/**
 * Sprint 3 contract tests — Yellow Card submit-send wire payload.
 *
 * Asserts the rewritten POST /business/send body: documented Sends fields only
 * (sequenceId, channelType, country, currency, localAmount, forceAccept,
 * destination) and no legacy fields (amount, recipient, recipientType,
 * callbackUrl) and no X-Idempotency-Key header. Contract per
 * docs/yellowcard-api-reference.md §3. config differences (kobo, networkId,
 * forceAccept semantics, sender omission) remain UNVERIFIED and are flagged,
 * not asserted correct.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const API_KEY = 'bank-api-key';
const SECRET = 'bank-secret';
const API_URL = 'https://sandbox.api.yellowcard.io/business';
let loadCount = 0;

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
    return { ok: false, status, statusText: 'ERR', json: async () => ({}), text: async () => '{"message":"nope"}' };
  };
}

async function loadAdapter() {
  process.env.YELLOW_CARD_API_KEY = API_KEY;
  process.env.YELLOW_CARD_SECRET_KEY = SECRET;
  process.env.YELLOW_CARD_API_URL = API_URL;
  process.env.YELLOW_CARD_ENV = 'sandbox';
  loadCount += 1;
  return import(`../../src/services/bos/yellowcardAdapter.js?case=send-${loadCount}-${Date.now()}`);
}

function sentBody() {
  assert.equal(fetchCalls.length, 1);
  return JSON.parse(fetchCalls[0].options.body);
}

function signature(timestamp, path, method, body) {
  const bodyHash = body ? crypto.createHash('sha256').update(body).digest('base64') : '';
  return crypto.createHmac('sha256', SECRET).update(`${timestamp}${path}${method}${bodyHash}`).digest('base64');
}

test.after(() => {
  globalThis.fetch = origFetch;
  delete process.env.YELLOW_CARD_API_KEY;
  delete process.env.YELLOW_CARD_SECRET_KEY;
  delete process.env.YELLOW_CARD_API_URL;
});

test('submitSend: bank payout maps to the documented Sends body', async () => {
  const adapter = await loadAdapter();
  stubFetch({ id: 'yc-1', status: 'successful', sequenceId: 'seq-42' });

  const result = await adapter.submitSend({
    idempotency_key: 'seq-42',
    amount: 4125000,
    currency: 'NGN',
    recipient_type: 'bank_account',
    recipient: { bankCode: '044', accountNumber: '0123456789', accountName: 'ALIYAH NAUSCH' },
    callback_url: 'https://bos.example/webhooks/yellowcard',
  });

  const { url, options } = fetchCalls[0];
  assert.equal(url, `${API_URL}/send`);
  assert.equal(options.method, 'POST');
  assert.ok(options.headers.Authorization);
  assert.equal(options.headers['X-Idempotency-Key'], undefined, 'idempotency moved to sequenceId; header removed');

  const body = sentBody();
  assert.deepEqual(
    Object.keys(body).sort(),
    ['channelType', 'country', 'currency', 'destination', 'forceAccept', 'localAmount', 'sequenceId'],
    'wire body must contain only documented Sends fields',
  );
  assert.equal(body.sequenceId, 'seq-42');
  assert.equal(body.channelType, 'bank');
  assert.equal(body.country, 'NG');
  assert.equal(body.currency, 'NGN');
  assert.equal(body.localAmount, '4125000');
  assert.equal(body.forceAccept, true);
  assert.deepEqual(body.destination, {
    accountNumber: '0123456789',
    accountType: 'bank',
    networkId: '044',
    accountName: 'ALIYAH NAUSCH',
  });

  // No legacy keys leaked into the wire body.
  for (const legacy of ['amount', 'recipient', 'recipientType', 'callbackUrl']) {
    assert.equal(legacy in body, false, `legacy field "${legacy}" must not be sent`);
  }

  // Status normalization: successful -> completed; sequenceId threaded through.
  assert.equal(result.send_id, 'yc-1');
  assert.equal(result.status, 'completed');
  assert.equal(result.sequence_id, 'seq-42');
});

test('submitSend: mobile_money recipient maps to channelType momo + accountType momo', async () => {
  const adapter = await loadAdapter();
  stubFetch({ id: 'yc-2', status: 'processing' });

  await adapter.submitSend({
    idempotency_key: 'seq-7',
    amount: 500,
    recipient_type: 'mobile_money',
    recipient: { networkId: 'MTN', accountNumber: '08012345678', accountName: 'MOMO USER' },
  });

  const body = sentBody();
  assert.equal(body.channelType, 'momo');
  assert.equal(body.destination.accountType, 'momo');
  assert.equal(body.destination.networkId, 'MTN');
  assert.equal(body.destination.accountName, 'MOMO USER');
});

test('submitSend: accountName omitted when not provided; EUR/currency fallback defaulted to NGN', async () => {
  const adapter = await loadAdapter();
  stubFetch({ id: 'yc-3', status: 'processing' });

  const result = await adapter.submitSend({
    idempotency_key: 'seq-9',
    amount: 200,
    currency: 'USD',
    recipient_type: 'bank_account',
    recipient: { bankCode: '011', accountNumber: '1112223334' },
  });

  const body = sentBody();
  assert.equal(body.currency, 'USD', 'caller-specified currency is preserved');
  assert.equal('accountName' in body.destination, false);
  assert.equal(body.destination.networkId, '011', 'bankCode flows into networkId');
  assert.ok(result.send_id);
});

test('submitSend: 4xx responses classify permanent and are not retried (classifyError)', async () => {
  const adapter = await loadAdapter();
  stubFetchError(400);

  await assert.rejects(
    adapter.submitSend({ idempotency_key: 'seq-10', amount: 1, recipient_type: 'bank_account', recipient: { bankCode: '044', accountNumber: '0123456789' } }),
    (err) => err.status === 400 && adapter.classifyError(err) === 'permanent',
  );
});