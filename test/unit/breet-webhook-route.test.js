/**
 * Breet webhook route — verify-first ordering and fail-closed handling.
 *
 * Mirrors the harness in flutterwave-webhook.test.js: a real Express app with
 * raw-body capture (express.json({ verify })), backed by FakeDb and mock
 * adapters, over an ephemeral loopback listener. No external network calls.
 *
 * ── THE FIXTURE IS SYNTHETIC AND UNVERIFIED ─────────────────────────────────
 * No live Breet sandbox delivery was captured. Breet's mock-trade trigger is
 * unreachable with the provided sandbox credentials, and Breet's own docs
 * contradict each other on the required `X-Breet-Env` value — a Breet-side
 * blocker, not ours (see docs/SPRINT_BREET_WEBHOOK_PLAN.md §8). The body below
 * matches the shape the docs DESCRIBE and is UNVERIFIED against a real Breet
 * delivery. The route does not parse fields (payload resolution is deferred to
 * P-1), so this fixture only needs to be valid JSON of the documented shape.
 * Upgrading it to a captured shape is backlog P-8.
 *
 * ── WHAT THE ROUTE DOES AND DOES NOT DO ─────────────────────────────────────
 * It verifies `x-webhook-secret` against `BREET_WEBHOOK_SECRET` (a STATIC SHARED
 * SECRET compared as a plain string — NOT an HMAC, NOT a function of the body)
 * and returns the honest, verified body inline. It does NOT resolve a target,
 * advance the state machine, or write evidence: all three are blocked by P-1
 * (no provider routing) and are asserted absent below rather than assumed.
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

const BREET_SECRET = 'breet-webhook-secret-under-test';
const FLW_HASH = 'flw-verif-hash-abc123';
const YC_SECRET = 'yc-secret';
const IDEM_KEY = 'payout:disb-1';

/**
 * SYNTHETIC Breet body (UNVERIFIED against a real delivery — see the header).
 * Documented-shape fields only; the route ignores them entirely.
 */
const BREET_BODY = JSON.stringify({
  event: 'trade.completed',
  data: {
    reference: 'breet-ref-1',
    status: 'completed',
    amount: 1000,
    currency: 'NGN',
  },
});

/** The exact success body the route must return (fixed by correction 3). */
const BREET_SUCCESS_BODY = {
  processed: true,
  advanced: false,
  reason: 'breet webhook verified; payload resolution and state advance deferred to P-1',
};

const ENV_KEYS = [
  'BREET_WEBHOOK_SECRET',
  'FLW_SECRET_HASH',
  'YELLOW_CARD_WEBHOOK_SECRET',
  'XRESERVE_WEBHOOK_SECRET',
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(snap) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

/**
 * Backing store for the Yellow Card path (payout_id → disbursement), so the
 * cross-talk guard can prove that route still advances after this sprint.
 */
function createYellowCardStore(db) {
  const row = { id: 'disb-1', status: S.YELLOWCARD_PAYOUT_SUBMITTED, retry_count: 0, max_retries: 3 };

  db.when(/FROM external_refs er\s+JOIN disbursements d ON d\.id = er\.disbursement_id/, () => ({
    disbursement_id: row.id,
    status: row.status,
    identifier_type: 'payout_id',
    identifier_value: 'yc-1',
    external_system: 'yellowcard',
    metadata: {},
  }));
  db.when(/SELECT \* FROM disbursements WHERE id = \$1/, () => ({ ...row }));
  db.when(/UPDATE disbursements\s+SET status = \$1/, ({ params }) => {
    row.status = params[0];
    return { changes: 1, rows: [] };
  });
  db.when(/SELECT \* FROM external_refs/, () => ({
    disbursement_id: row.id,
    external_system: 'yellowcard',
    identifier_type: 'payout_id',
    identifier_value: 'yc-1',
    metadata: {},
  }));

  return { get status() { return row.status; } };
}

/** Backing store for the Flutterwave path (idempotency_key → disbursement). */
function createFlutterwaveStore(db) {
  db.when(/FROM disbursements\s+WHERE idempotency_key = \$1/, ({ params }) => (
    params[0] === IDEM_KEY
      ? { id: 'disb-1', idempotency_key: IDEM_KEY, status: S.YELLOWCARD_PAYOUT_SUBMITTED, retry_count: 0, max_retries: 3 }
      : null
  ));
}

async function makeApp(db, adapters) {
  await init(createTestCtx({ db, adapters }));
  const app = express();
  // Exactly as in production: only a JSON body gets captured into req.rawBody.
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/bos/webhooks', webhooksRouter);
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }); });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

function postBreet(base, body, { secret = BREET_SECRET, header = 'x-webhook-secret' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (header) headers[header] = secret;
  return fetch(`${base}/api/bos/webhooks/breet`, { method: 'POST', headers, body });
}

test('Breet webhook route: verify-first ordering, fail-closed handling', async (t) => {
  const env = snapshotEnv();
  t.afterEach(() => restoreEnv(env));

  await t.test('unset BREET_WEBHOOK_SECRET rejects with 401 no_secret_configured and touches no state', async () => {
    delete process.env.BREET_WEBHOOK_SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      const res = await postBreet(base, BREET_BODY);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { processed: false, reason: 'no_secret_configured' });
      assert.equal(db.countMatching(/UPDATE disbursements/), 0, 'no state was written');
      assert.equal(db.countMatching(/INSERT INTO disbursement_evidence/), 0, 'no evidence was written');
    } finally { await close(); }
  });

  await t.test('missing x-webhook-secret rejects with 401 missing_signature and touches no state', async () => {
    process.env.BREET_WEBHOOK_SECRET = BREET_SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      const res = await postBreet(base, BREET_BODY, { header: null });
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { processed: false, reason: 'missing_signature' });
      assert.equal(db.countMatching(/UPDATE disbursements/), 0);
      assert.equal(db.countMatching(/INSERT INTO disbursement_evidence/), 0);
    } finally { await close(); }
  });

  await t.test('mismatched x-webhook-secret rejects with 401 invalid_signature and touches no state', async () => {
    process.env.BREET_WEBHOOK_SECRET = BREET_SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      const res = await postBreet(base, BREET_BODY, { secret: 'wrong-secret' });
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { processed: false, reason: 'invalid_signature' });
      assert.equal(db.countMatching(/UPDATE disbursements/), 0);
      assert.equal(db.countMatching(/INSERT INTO disbursement_evidence/), 0);
    } finally { await close(); }
  });

  await t.test('an exact secret match returns 200 with the exact verified body and advances nothing', async () => {
    process.env.BREET_WEBHOOK_SECRET = BREET_SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      const res = await postBreet(base, BREET_BODY);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), BREET_SUCCESS_BODY);
      // The two things it must NOT do, asserted rather than assumed.
      assert.equal(db.countMatching(/UPDATE disbursements/), 0, 'no state transition');
      assert.equal(db.countMatching(/INSERT INTO disbursement_evidence/), 0,
        'recordWebhookPayload hardcodes method hmac-sha256; recording here would be a false evidence claim');
    } finally { await close(); }
  });

  await t.test('the body is not part of the comparison (pins the documented weakness)', async () => {
    process.env.BREET_WEBHOOK_SECRET = BREET_SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      // Same secret, two completely different bodies: both verify. This pins the
      // absence of payload integrity — a static shared secret authenticates the
      // sender only. The mitigation is the local idempotency_key UNIQUE
      // constraint (P-1), not the signature.
      const forged = await postBreet(base, '{"event":"forged.completed"}');
      assert.equal(forged.status, 200);
      assert.deepEqual(await forged.json(), BREET_SUCCESS_BODY);

      const genuine = await postBreet(base, BREET_BODY);
      assert.equal(genuine.status, 200);
      assert.deepEqual(await genuine.json(), BREET_SUCCESS_BODY);

      assert.equal(db.countMatching(/UPDATE disbursements/), 0);
    } finally { await close(); }
  });

  await t.test('replay: an identical request posted three times is still harmless', async () => {
    process.env.BREET_WEBHOOK_SECRET = BREET_SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      for (let i = 0; i < 3; i += 1) {
        const res = await postBreet(base, BREET_BODY);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), BREET_SUCCESS_BODY);
      }
      // The load-bearing control is that the route holds no state to corrupt.
      // When P-1 makes advancing real, duplicate suppression must come from the
      // idempotency_key UNIQUE constraint — in test/integration/, not here.
      assert.equal(db.countMatching(/UPDATE disbursements/), 0);
      assert.equal(db.countMatching(/INSERT INTO disbursement_evidence/), 0);
    } finally { await close(); }
  });

  await t.test('raw body unavailable fails closed with 401 raw_body_unavailable', async () => {
    process.env.BREET_WEBHOOK_SECRET = BREET_SECRET;
    const db = createFakeDb();
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      // A non-JSON content type means express.json never captures req.rawBody.
      const res = await fetch(`${base}/api/bos/webhooks/breet`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: BREET_BODY,
      });
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { processed: false, reason: 'raw_body_unavailable' });
      assert.equal(db.countMatching(/UPDATE disbursements/), 0);
    } finally { await close(); }
  });

  await t.test('regression guard: the three schemes do not cross-talk and existing routes are unaffected', async () => {
    process.env.BREET_WEBHOOK_SECRET = BREET_SECRET;
    process.env.FLW_SECRET_HASH = FLW_HASH;
    process.env.YELLOW_CARD_WEBHOOK_SECRET = YC_SECRET;

    const db = createFakeDb();
    const ycStore = createYellowCardStore(db);
    createFlutterwaveStore(db);
    const { base, close } = await makeApp(db, createMockAdapters());
    try {
      // (a) The Yellow Card HMAC path still verifies its own scheme and advances.
      const ycBody = '{"payout_id":"yc-1","status":"completed"}';
      const ycSig = crypto.createHmac('sha256', YC_SECRET).update(ycBody).digest('hex');
      const ycOk = await fetch(`${base}/api/bos/webhooks/yellowcard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-yc-signature': ycSig },
        body: ycBody,
      });
      assert.equal(ycOk.status, 200, 'the Yellow Card route is untouched by this sprint');
      const ycOkBody = await ycOk.json();
      assert.equal(ycOkBody.processed, true);
      assert.equal(ycOkBody.result.new_state, S.YELLOWCARD_PAYOUT_CONFIRMED);
      assert.equal(ycStore.status, S.YELLOWCARD_PAYOUT_CONFIRMED);

      // (b) The Flutterwave verif-hash path still acknowledges a valid delivery.
      const flwBody = JSON.stringify({
        event: 'transfer.completed',
        data: { id: 'flw-1', status: 'SUCCESSFUL', reference: IDEM_KEY, amount: 100, currency: 'USDC' },
      });
      const flwOk = await fetch(`${base}/api/bos/webhooks/flutterwave`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'verif-hash': FLW_HASH },
        body: flwBody,
      });
      assert.equal(flwOk.status, 200);
      assert.equal((await flwOk.json()).processed, true);

      // (c) A Flutterwave verif-hash must NOT authenticate the Breet route.
      const crossedIn = await fetch(`${base}/api/bos/webhooks/breet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'verif-hash': FLW_HASH },
        body: BREET_BODY,
      });
      assert.equal(crossedIn.status, 401, 'a verif-hash must not pass the Breet route');

      // (d) A Breet x-webhook-secret must NOT authenticate Flutterwave or Yellow Card.
      const crossedFlw = await fetch(`${base}/api/bos/webhooks/flutterwave`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': BREET_SECRET },
        body: flwBody,
      });
      assert.equal(crossedFlw.status, 401, 'an x-webhook-secret must not pass the Flutterwave route');

      const crossedYc = await fetch(`${base}/api/bos/webhooks/yellowcard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': BREET_SECRET },
        body: ycBody,
      });
      assert.equal(crossedYc.status, 401, 'an x-webhook-secret must not pass the Yellow Card route');
    } finally { await close(); }
  });
});
