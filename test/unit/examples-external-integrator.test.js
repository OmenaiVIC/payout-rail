/**
 * Sprint 7.5 — external-integrator example end-to-end against mocked infrastructure.
 *
 * Boots the real v1 router over an ephemeral loopback listener using the example's
 * own demo harness (FakeDb + mock adapters + latched release evidence), then drives
 * the exported `examples/external-integrator/client.js` functions exactly as an
 * external marketplace application would:
 *   paySeller happy path (create → advance to settled → receipt),
 *   idempotent re-create,
 *   the two error surfaces (missing bank fields → 400; bad token → 401),
 *   and the demo `main()` transcript.
 *
 * No credentials, no network beyond the ephemeral 127.0.0.1 listener.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { bootDemoHarness } from '../../examples/external-integrator/harness.js';
import {
  createPayout,
  paySeller,
  main,
  apiRequest,
  ApiError,
  SELLER_ORDER,
} from '../../examples/external-integrator/client.js';

const ENV_KEYS = ['BOS_API_TOKEN', 'BOS_ALLOW_UNAUTHENTICATED_DEV', 'PAYOUT_API_BASE_URL'];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot) {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

const EXPECTED_LIFECYCLE = [
  'preflight_check',
  'burn_submitted',
  'burn_confirmed',
  'attestation_requested',
  'attestation_confirmed',
  'destination_release_unobserved',
  'destination_release_observed',
  'destination_release_confirmed',
  'yellowcard_payout_submitted',
  'yellowcard_payout_confirmed',
  'settled',
];

test('external-integrator example end-to-end against mocked infra', async (t) => {
  const env = snapshotEnv();

  const { store, db, base, close } = await bootDemoHarness();
  t.after(async () => close());
  t.after(() => restoreEnv(env));

  process.env.BOS_API_TOKEN = 'secret-token';
  delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
  process.env.PAYOUT_API_BASE_URL = base;

  await t.test('paySeller drives create → settled and returns a gap-free receipt', async () => {
    store.reset();

    const { disbursement, states, receipt } = await paySeller(SELLER_ORDER);

    assert.equal(disbursement.status, 'settled');
    assert.deepEqual(states, EXPECTED_LIFECYCLE, 'one landed state per lifecycle hop, ending settled');

    assert.equal(receipt.final_status, 'settled');
    assert.deepEqual(receipt.gaps, [], 'settled payout reconstructs a complete, gap-free receipt');
    assert.equal(receipt.settlement_reference.provider, 'yellowcard');
    assert.equal(receipt.settlement_reference.provider_payout_id, 'yc-mock-1');
    assert.equal(receipt.settlement_reference.external_settlement_reference, 'yc-mock-1');
    assert.match(receipt.stacks_leg.burn_tx_hash, /^0x0+1$/, 'burn tx id persisted onto the receipt');
    assert.equal(receipt.stacks_leg.attestation_id, 'att-mock-1');
    assert.equal(receipt.release_leg.release_status, 'observed_confirmed');
    assert.equal(receipt.provider_leg.ngn_amount, '4125000', '25 USDCx @ 1650 = NGN 41,250.00 in kobo');
    assert.equal(receipt.provider_leg.status, 'confirmed');
  });

  await t.test('identical re-create is idempotent: same disbursement, no second row', async () => {
    const first = await createPayout(SELLER_ORDER);
    const duplicate = await createPayout(SELLER_ORDER);

    assert.ok(first.disbursement.id, 'first create returns a disbursement id');
    assert.equal(duplicate.disbursement.id, first.disbursement.id, 'same body twice → same disbursement');
    assert.equal(db.countMatching(/^INSERT INTO disbursements/), 1,
      'the whole happy path + duplicate create produced exactly one disbursement row');
  });

  await t.test('error surfaces: missing bank fields → 400, bad token → 401', async () => {
    await assert.rejects(
      () => createPayout({ ...SELLER_ORDER, recipient_bank_account: '', recipient_bank_code: '' }),
      (err) => err instanceof ApiError
        && err.status === 400
        && err.error_code === 'missing_recipient_bank_details'
        && Array.isArray(err.details.missing)
    );

    await assert.rejects(
      () => apiRequest({
        method: 'POST',
        path: '/api/v1/disbursements',
        token: 'wrong-token',
        body: SELLER_ORDER,
      }),
      (err) => err instanceof ApiError && err.status === 401 && err.error_code === 'unauthorized'
    );
  });

  await t.test('main() demo exits 0 and prints the full transcript', async () => {
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
    assert.match(transcript, /marketplace-seller payout demo/);
    assert.match(transcript, /order-2042/);
    assert.match(transcript, /preflight_check -> burn_submitted/);
    assert.match(transcript, /settled/);
    assert.match(transcript, /final_status=settled/);
    assert.match(transcript, /gaps=0/);
    assert.match(transcript, /SAME disbursement/);
    assert.match(transcript, /400 missing_recipient_bank_details/);
    assert.match(transcript, /401 unauthorized/);
    assert.match(transcript, /demo complete/);

    console.log('=== external-integrator demo transcript (captured from the mocked run) ===');
    console.log(transcript);
    console.log('=== end transcript ===');
  });
});