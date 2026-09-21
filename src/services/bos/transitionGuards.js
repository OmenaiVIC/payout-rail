/**
 * BOS Transition Guards — Pure predicate functions (no side effects)
 * Each guard returns { ok: true } or { ok: false, error_code, reason }
 */

import { DisbursementState } from './types.js';
import { runAllGates } from './payoutGates.js';
import { TwoPersonApproval } from './twoPersonApproval.js';

const twoPersonApproval = new TwoPersonApproval();

/**
 * Check that a disbursement exists and is in an expected state
 */
export function disbursementExists(disbursement, _ctx) {
  if (!disbursement) {
    return { ok: false, error_code: 'u8201', reason: 'Disbursement not found' };
  }
  return { ok: true };
}

/**
 * burn_submitted → burn_confirmed
 * Guard: external_tx_id present + chain confirms ≥ 1 block confirmation
 */
export async function isBurnConfirmed(disbursement, ctx) {
  if (!disbursement.external_tx_id) {
    return { ok: false, error_code: 'u8211', reason: 'No external tx_id on record' };
  }
  try {
    const status = await ctx.adapters.stacks.getTransactionStatus(disbursement.external_tx_id);
    if (status.tx_status === 'success' && (status.block_height ?? 0) > 0) {
      return { ok: true, details: { burn_block_height: status.block_height } };
    }
    return { ok: false, error_code: 'u8212', reason: `Burn tx status: ${status.tx_status}` };
  } catch (err) {
    return { ok: false, error_code: 'u8213', reason: `Chain query failed: ${err.message}` };
  }
}

/**
 * burn_confirmed → attestation_requested
 * Guard: burn confirmed on chain (chained from previous state but re-validates)
 */
export async function burnConfirmedForAttestation(disbursement, ctx) {
  return isBurnConfirmed(disbursement, ctx);
}

/**
 * attestation_requested → attestation_confirmed
 * Guard: xReserve has confirmed the attestation
 */
export async function isAttestationConfirmed(disbursement, ctx) {
  const ref = await _getExternalRef(ctx, disbursement.id, 'xreserve', 'attestation_id');
  if (!ref) {
    return { ok: false, error_code: 'u8221', reason: 'No attestation external_ref found' };
  }
  try {
    const status = await ctx.adapters.xreserve.getAttestationStatus(ref.identifier_value);
    if (status.status === 'confirmed') {
      return { ok: true, details: { attestation_id: ref.identifier_value, attestation_data: status } };
    }
    return { ok: false, error_code: 'u8222', reason: `Attestation status: ${status.status}` };
  } catch (err) {
    return { ok: false, error_code: 'u8223', reason: `Attestation poll failed: ${err.message}` };
  }
}

/**
 * attestation_confirmed → destination_release_submitted
 * Guard: attestation confirmed (re-validates)
 */
export async function attestationConfirmedForRelease(disbursement, ctx) {
  return isAttestationConfirmed(disbursement, ctx);
}

/**
 * destination_release_submitted → destination_release_confirmed
 * Guard: xReserve has confirmed the destination release (BTC arrived at recipient)
 */
export async function isDestinationReleased(disbursement, ctx) {
  const ref = await _getExternalRef(ctx, disbursement.id, 'xreserve', 'release_id');
  if (!ref) {
    return { ok: false, error_code: 'u8224', reason: 'No release external_ref found' };
  }
  try {
    const status = await ctx.adapters.xreserve.getReleaseStatus(ref.identifier_value);
    if (status.status === 'confirmed') {
      return { ok: true, details: { release_id: ref.identifier_value } };
    }
    return { ok: false, error_code: 'u8225', reason: `Release status: ${status.status}` };
  } catch (err) {
    return { ok: false, error_code: 'u8226', reason: `Release poll failed: ${err.message}` };
  }
}

/**
 * destination_release_confirmed → yellowcard_payout_submitted
 * Guard: destination release confirmed (re-validates) + payout gates + 2-of-N approval
 */
export async function destinationReleasedForPayout(disbursement, ctx) {
  const release = await isDestinationReleased(disbursement, ctx);
  if (!release.ok) return release;

  // Enforce payout gates before Yellow Card payout
  const gates = await runAllGates(disbursement, ctx);
  if (!gates.ok) {
    return { ok: false, error_code: 'u8235', reason: `Payout gates failed: ${gates.gate_results.find(r => !r.ok)?.reason}` };
  }

  // Enforce 2-of-N approval before Yellow Card payout
  const tpResult = await twoPersonApproval.check(disbursement, ctx);
  if (!tpResult.ok) {
    return { ok: false, error_code: tpResult.error_code, reason: tpResult.reason };
  }

  return { ok: true, details: release.details };
}

/**
 * yellowcard_payout_submitted → yellowcard_payout_confirmed
 * Guard: Yellow Card has confirmed the NGN payout arrived
 */
export async function isPayoutConfirmed(disbursement, ctx) {
  const ref = await _getExternalRef(ctx, disbursement.id, 'yellowcard', 'payout_id');
  if (!ref) {
    return { ok: false, error_code: 'u8231', reason: 'No payout external_ref found' };
  }
  try {
    const status = await ctx.adapters.yellowcard.lookupSend(ref.identifier_value);
    if (status.status === 'completed') {
      return { ok: true, details: { payout_id: ref.identifier_value } };
    }
    return { ok: false, error_code: 'u8232', reason: `Payout status: ${status.status}` };
  } catch (err) {
    return { ok: false, error_code: 'u8233', reason: `Payout poll failed: ${err.message}` };
  }
}

/**
 * Generic guard: is the exchange rate recent enough?
 * Used before any NGN amount calculation
 */
export async function hasValidExchangeRate(_disbursement, ctx) {
  try {
    const row = await ctx.getDb().get(
      `SELECT updated_at FROM exchange_rates ORDER BY updated_at DESC LIMIT 1`
    );
    if (!row) return { ok: false, error_code: 'u8204', reason: 'No exchange rate on file' };
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (age > 5 * 60 * 1000) {
      return { ok: false, error_code: 'u8205', reason: `Exchange rate stale: ${Math.round(age / 1000)}s old` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error_code: 'u8206', reason: `Rate query failed: ${err.message}` };
  }
}

/**
 * disbursement_initiated → preflight_check
 * Guard: disbursement exists (no external calls needed — preflight action does the real checks)
 */
export function preflightPassed(disbursement, _ctx) {
  if (!disbursement) {
    return { ok: false, error_code: 'u8201', reason: 'Disbursement not found' };
  }
  return { ok: true };
}

/**
 * Has the disbursement exceeded its retry budget?
 */
export function withinRetryBudget(disbursement, _ctx) {
  const max = disbursement.max_retries ?? 3;
  if (disbursement.retry_count >= max) {
    return { ok: false, error_code: 'u8291', reason: `Retry budget exhausted (${disbursement.retry_count}/${max})` };
  }
  return { ok: true };
}

/**
 * Is the disbursement in a terminal state? (for reaper/reconciliation checks)
 */
export function isTerminal(disbursement, _ctx) {
  const terminal = new Set([DisbursementState.SETTLED, DisbursementState.FAILED, DisbursementState.CANCELLED]);
  if (terminal.has(disbursement.status)) {
    return { ok: false, error_code: 'u8292', reason: `Already in terminal state: ${disbursement.status}` };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function _getExternalRef(ctx, disbursementId, system, identifierType) {
  const db = ctx.getDb();
  return db.get(
    `SELECT * FROM external_refs
     WHERE disbursement_id = $1 AND external_system = $2 AND identifier_type = $3`,
    [disbursementId, system, identifierType]
  );
}
