/**
 * G-04: amount_ngn_expected and exchange_rate are populated deterministically
 * at creation, fail-closed.
 *
 * amount_usdcx is expressed in 6-dp USDCx base units; amount_ngn_expected is
 * the Yellow Card payout amount in kobo (currency's smallest unit) so it can be
 * passed straight through to submitSend without conversion.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DisbursementState as S } from '../../src/services/bos/types.js';
import { init, initiateDisbursement, computeAmountNgnExpected } from '../../src/services/bos/disbursementService.js';
import { submitYellowCardPayout } from '../../src/services/bos/transitionActions.js';
import { createTestCtx } from '../helpers/ctx.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';

const BASE = {
  source_reference: 'campaign-001',
  amount_usd: 25,
  amount_usdcx: 25_000_000, // 25 USDCx
  creator_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
  recipient_bank_account: '0123456789',
  recipient_bank_code: '044',
  ngn_recipient: { accountNumber: '0123456789', bankCode: '044' },
};

/** Minimal stand-in for the `disbursements` row after INSERT. */
function seedRowForCreate(db) {
  db.when(/SELECT \* FROM disbursements WHERE id = \$1/, () => ({
    id: 'd-g04',
    status: S.DISBURSEMENT_INITIATED,
    retry_count: 0,
    max_retries: 3,
  }));
}

describe('computeAmountNgnExpected (decimals convention)', () => {
  it('converts USDCx base units (6-dp) to NGN kobo at the given rate', () => {
    // 1 USDCx @ 1650 → 1650 NGN → 165_000 kobo
    assert.equal(computeAmountNgnExpected({ amount_usdcx_base_units: 1_000_000, rate: 1650 }), 165_000);
    // 0.5 USDCx @ 1650 → 825 NGN → 82_500 kobo
    assert.equal(computeAmountNgnExpected({ amount_usdcx_base_units: 500_000, rate: 1650 }), 82_500);
    // 25 USDCx @ 1650 → 41_250 NGN → 4_125_000 kobo
    assert.equal(computeAmountNgnExpected({ amount_usdcx_base_units: 25_000_000, rate: 1650 }), 4_125_000);
  });

  it('rounds fractional kobo to the nearest integer', () => {
    // 0.001 USDCx @ 1650 → 1.65 NGN → 165 kobo (exact), 0.00123 → 202.95 kobo → 203
    assert.equal(computeAmountNgnExpected({ amount_usdcx_base_units: 1_230, rate: 1650 }), 203);
  });
});

describe('G-04: initiateDisbursement resolves and persists the rate (fail closed)', () => {
  it('populates exchange_rate and amount_ngn_expected in the INSERT when a rate exists', async () => {
    const ctx = createTestCtx({ adapters: createMockAdapters() });
    ctx.db.when(/SELECT rate FROM exchange_rates/, () => ({ rate: 1650 }));
    seedRowForCreate(ctx.db);
    await init(ctx);

    await initiateDisbursement({ ...BASE });

    const insert = ctx.db.findCall(/INSERT INTO disbursements/);
    assert.ok(insert, 'a disbursement INSERT should have been issued');
    assert.match(insert.sql, /amount_ngn_expected/);
    assert.match(insert.sql, /exchange_rate/);
    // Params: ..., metadata, amount_ngn_expected, exchange_rate (indices 13, 14)
    assert.equal(insert.params[13], 4_125_000, 'amount_ngn_expected = 4125000 kobo for 25 USDCx @ 1650');
    assert.equal(insert.params[14], 1650, 'exchange_rate persisted unchanged');
  });

  it('rejects creation when no rate is on file (fail closed, no INSERT)', async () => {
    const ctx = createTestCtx({ adapters: createMockAdapters() });
    await init(ctx);

    await assert.rejects(
      () => initiateDisbursement({ ...BASE }),
      (err) => {
        assert.equal(err.error_code, 'missing_exchange_rate');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    assert.equal(ctx.db.countMatching(/INSERT INTO disbursements/), 0, 'no row is inserted without a rate');
  });

  it('rejects creation when the rate is zero or negative', async () => {
    for (const rate of [0, -1]) {
      const ctx = createTestCtx({ adapters: createMockAdapters() });
      ctx.db.when(/SELECT rate FROM exchange_rates/, () => ({ rate }));
      await init(ctx);

      await assert.rejects(
        () => initiateDisbursement({ ...BASE }),
        (err) => {
          assert.equal(err.error_code, 'missing_exchange_rate');
          return true;
        }
      );
      assert.equal(ctx.db.countMatching(/INSERT INTO disbursements/), 0, `rate ${rate} must fail closed`);
    }
  });
});

describe('G-04: submitYellowCardPayout no longer throws "amount_ngn_expected missing or zero"', () => {
  it('submits the payout when amount_ngn_expected is populated at create time', async () => {
    const ctx = createTestCtx({ adapters: createMockAdapters() });
    const disbursement = {
      id: 'd-g04',
      status: S.DESTINATION_RELEASE_CONFIRMED,
      amount_ngn_expected: 4_125_000,
      exchange_rate: 1650,
      ngn_recipient: { account_number: '0123456789', bank_code: '044' },
    };

    const result = await submitYellowCardPayout(disbursement, ctx);

    assert.ok(result.payout_id, 'a payout id was returned');
    assert.equal(result.amount_ngn, 4_125_000);
    assert.equal(ctx.adapters.yellowcard.calls.submitSend[0].amount, 4_125_000, 'amount passed in kobo');
  });

  it('still throws (fail closed) when amount_ngn_expected is missing entirely', async () => {
    const ctx = createTestCtx({ adapters: createMockAdapters() });
    await assert.rejects(
      () => submitYellowCardPayout({ id: 'd-g04', status: S.DESTINATION_RELEASE_CONFIRMED }, ctx),
      /amount_ngn_expected missing or zero/
    );
    assert.equal(ctx.adapters.yellowcard.calls.submitSend.length, 0, 'no external call on invalid input');
  });
});