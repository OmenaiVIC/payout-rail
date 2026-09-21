/**
 * BOS Stuck-State Reaper — Background job (60s interval)
 * Detects disbursements stuck in non-terminal states beyond their SLA threshold
 * Moves them to manual_review and emits alerts
 */

import { DisbursementState, TERMINAL_STATES } from './types.js';
import { recoverStuckDisbursement } from './disbursementService.js';
import { getReaperThresholdMs } from './monitoring/thresholdConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// State → SLA threshold mapping (from BOS design doc §6)
// Reaper triggers at 2× the SLA threshold
// ─────────────────────────────────────────────────────────────────────────────

const STATE_SLA_MS = {
  [DisbursementState.BURN_SUBMITTED]:               600_000,  // 10 min
  [DisbursementState.BURN_CONFIRMED]:               300_000,  // 5 min (internal, fast)
  [DisbursementState.ATTESTATION_REQUESTED]:         900_000,  // 15 min
  [DisbursementState.ATTESTATION_CONFIRMED]:         300_000,  // 5 min (internal, fast)
  [DisbursementState.DESTINATION_RELEASE_SUBMITTED]: 3_600_000, // 60 min
  [DisbursementState.DESTINATION_RELEASE_CONFIRMED]: 300_000,  // 5 min (internal, fast)
  [DisbursementState.YELLOWCARD_PAYOUT_SUBMITTED]:   1_800_000, // 30 min
};

// States the reaper should NOT touch (manual_review is operator-managed)
const REAPER_SKIP_STATES = new Set([
  ...TERMINAL_STATES,
  DisbursementState.MANUAL_REVIEW,
]);

// ─────────────────────────────────────────────────────────────────────────────
// Reaper
// ─────────────────────────────────────────────────────────────────────────────

let _running = false;
let _interval = null;
let _ctx = null;
let _stats = { runs: 0, flagged: 0, errors: 0, lastRun: null };

/**
 * Initialize the reaper with runtime context
 */
export function init(ctx) {
  _ctx = ctx;
}

/**
 * Start the reaper background loop
 * @param {number} intervalMs — check interval (default 60s)
 */
export function start(intervalMs = 60_000) {
  if (_interval) return; // already running
  _interval = setInterval(_tick, intervalMs);
  _ctx?.getLogger('reaper')?.info({ intervalMs }, 'Stuck-state reaper started');
}

/**
 * Stop the reaper background loop
 */
export function stop() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    _ctx?.getLogger('reaper')?.info('Stuck-state reaper stopped');
  }
}

/**
 * Get current reaper statistics
 */
export function getStats() {
  return { ..._stats };
}

/**
 * Single manual run (for testing / operator trigger)
 */
export async function reapOnce() {
  return _tick();
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: single reaper tick
// ─────────────────────────────────────────────────────────────────────────────

async function _tick() {
  if (_running) {
    _ctx?.getLogger('reaper')?.debug('Reaper tick already in progress, skipping');
    return;
  }

  _running = true;
  const log = _ctx?.getLogger('reaper');
  const db = _ctx?.getDb();

  try {
    const flagged = await _findAndFlagStuckDisbursements(db, log);
    _stats.runs++;
    _stats.flagged += flagged;
    _stats.lastRun = new Date().toISOString();
    log?.info({ flagged, total_runs: _stats.runs }, 'Reaper tick complete');
  } catch (err) {
    _stats.errors++;
    log?.error({ error: err.message }, 'Reaper tick failed');
    // Emit monitor_failure alert if notifier available
    if (_ctx?.emitEvent) {
      await _ctx.emitEvent({
        disbursement_id: null,
        old_status: null,
        new_status: null,
        action: 'reaper_failure',
        details: { error: err.message },
        triggered_by: 'reaper',
      });
    }
  } finally {
    _running = false;
  }
}

/**
 * Find disbursements stuck beyond their SLA threshold and move to manual_review
 */
async function _findAndFlagStuckDisbursements(db, log) {
  let flagged = 0;

  for (const [state, slaMs] of Object.entries(STATE_SLA_MS)) {
    if (REAPER_SKIP_STATES.has(state)) continue;

    const reaperThresholdMs = getReaperThresholdMs(state, slaMs);
    const query = `
      SELECT * FROM disbursements
      WHERE status = $1
        AND last_heartbeat_at < NOW() - INTERVAL '${Math.round(reaperThresholdMs / 1000)} seconds'
      ORDER BY last_heartbeat_at ASC
      LIMIT 50
    `;

    const stuck = await db.all(query, [state]);

    for (const disbursement of stuck) {
      const ageMs = Date.now() - new Date(disbursement.last_heartbeat_at).getTime();
      log?.warn(
        {
          id: disbursement.id,
          status: disbursement.status,
          age_minutes: Math.round(ageMs / 60_000),
          sla_minutes: Math.round(slaMs / 60_000),
        },
        'Disbursement stuck — moving to manual review'
      );

      try {
        await recoverStuckDisbursement(disbursement.id, `stuck_in_${state}_beyond_sla`);
        flagged++;
      } catch (err) {
        log?.error({ id: disbursement.id, error: err.message }, 'Failed to flag stuck disbursement');
        _stats.errors++;
      }
    }
  }

  return flagged;
}
