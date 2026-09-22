/**
 * Sprint 5 — v1 public API route tests: endpoints 1–6
 * (create / get / list / advance / retry / recover).
 *
 * Deterministic, mocked (FakeDb + mock adapters), no credentials, no network —
 * the same pattern as test/unit/disbursements-routes.test.js but against the
 * versioned router at /api/v1/disbursements/*.
 *
 * Covers: happy paths, normalized 404s, the fail-closed 400s from the service,
 * and the normalized 409 error schema on guard/eligibility rejections.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { init } from '../../src/services/bos/disbursementService.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createTestCtx } from '../helpers/ctx.js';
import {
  VALID_BODY,
  createV1Store,
  makeV1App,
  listen,
  snapshotEnv,
  restoreEnv,
} from '../helpers/v1Api.js';

test('v1 public routes: create / get / list / advance / retry / recover', async (t) => {
  const env = snapshotEnv();
  t.afterEach(() => restoreEnv(env));

  const db = createFakeDb();
  const store = createV1Store(db);
  const ctx = createTestCtx({ db, adapters: createMockAdapters() });
  await init(ctx);

  const app = makeV1App();
  const { base, close } = await listen(app);
  t.after(() => close());

  delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
  process.env.BOS_API_TOKEN = 'secret-token';
  const headers = { 'content-type': 'application/json', authorization: 'Bearer secret-token' };

  // afterEach restores env per subtest, so each subtest re-applies auth.
  const setAuth = () => {
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';
  };

  await t.test('(1) POST create → 201 with a disbursement that ran its first transition to preflight_check', async () => {
    setAuth();
    store.reset();
    const res = await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    });
    assert.equal(res.status, 201);
    const { disbursement } = await res.json();
    assert.ok(disbursement.id, 'created disbursement has an id');
    assert.equal(disbursement.recipient_bank_account, '0123456789');
    assert.equal(disbursement.recipient_bank_code, '044');
    assert.equal(disbursement.status, 'preflight_check');
    assert.equal(JSON.parse(store.row.preflight_result).ok, false);
  });

  await t.test('(1) POST create → 400 missing_recipient_bank_details (fail closed, no INSERT)', async () => {
    setAuth();
    store.reset();
    const insertsBefore = db.countMatching(/INSERT INTO disbursements/);
    const res = await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers,
      body: JSON.stringify({ ...VALID_BODY, recipient_bank_account: '', recipient_bank_code: '' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'missing_recipient_bank_details');
    assert.deepEqual(body.details, { missing: ['recipient_bank_account', 'recipient_bank_code'] });
    assert.equal(db.countMatching(/INSERT INTO disbursements/), insertsBefore, 'no INSERT on a fail-closed create');
  });

  await t.test('(2) GET by id → 200 enriched disbursement (external_refs + audit_log arrays)', async () => {
    setAuth();
    store.reset();
    const created = await (await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    })).json();

    const res = await fetch(`${base}/api/v1/disbursements/${created.disbursement.id}`, { headers });
    assert.equal(res.status, 200);
    const { disbursement } = await res.json();
    assert.equal(disbursement.id, created.disbursement.id);
    assert.ok(Array.isArray(disbursement.external_refs));
    assert.ok(Array.isArray(disbursement.audit_log));
  });

  await t.test('(2) GET by id → normalized 404 for an unknown id', async () => {
    setAuth();
    store.reset();
    const res = await fetch(`${base}/api/v1/disbursements/does-not-exist`, { headers });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'not found');
    assert.equal(body.error_code, 'not_found');
  });

  await t.test('(3) GET list → 200 { disbursements, total }', async () => {
    setAuth();
    store.reset();
    await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    });

    const res = await fetch(`${base}/api/v1/disbursements?limit=5&offset=0`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.disbursements));
    assert.equal(body.disbursements.length, 1);
    assert.equal(body.total, 1);
  });

  await t.test('(4) POST advance → 200 and advances exactly one step (preflight rejection escalates to manual_review)', async () => {
    setAuth();
    store.reset();
    const created = await (await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    })).json();

    const res = await fetch(`${base}/api/v1/disbursements/${created.disbursement.id}/advance`, {
      method: 'POST', headers,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.success, true);
    assert.equal(body.result.new_state, 'manual_review');
    assert.equal(body.result.escalated_from_rejection, true);
    assert.equal(body.disbursement.status, 'manual_review');
    assert.equal(db.countMatching(/INSERT INTO external_refs/), 0, 'burn was never submitted');
  });

  await t.test('(4) POST advance → normalized 409 when a guard rejects (burn_submitted with no tx id)', async () => {
    setAuth();
    store.reset();
    store.setRow({ id: 'stuck-burn', status: 'burn_submitted', external_tx_id: null });

    const res = await fetch(`${base}/api/v1/disbursements/stuck-burn/advance`, {
      method: 'POST', headers,
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error_code, 'u8211', 'specific guard error_code is surfaced');
    assert.ok(body.error.includes('No external tx_id'));
  });

  await t.test('(5) POST retry → normalized 409 retry_conflict when not in failed state', async () => {
    setAuth();
    store.reset();
    const created = await (await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    })).json();

    const res = await fetch(`${base}/api/v1/disbursements/${created.disbursement.id}/retry`, {
      method: 'POST', headers,
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error_code, 'retry_conflict');
    assert.ok(body.error.includes('Can only retry from failed state'));
  });

  await t.test('(6) POST recover → 200 escalates a stuck disbursement to manual_review', async () => {
    setAuth();
    store.reset();
    const created = await (await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    })).json();

    const res = await fetch(`${base}/api/v1/disbursements/${created.disbursement.id}/recover`, {
      method: 'POST', headers, body: JSON.stringify({ reason: 'stuck in pipeline' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.success, true);
    assert.equal(body.result.new_state, 'manual_review');
    assert.equal(body.disbursement.status, 'manual_review');
    assert.equal(store.row.status, 'manual_review');
  });

  await t.test('(4) POST advance with steps=2 runs the escalation then the manual_review terminal exit', async () => {
    setAuth();
    store.reset();
    const created = await (await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    })).json();

    const res = await fetch(`${base}/api/v1/disbursements/${created.disbursement.id}/advance?steps=2`, {
      method: 'POST', headers,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.success, true);
    assert.equal(body.result.new_state, 'failed', 'second step routes manual_review → failed');
    assert.equal(body.disbursement.status, 'failed');
  });
});