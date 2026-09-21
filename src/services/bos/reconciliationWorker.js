/**
 * BOS Reconciliation Worker — Background job (5 min interval)
 * Two jobs:
 *   1. reconcileUnrecordedBurns — scan Stacks chain for burns not yet recorded
 *   2. reconcileOrphanedPayouts — scan Yellow Card for completed payouts not yet advanced
 * Both are idempotent and safe to run under concurrent workers.
 */

import { DisbursementState } from './types.js';
import { advanceDisbursement } from './disbursementService.js';
import { upsertExternalRef } from './transitionActions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const RECONCILIATION_INTERVAL_MS = 5 * 60_000; // 5 minutes
const BURN_SCAN_BATCH_SIZE = 50;
const PAYOUT_SCAN_BATCH_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let _running = false;
let _interval = null;
let _ctx = null;
let _stats = {
  runs: 0,
  burns_matched: 0,
  burns_new: 0,
  payouts_matched: 0,
  payouts_new: 0,
  errors: 0,
  lastRun: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize the reconciliation worker with runtime context
 */
export function init(ctx) {
  _ctx = ctx;
}

/**
 * Start the reconciliation background loop
 */
export function start(intervalMs = RECONCILIATION_INTERVAL_MS) {
  if (_interval) return;
  _interval = setInterval(_tick, intervalMs);
  _ctx?.getLogger('reconciliation')?.info({ intervalMs }, 'Reconciliation worker started');
}

/**
 * Stop the reconciliation background loop
 */
export function stop() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    _ctx?.getLogger('reconciliation')?.info('Reconciliation worker stopped');
  }
}

/**
 * Get current reconciliation statistics
 */
export function getStats() {
  return { ..._stats };
}

/**
 * Single manual run (for testing / operator trigger)
 */
export async function reconcileOnce() {
  return _tick();
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: single reconciliation tick
// ─────────────────────────────────────────────────────────────────────────────

async function _tick() {
  if (_running) {
    _ctx?.getLogger('reconciliation')?.debug('Reconciliation tick already in progress, skipping');
    return;
  }

  _running = true;
  const log = _ctx?.getLogger('reconciliation');

  try {
    const db = _ctx.getDb();
    const [burnsResult, payoutsResult] = await Promise.allSettled([
      reconcileUnrecordedBurns(db, log),
      reconcileOrphanedPayouts(db, log),
    ]);

    _stats.runs++;
    _stats.lastRun = new Date().toISOString();

    if (burnsResult.status === 'fulfilled') {
      _stats.burns_matched += burnsResult.value.matched;
      _stats.burns_new += burnsResult.value.new;
    } else {
      _stats.errors++;
      log?.error({ error: burnsResult.reason?.message }, 'Burn reconciliation failed');
    }

    if (payoutsResult.status === 'fulfilled') {
      _stats.payouts_matched += payoutsResult.value.matched;
      _stats.payouts_new += payoutsResult.value.new;
    } else {
      _stats.errors++;
      log?.error({ error: payoutsResult.reason?.message }, 'Payout reconciliation failed');
    }

    log?.info(
      {
        total_runs: _stats.runs,
        burns: { matched: burnsResult.value?.matched ?? 0, new: burnsResult.value?.new ?? 0 },
        payouts: { matched: payoutsResult.value?.matched ?? 0, new: payoutsResult.value?.new ?? 0 },
      },
      'Reconciliation tick complete'
    );
  } catch (err) {
    _stats.errors++;
    log?.error({ error: err.message }, 'Reconciliation tick failed');
    if (_ctx?.emitEvent) {
      await _ctx.emitEvent({
        disbursement_id: null,
        old_status: null,
        new_status: null,
        action: 'reconciliation_failure',
        details: { error: err.message },
        triggered_by: 'reconciliation',
      });
    }
  } finally {
    _running = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 1: reconcileUnrecordedBurns
// Scan Stacks chain for USDCx burns that match disbursements in burn_submitted
// state but whose tx isn't yet in external_refs
// ─────────────────────────────────────────────────────────────────────────────

async function reconcileUnrecordedBurns(db, log) {
  let matched = 0;
  let newRecords = 0;

  // ── Find disbursements waiting for burn confirmation ───────────────────
  const pending = await db.all(
    `SELECT * FROM disbursements
     WHERE status = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [DisbursementState.BURN_SUBMITTED, BURN_SCAN_BATCH_SIZE]
  );

  if (pending.length === 0) return { matched: 0, new: 0 };

  log?.debug({ count: pending.length }, 'Scanning for unrecorded burns');

  for (const disbursement of pending) {
    if (!disbursement.external_tx_id) continue;

    // ── Check if external_ref already exists ────────────────────────────
    const existingRef = await db.get(
      `SELECT * FROM external_refs
       WHERE disbursement_id = $1 AND external_system = 'stacks' AND identifier_type = 'tx_id'`,
      [disbursement.id]
    );

    if (existingRef?.metadata?.confirmed_at) {
      matched++; // already fully recorded
      continue;
    }

    // ── Query chain for tx status ──────────────────────────────────────
    try {
      const status = await _ctx.adapters.stacks.getTransactionStatus(disbursement.external_tx_id);

      if (status.tx_status === 'success' && status.block_height > 0) {
        // ── Record confirmation ────────────────────────────────────────
        await upsertExternalRef(db, disbursement.id, 'stacks', 'tx_id', disbursement.external_tx_id, {
          confirmed_at: new Date().toISOString(),
          block_height: status.block_height,
          reconciled_by: 'reconciliation_worker',
        });

        log?.info(
          { id: disbursement.id, tx_id: disbursement.external_tx_id, block_height: status.block_height },
          'Reconciled unrecorded burn confirmation'
        );
        newRecords++;

        // ── Attempt to advance the disbursement ───────────────────────
        await advanceDisbursement(disbursement.id);
      }
    } catch (err) {
      log?.warn(
        { id: disbursement.id, tx_id: disbursement.external_tx_id, error: err.message },
        'Failed to check burn status during reconciliation'
      );
      _stats.errors++;
    }
  }

  return { matched, new: newRecords };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 2: reconcileOrphanedPayouts
// Scan Yellow Card for completed payouts not yet matched to disbursements
// ─────────────────────────────────────────────────────────────────────────────

async function reconcileOrphanedPayouts(db, log) {
  let matched = 0;
  let newRecords = 0;

  // ── Find disbursements waiting for payout confirmation ────────────────
  const pending = await db.all(
    `SELECT d.*, er.identifier_value as payout_id
     FROM disbursements d
     JOIN external_refs er ON er.disbursement_id = d.id
       AND er.external_system = 'yellowcard'
       AND er.identifier_type = 'payout_id'
     WHERE d.status = $1
     ORDER BY d.created_at ASC
     LIMIT $2`,
    [DisbursementState.YELLOWCARD_PAYOUT_SUBMITTED, PAYOUT_SCAN_BATCH_SIZE]
  );

  if (pending.length === 0) return { matched: 0, new: 0 };

  log?.debug({ count: pending.length }, 'Scanning for orphaned Yellow Card payouts');

  for (const disbursement of pending) {
    if (!disbursement.payout_id) continue;

    // ── Check if already confirmed in external_refs metadata ────────────
    const ref = await db.get(
      `SELECT * FROM external_refs
       WHERE disbursement_id = $1 AND external_system = 'yellowcard' AND identifier_type = 'payout_id'`,
      [disbursement.id]
    );

    if (ref?.metadata?.confirmed_at) {
      matched++; // already fully recorded
      continue;
    }

    // ── Query Yellow Card for payout status ─────────────────────────────
    try {
      const status = await _ctx.adapters.yellowcard.getPayoutStatus(disbursement.payout_id);

      if (status.status === 'completed') {
        // ── Record confirmation ────────────────────────────────────────
        await upsertExternalRef(db, disbursement.id, 'yellowcard', 'payout_id', disbursement.payout_id, {
          ...(ref?.metadata || {}),
          confirmed_at: new Date().toISOString(),
          payout_data: status,
          reconciled_by: 'reconciliation_worker',
        });

        log?.info(
          { id: disbursement.id, payout_id: disbursement.payout_id },
          'Reconciled orphaned Yellow Card payout'
        );
        newRecords++;

        // ── Attempt to advance the disbursement ───────────────────────
        await advanceDisbursement(disbursement.id);
      }
    } catch (err) {
      log?.warn(
        { id: disbursement.id, payout_id: disbursement.payout_id, error: err.message },
        'Failed to check payout status during reconciliation'
      );
      _stats.errors++;
    }
  }

  return { matched, new: newRecords };
}
