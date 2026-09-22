/**
 * Sprint 3 contract tests — Yellow Card YcHmacV1 auth scheme.
 *
 * The adapter signs the documented message `timestamp + path + method
 * [+ base64(SHA256(body)) for POST/PUT]` with base64 HMAC-SHA256 and sends
 * `Authorization: YcHmacV1 {apiKey}:{signature}` plus `X-YC-Timestamp`
 * (docs/yellowcard-api-reference.md). Earlier code signed only
 * `timestamp + apiKey + hex(bodyHash)` inside a JSON envelope with no
 * X-YC-Timestamp header — that scheme is INCORRECT vs docs and is asserted
 * away here (G-07). No network: `fetch` is stubbed and every expected
 * signature is recomputed locally with node:crypto from the headers/path the
 * adapter actually sent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const API_KEY = 'test-api-key';
const SECRET = 'test-secret';
const API_URL = 'https://sandbox.api.yellowcard.io/business';

let adapterLoadCount = 0;

const origFetch = globalThis.fetch;
let fetchCalls = [];
function stubFetch(response = {}) {
  fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => response,
      text: async () => '',
    };
  };
}

async function loadAdapter(overrides = {}) {
  process.env.YELLOW_CARD_API_KEY = overrides.apiKey ?? API_KEY;
  process.env.YELLOW_CARD_SECRET_KEY = overrides.secret ?? SECRET;
  process.env.YELLOW_CARD_API_URL = overrides.apiUrl ?? API_URL;
  process.env.YELLOW_CARD_ENV = 'sandbox';
  adapterLoadCount += 1;
  return import(`../../src/services/bos/yellowcardAdapter.js?case=${adapterLoadCount}-${Date.now()}`);
}

function expectedSignature(timestamp, path, method, body, secret = SECRET) {
  const bodyHash = body && method !== 'GET' && method !== 'DELETE'
    ? crypto.createHash('sha256').update(body).digest('base64')
    : '';
  const message = `${timestamp}${path}${method}${bodyHash}`;
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

function signatureOf(authorization) {
  assert.match(authorization, /^YcHmacV1 /, 'Authorization must be the documented YcHmacV1 shape');
  const parts = authorization.replace(/^YcHmacV1 /, '').split(':');
  assert.equal(parts.length, 2, 'YcHmacV1 value must be {apiKey}:{signature} — not a JSON envelope');
  return parts[1];
}

test.after(() => {
  globalThis.fetch = origFetch;
  delete process.env.YELLOW_CARD_API_KEY;
  delete process.env.YELLOW_CARD_SECRET_KEY;
  delete process.env.YELLOW_CARD_API_URL;
});

test('submitSend (POST): signs timestamp+path+method+base64(bodyHash) and sends both headers', async () => {
  const adapter = await loadAdapter();
  stubFetch({ id: 's-1', status: 'processing' });

  const payout = await adapter.submitSend({
    idempotency_key: 'seq-1',
    amount: 100,
    recipient_type: 'bank_account',
    recipient: { bankCode: '044', accountNumber: '0123456789' },
  });

  assert.ok(payout.send_id);
  assert.equal(fetchCalls.length, 1);
  const { url, options } = fetchCalls[0];
  assert.equal(url, `${API_URL}/send`);
  assert.equal(options.method, 'POST');

  const timestamp = options.headers['X-YC-Timestamp'];
  assert.ok(timestamp, 'X-YC-Timestamp header must be present');
  assert.match(timestamp, /\.\d{3}Z$/, 'timestamp must be full ISO-8601 with milliseconds');
  assert.match(options.headers['Authorization'], /^YcHmacV1 /);

  const path = new URL(url).pathname;
  assert.equal(path, '/business/send');
  const expected = expectedSignature(timestamp, path, options.method, options.body);
  assert.equal(signatureOf(options.headers['Authorization']), expected);
});

test('lookupSend (GET): path+method bound, no body hash appended', async () => {
  const adapter = await loadAdapter();
  stubFetch({ status: 'completed', data: { id: 's-1' } });

  await adapter.lookupSend('s-1');
  const { url, options } = fetchCalls[0];
  assert.equal(url, `${API_URL}/send/s-1`);
  assert.equal(options.method, 'GET');
  assert.equal(options.body, undefined);

  const timestamp = options.headers['X-YC-Timestamp'];
  const path = new URL(url).pathname;
  assert.equal(path, '/business/send/s-1');
  const expected = expectedSignature(timestamp, path, 'GET', null);
  assert.equal(signatureOf(options.headers['Authorization']), expected);
});

test('signature is base64 (44-char digest of the 32-byte HMAC)', async () => {
  const adapter = await loadAdapter();
  stubFetch({ id: 's-2', status: 'processing' });
  await adapter.submitSend({ idempotency_key: 'seq-2', amount: 100, recipient: {} });

  const sig = signatureOf(fetchCalls[0].options.headers['Authorization']);
  assert.match(sig, /^[A-Za-z0-9+/]+={0,2}$/, 'signature must be base64');
  assert.equal(sig.length, 44, 'base64 of a 32-byte HMAC-SHA256 is 44 chars');
});

test('message binds path and method: old/shortened message shapes do NOT verify', async () => {
  const adapter = await loadAdapter();
  stubFetch({ id: 's-3', status: 'processing' });
  await adapter.submitSend({ idempotency_key: 'seq-3', amount: 100, recipient: {} });

  const { options } = fetchCalls[0];
  const timestamp = options.headers['X-YC-Timestamp'];
  const path = new URL(fetchCalls[0].url).pathname;
  const sent = signatureOf(options.headers['Authorization']);

  // Legacy scheme from the removed code: timestamp + apiKey + hex(bodyHash).
  const legacy = crypto
    .createHmac('sha256', SECRET)
    .update(
      timestamp + API_KEY + crypto.createHash('sha256').update(options.body).digest('hex'),
    )
    .digest('hex');
  assert.notEqual(legacy, sent, 'old (timestamp+apiKey+hex body) scheme must be rejected');

  // Timestamp + apiKey only — no path, no method, no body.
  const bindless = crypto.createHmac('sha256', SECRET).update(timestamp + API_KEY).digest('base64');
  assert.notEqual(bindless, sent, 'path+method+body must be bound into the message (G-07)');

  // path is part of the message: swapping the path changes the signature.
  const otherPath = crypto
    .createHmac('sha256', SECRET)
    .update(`${timestamp}${path + 'x'}POST${crypto.createHash('sha256').update(options.body).digest('base64')}`)
    .digest('base64');
  assert.notEqual(otherPath, sent, 'the signed path must affect the signature');
});

test('fail-closed: missing secret sends no Authorization/X-YC-Timestamp', async () => {
  const adapter = await loadAdapter({ secret: '' });
  stubFetch({ id: 's-4', status: 'processing' });

  await adapter.submitSend({ idempotency_key: 'seq-4', amount: 100, recipient: {} });

  const headers = fetchCalls[0].options.headers;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers['X-YC-Timestamp'], undefined);
});

test('fail-closed: missing apiKey sends no Authorization/X-YC-Timestamp', async () => {
  const adapter = await loadAdapter({ apiKey: '' });
  stubFetch({ id: 's-5', status: 'processing' });

  await adapter.submitSend({ idempotency_key: 'seq-5', amount: 100, recipient: {} });

  const headers = fetchCalls[0].options.headers;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers['X-YC-Timestamp'], undefined);
});

test('query string is excluded from the signed path', async () => {
  const adapter = await loadAdapter();
  stubFetch({ sends: [] });

  await adapter.listSends({ status: 'processing', limit: 5, offset: 2 });

  const { url, options } = fetchCalls[0];
  assert.ok(url.includes('?'), 'listSends must hit the query-string URL');
  const path = new URL(url).pathname;
  assert.equal(path, '/business/sends', 'signed path must exclude the query string');

  const expected = expectedSignature(options.headers['X-YC-Timestamp'], path, 'GET', null);
  assert.equal(signatureOf(options.headers['Authorization']), expected);
});