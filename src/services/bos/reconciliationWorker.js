/**
 * BOS Reconciliation Worker — Background job (5 min interval)
 * Five deterministic, offline, idempotent detection modes (Sprint 4 plan §5):
 *   1. missingWebhook      — payout_submitted rows whose provider result never arrived via webhook;
 *                            resolved by polling lookupSend(payout_id).
 *   2. duplicateEvent      — conflicting webhook statuses for the same derived event id.
 *   3. inconsistentStatus  — duck-test re-check offline: persisted leg facts vs recorded observations.
 *   4. timeoutEscalation   — non-terminal rows whose last_heartbeat_at exceeds the state SLA.
 *   5. orphanedPayout      — payout-leg rows that cannot be matched to a real send (404, cross-wire, no id).
 *
 * All SLAs are computed in JS from stored timestamps via the injected `getNow` clock
 * (no NOW() in worker SQL) so FakeDb tests are deterministic.
 */

import { DisbursementState as S } from './types.js';
import { executeTransition } from './stateMachine.js';
import { STATE_SLA_MS } from './stuckStateReaper.js';
import { recordStatusSnapshot, recordPollResult, recordReconciliationDetection } from './evidenceCollector.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration / State
// ─────────────────────────────────────────────────────────────────────────────

const RECONCILIATION_INTERVAL_MS = 5 * 60_000; // 5 minutes
const SCAN_BATCH_SIZE = 50;

const SCAN_ACTIVE_SQL = `
  SELECT * FROM disbursements
  WHERE status NOT IN ('settled', 'failed', 'cancelled', 'manual_review')
  ORDER BY created_at ASC
  LIMIT $1
`;

const SCAN_PAYOUT_CANDIDATES_SQL = `
  SELECT d.*, er.identifier_value AS payout_id
  FROM disbursements d
  LEFT JOIN external_refs er ON er.disbursement_id = d.id
    AND er.external_system = 'yellowcard' AND er.identifier_type = 'payout_id'
  WHERE d.status = 'yellowcard_payout_submitted'
  ORDER BY d.created_at ASC
  LIMIT $1
`;

const SCAN_WEBHOOK_EVENTS_SQL = `
  SELECT we.disbursement_id, we.payment_id AS event_id, we.payload, we.id AS row_id, d.status AS status
  FROM yellow_card_webhook_events we
  JOIN disbursements d ON d.id = we.disbursement_id
  WHERE d.status NOT IN ('settled', 'failed', 'cancelled', 'manual_review')
  ORDER BY we.disbursement_id, we.created_at ASC
  LIMIT $1
`;

let _running = false;
let _interval = null;
let _ctx = null;
let _getNow = () => new Date();
let _stats = {
  runs: 0,
  lastRun: null,
  modes: {
    missingWebhook: { scanned: 0, routed: 0, advanced: 0, markedFailed: 0, errors: 0 },
    duplicateEvent: { scanned: 0, routed: 0, errors: 0 },
    inconsistentStatus: { scanned: 0, routed: 0, errors: 0 },
    timeoutEscalation: { scanned: 0, overSla: 0, routed: 0, errors: 0 },
    orphanedPayout: { scanned: 0, routed: 0, errors: 0 },
  },
  totals: { scanned: 0, advancedConfirmed: 0, markedFailed: 0, routedManualReview: 0, errors: 0 },
  detections: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function init(ctx, { getNow } = {}) {
  _ctx = ctx;
  if (getNow) _getNow = getNow;
}

export function start(intervalMs = RECONCILIATION_INTERVAL_MS) {
  if (_interval) return;
  _interval = setInterval(_tick, intervalMs);
  _ctx?.getLogger('reconciliation')?.info({ intervalMs }, 'Reconciliation worker started');
}

export function stop() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    _ctx?.getLogger('reconciliation')?.info('Reconciliation worker stopped');
  }
}

export function getStats() {
  return {
    ..._stats,
    modes: Object.fromEntries(
      Object.entries(_stats.modes).map(([k, v]) => [k, { ...v }])
    ),
    totals: { ..._stats.totals },
    detections: [..._stats.detections],
  };
}

/**
 * Single manual run (operator trigger / tests).
 * Resolves to a per-run summary, or `{ ok:false, skipped:true }` when a tick
 * is already in progress.
 */
export async function reconcileOnce() {
  if (_running) return { ok: false, skipped: true };
  return _tick();
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: single reconciliation tick
// ─────────────────────────────────────────────────────────────────────────────

async function _tick() {
  _running = true;
  const log = _ctx?.getLogger('reconciliation');
  const runAt = _getNow();
  const summary = {
    ok: true,
    run_at: runAt.toISOString(),
    modes: {
      missingWebhook: { scanned: 0, routed: 0, advanced: 0, markedFailed: 0 },
      duplicateEvent: { scanned: 0, routed: 0 },
      inconsistentStatus: { scanned: 0, routed: 0 },
      timeoutEscalation: { scanned: 0, overSla: 0, routed: 0 },
      orphanedPayout: { scanned: 0, routed: 0 },
    },
    detections: [],
    errors: [],
  };

  try {
    const db = _ctx.getDb();

    // Order matters: missingWebhook resolves healthy payouts first so later
    // modes only see rows it left behind.
    const mw = await missingWebhook(db, log, summary);
    summary.modes.missingWebhook = mw;

    const de = await duplicateEvent(db, log, summary);
    summary.modes.duplicateEvent = de;

    const ic = await inconsistentStatus(db, log, summary);
    summary.modes.inconsistentStatus = ic;

    const te = await timeoutEscalation(db, log, summary);
    summary.modes.timeoutEscalation = te;

    const op = await orphanedPayout(db, log, summary);
    summary.modes.orphanedPayout = op;

    _stats.runs++;
    _stats.lastRun = runAt.toISOString();
    for (const mode of Object.keys(summary.modes)) {
      mergeStats(_stats.modes[mode], summary.modes[mode]);
    }
    _stats.totals.scanned += summary.modes.missingWebhook.scanned
      + summary.modes.duplicateEvent.scanned
      + summary.modes.inconsistentStatus.scanned
      + summary.modes.timeoutEscalation.scanned
      + summary.modes.orphanedPayout.scanned;
    _stats.totals.advancedConfirmed += summary.modes.missingWebhook.advanced;
    _stats.totals.markedFailed += summary.modes.missingWebhook.markedFailed;
    _stats.totals.routedManualReview += summary.modes.missingWebhook.routed
      + summary.modes.duplicateEvent.routed
      + summary.modes.inconsistentStatus.routed
      + summary.modes.timeoutEscalation.routed
      + summary.modes.orphanedPayout.routed;
    _stats.totals.errors += summary.modes.missingWebhook.errors
      + summary.modes.duplicateEvent.errors
      + summary.modes.inconsistentStatus.errors
      + summary.modes.timeoutEscalation.errors
      + summary.modes.orphanedPayout.errors;
    _stats.detections.push(...summary.detections);

    log?.info({ run_at: summary.run_at, modes: summary.modes }, 'Reconciliation tick complete');
  } catch (err) {
    summary.ok = false;
    summary.errors.push({ mode: 'tick', message: err.message });
    _stats.runs++;
    _stats.totals.errors++;
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

  return summary;
}

function mergeStats(accum, delta) {
  for (const key of Object.keys(delta)) {
    if (Number.isFinite(delta[key])) accum[key] = (accum[key] || 0) + delta[key];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 1: missingWebhook (plan §5.1)
// ─────────────────────────────────────────────────────────────────────────────

async function missingWebhook(db, log, summary) {
  const mode = 'missingWebhook';
  const stats = { scanned: 0, routed: 0, advanced: 0, markedFailed: 0, errors: 0 };

  let rows = [];
  try {
    rows = await db.all(SCAN_PAYOUT_CANDIDATES_SQL, [SCAN_BATCH_SIZE]);
  } catch (err) {
    stats.errors++;
    summary.errors.push({ mode, message: err.message });
    return stats;
  }

  for (const d of rows || []) {
    stats.scanned++;
    const payoutId = d.payout_id;

    if (!payoutId) {
      await escalate(db, log, summary, mode, d,
        'payout has no payout_id — cannot resolve offline');
      stats.routed++;
      continue;
    }

    let providerResult;
    try {
      providerResult = await _ctx.adapters.yellowcard.lookupSend(payoutId);
    } catch (err) {
      // A provider that cannot be reached is a transient concern; record the
      // failed poll and let orphanedPayout handle not-found semantics.
      await recordPollResult({
        db, disbursementId: d.id, adapter: 'yellowcard', method: 'lookupSend',
        externalId: payoutId, externalIdType: 'payout_id', status: 'error',
        advanceAction: null, log,
      });
      continue;
    }

    const status = String(providerResult?.status || '').toLowerCase();

    if (status === 'completed') {
      await recordPollResult({
        db, disbursementId: d.id, adapter: 'yellowcard', method: 'lookupSend',
        externalId: payoutId, externalIdType: 'payout_id', status: 'completed',
        advanceAction: 'confirm', log,
      });
      const routed = await route(d, S.YELLOWCARD_PAYOUT_CONFIRMED, log);
      if (routed) stats.advanced++;
      continue;
    }

    if (status === 'failed') {
      await recordPollResult({
        db, disbursementId: d.id, adapter: 'yellowcard', method: 'lookupSend',
        externalId: payoutId, externalIdType: 'payout_id', status: 'failed',
        advanceAction: 'mark_failed', log,
      });
      const routed = await route(d, S.FAILED, log);
      if (routed) stats.markedFailed++;
      continue;
    }

    // pending / in_progress etc: escalate only once the state SLA has elapsed.
    const slaMs = STATE_SLA_MS[S.YELLOWCARD_PAYOUT_SUBMITTED] ?? null;
    const heartbeat = d.last_heartbeat_at ? new Date(d.last_heartbeat_at).getTime() : NaN;
    const ageMs = Number.isFinite(heartbeat) ? _getNow().getTime() - heartbeat : Infinity;
    await recordPollResult({
      db, disbursementId: d.id, adapter: 'yellowcard', method: 'lookupSend',
      externalId: payoutId, externalIdType: 'payout_id', status,
      advanceAction: null, log,
    });
    if (slaMs !== null && ageMs > slaMs) {
      await escalate(db, log, summary, mode, d,
        `provider still ${status} after ${Math.round(ageMs / 60_000)}m in yellowcard_payout_submitted`);
      stats.routed++;
    }
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 2: duplicateEvent (plan §5.2)
// ─────────────────────────────────────────────────────────────────────────────

async function duplicateEvent(db, log, summary) {
  const mode = 'duplicateEvent';
  const stats = { scanned: 0, routed: 0, errors: 0 };

  let events = [];
  try {
    events = await db.all(SCAN_WEBHOOK_EVENTS_SQL, [SCAN_BATCH_SIZE]);
  } catch (err) {
    stats.errors++;
    summary.errors.push({ mode, message: err.message });
    return stats;
  }

  const byEvent = new Map();
  for (const row of events || []) {
    const key = `${row.disbursement_id}:${row.event_id ?? ''}`;
    const entry = byEvent.get(key) || {
      disbursementId: row.disbursement_id,
      eventId: row.event_id,
      status: row.status,
      statuses: new Set(),
    };
    const payload = typeof row.payload === 'string' ? safeParse(row.payload) : row.payload;
    const s = String(payload?.status ?? '').toLowerCase();
    if (s) entry.statuses.add(s);
    byEvent.set(key, entry);
  }

  for (const entry of byEvent.values()) {
    stats.scanned++;
    const statuses = [...entry.statuses];
    if (statuses.length <= 1) {
      log?.info({ disbursement_id: entry.disbursementId, event_id: entry.eventId },
        'Webhook delivery recorded without conflict');
      continue;
    }
    await escalate(db, log, summary, mode, { id: entry.disbursementId, status: entry.status },
      `conflicting webhook statuses for event_id=${entry.eventId ?? 'null'}: ${statuses.join(', ')}`);
    stats.routed++;
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 3: inconsistentStatus (plan §5.3)
// ─────────────────────────────────────────────────────────────────────────────

async function inconsistentStatus(db, log, summary) {
  const mode = 'inconsistentStatus';
  const stats = { scanned: 0, routed: 0, errors: 0 };

  let rows = [];
  try {
    rows = await db.all(SCAN_ACTIVE_SQL, [SCAN_BATCH_SIZE]);
  } catch (err) {
    stats.errors++;
    summary.errors.push({ mode, message: err.message });
    return stats;
  }

  for (const d of rows || []) {
    stats.scanned++;
    const reason = await duckTest(db, log, d);
    if (reason) {
      await escalate(db, log, summary, mode, d, reason);
      stats.routed++;
    }
  }

  return stats;
}

async function duckTest(db, log, d) {
  const burnConfirmedRow = await db.get(
    `SELECT COUNT(*) AS n FROM on_chain_events
     WHERE disbursement_id = $1 AND event_type = 'confirmation' AND status = 'confirmed'`,
    [d.id]
  );
  const burnConfirmedCount = Number(burnConfirmedRow?.n ?? 0);
  const completedWebhookRow = await db.get(
    `SELECT COUNT(*) AS n FROM yellow_card_webhook_events
     WHERE disbursement_id = $1 AND payload->>'status' = 'completed'`,
    [d.id]
  );
  const completedWebhookCount = Number(completedWebhookRow?.n ?? 0);
  const payoutRefRow = await db.get(
    `SELECT COUNT(*) AS n FROM external_refs
     WHERE disbursement_id = $1 AND external_system = 'yellowcard' AND identifier_type = 'payout_id'`,
    [d.id]
  );
  const payoutRefCount = Number(payoutRefRow?.n ?? 0);
  const transitionEnterRow = await db.get(
    `SELECT COUNT(*) AS n FROM disbursement_evidence
     WHERE disbursement_id = $1 AND evidence_type = 'transition'
       AND (evidence_data::jsonb->'status'->>'to') = $2`,
    [d.id, d.status]
  );
  const transitionEnterCount = Number(transitionEnterRow?.n ?? 0);

  if (d.status === S.BURN_SUBMITTED && burnConfirmedCount > 0) {
    return 'burn confirmed on chain but row still burn_submitted';
  }
  if (d.status === S.BURN_CONFIRMED && burnConfirmedCount === 0) {
    return 'row burn_confirmed but no on-chain confirmation evidence';
  }
  if (d.status === S.YELLOWCARD_PAYOUT_SUBMITTED && completedWebhookCount > 0) {
    return 'completed webhook on record but row still yellowcard_payout_submitted';
  }
  if (d.status === S.YELLOWCARD_PAYOUT_CONFIRMED && completedWebhookCount === 0 && payoutRefCount === 0) {
    return 'row yellowcard_payout_confirmed with no payout evidence at all';
  }
  if (d.status !== S.YELLOWCARD_PAYOUT_CONFIRMED && payoutRefCount > 0 && !d.payout_id) {
    return 'payout external_ref exists but payout_id missing from row';
  }
  if (transitionEnterCount === 0 && d.status !== S.DISBURSEMENT_INITIATED) {
    return `missing canonical transition evidence for ${d.status} (dropped evidence insert)`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 4: timeoutEscalation (plan §5.4)
// ─────────────────────────────────────────────────────────────────────────────

async function timeoutEscalation(db, log, summary) {
  const mode = 'timeoutEscalation';
  const stats = { scanned: 0, overSla: 0, routed: 0, errors: 0 };

  let rows = [];
  try {
    rows = await db.all(SCAN_ACTIVE_SQL, [SCAN_BATCH_SIZE]);
  } catch (err) {
    stats.errors++;
    summary.errors.push({ mode, message: err.message });
    return stats;
  }

  const nowMs = _getNow().getTime();
  for (const d of rows || []) {
    stats.scanned++;
    const slaMs = STATE_SLA_MS[d.status];
    if (slaMs === undefined) continue;
    const heartbeat = d.last_heartbeat_at ? new Date(d.last_heartbeat_at).getTime() : null;
    if (heartbeat === null) continue;
    const ageMs = nowMs - heartbeat;
    if (ageMs <= slaMs) continue;
    stats.overSla++;
    await escalate(db, log, summary, mode, d,
      `stuck in ${d.status} ${Math.round(ageMs / 60_000)}m (> SLA ${Math.round(slaMs / 60_000)}m) — reaper backstop`);
    stats.routed++;
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 5: orphanedPayout (plan §5.5)
// ─────────────────────────────────────────────────────────────────────────────

async function orphanedPayout(db, log, summary) {
  const mode = 'orphanedPayout';
  const stats = { scanned: 0, routed: 0, errors: 0 };

  let rows = [];
  try {
    rows = await db.all(SCAN_PAYOUT_CANDIDATES_SQL, [SCAN_BATCH_SIZE]);
  } catch (err) {
    stats.errors++;
    summary.errors.push({ mode, message: err.message });
    return stats;
  }

  for (const d of rows || []) {
    stats.scanned++;
    const payoutId = d.payout_id;

    if (!payoutId) {
      await escalate(db, log, summary, mode, d,
        'payout_id NULL and no matchable external_ref — cannot resolve offline');
      stats.routed++;
      continue;
    }

    let providerResult = null;
    let lookupError = null;
    try {
      providerResult = await _ctx.adapters.yellowcard.lookupSend(payoutId);
    } catch (err) {
      lookupError = err;
    }

    if (lookupError) {
      const notFound = isNotFoundError(lookupError);
      if (notFound) {
        await escalate(db, log, summary, mode, d,
          `provider 404 on payout ${payoutId}: ${lookupError.message}`);
        stats.routed++;
      }
      continue;
    }

    const claimed = providerResult?.data?.id ?? providerResult?.payout_id ?? null;
    if (claimed && claimed !== payoutId) {
      await escalate(db, log, summary, mode, d,
        `cross-wire: payout ${payoutId} resolves to send ${claimed} (different payout)`);
      stats.routed++;
      continue;
    }

    const status = String(providerResult?.status || '').toLowerCase();
    if (status === 'completed') {
      log?.info({ disbursement_id: d.id, payout_id: payoutId },
        'Payout recognized and completed — benign (owner reconciled by missingWebhook)');
    } else if (await payoutRefMissing(db, d)) {
      await escalate(db, log, summary, mode, d,
        `payout ${payoutId} unmatchable: no external_ref on record`);
      stats.routed++;
    }
  }

  return stats;
}

function isNotFoundError(err) {
  const msg = String(err?.message || '');
  return err?.statusCode === 404
    || err?.error_code === 'y404'
    || err?.code === 'NOT_FOUND'
    || /404|not found/i.test(msg);
}

async function payoutRefMissing(db, d) {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM external_refs
     WHERE disbursement_id = $1 AND external_system = 'yellowcard' AND identifier_type = 'payout_id'`,
    [d.id]
  );
  return Number(row?.n ?? 0) === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing helpers
// ─────────────────────────────────────────────────────────────────────────────

async function escalate(db, log, summary, mode, disbursement, reason) {
  await recordStatusSnapshot({
    db,
    disbursementId: disbursement.id,
    source: `reconciliation.${mode}`,
    status: 'detected',
    errorMessage: reason,
  });
  await recordReconciliationDetection({
    db,
    disbursementId: disbursement.id,
    mode,
    details: { reason },
    log,
  });
  summary.detections.push({ mode, disbursementId: disbursement.id, reason });
  await route(disbursement, S.MANUAL_REVIEW, log);
}

async function route(disbursement, toState, log) {
  const result = await executeTransition(
    disbursement,
    toState,
    _ctx,
    {},
    'reconciliation'
  );
  if (!result.success && !result.already_advanced) {
    log?.error(
      { id: disbursement.id, from: disbursement.status, to: toState, error: result.error, error_code: result.error_code },
      'Reconciliation route failed'
    );
    return false;
  }
  return true;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}