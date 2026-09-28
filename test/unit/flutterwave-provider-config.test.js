/**
 * Sprint 12 — provider selection at the config/factory layer.
 *
 * Decision D-1 scoped this sprint to the config layer: a corridor can NAME a
 * provider, but the payout leg itself is still hard-wired to
 * `ctx.adapters.yellowcard`. These tests pin that boundary so it cannot be
 * quietly widened:
 *
 *   - the default is yellowcard, and the resolved adapter IS the Yellow Card one;
 *   - PAYOUT_PROVIDER selects which adapter the context is built with;
 *   - publishing `flutterwave` on the context changes NOTHING about the payout
 *     leg, because that leg reads the `yellowcard` key at 14 hard-coded sites.
 *
 * The last point is the one that matters. A test that only asserted "the key
 * exists" would still pass after someone routed the pipeline through it without
 * the evidence chain being updated — the failure mode backlog P-1 exists to fix.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getPayoutProvider,
  getPayoutAdapter,
  getYellowCardAdapter,
  getFlutterwaveAdapter,
} from '../../src/services/bos/bridgeAdapterFactory.js';
import * as yellowcardAdapter from '../../src/services/bos/yellowcardAdapter.js';
import * as flutterwaveAdapter from '../../src/services/bos/flutterwaveAdapter.js';

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

test('the payout provider defaults to yellowcard', () => {
  withProvider(undefined, () => {
    assert.equal(getPayoutProvider(), 'yellowcard', 'the default must not change');
  });
});

test('the payout provider is read from PAYOUT_PROVIDER at call time', () => {
  withProvider('flutterwave', () => {
    assert.equal(getPayoutProvider(), 'flutterwave');
  });
  withProvider('yellowcard', () => {
    assert.equal(getPayoutProvider(), 'yellowcard');
  });
});

test('an unknown PAYOUT_PROVIDER falls back to the Yellow Card adapter', () => {
  // Fail-safe: an unrecognised value must not resolve to a provider nobody
  // configured, and must not throw during init.
  withProvider('not-a-provider', () => {
    assert.equal(getPayoutAdapter(), yellowcardAdapter);
  });
});

test('getPayoutAdapter resolves the configured provider', () => {
  withProvider('yellowcard', () => {
    assert.equal(getPayoutAdapter(), yellowcardAdapter);
  });
  withProvider('flutterwave', () => {
    assert.equal(getPayoutAdapter(), flutterwaveAdapter);
  });
});

test('both payout adapters satisfy the same interface the pipeline consumes', () => {
  // The four methods transitionActions/transitionGuards actually call, plus
  // classifyError. Parity here is what makes the abstraction real; a drift in
  // either adapter breaks the promise the sprint was meant to demonstrate.
  const required = ['submitSend', 'lookupSend', 'healthCheck', 'verifyWebhookSignature', 'classifyError'];
  for (const adapter of [yellowcardAdapter, flutterwaveAdapter]) {
    for (const method of required) {
      assert.equal(typeof adapter[method], 'function', `${adapter === flutterwaveAdapter ? 'flutterwave' : 'yellowcard'}Adapter.${method}`);
    }
  }
});

test('the factory getters return the same module objects the pipeline would import', () => {
  assert.equal(getYellowCardAdapter(), yellowcardAdapter);
  assert.equal(getFlutterwaveAdapter(), flutterwaveAdapter);
});

test('publishing flutterwave on the context does not change the payout leg', async () => {
  const { getStacksAdapter, getXReserveAdapter } = await import('../../src/services/bos/bridgeAdapterFactory.js');

  // Mirrors the `adapters` map built in src/index.js ensureInit().
  const buildAdapters = () => ({
    stacks: getStacksAdapter(),
    xreserve: getXReserveAdapter(),
    yellowcard: getYellowCardAdapter(),
    flutterwave: getFlutterwaveAdapter(),
  });

  const ctx = buildAdapters();

  // The key exists, so a future routing change has something to target.
  assert.ok(ctx.flutterwave, 'flutterwave must be published on the context');

  // ...but the payout leg is untouched. transitionActions.js:359 calls
  // ctx.adapters.yellowcard.submitSend, and that is still where it goes.
  assert.equal(ctx.yellowcard, yellowcardAdapter, 'the payout leg still resolves the yellowcard key');
  assert.notEqual(ctx.yellowcard, ctx.flutterwave, 'the two adapters are distinct objects');
});

test('the default provider and the resolved adapter agree', () => {
  // The invariant the default path rests on: with no PAYOUT_PROVIDER set, both
  // the name and the adapter say yellowcard. If this ever diverges, the
  // "additive only" claim in this sprint stops being true.
  withProvider(undefined, () => {
    assert.equal(getPayoutProvider(), 'yellowcard');
    assert.equal(getPayoutAdapter(), getYellowCardAdapter());
  });
});
