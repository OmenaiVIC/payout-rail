import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestCtx } from '../helpers/ctx.js';
import {
  init,
  initiateDisbursement,
  deriveDisbursementIdempotencyKey,
} from '../../src/services/bos/disbursementService.js';

const BASE = {
  source_reference: 'ref-dup-1',
  source_application: 'campaign',
  amount_usd: 5,
  amount_usdcx: 5_000_000,
  creator_address: 'SP0000000000000000000000000000000000000000',
  recipient_bank_account: '0123456789',
  recipient_bank_code: '044',
};

test('G-11: key is deterministic — same inputs yield the same key across calls', () => {
  const a = deriveDisbursementIdempotencyKey(BASE);
  const b = deriveDisbursementIdempotencyKey(BASE);
  assert.equal(a, b);
  assert.match(a, /^disbursement:[0-9a-f]{64}$/);
});

test('G-11: key does not depend on wall-clock time', async () => {
  const first = deriveDisbursementIdempotencyKey(BASE);
  await new Promise((r) => setTimeout(r, 10));
  const later = deriveDisbursementIdempotencyKey(BASE);
  assert.equal(first, later, 'a Date.now()-based key would differ after 10ms');
});

test('G-11: distinct stable inputs produce distinct keys', () => {
  const baseKey = deriveDisbursementIdempotencyKey(BASE);
  assert.notEqual(baseKey, deriveDisbursementIdempotencyKey({ ...BASE, recipient_bank_account: '9999999999' }));
  assert.notEqual(baseKey, deriveDisbursementIdempotencyKey({ ...BASE, amount_usdcx: 9_000_000 }));
  assert.notEqual(baseKey, deriveDisbursementIdempotencyKey({ ...BASE, source_reference: 'ref-other' }));
  assert.notEqual(baseKey, deriveDisbursementIdempotencyKey({ ...BASE, source_application: 'grants' }));
});

test('G-11: duplicate create returns the existing disbursement and does not INSERT a second row', async () => {
  const ctx = createTestCtx();
  const created = [];
  ctx.db.when(/SELECT rate FROM exchange_rates/, () => ({ rate: 1650 }));
  ctx.db.when(/INSERT INTO disbursements/, ({ params }) => {
    const row = {
      id: params[0],
      idempotency_key: params[1],
      source_reference: params[2],
      status: 'disbursement_initiated',
    };
    created.push(row);
    return { changes: 1, rows: [row] };
  });
  ctx.db.when(/SELECT \* FROM disbursements WHERE id = \$1/, ({ params }) =>
    created.find((r) => r.id === params[0]) ?? null
  );
  ctx.db.when(/SELECT \* FROM disbursements WHERE idempotency_key = \$1/, ({ params }) =>
    created.find((r) => r.idempotency_key === params[0]) ?? null
  );
  await init(ctx);

  const first = await initiateDisbursement({ ...BASE });
  const second = await initiateDisbursement({ ...BASE });

  assert.equal(second.id, first.id, 'duplicate create must return the same disbursement');
  assert.equal(ctx.db.countMatching(/INSERT INTO disbursements/), 1, 'exactly one INSERT for duplicate creates');
  assert.equal(created.length, 1);
});

test('G-11: the deterministic key (no timestamp) is threaded into the INSERT', async () => {
  const ctx = createTestCtx();
  const created = [];
  ctx.db.when(/SELECT rate FROM exchange_rates/, () => ({ rate: 1650 }));
  ctx.db.when(/INSERT INTO disbursements/, ({ params }) => {
    const row = { id: params[0], idempotency_key: params[1], status: 'disbursement_initiated' };
    created.push(row);
    return { changes: 1, rows: [row] };
  });
  ctx.db.when(/SELECT \* FROM disbursements WHERE id = \$1/, ({ params }) =>
    created.find((r) => r.id === params[0]) ?? null
  );
  ctx.db.when(/SELECT \* FROM disbursements WHERE idempotency_key = \$1/, ({ params }) =>
    created.find((r) => r.idempotency_key === params[0]) ?? null
  );
  await init(ctx);

  const disbursement = await initiateDisbursement({ ...BASE });
  const insert = ctx.db.findCall(/INSERT INTO disbursements/);
  const expectedKey = deriveDisbursementIdempotencyKey(BASE);

  assert.equal(disbursement.idempotency_key, expectedKey);
  assert.ok(insert.params.includes(expectedKey), 'INSERT must carry the deterministic key');
  assert.ok(!insert.params.join('|').includes('Date.now'), 'no timestamp-derived fragment in the key');
});