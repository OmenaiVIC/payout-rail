/**
 * Sprint 5 — v1 public API: idempotency contract through the routes.
 *
 * POST /api/v1/disbursements derives the deterministic idempotency key over
 * (source_reference, source_application, amount_usdcx, recipient_bank_account).
 * A duplicate create is recognised as the same disbursement: same id returned,
 * no second INSERT, and the route still answers 201 (the caller retried).
 * Distinct inputs produce a distinct key and a distinct disbursement.
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

test('v1 public API: idempotent create', async (t) => {
  const env = snapshotEnv();
  t.afterEach(() => restoreEnv(env));

  const db = createFakeDb();
  const store = createV1Store(db);
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

  await t.test('(10) POST create → a duplicate payload returns the existing row, no second INSERT', async () => {
    setAuth();
    store.reset();
    const insertsBefore = db.countMatching(/INSERT INTO disbursements/);

    const first = await (await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    })).json();
    const second = await (await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    })).json();

    assert.ok(first.disbursement.id, 'first create produced an id');
    assert.equal(second.disbursement.id, first.disbursement.id, 'the duplicate resolves to the same disbursement');
    assert.equal(db.countMatching(/INSERT INTO disbursements/), insertsBefore + 1, 'exactly one row inserted across both calls');
    assert.ok(store.row, 'row still read-backed by the store');
  });

  await t.test('(10) POST create → distinct inputs produce a distinct disbursement', async () => {
    setAuth();
    store.reset();

    const first = await (await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    })).json();
    const other = await (await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST', headers,
      body: JSON.stringify({ ...VALID_BODY, amount_usdcx: 99_000_000 }),
    })).json();

    assert.notEqual(other.disbursement.id, first.disbursement.id, 'a different amount is a different disbursement');
  });
});