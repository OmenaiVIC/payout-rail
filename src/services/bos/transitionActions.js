/**
 * BOS Transition Actions — Side-effect functions
 * Each action performs the real work: DB writes, external API calls, chain txs
 * All actions are idempotent — safe to re-run under duplicate worker execution.
 */

import { DisbursementState, ReleaseStatus } from './types.js';
import { USDCX_CONTRACT, PAYOUT_API_BASE_URL } from '../../config/chainConfig.js';
import { recordTxHash, recordApiResponse, recordGateResult, recordPollResult, recordStatusSnapshot } from './evidenceCollector.js';

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

  // ── On-chain broadcast event ──────────────────────────────────────
  await db.run(
    `INSERT INTO on_chain_events (disbursement_id, chain, event_type, tx_hash, status, raw_event)
     VALUES ($1, 'stacks', 'broadcast', $2, 'submitted', $3)`,
    [disbursement.id, burnTxId, JSON.stringify({ action: 'burn', amount: disbursement.amount_usdcx, submitted_at: new Date().toISOString() })]
  );

  await recordStatusSnapshot({
    db,
    disbursementId: disbursement.id,
    source: 'chain:stacks',
    status: 'submitted',
    responseTimeMs: null,
    errorMessage: null,
    payloadHash: `sha256:${burnTxId}`,
  });

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

  // ── On-chain confirmation event ───────────────────────────────────
  await db.run(
    `INSERT INTO on_chain_events (disbursement_id, chain, event_type, tx_hash, status, block_height, raw_event)
     VALUES ($1, 'stacks', 'confirmation', $2, 'confirmed', $3, $4)`,
    [disbursement.id, disbursement.external_tx_id, details.burn_block_height ?? null, JSON.stringify({ confirmed_at: new Date().toISOString() })]
  );

  await recordStatusSnapshot({
    db,
    disbursementId: disbursement.id,
    source: 'chain:stacks',
    status: 'confirmed',
    responseTimeMs: null,
    errorMessage: null,
    payloadHash: `sha256:${disbursement.external_tx_id}`,
  });

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
// Action: beginReleaseObservation
// attestation_confirmed → destination_release_unobserved (G-08)
// Parks the row as "nothing observed yet". Deliberately makes NO adapter call:
// the external settlement process releases funds on its own; there is nothing
// for the app to request or fabricate (the old `releaseDestination()` no-op is
// gone).
// ─────────────────────────────────────────────────────────────────────────────
export async function beginReleaseObservation(disbursement, ctx) {
  const log = ctx.getLogger('transition:beginReleaseObservation');
  log.info({ id: disbursement.id }, 'Begin observing destination release — no external evidence yet');
  return { release_status: ReleaseStatus.UNOBSERVED };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: recordReleaseObservation
// destination_release_unobserved → destination_release_observed (G-08)
// Observes the external settlement surface and persists whatever evidence
// exists (pending / confirmed / failed). The persisted value routes the next
// tick; it can only come from `observeDestinationRelease`, never from the app.
// ─────────────────────────────────────────────────────────────────────────────
export async function recordReleaseObservation(disbursement, ctx) {
  const log = ctx.getLogger('transition:recordReleaseObservation');
  const db = ctx.getDb();

  const observation = await observeReleaseFromAdapter(ctx, disbursement);

  await upsertExternalRef(db, disbursement.id, 'xreserve', 'observation', disbursement.id, {
    release_status: observation.release_status,
    source: observation.source || null,
    evidence: observation.evidence || null,
    observed_at: observation.observed_at || null,
  });

  await recordApiResponse({
    db,
    disbursementId: disbursement.id,
    adapter: 'xreserve',
    method: 'observeDestinationRelease',
    response: observation,
  });

  await recordPollResult({
    db,
    disbursementId: disbursement.id,
    adapter: 'xreserve',
    method: 'observeDestinationRelease',
    response: observation,
    status: observation.release_status,
    log,
  });

  log.info({ id: disbursement.id, release_status: observation.release_status }, 'Destination release observation recorded');
  return {
    release_status: observation.release_status,
    release_observed_at: observation.observed_at || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: confirmDestinationRelease
// destination_release_observed → destination_release_confirmed (G-08)
// Re-observes the external surface and persists the confirmation evidence.
// The guard (isReleaseObservedConfirmed) already required a fresh
// `observed_confirmed`; this action records the same observation as truth.
// ─────────────────────────────────────────────────────────────────────────────
export async function confirmDestinationRelease(disbursement, ctx) {
  const log = ctx.getLogger('transition:confirmDestinationRelease');
  const db = ctx.getDb();

  const observation = await observeReleaseFromAdapter(ctx, disbursement);

  await upsertExternalRef(db, disbursement.id, 'xreserve', 'observation', disbursement.id, {
    ...(await observationRefMetadata(db, disbursement.id)),
    release_status: observation.release_status,
    source: observation.source || null,
    evidence: observation.evidence || null,
    observed_at: observation.observed_at || null,
    confirmed_at: new Date().toISOString(),
  });

  await recordApiResponse({
    db,
    disbursementId: disbursement.id,
    adapter: 'xreserve',
    method: 'observeDestinationRelease',
    response: observation,
  });

  await recordPollResult({
    db,
    disbursementId: disbursement.id,
    adapter: 'xreserve',
    method: 'observeDestinationRelease',
    response: observation,
    status: observation.release_status,
    log,
  });

  log.info({ id: disbursement.id, release_status: observation.release_status }, 'Destination release confirmed');
  return {
    release_status: observation.release_status,
    release_observed_at: observation.observed_at || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action: recordReleaseObservedFailed
// destination_release_* → failed (G-08)
// Persists that the external surface reports the release failed.
// ─────────────────────────────────────────────────────────────────────────────
export async function recordReleaseObservedFailed(disbursement, ctx) {
  const log = ctx.getLogger('transition:recordReleaseObservedFailed');
  const db = ctx.getDb();

  const observation = await observeReleaseFromAdapter(ctx, disbursement);

  await upsertExternalRef(db, disbursement.id, 'xreserve', 'observation', disbursement.id, {
    ...(await observationRefMetadata(db, disbursement.id)),
    release_status: observation.release_status,
    source: observation.source || null,
    evidence: observation.evidence || null,
    observed_at: observation.observed_at || null,
    failed_at: new Date().toISOString(),
  });

  await recordApiResponse({
    db,
    disbursementId: disbursement.id,
    adapter: 'xreserve',
    method: 'observeDestinationRelease',
    response: observation,
  });

  await recordPollResult({
    db,
    disbursementId: disbursement.id,
    adapter: 'xreserve',
    method: 'observeDestinationRelease',
    response: observation,
    status: observation.release_status,
    log,
  });

  log.warn({ id: disbursement.id, release_status: observation.release_status }, 'Destination release observation reports failure');
  return {
    release_status: observation.release_status,
    failed_at: new Date().toISOString(),
  };
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

/**
 * Fresh read of the external destination-release observation surface.
 * The app records ONLY what this returns — it never fabricates a release status.
 */
async function observeReleaseFromAdapter(ctx, disbursement) {
  const attestationRef = disbursement.attestation_id
    ? null
    : await getExternalRef(ctx.getDb(), disbursement.id, 'xreserve', 'attestation_id');
  return ctx.adapters.xreserve.observeDestinationRelease({
    disbursement_id: disbursement.id,
    external_tx_id: disbursement.external_tx_id || null,
    attestation_id: disbursement.attestation_id || attestationRef?.identifier_value || null,
  });
}

/**
 * Existing observation metadata (so confirm/failed actions merge, not replace,
 * the first observation that moved the row to `observed`).
 */
async function observationRefMetadata(db, disbursementId) {
  const ref = await getExternalRef(db, disbursementId, 'xreserve', 'observation');
  return ref?.metadata || {};
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
