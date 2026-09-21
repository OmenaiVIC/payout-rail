/**
 * Sprint 1.5 — Duplicate-handling tests (04a Scope §3, plan §5).
 *
 * Cases:
 *  3  duplicate webhook delivery does not advance state twice
 *  4  worker tick on an already-advanced disbursement is a no-op for the burn leg
 *  5  worker restart mid-transition does not double-execute the burn
 *  6  retrying a burned payout does not create a second burn
 *  7  two concurrent advance attempts on the same disbursement
 *
 * No network, no Postgres, no credentials: FakeDb + mock adapters only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  init,
  advanceDisbursement,
  retryDisbursement,
  handleYellowCardWebhook,
} from '../../src/services/bos/disbursementService.js';
import * as pipelineWorker from '../../src/services/bos/pipelineWorker.js';
import { DisbursementState as S } from '../../src/services/bos/types.js';
import { createTestCtx } from '../helpers/ctx.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';

const VALID_CREATOR = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';
const VALID_BTC = 'bc1qexample000000000000000000000000000000000';
const AMOUNT_USDCX = 50_000_000;
const AMOUNT_USD = 50;
const RATE = 1650;

/** A fully pre-seeded disbursement row, advanced or parked by the test. */
function seededRow(overrides = {}) {
  return {
    id: 'd-dup',
    idempotency_key: 'dup',
    source_reference: 'dup-campaign-1',
    source_application: 'campaign',
    amount_usd: AMOUNT_USD,
    amount_usdcx: AMOUNT_USDCX,
    creator_address: VALID_CREATOR,
    creator_btc_address: VALID_BTC,
    recipient_bank_account: '0123456789',
    recipient_bank_code: '044',
    ngn_recipient: JSON.stringify({ account_number: '0123456789', bank_code: '044' }),
    status: S.DISBURSEMENT_INITIATED,
    metadata: '{}',
    amount_ngn_expected: 0,
    exchange_rate: 0,
    retry_count: 0,
    max_retries: 3,
    preflight_result: null,
    external_tx_id: null,
    attestation_id: null,
    release_id: null,
    payout_id: null,
    created_at: '2026-09-21T00:00:00Z',
    updated_at: '2026-09-21T00:00:00Z',
    ...overrides,
  };
}

/**
 * Harness for a single disbursement: live row + UPDATE handlers that keep the
 * row in sync (as executeTransition writes it), external_refs lookups, and the
 * rate row. Mirrors buildHarness() in mock-lifecycle.e2e.test.js.
 */
function buildHarness(rowSeeds = {}) {
  const db = createFakeDb();
  const adapters = createMockAdapters();
  const row = seededRow(rowSeeds);

  db.when(/SELECT \* FROM disbursements WHERE id = \$1/, ({ params }) => ({ ...row }));
  db.when(/FROM disbursements\s+WHERE status = ANY/, () => [{ ...row }]);
  db.when(/UPDATE disbursements\s+SET status = \$1/, ({ sql, params }) => {
    // CAS claim from executeTransition (WHERE id = $N AND status = $2): the row
    // is only claimed while it still sits in `fromState`. A concurrent advance
    // sees changes:0 here and bails without re-running the action.
    if (/WHERE id = \$\d+ AND status = \$2$/.test(sql.trimEnd())) {
      if (row.status !== params[1]) return { changes: 0, rows: [] };
      row.status = params[0];
      return { changes: 1, rows: [] };
    }
    // Retry reset / direct status writes: unconditional.
    row.status = params[0];
    return { changes: 1, rows: [] };
  });
  db.when(/^UPDATE disbursements SET ([\s\S]+?), updated_at = NOW\(\) WHERE id = \$\d+$/, ({ sql, params }) => {
    const body = sql.match(/^UPDATE disbursements SET ([\s\S]+?), updated_at = NOW\(\) WHERE id = \$\d+$/)[1];
    const tokens = [...body.matchAll(/([a-z_]+) = \$\d+/g)];
    tokens.forEach((m, i) => { row[m[1]] = params[i]; });
    return { changes: 1, rows: [] };
  });
  db.when(/SELECT rate FROM exchange_rates/, () => ({ rate: RATE }));

  const refs = {
    'xreserve|attestation_id': { identifier_value: 'att-mock-1', metadata: {} },
    'xreserve|release_id': { identifier_value: 'rel-mock-1', metadata: {} },
    'yellowcard|payout_id': { identifier_value: 'yc-mock-1', metadata: {} },
  };
  db.when(/FROM external_refs\s+WHERE disbursement_id = \$1/, ({ params }) =>
    refs[`${params[1]}|${params[2]}`] || null);

  // Webhook lookup joins the disbursement row for its current status.
  db.when(/JOIN disbursements d ON d\.id = er\.disbursement_id/, () => ({
    disbursement_id: row.id,
    status: row.status,
  }));

  return { db, adapters, row };
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 3 — duplicate webhook delivery
// ─────────────────────────────────────────────────────────────────────────────

test('case 3: duplicate webhook delivery does not advance state twice', async () => {
  const { db, adapters, row } = buildHarness({ status: S.YELLOWCARD_PAYOUT_SUBMITTED });
  const ctx = createTestCtx({ db, adapters });
  await init(ctx);

  const payload = { payout_id: 'yc-mock-1', status: 'completed' };
  const first = await handleYellowCardWebhook(payload);
  assert.equal(first.processed, true, 'first delivery advances to confirmed');
  assert.equal(row.status, S.YELLOWCARD_PAYOUT_CONFIRMED, 'payout confirmed after first delivery');

  const second = await handleYellowCardWebhook(payload);
  assert.equal(second.processed, false, 'second delivery is a no-op');
  assert.match(second.reason, /already applied/, 'second delivery explains itself');

  assert.equal(row.status, S.YELLOWCARD_PAYOUT_CONFIRMED, 'state did not advance on duplicate');
  assert.equal(adapters.yellowcard.calls.lookupSend.length, 2, 'guard + action each polled once, never again');
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 4 — worker tick on an already-advanced disbursement
// ─────────────────────────────────────────────────────────────────────────────

test('case 4: worker tick on an already-advanced disbursement never re-burns', async () => {
  const { db, adapters, row } = buildHarness({
    status: S.BURN_CONFIRMED,
    external_tx_id: `0x${String(1).padStart(64, '0')}`,
  });
  const ctx = createTestCtx({ db, adapters });
  await init(ctx);
  pipelineWorker.init(ctx);

  // The burn leg already happened before this tick (row is burn_confirmed).
  await pipelineWorker.runOnce();

  assert.equal(adapters.stacks.calls.burnUsdcx.length, 0, 'the burn is never re-submitted');
  assert.equal(row.status, S.ATTESTATION_REQUESTED, 'tick advanced to the attestation leg, not a re-burn');
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 5 — worker restart mid-transition
// ─────────────────────────────────────────────────────────────────────────────

test('case 5: worker restart mid-transition does not double-execute the burn', async () => {
  const { db, adapters, row } = buildHarness({
    status: S.PREFLIGHT_CHECK,
    preflight_result: JSON.stringify({ ok: true, action: null, gate_results: [] }),
    amount_ngn_expected: Math.round(AMOUNT_USD * RATE) * 100,
    exchange_rate: RATE,
  });
  const adaptersAfterRestart = createMockAdapters();

  // Tick 1: preflight_check → burn_submitted (the burn is broadcast once).
  const ctx1 = createTestCtx({ db, adapters });
  await init(ctx1);
  pipelineWorker.init(ctx1);
  await pipelineWorker.runOnce();
  assert.equal(adapters.stacks.calls.burnUsdcx.length, 1, 'burn broadcast by the first worker');
  assert.equal(row.status, S.BURN_SUBMITTED);

  // "Restart": a fresh ctx with fresh adapter instances, same database.
  row.external_tx_id = `0x${String(1).padStart(64, '0')}`; // chain has the burn (C-01 legacy)
  const ctx2 = createTestCtx({ db, adapters: adaptersAfterRestart });
  await init(ctx2);
  pipelineWorker.init(ctx2);
  await pipelineWorker.runOnce();

  assert.equal(row.status, S.BURN_CONFIRMED, 'restart advances the confirmation leg');
  assert.equal(adaptersAfterRestart.stacks.calls.burnUsdcx.length, 0, 'the restarted worker does not re-burn');
  assert.equal(adapters.stacks.calls.burnUsdcx.length, 1, 'the burn was broadcast exactly once overall');
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 6 — retrying a burned payout does not create a second burn
// ─────────────────────────────────────────────────────────────────────────────

test('case 6: retrying a burned payout does not create a second burn', async () => {
  const { db, adapters, row } = buildHarness({
    status: S.BURN_CONFIRMED,
    external_tx_id: `0x${String(1).padStart(64, '0')}`,
  });

  // The disbursement burned and then failed while waiting for attestation.
  row.status = S.FAILED;
  row.failed_at = '2026-09-21T01:00:00Z';
  db.when(/SELECT old_status FROM disbursement_audit/, () => ({ old_status: S.BURN_CONFIRMED }));
  db.when(/INSERT INTO external_refs/, () => ({ changes: 1, rows: [] }));
  db.when(/INSERT INTO disbursement_evidence/, () => ({ changes: 1, rows: [] }));

  const ctx = createTestCtx({ db, adapters });
  await init(ctx);

  // Seed exactly one historical burn broadcast on the mock (as if paid before fail).
  adapters.stacks.calls.burnUsdcx.push({ idempotencyKey: `burn:${row.id}` });

  const result = await retryDisbursement(row.id);
  assert.ok(result.success, `retry should advance: ${result.error}`);
  assert.ok(row.status !== S.BURN_SUBMITTED, 'a retry must not re-enter the burn submission leg');

  assert.equal(adapters.stacks.calls.burnUsdcx.length, 1, 'burn submitted exactly once across the whole survive+retry');
  assert.equal(adapters.stacks.calls.getTransactionStatus.length >= 1, true, 'confirmation polled during retry');
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 7 — two concurrent advance attempts on the same disbursement
// ─────────────────────────────────────────────────────────────────────────────

test('case 7: two concurrent advance attempts do not both execute the burn', async () => {
  const { db, adapters, row } = buildHarness({
    status: S.PREFLIGHT_CHECK,
    preflight_result: JSON.stringify({ ok: true, action: null, gate_results: [] }),
    amount_ngn_expected: Math.round(AMOUNT_USD * RATE) * 100,
    exchange_rate: RATE,
  });
  const ctx = createTestCtx({ db, adapters });
  await init(ctx);

  let a;
  let b;
  let threw = null;
  try {
    [a, b] = await Promise.all([advanceDisbursement(row.id), advanceDisbursement(row.id)]);
  } catch (err) {
    threw = err;
  }

  assert.equal(threw, null, 'concurrent advances must never throw');
  assert.equal(adapters.stacks.calls.burnUsdcx.length, 1, 'exactly one burn broadcast despite concurrent advances');
  assert.equal(row.status, S.BURN_SUBMITTED, 'the disbursement ends one step past preflight');

  const outcomes = [a, b];
  assert.equal(outcomes.filter((r) => r?.success).length, 1, 'exactly one advance wins the claim');
  const loser = outcomes.find((r) => r?.success === false);
  assert.ok(loser, 'the loser receives a result, not an exception');
  assert.equal(loser.error, 'already advanced', 'the loser is told the row already advanced');
  assert.equal(loser.already_advanced, true, 'loser result flags the benign no-op');
});