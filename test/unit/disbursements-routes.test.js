/**
 * Route-level tests for the disbursement API (G-03).
 *
 * These exercise the real Express router over a real HTTP listener, backed by
 * the FakeDb and mock adapters. They prove: method/route wiring, fail-closed
 * auth, and that a created record is readable and advanceable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import router from '../../src/routes/disbursements.js';
import { init } from '../../src/services/bos/disbursementService.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createTestCtx } from '../helpers/ctx.js';

const VALID_BODY = {
  source_reference: 'camp-1',
  source_application: 'test-app',
  amount_usd: 25,
  amount_usdcx: 25_000_000,
  creator_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
  creator_btc_address: 'bc1qexample000000000000000000000000000000000',
  recipient_bank_account: '0123456789',
  recipient_bank_code: '044',
  ngn_recipient: { bankCode: '044', accountNumber: '0123456789' },
};

/** Minimal stand-in for the `disbursements` row so the service can run. */
function createRowStore(db) {
  let row = null;

  db.when(/SELECT \* FROM disbursements WHERE idempotency_key = \$1/, () => null);

  db.when(/INSERT INTO disbursements/, ({ params }) => {
    row = {
      id: params[0],
      idempotency_key: params[1],
      source_reference: params[2],
      source_application: params[3],
      amount_usd: params[4],
      amount_usdcx: params[5],
      creator_address: params[6],
      creator_btc_address: params[7],
      recipient_bank_account: params[8],
      recipient_bank_code: params[9],
      status: params[11],
      retry_count: 0,
      max_retries: 3,
    };
    return { changes: 1, rows: [] };
  });

  db.when(/SELECT \* FROM disbursements WHERE id = \$1/, ({ params }) => (
    row && row.id === params[0] ? row : null
  ));

  db.when(/SELECT \* FROM disbursements\s+ORDER BY created_at DESC/, () => (row ? [row] : []));
  db.when(/SELECT COUNT\(\*\) as total FROM disbursements/, () => ({ total: row ? 1 : 0 }));

  db.when(/UPDATE disbursements\s+SET status = \$1/, ({ params }) => {
    if (row) row.status = params[0];
    return { changes: 1, rows: [] };
  });

  db.when(/UPDATE disbursements SET preflight_result = \$4/, ({ params }) => {
    if (row) row.preflight_result = params[0];
    return { changes: 1, rows: [] };
  });

  db.when(/UPDATE disbursements SET manual_review_at = \$4/, ({ params }) => {
    if (row) row.manual_review_at = params[0];
    return { changes: 1, rows: [] };
  });

  db.when(/UPDATE disbursements SET error_message/, () => ({ changes: 1, rows: [] }));

  return {
    get row() { return row; },
    reset() { row = null; },
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/disbursements', router);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

const ENV_KEYS = ['BOS_API_TOKEN', 'BOS_ALLOW_UNAUTHENTICATED_DEV'];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot) {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

test('disbursement routes', async (t) => {
  const env = snapshotEnv();

  t.afterEach(() => restoreEnv(env));

  const db = createFakeDb();
  const store = createRowStore(db);
  const ctx = createTestCtx({ db, adapters: createMockAdapters() });
  await init(ctx);

  const app = makeApp();
  const { base, close } = await listen(app);
  t.after(() => close());

  const noAuth = () => fetch(`${base}/api/disbursements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(VALID_BODY),
  });

  await t.test('rejects when BOS_API_TOKEN is set and no bearer is presented', async () => {
    store.reset();
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';

    const res = await noAuth();
    assert.equal(res.status, 401);
    assert.equal(db.countMatching(/INSERT INTO disbursements/), 0);
  });

  await t.test('rejects a wrong bearer token', async () => {
    store.reset();
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';

    const res = await fetch(`${base}/api/disbursements`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
      body: JSON.stringify(VALID_BODY),
    });
    assert.equal(res.status, 401);
  });

  await t.test('rejects when no token is configured and dev escape hatch is off', async () => {
    store.reset();
    delete process.env.BOS_API_TOKEN;
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;

    const res = await noAuth();
    assert.equal(res.status, 401);
  });

  await t.test('accepts with the correct bearer token: create → read → advance', async () => {
    store.reset();
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';

    const headers = { 'content-type': 'application/json', authorization: 'Bearer secret-token' };

    const created = await fetch(`${base}/api/disbursements`, {
      method: 'POST', headers, body: JSON.stringify(VALID_BODY),
    });
    assert.equal(created.status, 201);
    const { disbursement } = await created.json();
    assert.ok(disbursement.id, 'created disbursement has an id');
    assert.equal(disbursement.recipient_bank_account, '0123456789');
    assert.equal(disbursement.recipient_bank_code, '044');
    // create runs the first transition (initiated → preflight_check)
    assert.equal(disbursement.status, 'preflight_check');
    // the preflight verdict was persisted onto the row (JSON-stringified by serializer)
    assert.equal(JSON.parse(store.row.preflight_result).ok, false);

    const read = await fetch(`${base}/api/disbursements/${disbursement.id}`, { headers });
    assert.equal(read.status, 200);
    const readBody = await read.json();
    assert.equal(readBody.disbursement.id, disbursement.id);
    assert.ok(Array.isArray(readBody.disbursement.audit_log));

    // G-01 fail-closed: the failing preflight verdict blocks the burn and
    // escalates to manual review rather than stalling or burning.
    const advanced = await fetch(`${base}/api/disbursements/${disbursement.id}/advance`, {
      method: 'POST', headers,
    });
    assert.equal(advanced.status, 200);
    const advBody = await advanced.json();
    assert.equal(advBody.result.success, true);
    assert.equal(advBody.result.new_state, 'manual_review');
    assert.equal(advBody.result.escalated_from_rejection, true);
    assert.equal(advBody.disbursement.status, 'manual_review');
    assert.equal(store.row.status, 'manual_review');
    assert.equal(db.countMatching(/INSERT INTO external_refs/), 0, 'burn was never submitted');
  });

  await t.test('returns 404 for an unknown id', async () => {
    store.reset();
    process.env.BOS_API_TOKEN = 'secret-token';
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;

    const res = await fetch(`${base}/api/disbursements/does-not-exist`, {
      headers: { authorization: 'Bearer secret-token' },
    });
    assert.equal(res.status, 404);
  });

  await t.test('honours the BOS_ALLOW_UNAUTHENTICATED_DEV escape hatch', async () => {
    store.reset();
    delete process.env.BOS_API_TOKEN;
    process.env.BOS_ALLOW_UNAUTHENTICATED_DEV = 'true';

    const res = await noAuth();
    assert.equal(res.status, 201);
    assert.ok(store.row, 'a row was created');
  });
});
