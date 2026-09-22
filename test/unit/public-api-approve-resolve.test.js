/**
 * Sprint 5 — v1 public API route tests: manual-review operations
 * (POST /:id/approve, POST /:id/resolve).
 *
 * Deterministic, mocked (FakeDb + mock adapters), no credentials, no network.
 *
 * Approve: two-person approval contributions are idempotent per
 * (disbursement_id, approver); the second distinct approver flips `approved`.
 *
 * Resolve: maps the manual_review row onto the existing terminal state-machine
 * exits (settled / failed / cancelled). The operator attribution (resolved_by)
 * is written before the transition; the terminal action's own resolve call is a
 * no-op against the already-closed queue row.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { init } from '../../src/services/bos/disbursementService.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createTestCtx } from '../helpers/ctx.js';
import {
  createV1Store,
  wireApprovals,
  makeV1App,
  listen,
  snapshotEnv,
  restoreEnv,
} from '../helpers/v1Api.js';

test('v1 public API: approve + resolve (manual review)', async (t) => {
  const env = snapshotEnv();
  t.afterEach(() => restoreEnv(env));

  const db = createFakeDb();
  const store = createV1Store(db);
  const { approvals } = wireApprovals(db);
  const ctx = createTestCtx({ db, adapters: createMockAdapters() });
  await init(ctx);

  const app = makeV1App();
  const { base, close } = await listen(app);
  t.after(() => close());

  const headers = { 'content-type': 'application/json', authorization: 'Bearer secret-token' };
  const setAuth = () => {
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';
  };

  // ── POST /:id/approve ───────────────────────────────────────────────────
  await t.test('(7) POST approve → first approval records 1/2 (not yet approved)', async () => {
    setAuth();
    approvals.length = 0;
    store.setRow({ id: 'app-row', status: 'preflight_check', amount_usd: 25 });

    const res = await fetch(`${base}/api/v1/disbursements/app-row/approve`, {
      method: 'POST', headers, body: JSON.stringify({ approver: 'ops-1' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.disbursement_id, 'app-row');
    assert.equal(body.approver, 'ops-1');
    assert.equal(body.approved, false);
    assert.equal(body.approvals_received, 1);
    assert.equal(body.approvals_needed, 2);
    assert.equal(approvals.length, 1);
  });

  await t.test('(7) POST approve → a second distinct approver reaches 2/2 and approves', async () => {
    setAuth();
    approvals.length = 0;
    store.setRow({ id: 'app-row', status: 'manual_review', amount_usd: 25 });
    await fetch(`${base}/api/v1/disbursements/app-row/approve`, {
      method: 'POST', headers, body: JSON.stringify({ approver: 'ops-1' }),
    });

    const res = await fetch(`${base}/api/v1/disbursements/app-row/approve`, {
      method: 'POST', headers, body: JSON.stringify({ approver: 'ops-2' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.approved, true);
    assert.equal(body.approvals_received, 2);
    assert.equal(approvals.length, 2, 'two distinct records, no duplicates');
  });

  await t.test('(7) POST approve → the same approver is idempotent (no double count)', async () => {
    setAuth();
    approvals.length = 0;
    store.setRow({ id: 'app-row', status: 'preflight_check', amount_usd: 25 });

    const first = await (await fetch(`${base}/api/v1/disbursements/app-row/approve`, {
      method: 'POST', headers, body: JSON.stringify({ approver: 'ops-1' }),
    })).json();
    const second = await (await fetch(`${base}/api/v1/disbursements/app-row/approve`, {
      method: 'POST', headers, body: JSON.stringify({ approver: 'ops-1' }),
    })).json();

    assert.equal(first.approvals_received, 1);
    assert.equal(second.approvals_received, 1, 'repeat of the same approver does not count twice');
    assert.equal(approvals.length, 1, 'single row persisted for the (id, approver) pair');
  });

  await t.test('(7) POST approve → 400 invalid_body when approver is missing (no INSERT)', async () => {
    setAuth();
    approvals.length = 0;
    store.setRow({ id: 'app-row', status: 'preflight_check', amount_usd: 25 });

    const res = await fetch(`${base}/api/v1/disbursements/app-row/approve`, {
      method: 'POST', headers, body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'invalid_body');
    assert.deepEqual(body.details, { missing: ['approver'] });
    assert.equal(approvals.length, 0, 'no approval row written');
  });

  await t.test('(7) POST approve → normalized 404 for an unknown disbursement', async () => {
    setAuth();
    approvals.length = 0;
    store.reset();
    const res = await fetch(`${base}/api/v1/disbursements/nope/approve`, {
      method: 'POST', headers, body: JSON.stringify({ approver: 'ops-1' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error_code, 'not_found');
  });

  // ── POST /:id/resolve ───────────────────────────────────────────────────
  const queueCalls = () => db.callsMatching(/UPDATE manual_review_queue/);

  await t.test('(8) POST resolve → settled: 200, terminal row + resolved_by attribution', async () => {
    setAuth();
    store.setRow({ id: 'res-row', status: 'manual_review', amount_usd: 25 });
    const firstQueueIdx = queueCalls().length;

    const res = await fetch(`${base}/api/v1/disbursements/res-row/resolve`, {
      method: 'POST', headers,
      body: JSON.stringify({ resolution: 'settled', reviewer: 'reviewer-bob', note: 'payout confirmed off-chain' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.success, true);
    assert.equal(body.result.new_state, 'settled');
    assert.equal(body.result.details.reviewer, 'reviewer-bob');
    assert.equal(body.result.details.note, 'payout confirmed off-chain');
    assert.ok(body.result.details.settled_at, 'settled_at persisted by markSettled');
    assert.equal(body.disbursement.status, 'settled');
    assert.equal(store.row.status, 'settled');
    assert.ok(store.row.settled_at, 'settled_at written onto the row');

    const call = queueCalls()[firstQueueIdx];
    assert.equal(call.params && call.params[2], 'reviewer-bob', 'operator attribution lands first on the queue row');
  });

  await t.test('(8) POST resolve → the default attribution is workflow when no reviewer is supplied', async () => {
    setAuth();
    store.setRow({ id: 'res-row', status: 'manual_review', amount_usd: 25 });
    const firstQueueIdx = queueCalls().length;

    const res = await fetch(`${base}/api/v1/disbursements/res-row/resolve`, {
      method: 'POST', headers, body: JSON.stringify({ resolution: 'failed' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.success, true);
    assert.equal(body.result.new_state, 'failed');
    assert.ok(body.result.details.failed_at, 'failed_at persisted by markFailed');
    assert.equal(body.disbursement.status, 'failed');
    const call = queueCalls()[firstQueueIdx];
    assert.equal(call.params && call.params[2], 'workflow', 'default resolved_by is workflow');
  });

  await t.test('(8) POST resolve → cancelled exits to a terminal row', async () => {
    setAuth();
    store.setRow({ id: 'res-row', status: 'manual_review', amount_usd: 25 });

    const res = await fetch(`${base}/api/v1/disbursements/res-row/resolve`, {
      method: 'POST', headers, body: JSON.stringify({ resolution: 'cancelled' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.success, true);
    assert.equal(body.result.new_state, 'cancelled');
    assert.ok(body.result.details.cancelled_at);
    assert.equal(body.disbursement.status, 'cancelled');
  });

  await t.test('(8) POST resolve → 400 invalid_body for an unknown resolution', async () => {
    setAuth();
    store.setRow({ id: 'res-row', status: 'manual_review', amount_usd: 25 });

    const res = await fetch(`${base}/api/v1/disbursements/res-row/resolve`, {
      method: 'POST', headers, body: JSON.stringify({ resolution: 'refund' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'invalid_body');
    assert.deepEqual(body.details, { field: 'resolution', allowed: ['settled', 'failed', 'cancelled'] });
  });

  await t.test('(8) POST resolve → 409 wrong_state when the disbursement is not in manual_review', async () => {
    setAuth();
    store.setRow({ id: 'res-row', status: 'preflight_check', amount_usd: 25 });

    const res = await fetch(`${base}/api/v1/disbursements/res-row/resolve`, {
      method: 'POST', headers, body: JSON.stringify({ resolution: 'settled' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error_code, 'wrong_state');
    assert.deepEqual(body.details, { current_state: 'preflight_check', expected_state: 'manual_review' });
    assert.equal(store.row.status, 'preflight_check', 'row is untouched by a wrong_state resolve');
  });

  await t.test('(8) POST resolve → normalized 404 for an unknown disbursement', async () => {
    setAuth();
    store.reset();
    const res = await fetch(`${base}/api/v1/disbursements/nope/resolve`, {
      method: 'POST', headers, body: JSON.stringify({ resolution: 'settled' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error_code, 'not_found');
  });
});