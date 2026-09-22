/**
 * BOS State Machine — 15 states, observation-based destination release
 * Each transition = { guard, action } pair
 * Guard: pure predicate — reads state, returns { ok, error_code, reason }
 * Action: side-effect — writes DB, calls external API, returns update payload
 */

import { DisbursementState as S, TERMINAL_STATES } from './types.js';
import * as guards from './transitionGuards.js';
import * as actions from './transitionActions.js';
import { recordTransitionEvidence } from './evidenceCollector.js';

/**
 * Action-returned fields that are written onto the `disbursements` row.
 * Anything not listed here is recorded in the audit log but never persisted
 * to the row — which is how external tx ids were previously dropped.
 *
 * `release_status` is whitelisted so observation actions persist the external
 * settlement evidence onto the row (G-08 gating).
 * `release_id` is NOT whitelisted: it was the fabricated id of the removed
 * `releaseDestination()` call and must never be written again.
 */
const PERSISTED_ACTION_FIELDS = {
  settled_at: (v) => v,
  failed_at: (v) => v,
  cancelled_at: (v) => v,
  manual_review_at: (v) => v,
  preflight_result: (v) => JSON.stringify(v),
  external_tx_id: (v) => v,
  attestation_id: (v) => v,
  payout_id: (v) => v,
  release_status: (v) => v,
};

// ─────────────────────────────────────────────────────────────────────────────
// Transition table: key = `${from}→${to}`
// Each entry: { description, guard, action }
// ─────────────────────────────────────────────────────────────────────────────

const TRANSITIONS = new Map([
  // ── Preflight (§8 SAFE Forwarding) ─────────────────────────────────────
  [`${S.DISBURSEMENT_INITIATED}→${S.PREFLIGHT_CHECK}`, {
    description: 'Run financial safety gates before burn phase',
    guard:  guards.preflightRequested,
    action: actions.runPreflightCheck,
  }],
  [`${S.PREFLIGHT_CHECK}→${S.BURN_SUBMITTED}`, {
    description: 'Preflight passed — proceed with USDCx burn',
    guard:  guards.preflightPassed,
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

  // ── Destination release lifecycle (G-08: observed, never fabricated) ─────
  // The app does not "request" a release it controls. After the attestation is
  // confirmed, the external settlement process releases USDC off-chain; the app
  // parks in destination_release_unobserved, records any evidence it sees
  // (→ destination_release_observed), and only confirms on pushed evidence
  // that reports observed_confirmed (→ destination_release_confirmed).
  // `advanceDisbursement` attempts exactly one candidate (nextStates[0]), so
  // the observation states CHAIN instead of branching; evidence that reports
  // pending/confirmed/failed all advance unobserved → observed, then the
  // next tick routes confirmed → destination_release_confirmed. The → failed
  // routes stay available for direct execution (webhook/operator path),
  // consistent with every other failure transition in this machine.
  [`${S.ATTESTATION_CONFIRMED}→${S.DESTINATION_RELEASE_UNOBSERVED}`, {
    description: 'Begin observing destination release — no external evidence yet',
    guard:  guards.attestationConfirmedForRelease,
    action: actions.beginReleaseObservation,
  }],
  [`${S.ATTESTATION_CONFIRMED}→${S.FAILED}`, {
    description: 'Destination release observation could not begin',
    guard:  guards.withinRetryBudget,
    action: actions.markFailed,
  }],
  [`${S.DESTINATION_RELEASE_UNOBSERVED}→${S.DESTINATION_RELEASE_OBSERVED}`, {
    description: 'External evidence recorded for destination release',
    guard:  guards.isReleaseObserved,
    action: actions.recordReleaseObservation,
  }],
  [`${S.DESTINATION_RELEASE_UNOBSERVED}→${S.FAILED}`, {
    description: 'Destination release observation reports failure',
    guard:  guards.isReleaseObservedFailed,
    action: actions.recordReleaseObservedFailed,
  }],
  [`${S.DESTINATION_RELEASE_OBSERVED}→${S.DESTINATION_RELEASE_CONFIRMED}`, {
    description: 'External evidence reports destination release confirmed',
    guard:  guards.isReleaseObservedConfirmed,
    action: actions.confirmDestinationRelease,
  }],
  [`${S.DESTINATION_RELEASE_OBSERVED}→${S.FAILED}`, {
    description: 'Destination release observation reports failure',
    guard:  guards.isReleaseObservedFailed,
    action: actions.recordReleaseObservedFailed,
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

    // Fail-closed routing: a guard may demand escalation instead of a stall
    // (e.g. a failed preflight must reach manual review, not block the burn forever).
    if (
      guardResult.action === 'MANUAL_REVIEW_REQUIRED' &&
      toState !== S.MANUAL_REVIEW &&
      getTransition(fromState, S.MANUAL_REVIEW)
    ) {
      log.warn(
        { id: disbursement.id, from: fromState, attempted: toState, error_code: guardResult.error_code },
        'Guard requires manual review — escalating'
      );
      const escalated = await executeTransition(disbursement, S.MANUAL_REVIEW, context, {}, triggeredBy);
      return { ...escalated, escalated_from_rejection: true };
    }

    return {
      success: false,
      error: guardResult.reason,
      error_code: guardResult.error_code,
      new_state: null,
    };
  }

  // ── Claim the transition (optimistic concurrency) ───────────────────
  // The `AND status = $2` predicate in the WHERE clause is a compare-and-swap,
  // NOT an accidental condition: the row is only claimed while it still sits in
  // `fromState`. A concurrent advance (pipeline tick, webhook delivery, retry)
  // that already moved the row affects 0 rows here, so we bail out as a benign
  // no-op BEFORE any side-effect runs. Without this, two overlapping workers
  // could both pass the guard and both broadcast the burn.
  const db = context.getDb();
  const claim = await db.run(
    `UPDATE disbursements
     SET status = $1,
         updated_at = NOW(),
         last_heartbeat_at = NOW(),
         retry_count = CASE WHEN $1 = $2 THEN retry_count + 1 ELSE retry_count END,
         error_message = NULL
     WHERE id = $3 AND status = $2`,
    [toState, fromState, disbursement.id]
  );

  if (claim.changes === 0) {
    log.warn(
      { id: disbursement.id, from: fromState, to: toState, error_code: 'u8293' },
      'Transition already applied by a concurrent process — benign no-op'
    );
    return {
      success: false,
      error: 'already advanced',
      error_code: 'u8293',
      new_state: null,
      already_advanced: true,
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
    // Roll back the claim so a subsequent retry can re-attempt from fromState,
    // and record the error — same observable behaviour as an action failure
    // that never claimed the row (row left in source state + error message).
    await db.run(
      `UPDATE disbursements SET status = $1, error_message = $2, last_error = $3, updated_at = NOW() WHERE id = $4 AND status = $5`,
      [fromState, err.message, err.message, disbursement.id, toState]
    );
    return {
      success: false,
      error: err.message,
      error_code: 'u8290',
      new_state: null,
    };
  }

  // ── Write state change to DB ────────────────────────────────────────
  const mergedDetails = { ...actionDetails, ...override };

  // Merge extra fields if provided (e.g., external_tx_id, preflight_result)
  const extraFields = [];
  const extraValues = [];
  let paramIdx = 4;
  for (const [field, encode] of Object.entries(PERSISTED_ACTION_FIELDS)) {
    if (mergedDetails[field] === undefined) continue;
    extraFields.push(`${field} = $${paramIdx}`);
    extraValues.push(encode(mergedDetails[field]));
    paramIdx++;
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

  // ── Write the canonical transition evidence record ───────────────────
  // Exactly one `transition`-type record per successful transition. The write
  // is best-effort AFTER the state flip and audit row (approved Sprint 4
  // interpretation #2): a failure must NEVER be silent — it is logged at ERROR
  // with the disbursement id + evidence type, and remains detectable by the
  // reconciliation consistency job later.
  try {
    await recordTransitionEvidence({
      db,
      disbursementId: disbursement.id,
      fromState,
      toState,
      triggeredBy,
      details: mergedDetails,
    });
  } catch (err) {
    log.error(
      { id: disbursement.id, evidence_type: 'transition', error: err.message },
      'Failed to record canonical transition evidence'
    );
  }

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
