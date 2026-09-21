/**
 * G-06: Webhook signature verification — verify-first ordering, fail-closed.
 *
 * These exercise the real Express app (with raw-body capture via
 * express.json({ verify })) over an ephemeral HTTP listener, backed by FakeDb
 * and mock adapters. They prove the ordering requirement: unsigned/wrong
 * payloads are rejected with 401 BEFORE any state is touched, valid payloads
 * are handled, duplicates do not double-advance, and the /test endpoint is
 * behind the admin token.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

import webhooksRouter from '../../src/routes/webhooks.js';
import { init } from '../../src/services/bos/disbursementService.js';
import { DisbursementState as S } from '../../src/services/bos/types.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createTestCtx } from '../helpers/ctx.js';

const PAYOUT_ID = 'yc-payout-1';
const SECRET = 'webhook-test-secret';

const PAYLOAD = { payout_id: PAYOUT_ID, status: 'completed', reference: 'ref-1' };
const BODY = JSON.stringify(PAYLOAD);

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Backing store for handleYellowCardWebhook → advanceDisbursement.
 * Models the disbursement row + the external_refs payout lookup.
 */
function createWebhookStore(db) {
  const row = {
    id: 'd-wh',
    status: S.YELLOWCARD_PAYOUT_SUBMITTED,
    retry_count: 0,
    max_retries: 3,
  };

  // The JOIN used to resolve payout_id → disbursement (d.status aliased to status).
  db.when(/FROM external_refs er\s+JOIN disbursements d ON d\.id = er\.disbursement_id/, () => ({
    disbursement_id: row.id,
    status: row.status,
    identifier_type: 'payout_id',
    identifier_value: PAYOUT_ID,
    external_system: 'yellowcard',
    metadata: {},
  }));

  // Re-read in advanceDisbursement.
  db.when(/SELECT \* FROM disbursements WHERE id = \$1/, () => ({ ...row }));

  // Status UPDATE from executeTransition.
  db.when(/UPDATE disbursements\s+SET status = \$1/, ({ params }) => {
    row.status = params[0];
    return { changes: 1, rows: [] };
  });

  // Guard / action read the payout external ref.
  db.when(/SELECT \* FROM external_refs/, () => ({
    disbursement_id: row.id,
    external_system: 'yellowcard',
    identifier_type: 'payout_id',
    identifier_value: PAYOUT_ID,
    metadata: {},
  }));

  return {
    get status() { return row.status; },
  };
}

const ENV_KEYS = ['YELLOW_CARD_WEBHOOK_SECRET', 'BOS_API_TOKEN', 'BOS_ALLOW_UNAUTHENTICATED_DEV'];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot) {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

async function makeApp(db, adapters) {
  await init(createTestCtx({ db, adapters }));
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/bos/webhooks', webhooksRouter);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test('G-06: webhook verification ordering', async (t) => {
  const env = snapshotEnv();
  t.afterEach(() => restoreEnv(env));

  await t.test('rejects an unsigned payload with 401 and touches no state', async () => {
    process.env.YELLOW_CARD_WEBHOOK_SECRET = SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      const res = await fetch(`${base}/api/bos/webhooks/yellowcard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: BODY,
      });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.reason, 'missing_signature');
      assert.equal(db.countMatching(/FROM external_refs er\s+JOIN disbursements/), 0, 'handler never reached');
      assert.equal(db.countMatching(/UPDATE disbursements/), 0, 'no state was written');
    } finally { await close(); }
  });

  await t.test('rejects a wrong signature with 401 and touches no state', async () => {
    process.env.YELLOW_CARD_WEBHOOK_SECRET = SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      const res = await fetch(`${base}/api/bos/webhooks/yellowcard`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-yellowcard-signature': sign(BODY, 'wrong-secret'),
        },
        body: BODY,
      });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).reason, 'invalid_signature');
      assert.equal(db.countMatching(/FROM external_refs er\s+JOIN disbursements/), 0, 'handler never reached');
      assert.equal(db.countMatching(/UPDATE disbursements/), 0, 'no state was written');
    } finally { await close(); }
  });

  await t.test('rejects with 401 when no secret is configured (fail closed, not fail open)', async () => {
    delete process.env.YELLOW_CARD_WEBHOOK_SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      const res = await fetch(`${base}/api/bos/webhooks/yellowcard`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-yellowcard-signature': sign(BODY, SECRET),
        },
        body: BODY,
      });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).reason, 'no_secret_configured');
      assert.equal(db.countMatching(/UPDATE disbursements/), 0);
    } finally { await close(); }
  });

  await t.test('handles a correctly signed payload and advances exactly once', async () => {
    process.env.YELLOW_CARD_WEBHOOK_SECRET = SECRET;
    const db = createFakeDb();
    const store = createWebhookStore(db);
    const adapters = createMockAdapters();
    const { base, close } = await makeApp(db, adapters);
    try {
      const headers = {
        'content-type': 'application/json',
        'x-yellowcard-signature': sign(BODY, SECRET),
      };

      const first = await fetch(`${base}/api/bos/webhooks/yellowcard`, { method: 'POST', headers, body: BODY });
      assert.equal(first.status, 200);
      const firstBody = await first.json();
      assert.equal(firstBody.processed, true);
      assert.equal(firstBody.result.success, true);
      assert.equal(firstBody.result.new_state, S.YELLOWCARD_PAYOUT_CONFIRMED);
      assert.equal(store.status, S.YELLOWCARD_PAYOUT_CONFIRMED);

      // Evidence chain captures the verified raw payload (+ the transition's API response).
      assert.equal(db.countMatching(/INSERT INTO disbursement_evidence/), 2, 'webhook payload + API response recorded');

      // Duplicate delivery is acknowledged but does NOT double-advance.
      const dup = await fetch(`${base}/api/bos/webhooks/yellowcard`, { method: 'POST', headers, body: BODY });
      assert.equal(dup.status, 200);
      const dupBody = await dup.json();
      assert.equal(dupBody.processed, false);
      assert.match(dupBody.reason, /already applied/);

      assert.equal(db.countMatching(/UPDATE disbursements\s+SET status/), 1, 'status changed once across both deliveries');
      assert.equal(store.status, S.YELLOWCARD_PAYOUT_CONFIRMED, 'duplicate did not advance');
      assert.equal(adapters.yellowcard.calls.lookupSend.length, 2, 'guard + action only on the advancing delivery');
    } finally { await close(); }
  });

  await t.test('supports the sha256= header prefix', async () => {
    process.env.YELLOW_CARD_WEBHOOK_SECRET = SECRET;
    const db = createFakeDb();
    createWebhookStore(db);
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      const res = await fetch(`${base}/api/bos/webhooks/yellowcard`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': `sha256=${sign(BODY, SECRET)}`,
        },
        body: BODY,
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).processed, true);
    } finally { await close(); }
  });

  await t.test('puts /yellowcard/test behind the admin token', async () => {
    process.env.YELLOW_CARD_WEBHOOK_SECRET = SECRET;
    process.env.BOS_API_TOKEN = 'admin-secret';
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    const db = createFakeDb();
    createWebhookStore(db);
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      const denied = await fetch(`${base}/api/bos/webhooks/yellowcard/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"payout_id":"' + PAYOUT_ID + '","status":"completed"}',
      });
      assert.equal(denied.status, 401);

      const allowed = await fetch(`${base}/api/bos/webhooks/yellowcard/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer admin-secret' },
        body: JSON.stringify({ payout_id: PAYOUT_ID, status: 'completed' }),
      });
      assert.equal(allowed.status, 200);
      assert.equal((await allowed.json()).processed, true);
    } finally { await close(); }
  });
});