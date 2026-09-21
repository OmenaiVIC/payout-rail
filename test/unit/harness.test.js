import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeDb, createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters, createMockStacks, createMockXReserve, createMockYellowCard } from '../helpers/mockAdapters.js';
import { createTestCtx, createSilentLogger } from '../helpers/ctx.js';

test('FakeDb: records every call and answers from registered handlers', async () => {
  const db = createFakeDb();
  db.when(/SELECT \* FROM disbursements/, () => [{ id: 'd-1', status: 'disbursement_initiated' }]);

  const row = await db.get('SELECT * FROM disbursements WHERE id = $1', ['d-1']);
  assert.deepEqual(row, { id: 'd-1', status: 'disbursement_initiated' });

  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].method, 'get');
  assert.deepEqual(db.calls[0].params, ['d-1']);
  assert.equal(db.countMatching(/disbursements/), 1);
});

test('FakeDb: unmatched queries fall through to null / empty array', async () => {
  const db = createFakeDb();
  assert.equal(await db.get('SELECT 1'), null);
  assert.deepEqual(await db.all('SELECT 1'), []);
});

test('FakeDb: run() normalises to the PgClient result shape', async () => {
  const db = createFakeDb();
  db.when(/INSERT INTO payout_gates/, () => [{ id: 7 }]);

  const result = await db.run('INSERT INTO payout_gates (a) VALUES ($1)', ['x']);
  assert.equal(result.lastInsertRowid, 7);
  assert.equal(result.changes, 1);
  assert.equal(result.rows.length, 1);

  db.when(/DELETE FROM nothing/, () => ({ changes: 0, rows: [] }));
  const empty = await db.run('DELETE FROM nothing');
  assert.equal(empty.changes, 0);
});

test('FakeDb: when() rejects a global regex (stateful lastIndex)', () => {
  const db = new FakeDb();
  assert.throws(() => db.when(/x/g, () => null), /non-global/);
});

test('FakeDb: all() and table seeding', async () => {
  const db = createFakeDb().seed('external_refs', [{ id: 1 }, { id: 2 }]);
  db.when(/FROM external_refs/, ({ db: d }) => d.table('external_refs'));

  const rows = await db.all('SELECT * FROM external_refs');
  assert.equal(rows.length, 2);
  assert.equal(db.table('external_refs').length, 2);
});

test('mock adapters: expose the exact methods the pipeline consumes', async () => {
  const stacks = createMockStacks();
  const txHash = await stacks.burnUsdcx({ amount: 1 });
  assert.match(txHash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(await stacks.getTransactionStatus(txHash), { tx_status: 'success', block_height: 1 });
  assert.equal(stacks.calls.burnUsdcx.length, 1);

  const xreserve = createMockXReserve();
  const att = await xreserve.requestAttestation({ tx_id: txHash });
  assert.ok(att.attestation_id);
  const rel = await xreserve.releaseDestination({ attestation_id: att.attestation_id });
  assert.ok(rel.release_id);
  assert.equal(xreserve.calls.releaseDestination.length, 1);

  const yellowcard = createMockYellowCard();
  const payout = await yellowcard.submitSend({ amount: 100 });
  assert.ok(payout.send_id);
  assert.deepEqual(await yellowcard.lookupSend(payout.send_id), {
    status: 'completed',
    data: { id: payout.send_id },
  });
});

test('mock adapters: createMockAdapters wires all three', () => {
  const adapters = createMockAdapters();
  assert.deepEqual(Object.keys(adapters).sort(), ['stacks', 'xreserve', 'yellowcard']);
});

test('createTestCtx: matches the ensureInit() bosCtx shape', () => {
  const ctx = createTestCtx();
  assert.equal(typeof ctx.getDb, 'function');
  assert.equal(ctx.getDb(), ctx.db, 'getDb() should return the injected FakeDb');
  assert.deepEqual(Object.keys(ctx.adapters).sort(), ['stacks', 'xreserve', 'yellowcard']);
  assert.equal(typeof ctx.recipientRegistry.check, 'function');
  assert.equal(typeof ctx.emitEvent, 'function');
  assert.equal(typeof ctx.getLogger, 'function');
  assert.equal(typeof ctx.getLogger('x').info, 'function');
});

test('createTestCtx: permissive registry admits a recipient, null registry rejects', async () => {
  const permissive = createTestCtx();
  assert.equal((await permissive.recipientRegistry.check({ address: 'SP1' })).eligible, true);

  const { createRecipientRegistry } = await import('../../src/services/bos/RecipientRegistry.js');
  const none = createRecipientRegistry(undefined);
  assert.equal((await none.check({ address: 'SP1' })).eligible, false);
});

test('createTestCtx: emits audit events without a database', async () => {
  const ctx = createTestCtx();
  await ctx.emitEvent({ disbursement_id: 'd-1', action: 'test' });
  assert.equal(ctx.events.length, 1);
  assert.equal(ctx.events[0].action, 'test');
});

test('BOS module graph imports cleanly under ESM', async () => {
  const modules = [
    '../../src/services/bos/types.js',
    '../../src/services/bos/stateMachine.js',
    '../../src/services/bos/transitionGuards.js',
    '../../src/services/bos/transitionActions.js',
    '../../src/services/bos/preflight.js',
    '../../src/services/bos/payoutGates.js',
    '../../src/services/bos/twoPersonApproval.js',
    '../../src/services/bos/circuitBreaker.js',
    '../../src/services/bos/disbursementService.js',
    '../../src/services/bos/evidenceCollector.js',
    '../../src/services/bos/bridgeAdapterFactory.js',
    '../../src/services/bos/RecipientRegistry.js',
  ];
  for (const path of modules) {
    const mod = await import(path);
    assert.ok(mod, `${path} should export something`);
  }
});
