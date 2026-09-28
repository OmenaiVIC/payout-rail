/**
 * Sprint 12 contract tests — Flutterwave submit/lookup wire payload.
 *
 * Locks the adapter to docs/flutterwave-api-reference.md: the documented v3
 * transfers body (eight keys, nothing else on the wire), Bearer auth,
 * `reference` as the idempotency carrier, the lookup endpoint, the `verif-hash`
 * comparison, and the error taxonomy.
 *
 * Every test stubs globalThis.fetch. No network calls.
 *
 * Two things this file deliberately locks, because they are easy to "fix" into
 * bugs by a later reader:
 *
 *   - `amount` is passed through VERBATIM. The kobo convention that governs
 *     Yellow Card does not apply here, and the adapter performs no conversion.
 *   - the `currency` parameter lands in `debit_currency`, and the wire field
 *     `currency` is the constant "USDC". That inversion is the opposite of
 *     Yellow Card and is deliberate — see reference §3.3. Do not "fix" it to a
 *     literal pass-through.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const SECRET_KEY = 'flw_secret_test';
const MERCHANT_ID = 'mch_123456';
const BASE_URL = 'https://api.flutterwave.com/v3';
const VERIF_HASH = 'flw_verif_hash_test';
const WALLET = '0xabc123000000000000000000000000000000dead';

const origFetch = globalThis.fetch;
let fetchCalls = [];

function stubFetch(response = {}) {
  fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return { ok: true, status: 200, statusText: 'OK', json: async () => response, text: async () => '' };
  };
}

function stubFetchError(status) {
  fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return {
      ok: false,
      status,
      statusText: 'ERR',
      json: async () => ({}),
      text: async () => '{"message":"nope"}',
    };
  };
}

/** Mirror the shape an aborted fetch produces, without waiting out the 10s timer. */
function stubFetchAbort() {
  fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    throw err;
  };
}

async function loadAdapter() {
  process.env.FLW_SECRET_KEY = SECRET_KEY;
  process.env.FLW_MERCHANT_ID = MERCHANT_ID;
  process.env.FLW_BASE_URL = BASE_URL;
  return import(`../../src/services/bos/flutterwaveAdapter.js?case=${Date.now()}-${Math.random()}`);
}

function sentBody() {
  assert.equal(fetchCalls.length, 1);
  return JSON.parse(fetchCalls[0].options.body);
}

let adapter;

test.before(async () => {
  process.env.FLW_SECRET_HASH = VERIF_HASH;
  adapter = await loadAdapter();
});

test.after(() => {
  globalThis.fetch = origFetch;
  delete process.env.FLW_SECRET_KEY;
  delete process.env.FLW_MERCHANT_ID;
  delete process.env.FLW_BASE_URL;
  delete process.env.FLW_SECRET_HASH;
});

// ── Mandated tests ───────────────────────────────────────────────────────────

test('submitSend: sends exactly the documented v3 transfers body', async () => {
  stubFetch({ id: 'flw-1', status: 'NEW', reference: 'idem-1' });

  await adapter.submitSend({
    idempotency_key: 'idem-1',
    amount: 100,
    currency: 'NGN',
    recipient_type: 'bank_account',
    recipient: { walletAddress: WALLET },
  });

  const { url, options } = fetchCalls[0];
  assert.equal(url, `${BASE_URL}/transfers`);
  assert.equal(options.method, 'POST');

  const body = sentBody();
  assert.deepEqual(
    Object.keys(body).sort(),
    ['account_bank', 'account_number', 'amount', 'currency', 'debit_currency', 'destination', 'network', 'reference'],
    'wire body must contain only the eight documented v3 transfer fields',
  );
  assert.equal(body.account_bank, 'flutterwave');
  assert.equal(body.account_number, MERCHANT_ID);
  assert.equal(body.debit_currency, 'NGN');
  assert.equal(body.amount, 100);
  assert.equal(body.currency, 'USDC');
  assert.equal(body.network, 'POLYGON');
  assert.equal(body.destination, WALLET);
  assert.equal(body.reference, 'idem-1');
});

test('submitSend: Authorization is Bearer {FLW_SECRET_KEY}', async () => {
  stubFetch({ id: 'flw-2', status: 'NEW' });

  await adapter.submitSend({
    idempotency_key: 'idem-2',
    amount: 100,
    currency: 'NGN',
    recipient: { walletAddress: WALLET },
  });

  assert.equal(fetchCalls[0].options.headers.Authorization, `Bearer ${SECRET_KEY}`);
});

test('submitSend: reference carries the idempotency key and is echoed back', async () => {
  stubFetch({ id: 'flw-3', status: 'NEW', reference: 'idem-3' });

  const result = await adapter.submitSend({
    idempotency_key: 'idem-3',
    amount: 100,
    currency: 'NGN',
    recipient: { walletAddress: WALLET },
  });

  assert.equal(sentBody().reference, 'idem-3');
  assert.equal(result.reference, 'idem-3', 'the echoed reference is returned as idempotency evidence');
});

test('lookupSend: calls GET /v3/transfers/{id}', async () => {
  stubFetch({ id: 'flw-1', status: 'SUCCESSFUL' });

  await adapter.lookupSend('flw-1');

  assert.equal(fetchCalls[0].url, `${BASE_URL}/transfers/flw-1`);
  assert.equal(fetchCalls[0].options.method, 'GET');
  assert.equal(fetchCalls[0].options.headers.Authorization, `Bearer ${SECRET_KEY}`);
});

test('verifyWebhookSignature: accepts a matching verif-hash', () => {
  assert.equal(adapter.verifyWebhookSignature(Buffer.from('{"a":1}'), VERIF_HASH), true);
});

test('verifyWebhookSignature: rejects a mismatched verif-hash', () => {
  assert.equal(adapter.verifyWebhookSignature(Buffer.from('{"a":1}'), 'wrong-hash'), false);
});

test('verifyWebhookSignature: fails closed when FLW_SECRET_HASH is unset', () => {
  delete process.env.FLW_SECRET_HASH;
  try {
    assert.equal(
      adapter.verifyWebhookSignature(Buffer.from('{"a":1}'), VERIF_HASH),
      false,
      'an unconfigured secret must reject, never skip verification',
    );
  } finally {
    process.env.FLW_SECRET_HASH = VERIF_HASH;
  }
});

test('classifyError: 4xx permanent, 5xx/429/timeout transient, unknown otherwise', () => {
  const named = (name) => ({ name });
  const withStatus = (status) => ({ status });

  assert.equal(adapter.classifyError(withStatus(400)), 'permanent');
  assert.equal(adapter.classifyError(withStatus(404)), 'permanent');
  assert.equal(adapter.classifyError(withStatus(422)), 'permanent');
  assert.equal(adapter.classifyError(withStatus(429)), 'transient', '429 is retryable despite being 4xx');
  assert.equal(adapter.classifyError(withStatus(500)), 'transient');
  assert.equal(adapter.classifyError(withStatus(503)), 'transient');
  assert.equal(adapter.classifyError(named('AbortError')), 'transient', 'timeout');
  assert.equal(adapter.classifyError(new TypeError('fetch failed')), 'transient');
  assert.equal(adapter.classifyError({}), 'unknown');
});

// ── Additional tests ─────────────────────────────────────────────────────────

test('submitSend: NEW normalizes to pending, never processing', async () => {
  stubFetch({ id: 'flw-4', status: 'NEW' });

  const result = await adapter.submitSend({
    idempotency_key: 'idem-4',
    amount: 100,
    currency: 'NGN',
    recipient: { walletAddress: WALLET },
  });

  assert.equal(result.status, 'pending', 'the sandbox never leaves NEW; processing would assert motion that does not exist');
});

test('submitSend: SUCCESSFUL -> completed, FAILED -> failed', async () => {
  stubFetch({ id: 'flw-5', status: 'SUCCESSFUL' });
  const ok = await adapter.submitSend({
    idempotency_key: 'idem-5a', amount: 100, currency: 'NGN', recipient: { walletAddress: WALLET },
  });
  assert.equal(ok.status, 'completed');

  stubFetch({ id: 'flw-6', status: 'FAILED' });
  const bad = await adapter.submitSend({
    idempotency_key: 'idem-5b', amount: 100, currency: 'NGN', recipient: { walletAddress: WALLET },
  });
  assert.equal(bad.status, 'failed');
});

test('submitSend: no input path returns completed unless the provider said SUCCESSFUL', async () => {
  for (const status of [undefined, 'NEW', 'PENDING', 'REVERSED', 'CANCELLED', 'something-new']) {
    stubFetch({ id: 'flw-x', status });
    const result = await adapter.submitSend({
      idempotency_key: `idem-x-${status}`, amount: 100, currency: 'NGN', recipient: { walletAddress: WALLET },
    });
    assert.notEqual(result.status, 'completed', `status ${status} must not complete`);
  }
});

test('submitSend: throws a named error when no wallet address is present (fail closed)', async () => {
  stubFetch({ id: 'flw-7', status: 'NEW' });

  await assert.rejects(
    adapter.submitSend({
      idempotency_key: 'idem-7',
      amount: 100,
      currency: 'NGN',
      // The pipeline's ngn_recipient shape has no wallet field; an empty
      // destination must never be put on the wire.
      recipient: { type: 'bank_account', bankCode: '044', accountNumber: '0123456789' },
    }),
    (err) => {
      assert.equal(err.name, 'MissingRecipientDestinationError');
      assert.equal(fetchCalls.length, 0, 'must throw before issuing any request');
      return true;
    },
  );
});

test('submitSend: destination falls back through walletAddress, address, destination', async () => {
  for (const [key, value] of [['walletAddress', '0xaaa'], ['address', '0xbbb'], ['destination', '0xccc']]) {
    stubFetch({ id: 'flw-8', status: 'NEW' });
    await adapter.submitSend({
      idempotency_key: `idem-8-${key}`, amount: 100, currency: 'NGN', recipient: { [key]: value },
    });
    assert.equal(sentBody().destination, value, `${key} must populate destination`);
  }
});

test('submitSend: 4xx -> permanent, 5xx -> transient (not retried)', async () => {
  stubFetchError(400);
  await assert.rejects(
    adapter.submitSend({ idempotency_key: 'i9', amount: 1, currency: 'NGN', recipient: { walletAddress: WALLET } }),
    (err) => err.status === 400 && adapter.classifyError(err) === 'permanent',
  );

  stubFetchError(503);
  await assert.rejects(
    adapter.submitSend({ idempotency_key: 'i10', amount: 1, currency: 'NGN', recipient: { walletAddress: WALLET } }),
    (err) => err.status === 503 && adapter.classifyError(err) === 'transient',
  );
});

test('submitSend: amount passes through verbatim with no kobo conversion', async () => {
  // 4125000 is exactly the Yellow Card kobo convention. If the adapter silently
  // converted, this would come out as 41250. It must not.
  stubFetch({ id: 'flw-9', status: 'NEW' });
  await adapter.submitSend({
    idempotency_key: 'idem-9',
    amount: 4125000,
    currency: 'NGN',
    recipient: { walletAddress: WALLET },
  });

  assert.equal(sentBody().amount, 4125000, 'no kobo conversion is applied to this adapter');
});

test('submitSend: currency parameter lands in debit_currency (inverted vs Yellow Card)', async () => {
  stubFetch({ id: 'flw-10', status: 'NEW' });
  await adapter.submitSend({
    idempotency_key: 'idem-10',
    amount: 100,
    currency: 'NGN',
    recipient: { walletAddress: WALLET },
  });

  const body = sentBody();
  assert.equal(body.debit_currency, 'NGN', 'the currency parameter is debited from the merchant balance');
  assert.equal(body.currency, 'USDC', 'the recipient receives USDC; this field is the constant');
});

test('submitSend: callback_url is accepted and never sent on the wire', async () => {
  stubFetch({ id: 'flw-11', status: 'NEW' });

  await adapter.submitSend({
    idempotency_key: 'idem-11',
    amount: 100,
    currency: 'NGN',
    recipient: { walletAddress: WALLET },
    callback_url: 'https://bos.example/api/bos/webhooks/flutterwave',
  });

  const body = sentBody();
  assert.equal('callback_url' in body, false);
  assert.equal('callbackUrl' in body, false, 'Flutterwave registers webhook targets in dashboard settings');
});

test('healthCheck: returns healthy:false without throwing on a network error', async () => {
  globalThis.fetch = async () => {
    const err = new TypeError('fetch failed');
    throw err;
  };
  const result = await adapter.healthCheck();
  assert.equal(result.healthy, false);
  assert.ok(result.error);
  assert.equal(typeof result.latencyMs, 'number');
});

test('healthCheck: reports healthy against a 200 response', async () => {
  stubFetch({ data: [{ currency: 'NGN', available: 1000 }] });
  const result = await adapter.healthCheck();
  assert.equal(result.healthy, true);
  assert.equal(fetchCalls[0].url, `${BASE_URL}/balances`);
  assert.equal(fetchCalls[0].options.method, 'GET');
});

test('lookupSend: 4xx classifies permanent', async () => {
  stubFetchError(404);
  await assert.rejects(
    adapter.lookupSend('missing'),
    (err) => err.status === 404 && adapter.classifyError(err) === 'permanent',
  );
});

test('submitSend: request timeout is classified transient', async () => {
  stubFetchAbort();
  await assert.rejects(
    adapter.submitSend({
      idempotency_key: 'idem-12', amount: 100, currency: 'NGN', recipient: { walletAddress: WALLET },
    }),
    (err) => {
      assert.equal(err.name, 'AbortError');
      assert.equal(err._classification, 'transient', '_fetch stamps the classification on the error');
      return true;
    },
  );
});

test('submitSend: passes an AbortSignal so the request timeout can fire', async () => {
  stubFetch({ id: 'flw-13', status: 'NEW' });
  await adapter.submitSend({
    idempotency_key: 'idem-13', amount: 100, currency: 'NGN', recipient: { walletAddress: WALLET },
  });
  assert.ok(fetchCalls[0].options.signal, 'timeout is enforced via AbortController');
  assert.equal(fetchCalls[0].options.signal.aborted, false);
});
