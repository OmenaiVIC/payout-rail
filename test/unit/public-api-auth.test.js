/**
 * Sprint 5 — v1 public API: fail-closed auth contract.
 *
 * Every /api/v1/disbursements/* route is gated by the shared bearer token
 * (BOS_API_TOKEN). With `normalize: true`, denials carry the machine-readable
 * ErrorResponse body `{ error, error_code }` instead of the legacy v0 body.
 *
 * Cases: token set + none/wrong bearer → 401 normalized; no token + hatch off
 * → 401 normalized; correct bearer → passes; dev escape hatch honoured.
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

test('v1 public API: fail-closed auth', async (t) => {
  const env = snapshotEnv();
  t.afterEach(() => restoreEnv(env));

  const db = createFakeDb();
  const store = createV1Store(db);
  const ctx = createTestCtx({ db, adapters: createMockAdapters() });
  await init(ctx);

  const app = makeV1App();
  const { base, close } = await listen(app);
  t.after(() => close());

  const assertDenied = async (res) => {
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'unauthorized');
    assert.equal(body.error_code, 'unauthorized', 'normalized code is present on the v1 denial body');
    assert.equal('details' in body, false);
  };

  await t.test('denies a request with no bearer when a token is configured', async () => {
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';
    store.reset();
    const insertsBefore = db.countMatching(/INSERT INTO disbursements/);

    const res = await fetch(`${base}/api/v1/disbursements`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    await assertDenied(res);
    assert.equal(db.countMatching(/INSERT INTO disbursements/), insertsBefore, 'denial touches no state');
  });

  await t.test('denies a wrong bearer token with a normalized 401', async () => {
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';

    const res = await fetch(`${base}/api/v1/disbursements`, {
      headers: { authorization: 'Bearer not-the-token' },
    });
    await assertDenied(res);
  });

  await t.test('denies when no token is configured and the dev escape hatch is off', async () => {
    delete process.env.BOS_API_TOKEN;
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;

    const res = await fetch(`${base}/api/v1/disbursements`, {});
    await assertDenied(res);
  });

  await t.test('passes with the correct bearer token', async () => {
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';

    const res = await fetch(`${base}/api/v1/disbursements`, {
      headers: { authorization: 'Bearer secret-token' },
    });
    assert.equal(res.status, 200);
  });

  await t.test('honours the BOS_ALLOW_UNAUTHENTICATED_DEV escape hatch', async () => {
    delete process.env.BOS_API_TOKEN;
    process.env.BOS_ALLOW_UNAUTHENTICATED_DEV = 'true';

    const res = await fetch(`${base}/api/v1/disbursements`, {});
    assert.equal(res.status, 200);
  });
});