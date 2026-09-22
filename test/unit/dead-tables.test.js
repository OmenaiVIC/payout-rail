/**
 * Sprint 4 — Table disposition (4a, plan §4 / §9).
 *
 * Cases:
 *  1  the four wired tables each receive rows through their real flows:
 *       - yellow_card_webhook_events ← handleYellowCardWebhook (journal)
 *       - on_chain_events            ← submitBurn + recordBurnConfirmation
 *       - external_status_snapshots  ← chain evidence recorders
 *       - manual_review_queue        ← moveToManualReview (+ ON CONFLICT guard)
 *  2  the removed tables (relay_wallet_activity, config_snapshots) are referenced
 *     NOWHERE under src/ (static scan) and are gone from migration 008.
 *
 * No network, no Postgres, no credentials: FakeDb + mock adapters.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { init, handleYellowCardWebhook } from '../../src/services/bos/disbursementService.js';
import { executeTransition } from '../../src/services/bos/stateMachine.js';
import { DisbursementState as S } from '../../src/services/bos/types.js';
import { createTestCtx } from '../helpers/ctx.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';

const VALID_CREATOR = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';

function makeRow(status, overrides = {}) {
  return {
    id: 'd-dead',
    status,
    amount_usdcx: 50_000_000,
    creator_address: VALID_CREATOR,
    external_tx_id: `0x${'1'.repeat(64)}`,
    attestation_id: 'att-mock-1',
    preflight_result: JSON.stringify({ ok: true, action: null, gate_results: [] }),
    last_error: null,
    error_message: null,
    ...overrides,
  };
}

function buildHarness(status, overrides = {}) {
  const db = createFakeDb();
  const adapters = createMockAdapters();
  const row = makeRow(status, overrides);
  adapters.xreserve.getAttestationStatus = async (id) => {
    adapters.xreserve.calls.getAttestationStatus.push(id);
    return { attestation_id: id, status: 'confirmed' };
  };

  db.when(/UPDATE disbursements\s+SET status = \$1/, ({ params }) => {
    row.status = params[0];
    return { changes: 1, rows: [] };
  });
  db.when(/^UPDATE disbursements SET ([\s\S]+?), updated_at = NOW\(\) WHERE id = \$\d+$/, ({ sql, params }) => {
    const body = sql.match(/^UPDATE disbursements SET ([\s\S]+?), updated_at = NOW\(\) WHERE id = \$\d+$/)[1];
    const tokens = [...body.matchAll(/([a-z_]+) = \$\d+/g)];
    tokens.forEach((m, i) => { row[m[1]] = params[i]; });
    return { changes: 1, rows: [] };
  });
  db.when(/SELECT \* FROM external_refs\s+WHERE disbursement_id = \$1/, ({ params }) =>
    params[2] === 'attestation_id'
      ? { identifier_value: 'att-mock-1', metadata: {} }
      : { identifier_value: 'yc-mock-1', metadata: {} });
  db.when(/FROM external_refs er\s+JOIN disbursements d ON d\.id = er\.disbursement_id/, () => ({
    disbursement_id: row.id,
    status: row.status,
    identifier_type: 'payout_id',
    identifier_value: 'yc-mock-1',
    external_system: 'yellowcard',
    metadata: {},
  }));
  db.when(/SELECT \* FROM disbursements WHERE id = \$1/, () => ({ ...row }));

  const ctx = createTestCtx({ db, adapters });
  return { db, adapters, row, ctx };
}

test('wired: submitBurn + recordBurnConfirmation write on_chain_events rows', async () => {
  const { db, ctx, row } = buildHarness(S.PREFLIGHT_CHECK, { preflight_result: JSON.stringify({ ok: true, action: null, gate_results: [] }) });

  await executeTransition(row, S.BURN_SUBMITTED, ctx);
  await executeTransition(row, S.BURN_CONFIRMED, ctx);

  const chain = db.callsMatching(/INSERT INTO on_chain_events/);
  assert.equal(chain.length, 2, 'broadcast + confirmation');
  assert.match(chain[0].sql, /'broadcast'|\$3/, 'broadcast event_type in SQL');
  assert.equal(chain[0].params[1], row.external_tx_id, 'broadcast tx hash');
  assert.match(chain[1].sql, /'confirmation'|\$3/, 'confirmation event_type in SQL');
  assert.equal(chain[1].params[1], row.external_tx_id, 'confirmation tx hash');
  assert.equal(chain[1].params[2], 1, 'block height carried on confirmation');
});

test('wired: chain evidence recorders write external_status_snapshots rows', async () => {
  const { db, ctx, row } = buildHarness(S.PREFLIGHT_CHECK, { preflight_result: JSON.stringify({ ok: true, action: null, gate_results: [] }) });

  await executeTransition(row, S.BURN_SUBMITTED, ctx);

  const snaps = db.callsMatching(/INSERT INTO external_status_snapshots/);
  assert.ok(snaps.length >= 2, 'recordTxHash snapshot + explicit broadcast snapshot');
  const statuses = snaps.map((s) => s.params[2]);
  assert.ok(statuses.includes('broadcast'), 'chain recorder snapshot status');
  assert.ok(statuses.includes('submitted'), 'explicit submitBurn snapshot status');
});

test('wired: handleYellowCardWebhook writes a yellow_card_webhook_events journal row', async () => {
  const { db, ctx, row } = buildHarness(S.YELLOWCARD_PAYOUT_SUBMITTED);
  await init(ctx);

  const result = await handleYellowCardWebhook({ payout_id: 'yc-mock-1', status: 'completed', reference: 'ref-dead' });
  assert.equal(result.processed, true, 'webhook advances the payout');

  const journal = db.callsMatching(/INSERT INTO yellow_card_webhook_events/);
  assert.equal(journal.length, 1, 'delivery journaled');
  assert.match(journal[0].sql, /'yellowcard'/, 'event_type yellowcard in SQL');
  const summary = JSON.parse(journal[0].params[2]);
  assert.equal(summary.event_id, 'ref-dead', 'derived event id journaled');
  assert.equal(summary.verified, false, 'direct call is unverified (no signature given)');
  assert.match(summary.payload_hash, /^sha256:/);
  assert.ok(!journal[0].params[2].includes('0123456789'), 'no raw body in the journal payload column');
});

test('wired: moveToManualReview enqueues with the ON CONFLICT open-row guard', async () => {
  const { db, ctx, row } = buildHarness(S.DESTINATION_RELEASE_UNOBSERVED, { last_error: 'u8226 release stale' });

  await executeTransition(row, S.MANUAL_REVIEW, ctx);

  const enqueues = db.callsMatching(/INSERT INTO manual_review_queue/);
  assert.equal(enqueues.length, 1, 'exactly one enqueue');
  const sql = enqueues[0].sql;
  assert.match(sql, /ON CONFLICT \(disbursement_id\) WHERE resolved = FALSE DO NOTHING/,
    'open-row guard present (partial unique index from migration 008)');
  assert.equal(enqueues[0].params[1], 'u8226 release stale', 'reason derives from last_error');
});

test('removed: relay_wallet_activity and config_snapshots referenced nowhere under src/', () => {
  const src = path.resolve('src');
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|sql)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const table of ['relay_wallet_activity', 'config_snapshots']) {
          if (text.includes(table)) hits.push(`${full}: ${table}`);
        }
      }
    }
  };
  walk(src);
  assert.deepEqual(hits, [], `dead tables still referenced: ${hits.join(', ')}`);

  const migration = fs.readFileSync(path.resolve('migrations/008_sprint_4.sql'), 'utf8');
  assert.ok(/DROP TABLE IF EXISTS relay_wallet_activity;/.test(migration), 'migration drops relay_wallet_activity');
  assert.ok(/DROP TABLE IF EXISTS config_snapshots;/.test(migration), 'migration drops config_snapshots');
});