import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getPayoutProvider, getPayoutAdapter } from '../../src/services/bos/bridgeAdapterFactory.js';

describe('Breet provider config', () => {
  const old = process.env.PAYOUT_PROVIDER;
  test('selects breet adapter when PAYOUT_PROVIDER=breet', () => {
    process.env.PAYOUT_PROVIDER = 'breet';
    assert.equal(getPayoutProvider(), 'breet');
    const adapter = getPayoutAdapter();
    assert.ok(adapter && typeof adapter.submitSend === 'function');
    assert.ok(adapter && typeof adapter.lookupSend === 'function');
  });
  test('default remains yellowcard when unset/other', () => {
    delete process.env.PAYOUT_PROVIDER;
    assert.equal(getPayoutProvider(), 'yellowcard');
    process.env.PAYOUT_PROVIDER = 'other';
    assert.equal(getPayoutProvider(), 'other');
    const adapter = getPayoutAdapter();
    assert.ok(adapter);
  });
  process.env.PAYOUT_PROVIDER = old;
});
