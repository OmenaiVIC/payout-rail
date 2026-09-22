/**
 * Sprint 4b — Reconciliation worker: five modes, deterministic + idempotent
 * (plan §5 / D5, §9).
 *
 * Cases:
 *  1  missingWebhook: completed → confirmed (advance), `lookupSend` seam used
 *     (never the deprecated getPayoutStatus); failed → failed
 *  2  missingWebhook: pending over the state SLA → manual_review with
 *     evidence-before-flip ordering; pending under SLA → benign, no detection
 *  3  missingWebhook: no payout_id → manual_review
 *  4  duplicateEvent: conflicting statuses route; benign redelivery records
 *     without routing; terminal rows excluded
 *  5  inconsistentStatus: duck-test divergence routes; consistent/manual/terminal
 *     rows untouched
 *  6  timeoutEscalation: over-SLA routes; under-SLA benign; manual/terminal excluded
 *  7  orphanedPayout: 404 / cross-wire / no payout_id escalate; a recognized
 *     completed send stays benign
 *  8  idempotent re-run: no double-advance, no queue duplication, no extra detections
 *
 * No network, no Postgres, no credentials: FakeDb + injected clock + mock adapters.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DisbursementState as S } from '../../src/services/bos/types.js';
import * as reconciliationWorker from '../../src/services/bos/reconciliationWorker.js';
import { createTestCtx } from '../helpers/ctx.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';

const T = new Date('2026-01-15T12:00:00.000Z');
const getNow = () => T;
const EXCLUDE = ['settled', 'failed', 'cancelled', 'manual_review'];

function makeRow(id, status, overrides = {}) {
  return {
    id,
    status,
    amount_usdcx: 50_000_000,
    creator_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
    retry_count: 0,
    max_retries: 3,
    last_error: null,
    error_message: null,
    payout_id: null,
    last_heartbeat_at: new Date(T.getTime() - 60_000).toISOString(),
    created_at: new Date(T.getTime() - 600_000).toISOString(),
    ...overrides,
  };
}

/** Mirrors real-Postgres behaviour: scans filter on status, the claim UPDATE
 * is a CAS, action field-UPDATEs apply whitelisted fields. Evidence, snapshots
 * and queue items are captured in state so tests can assert order and counts. */
function buildHarness({ rows, adapters = createMockAdapters(), webhookRows = [], refs = [], onChain = [] }) {
  const state = {
    rows,
    queue: [],
    evidence: [],
    snapshots: [],
    refs: [...refs],
    onChain: [...onChain],
    // Every active row sits in its current state via a seeded canonical
    // transition record (except disbursement_initiated, created directly).
    // Mirrors real life: entering a state wrote its transition evidence.
    entered: new Set(rows.filter((r) => r.status !== S.DISBURSEMENT_INITIATED).map((r) => `${r.id}:${r.status}`)),
  };
  const db = createFakeDb();

  db.when(/UPDATE disbursements\s+SET status = \$1/, ({ params }) => {
    const [to, from, id] = params;
    const row = state.rows.find((r) => r.id === id);
    if (!row || row.status !== from) return { changes: 0, rows: [] };
    row.status = to;
    state.entered.add(`${row.id}:${row.status}`);
    return { changes: 1, rows: [] };
  });
  db.when(/^UPDATE disbursements SET ([\s\S]+?), updated_at = NOW\(\) WHERE id = \$\d+$/, ({ sql, params }) => {
    const body = sql.match(/^UPDATE disbursements SET ([\s\S]+?), updated_at = NOW\(\) WHERE id = \$\d+$/)[1];
    const tokens = [...body.matchAll(/([a-z_]+) = \$\d+/g)];
    const row = state.rows.find((r) => r.id === params[params.length - 1]);
    tokens.forEach((m, i) => { row[m[1]] = params[i]; });
    return { changes: 1, rows: [] };
  });

  db.when(/FROM disbursements\s+WHERE status NOT IN/, ({ params }) =>
    state.rows.filter((r) => !EXCLUDE.includes(r.status)).slice(0, params[0]));
  db.when(/identifier_value AS payout_id/, ({ params }) =>
    state.rows
      .filter((r) => r.status === 'yellowcard_payout_submitted')
      .map((r) => ({
        ...r,
        payout_id: r.payout_id && state.refs.some((f) => f.disbursementId === r.id && f.system === 'yellowcard' && f.type === 'payout_id') ? r.payout_id : null,
      }))
      .slice(0, params[0]));
  db.when(/FROM yellow_card_webhook_events we\s+JOIN/, ({ params }) =>
    webhookRows
      .filter((w) => state.rows.some((r) => r.id === w.disbursement_id && !EXCLUDE.includes(r.status)))
      .slice(0, params[0]));

  db.when(/INSERT INTO disbursement_evidence/, ({ params }) => {
    state.evidence.push({ disbursementId: params[1], type: params[2], envelope: JSON.parse(params[3]), recordedBy: params[4] });
    return { changes: 1, rows: [] };
  });
  db.when(/INSERT INTO external_status_snapshots/, ({ params }) => {
    state.snapshots.push({ disbursementId: params[0], source: params[1], status: params[2], errorMessage: params[5] });
    return { changes: 1, rows: [] };
  });

  db.when(/^SELECT \* FROM external_refs\s+WHERE disbursement_id = \$1/, ({ params }) =>
    state.refs.find((r) => r.disbursementId === params[0] && r.system === params[1] && r.type === params[2]) || null);
  db.when(/INSERT INTO external_refs \(disbursement_id/, () => ({ changes: 1, rows: [] }));

  db.when(/SELECT COUNT\(\*\) AS n FROM external_refs\s+WHERE disbursement_id/, ({ params }) => ({
    n: state.refs.filter((r) => r.disbursementId === params[0] && r.system === 'yellowcard' && r.type === 'payout_id').length,
  }));
  db.when(/SELECT COUNT\(\*\) AS n FROM on_chain_events/, ({ params }) => ({
    n: state.onChain.filter((o) => o.disbursementId === params[0] && o.status === 'confirmed').length,
  }));
  db.when(/FROM yellow_card_webhook_events\s+WHERE disbursement_id/, ({ params }) => ({
    n: webhookRows.filter((w) => w.disbursement_id === params[0] && String(w.payload?.status || '').toLowerCase() === 'completed').length,
  }));
  db.when(/FROM disbursement_evidence\s+WHERE disbursement_id/, ({ params }) => ({
    n: state.entered.has(`${params[0]}:${params[1]}`) ? 1 : 0,
  }));

  db.when(/INSERT INTO manual_review_queue/, ({ params }) => {
    const open = state.queue.find((q) => q.disbursementId === params[0] && !q.resolved);
    if (!open) state.queue.push({ disbursementId: params[0], reason: params[1], resolved: false });
    return { changes: open ? 0 : 1, rows: [] };
  });
  db.when(/UPDATE manual_review_queue/, () => ({ changes: 1, rows: [] }));

  const ctx = createTestCtx({ db, adapters });
  reconciliationWorker.init(ctx, { getNow });
  return { db, ctx, state, adapters };
}

function claimsFor(db) {
  return db.callsMatching(/UPDATE disbursements\s+SET status = \$1/);
}

function evidenceFor(state, id, type) {
  return state.evidence.filter((e) => e.disbursementId === id && (type === undefined || e.type === type));
}

function reasonOf(state, id) {
  return evidenceFor(state, id, 'reconciliation_detection')[0]?.envelope?.details?.reason ?? null;
}

function lookupIdx(db) {
  return db.calls.findIndex((c) => c.method === 'run' && /INSERT INTO disbursement_evidence/.test(c.sql) && c.params[2] === 'poll_result');
}

const claimIdx = (db) => db.calls.indexOf(claimsFor(db)[0]);

// ─────────────────────────────────────────────────────────────────────────────
// Mode 1: missingWebhook — completed, failed
// ─────────────────────────────────────────────────────────────────────────────

test('missingWebhook: completed lookup advances to confirmed via lookupSend seam', async () => {
  const rows = [makeRow('d1', S.YELLOWCARD_PAYOUT_SUBMITTED, { payout_id: 'yc-1' })];
  const adapters = createMockAdapters();
  adapters.yellowcard.lookupResults = { 'yc-1': { status: 'completed', data: { id: 'yc-1' } } };
  const { db, state, adapters: ads } = buildHarness({
    rows,
    adapters,
    refs: [{ disbursementId: 'd1', system: 'yellowcard', type: 'payout_id', identifier_value: 'yc-1', metadata: {} }],
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.ok(summary.ok, JSON.stringify(summary.errors));
  assert.equal(summary.modes.missingWebhook.scanned, 1);
  assert.equal(summary.modes.missingWebhook.advanced, 1);
  assert.equal(rows[0].status, S.YELLOWCARD_PAYOUT_CONFIRMED);

  assert.equal(ads.yellowcard.calls.lookupSend[0], 'yc-1', 'worker polls via lookupSend');
  assert.equal(typeof ads.yellowcard.getPayoutStatus, 'undefined', 'worker never calls the deprecated seam');

  const poll = lookupIdx(db);
  const claim = claimIdx(db);
  assert.ok(poll >= 0 && claim >= 0 && poll < claim, 'poll_result evidence precedes the state flip');

  assert.equal(evidenceFor(state, 'd1', 'transition').length, 1);
  assert.equal(evidenceFor(state, 'd1', 'transition')[0].envelope.status.to, S.YELLOWCARD_PAYOUT_CONFIRMED);

  const rerun = await reconciliationWorker.reconcileOnce();
  assert.equal(rerun.modes.missingWebhook.scanned, 0);
  assert.equal(claimsFor(db).length, 1, 'no double-advance on re-run');
});

test('missingWebhook: failed lookup marks the disbursement failed (no detection evidence)', async () => {
  const rows = [makeRow('d2', S.YELLOWCARD_PAYOUT_SUBMITTED, { payout_id: 'yc-2' })];
  const adapters = createMockAdapters();
  adapters.yellowcard.lookupResults = { 'yc-2': { status: 'failed', data: { id: 'yc-2' } } };
  const { db, state } = buildHarness({
    rows,
    adapters,
    refs: [{ disbursementId: 'd2', system: 'yellowcard', type: 'payout_id', identifier_value: 'yc-2', metadata: {} }],
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.missingWebhook.markedFailed, 1);
  assert.equal(rows[0].status, S.FAILED);
  assert.equal(evidenceFor(state, 'd2', 'poll_result').length, 1);
  assert.equal(evidenceFor(state, 'd2', 'poll_result')[0].envelope.status.poll_status, 'failed');
  assert.equal(evidenceFor(state, 'd2', 'reconciliation_detection').length, 0, 'provider-fail is a resolved outcome, not a detection');

  const rerun = await reconciliationWorker.reconcileOnce();
  assert.equal(rerun.modes.missingWebhook.scanned, 0);
  assert.equal(claimsFor(db).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode 1: missingWebhook — pending over/under SLA, no payout_id
// ─────────────────────────────────────────────────────────────────────────────

test('missingWebhook: pending over the state SLA routes to manual_review, detection evidence written before the flip', async () => {
  const rows = [makeRow('d3', S.YELLOWCARD_PAYOUT_SUBMITTED, {
    payout_id: 'yc-3',
    last_heartbeat_at: new Date(T.getTime() - 2_000_000).toISOString(),
  })];
  const adapters = createMockAdapters();
  adapters.yellowcard.lookupResults = { 'yc-3': { status: 'in_progress' } };
  const { db, state } = buildHarness({
    rows,
    adapters,
    refs: [{ disbursementId: 'd3', system: 'yellowcard', type: 'payout_id', identifier_value: 'yc-3', metadata: {} }],
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.missingWebhook.routed, 1);
  assert.equal(rows[0].status, S.MANUAL_REVIEW);

  const dip = (type) => db.calls.findIndex((c) => c.method === 'run' && /INSERT INTO disbursement_evidence/.test(c.sql) && c.params[2] === type);
  const snapIdx = db.calls.findIndex((c) => c.method === 'run' && /INSERT INTO external_status_snapshots/.test(c.sql));
  const detIdx = dip('reconciliation_detection');
  const claim = claimIdx(db);
  assert.ok(snapIdx >= 0 && snapIdx < detIdx && detIdx < claim, 'snapshot → detection → claim ordering holds');

  const det = evidenceFor(state, 'd3', 'reconciliation_detection')[0];
  assert.equal(det.envelope.status.mode, 'missingWebhook');
  assert.match(det.envelope.details.reason, /in_progress/);
  assert.equal(state.queue.length, 1, 'exactly one manual-review row enqueued');
  assert.equal(state.queue[0].disbursementId, 'd3');

  await reconciliationWorker.reconcileOnce();
  assert.equal(evidenceFor(state, 'd3', 'reconciliation_detection').length, 1, 'no extra detection on re-run');
  assert.equal(state.queue.length, 1, 'no queue duplication on re-run');
  assert.equal(claimsFor(db).length, 1);
});

test('missingWebhook: pending under the SLA is benign — poll recorded, no detection, no flip', async () => {
  const rows = [makeRow('d4', S.YELLOWCARD_PAYOUT_SUBMITTED, { payout_id: 'yc-4' })];
  const adapters = createMockAdapters();
  adapters.yellowcard.lookupResults = { 'yc-4': { status: 'in_progress' } };
  const { state } = buildHarness({
    rows,
    adapters,
    refs: [{ disbursementId: 'd4', system: 'yellowcard', type: 'payout_id', identifier_value: 'yc-4', metadata: {} }],
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.missingWebhook.scanned, 1);
  assert.equal(summary.modes.missingWebhook.routed, 0);
  assert.equal(rows[0].status, S.YELLOWCARD_PAYOUT_SUBMITTED, 'benign observation never flips state');
  assert.equal(evidenceFor(state, 'd4', 'poll_result').length, 1);
  assert.equal(evidenceFor(state, 'd4', 'reconciliation_detection').length, 0, 'detection evidence only when routing');
  assert.equal(state.queue.length, 0);
});

test('missingWebhook: payout with no payout_id routes to manual_review', async () => {
  const rows = [makeRow('d5', S.YELLOWCARD_PAYOUT_SUBMITTED)];
  const { state } = buildHarness({ rows });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.missingWebhook.routed, 1);
  assert.equal(rows[0].status, S.MANUAL_REVIEW);
  assert.match(reasonOf(state, 'd5'), /no payout_id/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode 2: duplicateEvent
// ─────────────────────────────────────────────────────────────────────────────

test('duplicateEvent: conflicting statuses route; benign redelivery and terminal rows do not', async () => {
  const rows = [
    makeRow('A', S.DISBURSEMENT_INITIATED, {}),
    makeRow('B', S.DISBURSEMENT_INITIATED, {}),
    makeRow('C', S.SETTLED, {}),
  ];
  const webhookRows = [
    { disbursement_id: 'A', event_id: 'evt-1', row_id: 1, status: rows[0].status, payload: { status: 'in_progress' } },
    { disbursement_id: 'A', event_id: 'evt-1', row_id: 2, status: rows[0].status, payload: { status: 'completed' } },
    { disbursement_id: 'B', event_id: 'evt-2', row_id: 3, status: rows[1].status, payload: { status: 'in_progress' } },
    { disbursement_id: 'B', event_id: 'evt-2', row_id: 4, status: rows[1].status, payload: { status: 'in_progress' } },
    { disbursement_id: 'C', event_id: 'evt-3', row_id: 5, status: rows[2].status, payload: { status: 'in_progress' } },
    { disbursement_id: 'C', event_id: 'evt-3', row_id: 6, status: rows[2].status, payload: { status: 'completed' } },
  ];
  const { state } = buildHarness({ rows, webhookRows });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.duplicateEvent.scanned, 2, 'A and B are scanned, terminal C excluded');
  assert.equal(summary.modes.duplicateEvent.routed, 1);
  assert.equal(rows[0].status, S.MANUAL_REVIEW, 'conflicting statuses route');
  assert.equal(rows[1].status, S.DISBURSEMENT_INITIATED, 'benign redelivery untouched');
  assert.equal(rows[2].status, S.SETTLED, 'terminal row untouched');
  assert.match(reasonOf(state, 'A'), /conflicting webhook statuses/);
  assert.equal(evidenceFor(state, 'B', 'reconciliation_detection').length, 0, 'benign redelivery records no detection');
  assert.equal(evidenceFor(state, 'C', 'reconciliation_detection').length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode 3: inconsistentStatus
// ─────────────────────────────────────────────────────────────────────────────

test('inconsistentStatus: duck-test divergence routes; consistent, manual and terminal rows untouched', async () => {
  const rows = [
    makeRow('I', S.BURN_CONFIRMED, {}),
    makeRow('OK', S.DISBURSEMENT_INITIATED, {}),
    makeRow('MR', S.MANUAL_REVIEW, {}),
    makeRow('FIN', S.SETTLED, {}),
  ];
  const { state } = buildHarness({
    rows,
    onChain: [{ disbursementId: 'OTHER', status: 'confirmed' }],
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.inconsistentStatus.scanned, 2, 'only I and OK are active');
  assert.equal(summary.modes.inconsistentStatus.routed, 1);
  assert.equal(rows[0].status, S.MANUAL_REVIEW);
  assert.match(reasonOf(state, 'I'), /no on-chain confirmation evidence/);
  assert.equal(rows[1].status, S.DISBURSEMENT_INITIATED, 'consistent row untouched');
  assert.equal(rows[2].status, S.MANUAL_REVIEW, 'already manual_review untouched');
  assert.equal(rows[3].status, S.SETTLED);
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode 4: timeoutEscalation
// ─────────────────────────────────────────────────────────────────────────────

test('timeoutEscalation: over-SLA routes, under-SLA benign, manual/terminal excluded', async () => {
  const rows = [
    makeRow('T1', S.BURN_SUBMITTED, { last_heartbeat_at: new Date(T.getTime() - 700_000).toISOString() }),
    makeRow('T2', S.DESTINATION_RELEASE_UNOBSERVED, {}),
    makeRow('T3', S.MANUAL_REVIEW, { last_heartbeat_at: new Date(T.getTime() - 7_200_000).toISOString() }),
    makeRow('T4', S.FAILED, {}),
  ];
  const { state } = buildHarness({ rows });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.timeoutEscalation.scanned, 2, 'T1 and T2 active; T3/T4 excluded');
  assert.equal(summary.modes.timeoutEscalation.overSla, 1);
  assert.equal(summary.modes.timeoutEscalation.routed, 1);
  assert.equal(rows[0].status, S.MANUAL_REVIEW);
  assert.match(reasonOf(state, 'T1'), /stuck in burn_submitted/);
  assert.equal(rows[1].status, S.DESTINATION_RELEASE_UNOBSERVED, 'under-SLA benign');
  assert.equal(rows[2].status, S.MANUAL_REVIEW);
  assert.equal(state.queue.filter((q) => q.disbursementId === 'T1').length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode 5: orphanedPayout
// ─────────────────────────────────────────────────────────────────────────────

test('orphanedPayout: 404, cross-wire and missing id escalate; recognized completed send stays benign', async () => {
  const rows = [
    makeRow('O1', S.YELLOWCARD_PAYOUT_SUBMITTED, { payout_id: 'yc-x' }),
    makeRow('O2', S.YELLOWCARD_PAYOUT_SUBMITTED, { payout_id: 'yc-y' }),
    makeRow('O3', S.YELLOWCARD_PAYOUT_SUBMITTED, { payout_id: 'yc-z' }),
    makeRow('O4', S.YELLOWCARD_PAYOUT_SUBMITTED, { payout_id: 'yc-w' }),
    makeRow('O5', S.YELLOWCARD_PAYOUT_SUBMITTED, {}),
  ];
  const adapters = createMockAdapters();
  adapters.yellowcard.lookupResults = (sendId) => {
    if (sendId === 'yc-x') {
      const e = new Error('payout not found');
      e.statusCode = 404;
      throw e;
    }
    if (sendId === 'yc-y') return { status: 'in_progress', data: { id: 'yc-OTHER' } };
    if (sendId === 'yc-z') return { status: 'in_progress', data: { id: 'yc-z' } };
    return { status: 'completed', data: { id: sendId } };
  };
  const refs = ['O1', 'O2', 'O3', 'O4'].map((id) => ({
    disbursementId: id, system: 'yellowcard', type: 'payout_id', identifier_value: rows.find((r) => r.id === id).payout_id, metadata: {},
  }));
  const { state } = buildHarness({
    rows,
    adapters,
    refs,
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.orphanedPayout.routed, 2, 'O1 (404) and O2 (cross-wire) escalate');
  assert.equal(rows[0].status, S.MANUAL_REVIEW);
  assert.equal(rows[1].status, S.MANUAL_REVIEW);
  assert.match(reasonOf(state, 'O1'), /404/);
  assert.match(reasonOf(state, 'O2'), /cross-wire/);
  assert.equal(rows[2].status, S.YELLOWCARD_PAYOUT_SUBMITTED, 'O3 in_progress under SLA stays');
  assert.equal(rows[3].status, S.YELLOWCARD_PAYOUT_CONFIRMED, 'O4 recognized + completed, reconciled by missingWebhook');
  assert.equal(rows[4].status, S.MANUAL_REVIEW, 'O5 has no payout_id → manual review via missingWebhook');
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency + cumulative stats
// ─────────────────────────────────────────────────────────────────────────────

test('reconcileOnce is idempotent end-to-end and getStats accumulates', async () => {
  const rows = [
    makeRow('M1', S.YELLOWCARD_PAYOUT_SUBMITTED, { payout_id: 'yc-m', last_heartbeat_at: new Date(T.getTime() - 2_000_000).toISOString() }),
    makeRow('M2', S.BURN_SUBMITTED, { last_heartbeat_at: new Date(T.getTime() - 700_000).toISOString() }),
  ];
  const adapters = createMockAdapters();
  adapters.yellowcard.lookupResults = { 'yc-m': { status: 'in_progress' } };
  const { db, state } = buildHarness({
    rows,
    adapters,
    refs: [{ disbursementId: 'M1', system: 'yellowcard', type: 'payout_id', identifier_value: 'yc-m', metadata: {} }],
  });

  const statsBefore = reconciliationWorker.getStats();
  const first = await reconciliationWorker.reconcileOnce();
  assert.equal(first.modes.missingWebhook.routed, 1);
  assert.equal(first.modes.timeoutEscalation.routed, 1);
  const detectionsAfterFirst = state.evidence.filter((e) => e.type === 'reconciliation_detection').length;

  await reconciliationWorker.reconcileOnce();
  await reconciliationWorker.reconcileOnce();

  assert.equal(claimsFor(db).length, 2, 'only the two first-run routes claim');
  assert.equal(state.queue.length, 2, 'no queue duplication across runs');
  assert.equal(state.evidence.filter((e) => e.type === 'reconciliation_detection').length, detectionsAfterFirst, 'no extra detections across runs');

  const stats = reconciliationWorker.getStats();
  assert.ok(stats.runs > statsBefore.runs, 'getStats counts runs');
  assert.ok(stats.totals.routedManualReview >= statsBefore.totals.routedManualReview + 2, 'getStats accumulates routed manual review');
  assert.ok(stats.modes.missingWebhook.routed >= statsBefore.modes.missingWebhook.routed + first.modes.missingWebhook.routed);
});