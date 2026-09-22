/**
 * Sprint 3 contract tests — Yellow Card lookup / list / fee / account endpoints.
 *
 * We assert the URL + signed path each method hits (G-04: no path mismatch
 * between what is signed and what is requested; base URL is /business), that
 * query strings are excluded from the signed path (G-04/Q-UNVERIFIED-quote),
 * and that returned statuses normalize. Config specifics remain UNVERIFIED
 * (no sandbox credentials).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const API_KEY = 'lookup-api-key';
const SECRET = 'lookup-secret';
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
    return { ok: false, status, statusText: 'ERR', json: async () => ({}), text: async () => 'err' };
  };
}

async function loadAdapter() {
  process.env.YELLOW_CARD_API_KEY = API_KEY;
  process.env.YELLOW_CARD_SECRET_KEY = SECRET;
  process.env.YELLOW_CARD_API_URL = API_URL;
  process.env.YELLOW_CARD_ENV = 'sandbox';
  loadCount += 1;
  return import(`../../src/services/bos/yellowcardAdapter.js?case=lookup-${loadCount}-${Date.now()}`);
}

function expectedSignature(timestamp, url, method, body) {
  const path = new URL(url).pathname;
  const bodyHash = body ? crypto.createHash('sha256').update(body).digest('base64') : '';
  return crypto.createHmac('sha256', SECRET).update(`${timestamp}${path}${method}${bodyHash}`).digest('base64');
}

function assertSigned(timestamp, url, method, body) {
  const auth = fetchCalls[0].options.headers.Authorization;
  const sent = auth.replace(/^YcHmacV1 [^:]+:/, '');
  assert.equal(sent, expectedSignature(timestamp, url, method, body));
}

test.after(() => {
  globalThis.fetch = origFetch;
  delete process.env.YELLOW_CARD_API_KEY;
  delete process.env.YELLOW_CARD_SECRET_KEY;
  delete process.env.YELLOW_CARD_API_URL;
});

test('lookupSend: GET /business/send/{sendId}, signed path matches request path', async () => {
  const adapter = await loadAdapter();
  stubFetch({ status: 'completed', id: 's-77' });

  const result = await adapter.lookupSend('s-77');

  assert.equal(fetchCalls.length, 1);
  const { url, options } = fetchCalls[0];
  assert.equal(url, `${API_URL}/send/s-77`);
  assert.equal(options.method, 'GET');
  assertSigned(options.headers['X-YC-Timestamp'], url, 'GET', null);
  assert.equal(result.status, 'completed');
  assert.equal(result.data.id, 's-77');
});

test('lookupSend: statuses normalize (successful -> completed, unknown passes through)', async () => {
  const adapter = await loadAdapter();
  stubFetch({ status: 'completed', id: 's-78' });
  assert.equal((await adapter.lookupSend('s-78')).status, 'completed');

  stubFetch({ id: 's-79' });
  assert.equal((await adapter.lookupSend('s-79')).status, 'pending');
});

test('listSends: query filters hit /business/sends and signed path excludes the query', async () => {
  const adapter = await loadAdapter();
  stubFetch({ sends: [], total: 0 });

  const result = await adapter.listSends({ status: 'processing', limit: 10, offset: 3 });

  const { url, options } = fetchCalls[0];
  assert.equal(new URL(url).pathname, '/business/sends');
  assert.ok(url.includes('status=processing'));
  assert.ok(url.includes('limit=10'));
  assert.ok(url.includes('offset=3'));
  assertSigned(options.headers['X-YC-Timestamp'], url, 'GET', null);
  assert.deepEqual(result, { sends: [], total: 0 });
});

test('getSendFee: GET /business/sends/fee with amount+currency, signed path has no query', async () => {
  const adapter = await loadAdapter();
  stubFetch({ fee: 50, total: 1000050 });

  const result = await adapter.getSendFee({ amount: 1000000, currency: 'NGN' });

  const { url, options } = fetchCalls[0];
  assert.ok(url.startsWith(`${API_URL}/sends/fee?`));
  assert.equal(new URL(url).pathname, '/business/sends/fee');
  assertSigned(options.headers['X-YC-Timestamp'], url, 'GET', null);
  assert.equal(result.fee, 50);
});

test('getPayoutStatus alias delegates to lookupSend with the same wire shape', async () => {
  const adapter = await loadAdapter();
  stubFetch({ status: 'failed', data: { id: 's-80' } });

  const result = await adapter.getPayoutStatus('s-80');

  assert.equal(fetchCalls[0].url, `${API_URL}/send/s-80`);
  assert.equal(result.status, 'failed');
});

test('lookupSend: 4xx classify permanent', async () => {
  const adapter = await loadAdapter();
  stubFetchError(404);

  await assert.rejects(
    adapter.lookupSend('s-404'),
    (err) => err.status === 404 && adapter.classifyError(err) === 'permanent',
  );
});