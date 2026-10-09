import { test, describe, after } from "node:test";
import assert from 'node:assert/strict';
import {
  submitSend,
  lookupSend,
  verifyWebhookSignature,
  classifyError,
} from '../../src/services/bos/breetAdapter.js';

describe('BreetAdapter contract', () => {
  const oldFetch = global.fetch;
  const oldEnv = { ...process.env };
  let calls = [];

  after(() => {
    global.fetch = oldFetch;
    process.env = oldEnv;
  });

  test('submitSend sends the documented off-ramp body shape (two-step: Add Bank then Withdraw)', async () => {
    calls = [];
    process.env.BREET_APP_ID = 'app123';
    process.env.BREET_APP_SECRET = 'secret123';
    process.env.BREET_ENV = 'sandbox';
    process.env.BREET_WITHDRAWAL_PIN = '1234';
    process.env.BREET_BASE_URL = 'https://api.breet.io/v1';

    global.fetch = async (url, opts = {}) => {
      calls.push({ url, opts });
      if (calls.length === 1) {
        assert.equal(url, 'https://api.breet.io/v1/payments/banks/add');
        assert.equal(opts.method, 'POST');
        const body = JSON.parse(opts.body);
        assert.equal(body.id, '15');
        assert.equal(body.accountNumber, '1234567890');
        assert.equal(body.currency, 'ngn');
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { id: 'bank_15' } }),
          text: async () => JSON.stringify({ data: { id: 'bank_15' } }),
        };
      }
      if (calls.length === 2) {
        assert.equal(url, 'https://api.breet.io/v1/payments/withdraw/bank/bank_15');
        assert.equal(opts.method, 'POST');
        const body = JSON.parse(opts.body);
        assert.equal(body.amount, 1000);
        assert.equal(body.pin, '1234');
        assert.equal(body.externalId, 'idem-123');
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { id: 'wid_456' } }),
          text: async () => JSON.stringify({ data: { id: 'wid_456' } }),
        };
      }
      throw new Error('unexpected call');
    };

    const res = await submitSend({
      idempotency_key: 'idem-123',
      amount: 1000,
      currency: 'NGN',
      recipient: {
        currency: 'NGN',
        accountNumber: '1234567890',
        bankCode: '044',
      },
    });
    assert.equal(res.send_id, 'wid_456');
    assert.equal(res.status, 'pending');
    assert.equal(res.sequence_id, 'idem-123');
    assert.equal(calls.length, 2);
  });

  test('Auth headers are x-app-id and x-app-secret', async () => {
    calls = [];
    process.env.BREET_APP_ID = 'app123';
    process.env.BREET_APP_SECRET = 'secret123';
    process.env.BREET_ENV = 'sandbox';
    process.env.BREET_WITHDRAWAL_PIN = '1234';
    process.env.BREET_BASE_URL = 'https://api.breet.io/v1';

    global.fetch = async (url, opts = {}) => {
      calls.push({ url, opts });
      if (calls.length === 1) {
        assert.equal(opts.headers['x-app-id'], 'app123');
        assert.equal(opts.headers['x-app-secret'], 'secret123');
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { id: 'bank_15' } }),
          text: async () => JSON.stringify({ data: { id: 'bank_15' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'wid_456' } }),
        text: async () => JSON.stringify({ data: { id: 'wid_456' } }),
      };
    };

    await submitSend({
      amount: 500,
      currency: 'NGN',
      recipient: { currency: 'NGN', accountNumber: '1234567890', bankCode: '044' },
    });
  });

  test('X-Breet-Env header is sandbox', async () => {
    calls = [];
    process.env.BREET_APP_ID = 'app123';
    process.env.BREET_APP_SECRET = 'secret123';
    process.env.BREET_ENV = 'sandbox';
    process.env.BREET_WITHDRAWAL_PIN = '1234';
    process.env.BREET_BASE_URL = 'https://api.breet.io/v1';

    global.fetch = async (url, opts = {}) => {
      calls.push({ url, opts });
      if (calls.length === 1) {
        assert.equal(opts.headers['X-Breet-Env'], 'sandbox');
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { id: 'bank_15' } }),
          text: async () => JSON.stringify({ data: { id: 'bank_15' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'wid_456' } }),
        text: async () => JSON.stringify({ data: { id: 'wid_456' } }),
      };
    };

    await submitSend({
      amount: 500,
      currency: 'NGN',
      recipient: { currency: 'NGN', accountNumber: '1234567890', bankCode: '044' },
    });
  });

  test('lookupSend calls GET /payments/withdrawal/{id}', async () => {
    process.env.BREET_APP_ID = 'app123';
    process.env.BREET_APP_SECRET = 'secret123';
    process.env.BREET_ENV = 'sandbox';
    process.env.BREET_BASE_URL = 'https://api.breet.io/v1';

    global.fetch = async (url, opts = {}) => {
      assert.equal(url, 'https://api.breet.io/v1/payments/withdrawal/wid_456');
      assert.equal(opts.method, 'GET');
      assert.equal(opts.headers['x-app-id'], 'app123');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { status: 'completed' } }),
        text: async () => JSON.stringify({ data: { status: 'completed' } }),
      };
    };

    const res = await lookupSend('wid_456');
    assert.equal(res.status, 'completed');
  });

  test('verifyWebhookSignature accepts a matching x-webhook-secret', () => {
    process.env.BREET_WEBHOOK_SECRET = 'secret';
    const ok = verifyWebhookSignature('ignored', 'secret', process.env.BREET_WEBHOOK_SECRET);
    assert.equal(ok, true);
  });

  test('verifyWebhookSignature rejects a mismatched secret', () => {
    process.env.BREET_WEBHOOK_SECRET = 'secret';
    const ok = verifyWebhookSignature('ignored', 'wrong', 'secret');
    assert.equal(ok, false);
  });

  test('verifyWebhookSignature fails closed when BREET_WEBHOOK_SECRET is unset', () => {
    delete process.env.BREET_WEBHOOK_SECRET;
    const ok = verifyWebhookSignature('ignored', 'any', '');
    assert.equal(ok, false);
  });

  test('classifyError taxonomy', () => {
    assert.equal(classifyError(new Error('fetch failed')), 'transient');
    assert.equal(classifyError({ name: 'AbortError' }), 'transient');
    assert.equal(classifyError({ status: 429 }), 'transient');
    assert.equal(classifyError({ status: 500 }), 'transient');
    assert.equal(classifyError({ status: 400 }), 'permanent');
    assert.equal(classifyError({ status: 404 }), 'permanent');
    assert.equal(classifyError({}), 'unknown');
  });
});
