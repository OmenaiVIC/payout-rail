/**
 * BOS State Machine — 13 states, 24 transitions
 * Each transition = { guard, action } pair
 * Guard: pure predicate — reads state, returns { ok, error_code, reason }
 * Action: side-effect — writes DB, calls external API, returns update payload
 */

import { DisbursementState as S, TERMINAL_STATES } from './types.js';
import * as guards from './transitionGuards.js';
import * as actions from './transitionActions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Transition table: key = `${from}→${to}`
// Each entry: { description, guard, action }
// ─────────────────────────────────────────────────────────────────────────────

const TRANSITIONS = new Map([
  // ── Preflight (§8 SAFE Forwarding) ─────────────────────────────────────
  [`${S.DISBURSEMENT_INITIATED}→${S.PREFLIGHT_CHECK}`, {
    description: 'Run financial safety gates before burn phase',
    guard:  guards.preflightPassed,
    action: actions.runPreflightCheck,
  }],
  [`${S.PREFLIGHT_CHECK}→${S.BURN_SUBMITTED}`, {
    description: 'Preflight passed — proceed with USDCx burn',
    guard:  guards.disbursementExists,
    action: actions.submitBurn,
  }],
  [`${S.PREFLIGHT_CHECK}→${S.MANUAL_REVIEW}`, {
    description: 'Preflight failed — escalate to manual review',
    guard:  guards.disbursementExists,
    action: actions.moveToManualReview,
  }],
  [`${S.PREFLIGHT_CHECK}→${S.FAILED}`, {
    description: 'Preflight fatal — disbursement failed',
    guard:  guards.disbursementExists,
    action: actions.markFailed,
  }],

  // ── Burn lifecycle ──────────────────────────────────────────────────────
  [`${S.DISBURSEMENT_INITIATED}→${S.BURN_SUBMITTED}`, {
    description: 'Broadcast USDCx burn tx to Stacks chain',
    guard:  guards.disbursementExists,
    action: actions.submitBurn,
  }],
  [`${S.BURN_SUBMITTED}→${S.BURN_CONFIRMED}`, {
    description: 'Burn tx confirmed on Stacks chain (≥1 block)',
    guard:  guards.isBurnConfirmed,
    action: actions.recordBurnConfirmation,
  }],
  [`${S.BURN_SUBMITTED}→${S.FAILED}`, {
    description: 'Burn tx failed or expired',
    guard:  guards.withinRetryBudget,
    action: actions.markFailed,
  }],

  // ── Attestation lifecycle ───────────────────────────────────────────────
  [`${S.BURN_CONFIRMED}→${S.ATTESTATION_REQUESTED}`, {
    description: 'Request xReserve attestation for the burn',
    guard:  guards.burnConfirmedForAttestation,
    action: actions.requestAttestation,
  }],
  [`${S.BURN_CONFIRMED}→${S.FAILED}`, {
    description: 'Attestation request failed',
    guard:  guards.withinRetryBudget,
    action: actions.markFailed,
  }],
  [`${S.ATTESTATION_REQUESTED}→${S.ATTESTATION_CONFIRMED}`, {
    description: 'xReserve confirms the attestation',
    guard:  guards.isAttestationConfirmed,
    action: actions.confirmAttestation,
  }],
  [`${S.ATTESTATION_REQUESTED}→${S.FAILED}`, {
    description: 'Attestation timed out or rejected',
    guard:  guards.withinRetryBudget,
    action: actions.markFailed,
  }],

  // ── Destination release lifecycle ───────────────────────────────────────
  [`${S.ATTESTATION_CONFIRMED}→${S.DESTINATION_RELEASE_SUBMITTED}`, {
    description: 'Request xReserve to release funds to creator BTC address',
    guard:  guards.attestationConfirmedForRelease,
    action: actions.submitDestinationRelease,
  }],
  [`${S.ATTESTATION_CONFIRMED}→${S.FAILED}`, {
    description: 'Destination release request failed',
    guard:  guards.withinRetryBudget,
    action: actions.markFailed,
  }],
  [`${S.DESTINATION_RELEASE_SUBMITTED}→${S.DESTINATION_RELEASE_CONFIRMED}`, {
    description: 'xReserve confirms BTC arrived at creator address',
    guard:  guards.isDestinationReleased,
    action: actions.confirmDestinationRelease,
  }],
  [`${S.DESTINATION_RELEASE_SUBMITTED}→${S.FAILED}`, {
    description: 'Destination release timed out or rejected',
    guard:  guards.withinRetryBudget,
    action: actions.markFailed,
  }],

  // ── Yellow Card payout lifecycle ────────────────────────────────────────
  [`${S.DESTINATION_RELEASE_CONFIRMED}→${S.YELLOWCARD_PAYOUT_SUBMITTED}`, {
    description: 'Initiate NGN payout via Yellow Card',
    guard:  guards.destinationReleasedForPayout,
    action: actions.submitYellowCardPayout,
  }],
  [`${S.DESTINATION_RELEASE_CONFIRMED}→${S.FAILED}`, {
    description: 'Yellow Card payout initiation failed',
    guard:  guards.withinRetryBudget,
    action: actions.markFailed,
  }],
  [`${S.YELLOWCARD_PAYOUT_SUBMITTED}→${S.YELLOWCARD_PAYOUT_CONFIRMED}`, {
    description: 'Yellow Card confirms NGN payout completed',
    guard:  guards.isPayoutConfirmed,
    action: actions.confirmYellowCardPayout,
  }],
  [`${S.YELLOWCARD_PAYOUT_SUBMITTED}→${S.FAILED}`, {
    description: 'Yellow Card payout failed or timed out',
    guard:  guards.withinRetryBudget,
    action: actions.markFailed,
  }],

  // ── Settlement (terminal) ───────────────────────────────────────────────
  [`${S.YELLOWCARD_PAYOUT_CONFIRMED}→${S.SETTLED}`, {
    description: 'Payout confirmed — disbursement complete',
    guard:  guards.disbursementExists,
    action: actions.markSettled,
  }],

  // ── Generic terminal transitions (any non-terminal state) ───────────────
  [`${S.MANUAL_REVIEW}→${S.FAILED}`, {
    description: 'Manual review resolved as failure',
    guard:  guards.disbursementExists,
    action: actions.markFailed,
  }],
  [`${S.MANUAL_REVIEW}→${S.SETTLED}`, {
    description: 'Manual review resolved as success (payout confirmed off-chain)',
    guard:  guards.disbursementExists,
    action: actions.markSettled,
  }],
  [`${S.MANUAL_REVIEW}→${S.CANCELLED}`, {
    description: 'Manual review resolved as cancelled',
    guard:  guards.disbursementExists,
    action: actions.markCancelled,
  }],
]);

// ─────────────────────────────────────────────────────────────────────────────
// Generic terminal transitions — any non-terminal → failed/cancelled/manual_review
// These are registered dynamically for every non-terminal state
// ─────────────────────────────────────────────────────────────────────────────

const GENERIC_TERMINAL_TARGETS = [
  { to: S.FAILED,        action: actions.markFailed,        desc: 'Fail disbursement' },
  { to: S.CANCELLED,     action: actions.markCancelled,     desc: 'Cancel disbursement' },
  { to: S.MANUAL_REVIEW, action: actions.moveToManualReview, desc: 'Escalate to manual review' },
];

for (const state of Object.values(S)) {
  if (TERMINAL_STATES.has(state)) continue;
  for (const { to, action, desc } of GENERIC_TERMINAL_TARGETS) {
    const key = `${state}→${to}`;
    if (!TRANSITIONS.has(key)) {
      TRANSITIONS.set(key, {
        description: desc,
        guard: guards.disbursementExists,
        action,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a specific transition definition
 */
export function getTransition(from, to) {
  return TRANSITIONS.get(`${from}→${to}`) || null;
}

/**
 * Get all valid next states for a given current state
 * Returns Array<{ to, description }>
 */
export function getValidNextStates(currentState) {
  const results = [];
  for (const [key, transition] of TRANSITIONS) {
    if (key.startsWith(`${currentState}→`)) {
      const to = key.split('→')[1];
      results.push({ to, description: transition.description });
    }
  }
  return results;
}

/**
 * Check whether a specific transition is allowed (without executing it)
 */
export function canTransition(from, to) {
  return TRANSITIONS.has(`${from}→${to}`);
}

/**
 * Execute a full transition: guard → action → DB update → audit log
 *
 * @param {Object}  disbursement      — current disbursement record
 * @param {string}  toState           — target state
 * @param {Object}  context           — { getDb, adapters, emitEvent, getLogger }
 * @param {Object}  [override]        — optional: override fields for the DB update
 * @param {string}  [triggeredBy='worker']
 * @returns {Promise<TransitionResult>}
 */
export async function executeTransition(disbursement, toState, context, override = {}, triggeredBy = 'worker') {
  const log = context.getLogger('stateMachine');
  const fromState = disbursement.status;

  // ── Lookup transition definition ──────────────────────────────────────
  const transition = getTransition(fromState, toState);
  if (!transition) {
    const msg = `Invalid transition: ${fromState} → ${toState}`;
    log.error({ from: fromState, to: toState, id: disbursement.id }, msg);
    return { success: false, error: msg, new_state: null };
  }

  // ── Run guard ────────────────────────────────────────────────────────
  const guardResult = await transition.guard(disbursement, context);
  if (!guardResult.ok) {
    log.warn(
      { id: disbursement.id, from: fromState, to: toState, error_code: guardResult.error_code },
      `Guard rejected transition: ${guardResult.reason}`
    );
    return {
      success: false,
      error: guardResult.reason,
      error_code: guardResult.error_code,
      new_state: null,
    };
  }

  // ── Execute action ──────────────────────────────────────────────────
  let actionDetails;
  try {
    actionDetails = await transition.action(disbursement, context);
  } catch (err) {
    log.error(
      { id: disbursement.id, from: fromState, to: toState, error: err.message },
      'Action failed during transition'
    );
    // Record error on the disbursement record
    const db = context.getDb();
    await db.run(
      `UPDATE disbursements SET error_message = $1, last_error = $2, updated_at = NOW() WHERE id = $3`,
      [err.message, err.message, disbursement.id]
    );
    return {
      success: false,
      error: err.message,
      error_code: 'u8290',
      new_state: null,
    };
  }

  // ── Write state change to DB ────────────────────────────────────────
  const db = context.getDb();
  const mergedDetails = { ...actionDetails, ...override };

  await db.run(
    `UPDATE disbursements
     SET status = $1,
         updated_at = NOW(),
         last_heartbeat_at = NOW(),
         retry_count = CASE WHEN $1 = $2 THEN retry_count + 1 ELSE retry_count END,
         error_message = NULL
     WHERE id = $3`,
    [toState, fromState, disbursement.id]
  );

  // Merge extra fields if provided (e.g., external_tx_id, error_message)
  const extraFields = [];
  const extraValues = [];
  let paramIdx = 4;
  for (const [field, value] of Object.entries(mergedDetails)) {
    if (['settled_at', 'failed_at', 'cancelled_at', 'manual_review_at'].includes(field)) {
      extraFields.push(`${field} = $${paramIdx}`);
      extraValues.push(value);
      paramIdx++;
    }
  }
  if (extraFields.length > 0) {
    await db.run(
      `UPDATE disbursements SET ${extraFields.join(', ')}, updated_at = NOW() WHERE id = $${paramIdx}`,
      [...extraValues, disbursement.id]
    );
  }

  // ── Write audit log ─────────────────────────────────────────────────
  await context.emitEvent({
    disbursement_id: disbursement.id,
    old_status: fromState,
    new_status: toState,
    action: `${fromState}→${toState}`,
    details: mergedDetails,
    triggered_by: triggeredBy,
  });

  log.info(
    { id: disbursement.id, from: fromState, to: toState, triggered_by: triggeredBy },
    `Transition completed: ${transition.description}`
  );

  return {
    success: true,
    new_state: toState,
    details: mergedDetails,
  };
}

/**
 * Get all registered transitions (for introspection / health checks)
 */
export function getAllTransitions() {
  const list = [];
  for (const [key, transition] of TRANSITIONS) {
    const [from, to] = key.split('→');
    list.push({ from, to, description: transition.description });
  }
  return list;
}

/**
 * Get transition statistics (count of transitions per from-state)
 * Useful for monitoring dashboard
 */
export function getTransitionStats() {
  const stats = {};
  for (const [key] of TRANSITIONS) {
    const from = key.split('→')[0];
    stats[from] = (stats[from] || 0) + 1;
  }
  return stats;
}
