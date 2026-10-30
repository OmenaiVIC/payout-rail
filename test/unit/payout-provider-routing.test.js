/**
 * Sprint P-1 / C1 — the payout adapter resolution seam.
 *
 * The pivot this file pins: the payout leg must resolve its adapter through a
 * named provider, and a provider that cannot serve the NGN bank leg must be
 * refused before the adapter is touched. Today the leg is hard-wired to
 * `ctx.adapters.yellowcard`; C1 adds the seam, C2–C4 move the call sites.
 *
 * Two rules are load-bearing and easy to break quietly:
 *
 *   1. Name and adapter resolve from the SAME normalization. An unknown
 *      PAYOUT_PROVIDER already falls back to yellowcard at the adapter layer
 *      (flutterwave-provider-config.test.js:58), so the capability layer must
 *      agree or the seam can name one provider and hand back another.
 *   2. An unsupported leg throws; it never degrades to "advance anyway". A
 *      refused resolution must not even call the adapter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAYOUT_LEGS,
  ProviderCapabilityError,
  assertPayoutLeg,
  assertPayoutProviderCapable,
  resolvePayoutAdapter,
  resolvePayoutProvider,
} from '../../src/services/bos/bridgeAdapterFactory.js';

function withProvider(value, fn) {
  const prior = process.env.PAYOUT_PROVIDER;
  if (value === undefined) delete process.env.PAYOUT_PROVIDER;
  else process.env.PAYOUT_PROVIDER = value;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env.PAYOUT_PROVIDER;
    else process.env.PAYOUT_PROVIDER = prior;
  }
}

function fakeAdapter(label) {
  return { label, async submitSend() {}, async lookupSend() {} };
}

test('PAYOUT_LEGS declares exactly which payout legs a provider can serve', () => {
  assert.deepEqual(PAYOUT_LEGS.yellowcard, ['ngn_bank']);
  assert.deepEqual(PAYOUT_LEGS.breet, ['ngn_bank']);
  assert.deepEqual(
    PAYOUT_LEGS.flutterwave,
    [],
    'flutterwave disburses USDC to a wallet, not NGN to a bank (F-1)'
  );
});

test('resolvePayoutAdapter returns the adapter named by ctx.payoutProvider', () => {
  const yellowcard = fakeAdapter('yellowcard');
  const breet = fakeAdapter('breet');
  const adapters = { yellowcard, breet };

  assert.equal(resolvePayoutAdapter({ payoutProvider: 'yellowcard', adapters }), yellowcard);
  assert.equal(resolvePayoutAdapter({ payoutProvider: 'breet', adapters }), breet);
});

test('resolvePayoutAdapter defaults to yellowcard when the ctx does not name a provider', () => {
  withProvider(undefined, () => {
    const yellowcard = fakeAdapter('yellowcard');
    assert.equal(resolvePayoutAdapter({ adapters: { yellowcard } }), yellowcard);
  });
});

test('resolvePayoutAdapter prefers ctx.getPayoutAdapter over adapters[...]', () => {
  const sentinel = fakeAdapter('sentinel');
  const ctx = {
    payoutProvider: 'yellowcard',
    adapters: { yellowcard: fakeAdapter('yellowcard') },
    getPayoutAdapter: () => sentinel,
  };
  assert.equal(resolvePayoutAdapter(ctx), sentinel);
});

test('resolvePayoutAdapter refuses a provider that cannot serve the NGN bank leg', () => {
  let adapterCalls = 0;
  const ctx = {
    payoutProvider: 'flutterwave',
    adapters: { flutterwave: fakeAdapter('flutterwave') },
    getPayoutAdapter: () => {
      adapterCalls += 1;
      return fakeAdapter('flutterwave');
    },
  };

  assert.throws(
    () => resolvePayoutAdapter(ctx),
    (err) =>
      err instanceof ProviderCapabilityError &&
      err.code === 'PROVIDER_CAPABILITY_UNSUPPORTED' &&
      err.provider === 'flutterwave' &&
      err.leg === 'ngn_bank'
  );
  assert.equal(adapterCalls, 0, 'the adapter must not be touched when the leg is unsupported');
});

test('assertPayoutLeg fails closed but normalizes unknown names like the adapter layer', () => {
  assert.equal(assertPayoutLeg('yellowcard'), 'yellowcard');
  assert.equal(assertPayoutLeg('breet'), 'breet');
  assert.throws(() => assertPayoutLeg('flutterwave'), ProviderCapabilityError);

  // Pinned by flutterwave-provider-config.test.js:58: an unrecognised value must
  // not throw during init, and the adapter resolves to yellowcard. The seam must
  // name the same provider it hands back.
  assert.equal(resolvePayoutProvider('not-a-provider'), 'yellowcard');
  assert.equal(assertPayoutLeg('not-a-provider'), 'yellowcard');
});

test('assertPayoutProviderCapable reads PAYOUT_PROVIDER at call time', () => {
  withProvider('flutterwave', () => {
    assert.throws(() => assertPayoutProviderCapable(), ProviderCapabilityError);
  });
  withProvider('breet', () => {
    assert.equal(assertPayoutProviderCapable(), 'breet');
  });
  withProvider(undefined, () => {
    assert.equal(assertPayoutProviderCapable(), 'yellowcard');
  });
});

test('resolvePayoutAdapter reports a missing adapter instead of silently falling back', () => {
  assert.throws(
    () => resolvePayoutAdapter({ payoutProvider: 'breet', adapters: { yellowcard: fakeAdapter('yellowcard') } }),
    /no payout adapter/i,
    'a named provider with no published adapter must not degrade to yellowcard'
  );
});
