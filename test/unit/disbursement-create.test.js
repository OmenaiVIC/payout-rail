import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestCtx } from '../helpers/ctx.js';
import { init, initiateDisbursement } from '../../src/services/bos/disbursementService.js';

const BASE = {
  source_reference: 'ref-1',
  amount_usd: 5,
  amount_usdcx: 5_000_000,
  creator_address: 'SP0000000000000000000000000000000000000000',
};

test('G-02: create rejects when recipient bank details are missing (fail-closed, no INSERT)', async () => {
  const ctx = createTestCtx();
  await init(ctx);

  await assert.rejects(
    () => initiateDisbursement({ ...BASE }),
    (err) => {
      assert.equal(err.error_code, 'missing_recipient_bank_details');
      assert.deepEqual(err.details.missing, ['recipient_bank_account', 'recipient_bank_code']);
      return true;
    }
  );

  assert.equal(
    ctx.db.countMatching(/INSERT INTO disbursements/),
    0,
    'no row should be inserted when validation fails'
  );
});

test('G-02: create rejects a blank bank field', async () => {
  const ctx = createTestCtx();
  await init(ctx);

  await assert.rejects(
    () => initiateDisbursement({ ...BASE, recipient_bank_account: '   ', recipient_bank_code: '044' }),
    (err) => {
      assert.equal(err.error_code, 'missing_recipient_bank_details');
      assert.deepEqual(err.details.missing, ['recipient_bank_account']);
      return true;
    }
  );
  assert.equal(ctx.db.countMatching(/INSERT INTO disbursements/), 0);
});

test('G-02: create persists recipient_bank_account and recipient_bank_code in the INSERT', async () => {
  const ctx = createTestCtx();
  ctx.db.when(/SELECT \* FROM disbursements WHERE id = \$1/, () => ({
    id: 'd-1',
    status: 'disbursement_initiated',
    retry_count: 0,
    max_retries: 3,
  }));
  await init(ctx);

  await initiateDisbursement({
    ...BASE,
    recipient_bank_account: '0123456789',
    recipient_bank_code: '044',
    ngn_recipient: { accountNumber: '0123456789', bankCode: '044' },
  });

  const insert = ctx.db.findCall(/INSERT INTO disbursements/);
  assert.ok(insert, 'an INSERT INTO disbursements should have been issued');
  assert.match(insert.sql, /recipient_bank_account/);
  assert.match(insert.sql, /recipient_bank_code/);
  assert.ok(insert.params.includes('0123456789'), 'account number should be bound');
  assert.ok(insert.params.includes('044'), 'bank code should be bound');
});
