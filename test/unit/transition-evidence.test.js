/**
 * Sprint 4 — Canonical transition evidence (4a, plan §2.5 / D1).
 *
 * Cases:
 *  1  every successful transition writes EXACTLY ONE `transition` evidence record
 *     — including the six actions that previously wrote none (recordBurnConfirmation,
 *     beginReleaseObservation, moveToManualReview, markFailed, markSettled,
 *     markCancelled)
 *  2  the record fieldset is {status:{from,to}, verification:{ok:true,method:'guard'},
 *     details:{triggered_by, action}} and is written AFTER the audit emitEvent
 *  3  a guard-rejected transition writes NO transition evidence
 *  4  evidence is canonical-count-stable even when a supplementary writer
 *     (tx_hash) also fires — the transition INSERT count stays at one
 *
 * No network, no Postgres, no credentials: FakeDb + mock adapters + executeTransition.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { executeTransition } from '../../src/services/bos/stateMachine.js';
import { DisbursementState as S } from '../../src/services/bos/types.js';
import { createTestCtx } from '../helpers/ctx.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';

const VALID_CREATOR = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';

function makeRow(status, overrides = {}) {
  return {
    id: 'd-trans',
    status,
    amount_usdcx: 50_000_000,
    creator_address: VALID_CREATOR,
    external_tx_id: null,
    attestation_id: null,
    preflight_result: null,
    last_error: null,
    error_message: null,
    ...overrides,
  };
}

/**
 * Harness: keeps `row` in sync with executeTransition's claim + field UPDATEs,
 * answers guard/action external-ref lookups, and pushes an emitEvent marker into
 * db.calls so tests can prove the audit row precedes the transition evidence.
 */
function buildHarness(row) {
  const db = createFakeDb();
  const adapters = createMockAdapters();
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
    params[2] === 'attestation_id' ? { identifier_value: 'att-mock-1', metadata: {} } : null);

  const ctx = createTestCtx({
    db,
    adapters,
    emitEvent: async (event) => {
      db.calls.push({ method: 'emitEvent', sql: `AUDIT ${event.old_status}->${event.new_status}`, params: [event] });
    },
  });

  return { db, adapters, row, ctx };
}

function transitionInserts(db) {
  return db.callsMatching(/INSERT INTO disbursement_evidence/).filter(
    (c) => c.params[2] === 'transition'
  );
}

async function runTransition(row, toState, ctx, triggeredBy = 'worker', override = {}) {
  return executeTransition(row, toState, ctx, override, triggeredBy);
}

for (const { from, to, desc, rowOverrides } of [
  { from: S.BURN_SUBMITTED, to: S.BURN_CONFIRMED, desc: 'recordBurnConfirmation', rowOverrides: { external_tx_id: `0x${'1'.repeat(64)}` } },
  { from: S.ATTESTATION_CONFIRMED, to: S.DESTINATION_RELEASE_UNOBSERVED, desc: 'beginReleaseObservation' },
  { from: S.MANUAL_REVIEW, to: S.FAILED, desc: 'markFailed' },
  { from: S.MANUAL_REVIEW, to: S.SETTLED, desc: 'markSettled' },
  { from: S.MANUAL_REVIEW, to: S.CANCELLED, desc: 'markCancelled' },
  { from: S.DESTINATION_RELEASE_UNOBSERVED, to: S.MANUAL_REVIEW, desc: 'moveToManualReview' },
]) {
  test(`transition: ${desc} writes exactly one canonical transition record`, async () => {
    const row = makeRow(from, rowOverrides);
    const { db, ctx } = buildHarness(row);

    const result = await runTransition(row, to, ctx, 'operator');
    assert.ok(result.success, `${from} → ${to} should succeed: ${result.error}`);
    assert.equal(result.new_state, to);
    assert.equal(row.status, to);

    const records = transitionInserts(db);
    assert.equal(records.length, 1, 'exactly one transition evidence record');
    const envelope = JSON.parse(records[0].params[3]);
    assert.deepEqual(envelope.status, { from, to });
    assert.equal(envelope.event_type, 'transition');
    assert.equal(envelope.source, 'bos.state_machine');
    assert.deepEqual(envelope.verification, { ok: true, method: 'guard' });
    assert.equal(envelope.details.triggered_by, 'operator');
    assert.equal(envelope.details.action, `${from}→${to}`);

    // Ordering: the audit emitEvent marker precedes the transition evidence INSERT.
    const auditIdx = db.calls.findIndex((c) => c.method === 'emitEvent' && c.sql === `AUDIT ${from}->${to}`);
    const evidenceIdx = db.calls.indexOf(records[0]);
    assert.ok(auditIdx !== -1, 'audit event emitted');
    assert.ok(auditIdx < evidenceIdx, 'evidence written after the audit emitEvent');
  });
}

test('transition: submitBurn adds one transition record alongside its tx_hash writer', async () => {
  const row = makeRow(S.PREFLIGHT_CHECK, {
    preflight_result: JSON.stringify({ ok: true, action: null, gate_results: [] }),
  });
  const { db, ctx } = buildHarness(row);

  const result = await runTransition(row, S.BURN_SUBMITTED, ctx);
  assert.ok(result.success, result.error);

  const all = db.callsMatching(/INSERT INTO disbursement_evidence/);
  assert.ok(all.some((c) => c.params[2] === 'tx_hash'), 'supplementary tx_hash evidence present');
  assert.equal(transitionInserts(db).length, 1, 'but only one transition record');
});

test('transition: a guard-rejected transition writes no transition evidence', async () => {
  // isBurnConfirmed rejects: no external_tx_id on record.
  const row = makeRow(S.BURN_SUBMITTED, { external_tx_id: null });
  const { db, ctx } = buildHarness(row);

  const result = await runTransition(row, S.BURN_CONFIRMED, ctx);
  assert.equal(result.success, false);
  assert.equal(row.status, S.BURN_SUBMITTED, 'state untouched');
  assert.equal(transitionInserts(db).length, 0, 'no transition record on a rejected guard');
});