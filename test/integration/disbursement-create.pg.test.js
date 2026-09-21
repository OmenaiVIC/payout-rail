import test from 'node:test';
import assert from 'node:assert/strict';

import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createSilentLogger } from '../helpers/ctx.js';
import { createRecipientRegistry } from '../../src/services/bos/RecipientRegistry.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

test(
  'G-02 (integration): a real disbursement row inserts with both bank columns satisfied',
  { skip: TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL not set — skipping Postgres integration test' },
  async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    const { initDb, getDb, closeDb } = await import('../../src/database.js');
    const { init, initiateDisbursement } = await import('../../src/services/bos/disbursementService.js');

    await initDb();

    const events = [];
    const ctx = {
      getDb,
      adapters: createMockAdapters(),
      recipientRegistry: createRecipientRegistry('permissive'),
      getLogger: createSilentLogger,
      emitEvent: async (e) => { events.push(e); },
    };

    await init(ctx);

    const reference = `itest-${Date.now()}`;
    let createdId = null;
    try {
      const created = await initiateDisbursement({
        source_reference: reference,
        amount_usd: 1,
        amount_usdcx: 1_000_000,
        creator_address: 'SP0000000000000000000000000000000000000000',
        recipient_bank_account: '0123456789',
        recipient_bank_code: '044',
        ngn_recipient: { accountNumber: '0123456789', bankCode: '044' },
      });

      const row = await getDb().then((db) =>
        db.get(`SELECT * FROM disbursements WHERE source_reference = $1`, [reference])
      );
      assert.ok(row, 'row should exist');
      createdId = row.id;
      assert.equal(row.recipient_bank_account, '0123456789');
      assert.equal(row.recipient_bank_code, '044');
      assert.equal(created?.id, row.id);
    } finally {
      if (createdId) {
        const db = await getDb();
        await db.run(`DELETE FROM disbursement_audit WHERE disbursement_id = $1`, [createdId]);
        await db.run(`DELETE FROM external_refs WHERE disbursement_id = $1`, [createdId]);
        await db.run(`DELETE FROM payout_gates WHERE disbursement_id = $1`, [createdId]);
        await db.run(`DELETE FROM disbursements WHERE id = $1`, [createdId]);
      }
      await closeDb();
    }
  }
);
