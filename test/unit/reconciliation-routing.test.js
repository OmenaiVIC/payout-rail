/**
 * Sprint P-1 / C4 — reconciliation payout polls travel through the seam.
 *
 * Both poll sites (missingWebhook and orphanedPayout) must read the payout ref
 * under the configured provider and label the poll with the adapter that issued
 * it. The legacy fallback preserves in-flight yellowcard rows under a newly
 * configured provider: poll the legacy ref under its issuing provider, never
 * cross-wire the id into the configured provider's API.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DisbursementState as S } from '../../src/services/bos/types.js';
import * as reconciliationWorker from '../../src/services/bos/reconciliationWorker.js';
import { createTestCtx } from '../helpers/ctx.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters, createMockYellowCard } from '../helpers/mockAdapters.js';

const T = new Date('2026-01-15T12:00:00.000Z');
const getNow = () => T;

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

function providerAdapters() {
  const adapters = createMockAdapters();
  adapters.breet = createMockYellowCard();
  return adapters;
}

function ref(disbursementId, system, identifierValue, metadata = {}) {
  return { disbursementId, system, type: 'payout_id', identifier_value: identifierValue, metadata };
}

function buildHarness({ rows, adapters = providerAdapters(), refs = [], payoutProvider = 'yellowcard' }) {
  const state = {
    rows,
    queue: [],
    evidence: [],
    snapshots: [],
    refs: [...refs],
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

  db.when(/FROM disbursements\s+WHERE status NOT IN/, () => []);
  db.when(/identifier_value AS payout_id/, ({ sql, params }) => {
    const system = /\$2/.test(sql) ? (params[1] ?? 'yellowcard') : 'yellowcard';
    return state.rows
      .filter((r) => r.status === S.YELLOWCARD_PAYOUT_SUBMITTED)
      .map((r) => {
        const match = state.refs.find(
          (f) => f.disbursementId === r.id && f.system === system && f.type === 'payout_id'
        );
        return { ...r, payout_id: match ? match.identifier_value : null };
      })
      .slice(0, params[0]);
  });
  db.when(/FROM yellow_card_webhook_events we\s+JOIN/, () => []);

  db.when(/INSERT INTO disbursement_evidence/, ({ params }) => {
    state.evidence.push({
      disbursementId: params[1],
      type: params[2],
      envelope: JSON.parse(params[3]),
      recordedBy: params[4],
    });
    return { changes: 1, rows: [] };
  });
  db.when(/INSERT INTO external_status_snapshots/, ({ params }) => {
    state.snapshots.push({
      disbursementId: params[0],
      source: params[1],
      status: params[2],
      errorMessage: params[5],
    });
    return { changes: 1, rows: [] };
  });

  db.when(/^SELECT \* FROM external_refs\s+WHERE disbursement_id = \$1/, ({ params }) =>
    state.refs.find(
      (r) =>
        r.disbursementId === params[0] &&
        r.system === params[1] &&
        r.type === (params[2] ?? 'payout_id')
    ) || null
  );
  db.when(/INSERT INTO external_refs \(disbursement_id/, () => ({ changes: 1, rows: [] }));

  db.when(/SELECT COUNT\(\*\) AS n FROM external_refs\s+WHERE disbursement_id/, ({ sql, params }) => {
    const system = /\$2/.test(sql) ? (params[1] ?? 'yellowcard') : 'yellowcard';
    return {
      n: state.refs.filter(
        (r) => r.disbursementId === params[0] && r.system === system && r.type === 'payout_id'
      ).length,
    };
  });
  db.when(/SELECT COUNT\(\*\) AS n FROM on_chain_events/, () => ({ n: 0 }));
  db.when(/FROM yellow_card_webhook_events\s+WHERE disbursement_id/, () => ({ n: 0 }));
  db.when(/FROM disbursement_evidence\s+WHERE disbursement_id/, ({ params }) => ({
    n: state.entered.has(`${params[0]}:${params[1]}`) ? 1 : 0,
  }));

  db.when(/INSERT INTO manual_review_queue/, ({ params }) => {
    const open = state.queue.find((q) => q.disbursementId === params[0] && !q.resolved);
    if (!open) state.queue.push({ disbursementId: params[0], reason: params[1], resolved: false });
    return { changes: open ? 0 : 1, rows: [] };
  });
  db.when(/UPDATE manual_review_queue/, () => ({ changes: 1, rows: [] }));

  const ctx = createTestCtx({ db, adapters, payoutProvider });
  reconciliationWorker.init(ctx, { getNow });
  return { db, ctx, state, adapters };
}

function pollEvidence(state, id) {
  return state.evidence.filter((e) => e.disbursementId === id && e.type === 'poll_result');
}

function scanProviderParams(db) {
  return db.callsMatching(/identifier_value AS payout_id/).map((c) => c.params[1]);
}

test('missingWebhook polls and labels the configured provider on completion', async () => {
  const rows = [makeRow('d1', S.YELLOWCARD_PAYOUT_SUBMITTED)];
  const adapters = providerAdapters();
  adapters.breet.lookupResults = { 'breet-1': { status: 'completed', data: { id: 'breet-1' } } };
  const { state } = buildHarness({
    rows,
    adapters,
    payoutProvider: 'breet',
    refs: [ref('d1', 'breet', 'breet-1')],
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.ok(summary.ok, JSON.stringify(summary.errors));
  assert.equal(summary.modes.missingWebhook.advanced, 1);
  assert.equal(rows[0].status, S.YELLOWCARD_PAYOUT_CONFIRMED);
  assert.equal(adapters.breet.calls.lookupSend[0], 'breet-1');
  assert.deepEqual(adapters.yellowcard.calls.lookupSend, []);
  assert.equal(pollEvidence(state, 'd1')[0].envelope.status.adapter, 'breet');
  assert.equal(pollEvidence(state, 'd1')[0].envelope.status.poll_status, 'completed');
});

test('missingWebhook marks failed under the configured provider', async () => {
  const rows = [makeRow('d2', S.YELLOWCARD_PAYOUT_SUBMITTED)];
  const adapters = providerAdapters();
  adapters.breet.lookupResults = { 'breet-2': { status: 'failed', data: { id: 'breet-2' } } };
  const { state } = buildHarness({
    rows,
    adapters,
    payoutProvider: 'breet',
    refs: [ref('d2', 'breet', 'breet-2')],
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.missingWebhook.markedFailed, 1);
  assert.equal(rows[0].status, S.FAILED);
  assert.deepEqual(adapters.breet.calls.lookupSend, ['breet-2']);
  assert.equal(pollEvidence(state, 'd2')[0].envelope.status.adapter, 'breet');
  assert.equal(pollEvidence(state, 'd2')[0].envelope.status.poll_status, 'failed');
});

test('missingWebhook records a poll error against the configured provider', async () => {
  const rows = [makeRow('d3', S.YELLOWCARD_PAYOUT_SUBMITTED)];
  const adapters = providerAdapters();
  adapters.breet.lookupResults = () => {
    throw new Error('breet down');
  };
  const { state } = buildHarness({
    rows,
    adapters,
    payoutProvider: 'breet',
    refs: [ref('d3', 'breet', 'breet-3')],
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.missingWebhook.routed, 0);
  assert.equal(rows[0].status, S.YELLOWCARD_PAYOUT_SUBMITTED);
  assert.ok(adapters.breet.calls.lookupSend.includes('breet-3'));
  assert.equal(pollEvidence(state, 'd3').length, 1);
  assert.equal(pollEvidence(state, 'd3')[0].envelope.status.adapter, 'breet');
  assert.equal(pollEvidence(state, 'd3')[0].envelope.status.poll_status, 'error');
});

test('pending payout is polled under the configured provider at both poll sites', async () => {
  const rows = [makeRow('d4', S.YELLOWCARD_PAYOUT_SUBMITTED)];
  const adapters = providerAdapters();
  adapters.breet.lookupResults = { 'breet-4': { status: 'in_progress' } };
  const { state } = buildHarness({
    rows,
    adapters,
    payoutProvider: 'breet',
    refs: [ref('d4', 'breet', 'breet-4')],
  });

  const summary = await reconciliationWorker.reconcileOnce();

  assert.equal(summary.modes.missingWebhook.scanned, 1);
  assert.equal(summary.modes.orphanedPayout.scanned, 1);
  assert.deepEqual(adapters.breet.calls.lookupSend, ['breet-4', 'breet-4']);
  assert.deepEqual(adapters.yellowcard.calls.lookupSend, []);
  assert.equal(rows[0].status, S.YELLOWCARD_PAYOUT_SUBMITTED);
  assert.equal(pollEvidence(state, 'd4').length, 1);
  assert.equal(pollEvidence(state, 'd4')[0].envelope.status.adapter, 'breet');
  assert.equal(pollEvidence(state, 'd4')[0].envelope.status.poll_status, 'in_progress');
});

test('legacy yellowcard row is polled under yellowcard when the configured provider changes', async () => {
  const rows = [makeRow('d5', S.YELLOWCARD_PAYOUT_SUBMITTED)];
  const adapters = providerAdapters();
  adapters.yellowcard.lookupResults = { 'yc-legacy': { status: 'in_progress' } };
  const { db, state } = buildHarness({
    rows,
    adapters,
    payoutProvider: 'breet',
    refs: [ref('d5', 'yellowcard', 'yc-legacy')],
  });

  await reconciliationWorker.reconcileOnce();

  assert.deepEqual(scanProviderParams(db), ['breet', 'breet']);
  assert.deepEqual(adapters.yellowcard.calls.lookupSend, ['yc-legacy', 'yc-legacy']);
  assert.deepEqual(adapters.breet.calls.lookupSend, []);
  assert.equal(pollEvidence(state, 'd5')[0].envelope.status.adapter, 'yellowcard');
  assert.equal(rows[0].status, S.YELLOWCARD_PAYOUT_SUBMITTED);
});

test('legacy row polls the issuer named by metadata.provider', async () => {
  const rows = [makeRow('d6', S.YELLOWCARD_PAYOUT_SUBMITTED)];
  const adapters = providerAdapters();
  adapters.breet.lookupResults = { 'legacy-breet': { status: 'in_progress' } };
  const { state } = buildHarness({
    rows,
    adapters,
    payoutProvider: 'breet',
    refs: [ref('d6', 'yellowcard', 'legacy-breet', { provider: 'breet' })],
  });

  await reconciliationWorker.reconcileOnce();

  assert.deepEqual(adapters.breet.calls.lookupSend, ['legacy-breet', 'legacy-breet']);
  assert.deepEqual(adapters.yellowcard.calls.lookupSend, []);
  assert.equal(pollEvidence(state, 'd6')[0].envelope.status.adapter, 'breet');
  assert.equal(rows[0].status, S.YELLOWCARD_PAYOUT_SUBMITTED);
});

test('default yellowcard reconciliation is preserved', async () => {
  const rows = [makeRow('d7', S.YELLOWCARD_PAYOUT_SUBMITTED)];
  const adapters = providerAdapters();
  adapters.yellowcard.lookupResults = { 'yc-default': { status: 'in_progress' } };
  const { state } = buildHarness({
    rows,
    adapters,
    refs: [ref('d7', 'yellowcard', 'yc-default')],
  });

  await reconciliationWorker.reconcileOnce();

  assert.deepEqual(adapters.yellowcard.calls.lookupSend, ['yc-default', 'yc-default']);
  assert.deepEqual(adapters.breet.calls.lookupSend, []);
  assert.equal(pollEvidence(state, 'd7')[0].envelope.status.adapter, 'yellowcard');
  assert.equal(rows[0].status, S.YELLOWCARD_PAYOUT_SUBMITTED);
});
