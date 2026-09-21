/**
 * BOS Pipeline Worker — Background job (30s interval)
 * The core BOS "heartbeat": scans all non-terminal, non-manual-review disbursements
 * and advances them through the state machine.
 *
 * Step 1 (Stacks Burn):   disbursement_initiated → burn_submitted → burn_confirmed
 * Step 2 (Attestation):   burn_confirmed → attestation_requested → attestation_confirmed
 * Step 3 (Release):       attestation_confirmed → destination_release_submitted → destination_release_confirmed
 * Step 4 (Payout):        destination_release_confirmed → yellowcard_payout_submitted → yellowcard_payout_confirmed → settled
 *
 * All operations are idempotent. Individual failures do not block other disbursements.
 * Each disbursement is advanced by at most ONE step per tick (prevents runaway loops).
 */

import { TERMINAL_STATES, DisbursementState } from './types.js';
import { advanceDisbursement } from './disbursementService.js';

const PIPELINE_INTERVAL_MS = parseInt(process.env.BOS_PIPELINE_INTERVAL_MS || '30000', 10);
const BATCH_SIZE = parseInt(process.env.BOS_PIPELINE_BATCH_SIZE || '25', 10);

// States the pipeline worker processes (all non-terminal, non-manual)
const PIPELINE_STATES = Object.values(DisbursementState).filter(
  s => !TERMINAL_STATES.has(s) && s !== DisbursementState.MANUAL_REVIEW
);

let _running = false;
let _interval = null;
let _ctx = null;
let _stats = {
  runs: 0,
  advanced: 0,
  skipped: 0,
  errors: 0,
  lastRun: null,
  lastDurationMs: null,
  perState: {},
};

/**
 * Initialize the pipeline worker with runtime context
 */
export function init(ctx) {
  _ctx = ctx;
}

/**
 * Start the pipeline background loop
 */
export function start(intervalMs = PIPELINE_INTERVAL_MS) {
  if (_interval) return;
  _interval = setInterval(_tick, intervalMs);
  _ctx?.getLogger('pipeline')?.info({ intervalMs }, 'Pipeline worker started');
}

/**
 * Stop the pipeline background loop
 */
export function stop() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    _ctx?.getLogger('pipeline')?.info('Pipeline worker stopped');
  }
}

/**
 * Get current pipeline statistics
 */
export function getStats() {
  return { ..._stats };
}

/**
 * Single manual run (for testing / operator trigger)
 */
export async function runOnce() {
  return _tick();
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: single pipeline tick
// ─────────────────────────────────────────────────────────────────────────────

async function _tick() {
  if (_running) {
    _ctx?.getLogger('pipeline')?.debug('Pipeline tick already in progress, skipping');
    return;
  }

  _running = true;
  const startTime = Date.now();
  const log = _ctx?.getLogger('pipeline');
  const db = _ctx?.getDb();

  let advanced = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // ── Fetch all actionable disbursements ──────────────────────────────
    const disbursements = await db.all(
      `SELECT * FROM disbursements
       WHERE status = ANY($1)
         AND (last_heartbeat_at IS NULL OR last_heartbeat_at < NOW() - INTERVAL '5 seconds')
       ORDER BY created_at ASC
       LIMIT $2`,
      [PIPELINE_STATES, BATCH_SIZE]
    );

    if (disbursements.length === 0) {
      _stats.runs++;
      _stats.lastRun = new Date().toISOString();
      _stats.lastDurationMs = Date.now() - startTime;
      return;
    }

    log?.info({ count: disbursements.length }, 'Pipeline tick: processing disbursements');

    // ── Process each disbursement ──────────────────────────────────────
    for (const d of disbursements) {
      try {
        const result = await advanceDisbursement(d.id);

        if (result === null) {
          // Terminal state or no valid transitions — skip
          skipped++;
          continue;
        }

        if (result.success) {
          advanced++;
          _stats.perState[d.status] = (_stats.perState[d.status] || 0) + 1;
          log?.info(
            { id: d.id, from: d.status, to: result.new_state },
            'Disbursement advanced'
          );
        } else {
          // Guard rejected — not an error, just not ready yet
          skipped++;
          log?.debug(
            { id: d.id, from: d.status, error: result.error, error_code: result.error_code },
            'Transition guard rejected'
          );
        }
      } catch (err) {
        errors++;
        log?.error(
          { id: d.id, status: d.status, error: err.message },
          'Pipeline failed to advance disbursement'
        );
      }
    }

    _stats.runs++;
    _stats.advanced += advanced;
    _stats.skipped += skipped;
    _stats.errors += errors;
    _stats.lastRun = new Date().toISOString();
    _stats.lastDurationMs = Date.now() - startTime;

    log?.info(
      {
        processed: disbursements.length,
        advanced,
        skipped,
        errors,
        duration_ms: _stats.lastDurationMs,
        total_runs: _stats.runs,
      },
      'Pipeline tick complete'
    );
  } catch (err) {
    _stats.errors++;
    _stats.lastRun = new Date().toISOString();
    _stats.lastDurationMs = Date.now() - startTime;
    log?.error({ error: err.message }, 'Pipeline tick failed');
    if (_ctx?.emitEvent) {
      await _ctx.emitEvent({
        disbursement_id: null,
        old_status: null,
        new_status: null,
        action: 'pipeline_failure',
        details: { error: err.message },
        triggered_by: 'pipeline',
      });
    }
  } finally {
    _running = false;
  }
}
