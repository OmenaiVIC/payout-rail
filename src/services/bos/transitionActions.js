/**
 * BOS Transition Actions — Side-effect functions
 * Each action performs the real work: DB writes, external API calls, chain txs
 * All actions are idempotent — safe to re-run under duplicate worker execution.
 */

import { DisbursementState } from './types.js';
import { USDCX_CONTRACT, PAYOUT_API_BASE_URL } from '../../config/chainConfig.js';
import { recordTxHash, recordApiResponse, recordGateResult } from './evidenceCollector.js';

// ─────────────────────────────────────────────────────────────────────────────
// Action: runPreflightCheck
// disbursement_initiated → preflight_check
// Runs all financial safety gates before the burn phase
// ─────────────────────────────────────────────────────────────────────────────
export async function runPreflightCheck(disbursement, ctx) {
  const log = ctx.getLogger('transition:runPreflightCheck');
  const db = ctx.getDb();

  log.info({ id: disbursement.id }, 'Running preflight check');

  const { runPreflight } = await import('./preflight.js');
  const result = await runPreflight(disbursement, ctx);

  // ── Record each gate result in payout_gates table ────────────────────
  if (result.gate_results) {
    for (const gate of result.gate_results) {
      await db.run(
        `INSERT INTO payout_gates (disbursement_id, gate_name, passed, error_code, reason, warning, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [disbursement.id, gate.gate, gate.ok, gate.error_code, gate.reason, gate.warning, JSON.stringify(gate.details || {})]
      );
      await recordGateResult({
        db, disbursementId: disbursement.id,
        gateName: gate.gate, passed: gate.ok,
        reason: gate.reason, details: { error_code: gate.error_code, warning: gate.warning },
      });
    }
  }

  if (!result.ok) {
    log.warn({ id: disbursement.id, action: result.action, gates: result.gate_results?.map(g => g.gate) },
      'Preflight failed — moving to manual review');
  } else {
    log.info({ id: disbursement.id, gates: result.gate_results?.length }, 'Preflight passed');
  }

  return {
    preflight_result: {
      ok: result.ok === true,
      action: result.action || null,
      gate_results: result.gate_results || [],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: submitBurn
// disbursement_initiated → burn_submitted
// Broadcasts USDCx burn tx on Stacks chain
// ─────────────────────────────────────────────────────────────────────────────
export async function submitBurn(disbursement, ctx) {
  const log = ctx.getLogger('transition:submitBurn');
  const db = ctx.getDb();

  log.info({ id: disbursement.id, amount_usdcx: disbursement.amount_usdcx }, 'Submitting burn tx');

  const burnTxId = await ctx.adapters.stacks.burnUsdcx({
    amount: disbursement.amount_usdcx,
    recipient: disbursement.creator_address,
    memo: `BOS:${disbursement.id}`,
    idempotencyKey: `burn:${disbursement.id}`,
  });

  await upsertExternalRef(db, disbursement.id, 'stacks', 'tx_id', burnTxId, {
    burn_amount: disbursement.amount_usdcx,
    submitted_at: new Date().toISOString(),
  });

  await recordTxHash({ db, disbursementId: disbursement.id, chain: 'stacks', txHash: burnTxId, details: { action: 'burn', amount: disbursement.amount_usdcx } });

  log.info({ id: disbursement.id, burnTxId }, 'Burn tx submitted');
  return { external_tx_id: burnTxId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: recordBurnConfirmation
// burn_submitted → burn_confirmed
// Writes burn block height into external_refs metadata
// ─────────────────────────────────────────────────────────────────────────────
export async function recordBurnConfirmation(disbursement, ctx) {
  const log = ctx.getLogger('transition:recordBurnConfirmation');
  const db = ctx.getDb();

  const details = await isBurnConfirmed(disbursement, ctx);
  const meta = { confirmed_at: new Date().toISOString(), block_height: details.burn_block_height };

  await upsertExternalRef(db, disbursement.id, 'stacks', 'tx_id', disbursement.external_tx_id, meta);

  log.info({ id: disbursement.id, block_height: details.burn_block_height }, 'Burn confirmed');
  return { burn_block_height: details.burn_block_height };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: requestAttestation
// burn_confirmed → attestation_requested
// Requests attestation from xReserve
// ─────────────────────────────────────────────────────────────────────────────
export async function requestAttestation(disbursement, ctx) {
  const log = ctx.getLogger('transition:requestAttestation');
  const db = ctx.getDb();

  log.info({ id: disbursement.id }, 'Requesting xReserve attestation');

  const attestation = await ctx.adapters.xreserve.requestAttestation({
    tx_id: disbursement.external_tx_id,
    token_contract: USDCX_CONTRACT,
    amount_base_units: disbursement.amount_usdcx,
  });

  await upsertExternalRef(db, disbursement.id, 'xreserve', 'attestation_id', attestation.attestation_id, {
    requested_at: new Date().toISOString(),
    attestation_data: attestation,
  });

  await recordApiResponse({ db, disbursementId: disbursement.id, adapter: 'xreserve', method: 'requestAttestation', response: attestation });

  log.info({ id: disbursement.id, attestation_id: attestation.attestation_id }, 'Attestation requested');
  return { attestation_id: attestation.attestation_id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: confirmAttestation
// attestation_requested → attestation_confirmed
// Records xReserve confirmation metadata
// ─────────────────────────────────────────────────────────────────────────────
export async function confirmAttestation(disbursement, ctx) {
  const log = ctx.getLogger('transition:confirmAttestation');
  const db = ctx.getDb();

  const ref = await getExternalRef(db, disbursement.id, 'xreserve', 'attestation_id');
  const attestation = await ctx.adapters.xreserve.getAttestationStatus(ref.identifier_value);

  await upsertExternalRef(db, disbursement.id, 'xreserve', 'attestation_id', ref.identifier_value, {
    ...ref.metadata,
    confirmed_at: new Date().toISOString(),
    attestation_data: attestation,
  });

  await recordApiResponse({ db, disbursementId: disbursement.id, adapter: 'xreserve', method: 'getAttestationStatus', response: attestation });

  log.info({ id: disbursement.id, attestation_id: ref.identifier_value }, 'Attestation confirmed');
  return { attestation_id: ref.identifier_value };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: submitDestinationRelease
// attestation_confirmed → destination_release_submitted
// Requests xReserve to release funds to creator's BTC address
// ─────────────────────────────────────────────────────────────────────────────
export async function submitDestinationRelease(disbursement, ctx) {
  const log = ctx.getLogger('transition:submitDestinationRelease');
  const db = ctx.getDb();

  log.info({ id: disbursement.id }, 'Submitting destination release');

  const release = await ctx.adapters.xreserve.releaseDestination({
    attestation_id: await _getAttestationId(db, disbursement.id),
    recipient_btc: disbursement.creator_btc_address || disbursement.creator_address,
    amount_base_units: disbursement.amount_usdcx,
    idempotencyKey: `release:${disbursement.id}`,
  });

  await upsertExternalRef(db, disbursement.id, 'xreserve', 'release_id', release.release_id, {
    submitted_at: new Date().toISOString(),
    release_data: release,
  });

  await recordApiResponse({ db, disbursementId: disbursement.id, adapter: 'xreserve', method: 'releaseDestination', response: release });

  log.info({ id: disbursement.id, release_id: release.release_id }, 'Destination release submitted');
  return { release_id: release.release_id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: confirmDestinationRelease
// destination_release_submitted → destination_release_confirmed
// Records release confirmation from xReserve
// ─────────────────────────────────────────────────────────────────────────────
export async function confirmDestinationRelease(disbursement, ctx) {
  const log = ctx.getLogger('transition:confirmDestinationRelease');
  const db = ctx.getDb();

  const ref = await getExternalRef(db, disbursement.id, 'xreserve', 'release_id');
  const release = await ctx.adapters.xreserve.getReleaseStatus(ref.identifier_value);

  await upsertExternalRef(db, disbursement.id, 'xreserve', 'release_id', ref.identifier_value, {
    ...ref.metadata,
    confirmed_at: new Date().toISOString(),
    release_data: release,
  });

  await recordApiResponse({ db, disbursementId: disbursement.id, adapter: 'xreserve', method: 'getReleaseStatus', response: release });

  log.info({ id: disbursement.id, release_id: ref.identifier_value }, 'Destination release confirmed');
  return { release_id: ref.identifier_value };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: submitYellowCardPayout
// destination_release_confirmed → yellowcard_payout_submitted
// Initiates NGN payout via Yellow Card
// ─────────────────────────────────────────────────────────────────────────────
export async function submitYellowCardPayout(disbursement, ctx) {
  const log = ctx.getLogger('transition:submitYellowCardPayout');
  const db = ctx.getDb();

  const amount_ngn = disbursement.amount_ngn_expected;
  if (!amount_ngn || amount_ngn <= 0) {
    throw new Error(`amount_ngn_expected missing or zero: ${amount_ngn}`);
  }

  const recipient_type = deriveRecipientType(disbursement.ngn_recipient);

  log.info({ id: disbursement.id, amount_ngn, recipient_type }, 'Submitting Yellow Card payout');

  const payout = await ctx.adapters.yellowcard.submitSend({
    idempotency_key: `payout:${disbursement.id}`,
    amount: amount_ngn,
    currency: 'NGN',
    recipient_type,
    recipient: disbursement.ngn_recipient || {},
    callback_url: `${PAYOUT_API_BASE_URL}/api/bos/webhooks/yellowcard`,
  });

  await upsertExternalRef(db, disbursement.id, 'yellowcard', 'payout_id', payout.send_id, {
    submitted_at: new Date().toISOString(),
    amount_ngn,
    exchange_rate: disbursement.exchange_rate || null,
    payout_data: payout,
  });

  await recordApiResponse({ db, disbursementId: disbursement.id, adapter: 'yellowcard', method: 'submitSend', response: payout });

  log.info({ id: disbursement.id, payout_id: payout.send_id }, 'Yellow Card payout submitted');
  return { payout_id: payout.send_id, amount_ngn };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: confirmYellowCardPayout
// yellowcard_payout_submitted → yellowcard_payout_confirmed
// Records Yellow Card payout confirmation
// ─────────────────────────────────────────────────────────────────────────────
export async function confirmYellowCardPayout(disbursement, ctx) {
  const log = ctx.getLogger('transition:confirmYellowCardPayout');
  const db = ctx.getDb();

  const ref = await getExternalRef(db, disbursement.id, 'yellowcard', 'payout_id');
  const payout = await ctx.adapters.yellowcard.lookupSend(ref.identifier_value);

  await upsertExternalRef(db, disbursement.id, 'yellowcard', 'payout_id', ref.identifier_value, {
    ...ref.metadata,
    confirmed_at: new Date().toISOString(),
    payout_data: payout,
  });

  await recordApiResponse({ db, disbursementId: disbursement.id, adapter: 'yellowcard', method: 'lookupSend', response: payout });

  log.info({ id: disbursement.id, payout_id: ref.identifier_value }, 'Yellow Card payout confirmed');
  return { payout_id: ref.identifier_value };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: markSettled
// yellowcard_payout_confirmed → settled
// Terminal: records settlement timestamp
// ─────────────────────────────────────────────────────────────────────────────
export async function markSettled(disbursement, ctx) {
  const log = ctx.getLogger('transition:markSettled');
  log.info({ id: disbursement.id }, 'Disbursement settled');
  return { settled_at: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: markFailed
// Any non-terminal → failed
// Terminal: records failure reason
// ─────────────────────────────────────────────────────────────────────────────
export async function markFailed(disbursement, ctx) {
  const log = ctx.getLogger('transition:markFailed');
  log.warn({ id: disbursement.id, reason: disbursement.last_error }, 'Disbursement marked failed');
  return { failed_at: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: markCancelled
// Any non-terminal → cancelled
// Terminal: user/system requested cancellation
// ─────────────────────────────────────────────────────────────────────────────
export async function markCancelled(disbursement, ctx) {
  const log = ctx.getLogger('transition:markCancelled');
  log.info({ id: disbursement.id }, 'Disbursement cancelled');
  return { cancelled_at: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: moveToManualReview
// Any non-terminal → manual_review
// Background reaper or explicit operator action
// ─────────────────────────────────────────────────────────────────────────────
export async function moveToManualReview(disbursement, ctx) {
  const log = ctx.getLogger('transition:moveToManualReview');
  log.warn({ id: disbursement.id, from_status: disbursement.status }, 'Moving to manual review');
  return { manual_review_at: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Helpers — external_refs upsert (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert an external reference. If a row with the same
 * (disbursement_id, external_system, identifier_type) already exists,
 * the metadata is merged (JSONB patch).
 */
export async function upsertExternalRef(db, disbursementId, system, idType, idValue, metadata = {}) {
  await db.run(
    `INSERT INTO external_refs (disbursement_id, external_system, identifier_type, identifier_value, metadata, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (disbursement_id, external_system, identifier_type)
     DO UPDATE SET
       identifier_value = EXCLUDED.identifier_value,
       metadata = external_refs.metadata || EXCLUDED.metadata,
       updated_at = NOW()`,
    [disbursementId, system, idType, idValue, JSON.stringify(metadata)]
  );
}

/**
 * Get an external reference by (disbursement_id, system, type)
 */
export async function getExternalRef(db, disbursementId, system, idType) {
  return db.get(
    `SELECT * FROM external_refs
     WHERE disbursement_id = $1 AND external_system = $2 AND identifier_type = $3`,
    [disbursementId, system, idType]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function _getAttestationId(db, disbursementId) {
  const ref = await getExternalRef(db, disbursementId, 'xreserve', 'attestation_id');
  if (!ref) throw new Error(`No attestation_id ref for disbursement ${disbursementId}`);
  return ref.identifier_value;
}

async function isBurnConfirmed(disbursement, ctx) {
  const status = await ctx.adapters.stacks.getTransactionStatus(disbursement.external_tx_id);
  return { burn_block_height: status.block_height };
}

/**
 * Derive Yellow Card recipient_type from ngn_recipient payload.
 * Defaults to 'bank_account' if unknown.
 */
function deriveRecipientType(recipient) {
  if (!recipient) return 'bank_account';
  if (recipient.type) return recipient.type;
  if (recipient.bankCode || recipient.bank_code || recipient.accountNumber || recipient.account_number) return 'bank_account';
  if (recipient.mobile_number || recipient.phoneNumber || recipient.provider) return 'mobile_money';
  return 'bank_account';
}
