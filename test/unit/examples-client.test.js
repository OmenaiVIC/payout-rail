/**
 * Sprint 5b — example client end-to-end against mocked infrastructure.
 *
 * Boots the real v1 router over an HTTP listener with FakeDb + mock adapters,
 * points the example client at it via PAYOUT_API_BASE_URL / BOS_API_TOKEN, and
 * drives the actual `examples/simple-payout-client/client.js` exports:
 * create → advance → receipt → error paths (400 / 404 / 401), then runs `main()`
 * to capture the demo transcript used in the READMEs and the sprint report.
 *
 * No credentials, no network beyond the ephemeral local listener.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { init } from '../../src/services/bos/disbursementService.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createTestCtx } from '../helpers/ctx.js';
import {
  createV1Store,
  makeV1App,
  listen,
  snapshotEnv,
  restoreEnv,
} from '../helpers/v1Api.js';
import { createPayout, advancePayout, getReceipt, main, ApiError } from '../../examples/simple-payout-client/client.js';

test('example client end-to-end against mocked infra', async (t) => {
  const env = snapshotEnv();
  const baseUrlBefore = process.env.PAYOUT_API_BASE_URL;
  t.afterEach(() => restoreEnv(env));
  t.after(() => {
    if (baseUrlBefore === undefined) delete process.env.PAYOUT_API_BASE_URL;
    else process.env.PAYOUT_API_BASE_URL = baseUrlBefore;
  });

  const db = createFakeDb();
  const store = createV1Store(db);
  const ctx = createTestCtx({ db, adapters: createMockAdapters() });
  await init(ctx);

  const app = makeV1App();
  const { base, close } = await listen(app);
  t.after(() => close());

  const setAuth = () => {
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';
    process.env.PAYOUT_API_BASE_URL = base;
  };

  const DEMO = {
    source_reference: 'client-e2e',
    source_application: 'example-client',
    amount_usd: 25,
    amount_usdcx: 25_000_000,
    creator_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
    creator_btc_address: 'bc1qexample000000000000000000000000000000000',
    recipient_bank_account: '0123456789',
    recipient_bank_code: '044',
    ngn_recipient: { bankCode: '044', accountNumber: '0123456789' },
  };

  await t.test('create → advance → receipt happy path through the client exports', async () => {
    setAuth();
    store.reset();

    const created = await createPayout(DEMO);
    assert.ok(created.disbursement.id, 'create returns a disbursement id');
    assert.equal(created.disbursement.status, 'preflight_check');
    assert.ok(created.disbursement.idempotency_key.startsWith('disbursement:'));

    const duplicate = await createPayout(DEMO);
    assert.equal(duplicate.disbursement.id, created.disbursement.id, 'duplicate create is idempotent');

    const advanced = await advancePayout(created.disbursement.id, 1);
    assert.equal(advanced.result.success, true);
    assert.equal(advanced.result.new_state, 'manual_review', 'failing preflight escalates to manual_review');
    assert.equal(advanced.disbursement.status, 'manual_review');

    const { receipt } = await getReceipt(created.disbursement.id);
    assert.equal(receipt.final_status, 'manual_review');
    assert.ok(Array.isArray(receipt.gaps), 'receipt exposes explicit gaps');
    assert.ok(receipt.gaps.some((g) => g.leg === 'stacks'), 'no burn evidence yet — the gap is stated, not fabricated');
  });

  await t.test('client surfaces the normalized error bodies as ApiError', async () => {
    setAuth();
    store.reset();

    await assert.rejects(
      () => createPayout({ ...DEMO, recipient_bank_account: '', recipient_bank_code: '' }),
      (err) => err instanceof ApiError
        && err.status === 400
        && err.error_code === 'missing_recipient_bank_details'
        && Array.isArray(err.details.missing)
    );

    await assert.rejects(
      () => getReceipt('00000000-0000-0000-0000-000000000000'),
      (err) => err instanceof ApiError && err.status === 404 && err.error_code === 'not_found'
    );
  });

  await t.test('main() demo runs the full sequence and exits 0 (transcript captured)', async () => {
    setAuth();
    store.reset();

    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    let code;
    try {
      code = await main();
    } finally {
      console.log = originalLog;
    }
    const transcript = lines.join('\n');

    assert.equal(code, 0, `main() should exit 0; transcript:\n${transcript}`);
    assert.match(transcript, /simple-payout-client demo/);
    assert.match(transcript, /"status":"preflight_check"/);
    assert.match(transcript, /"new_state":"manual_review"/);
    assert.match(transcript, /error path: GET receipt for an unknown id/);
    assert.match(transcript, /404 not_found/);
    assert.match(transcript, /error path: request with a wrong token/);
    assert.match(transcript, /401 unauthorized/);
    assert.match(transcript, /demo complete/);

    console.log('=== example client transcript (captured from the mocked run) ===');
    console.log(transcript);
    console.log('=== end transcript ===');
  });
});