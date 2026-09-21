/**
 * G-01: Fail-closed preflight — guard persistence, verdict gating, and
 * manual-review escalation under executeTransition.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { executeTransition, canTransition, getValidNextStates } from '../../src/services/bos/stateMachine.js';
import { preflightPassed, preflightRequested } from '../../src/services/bos/transitionGuards.js';
import { DisbursementState as S } from '../../src/services/bos/types.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createTestCtx } from '../helpers/ctx.js';

const PASSING_VERDICT = { ok: true, action: null, gate_results: [] };
const FAILING_VERDICT = { ok: false, action: 'MANUAL_REVIEW_REQUIRED', gate_results: [{ gate: 'unit', ok: false, error_code: 'u9999' }] };
const FAILING_VERDICT_JSON = JSON.stringify(FAILING_VERDICT);

const disbursement = (overrides = {}) => ({
  id: 'd1-test',
  status: S.PREFLIGHT_CHECK,
  retry_count: 0,
  max_retries: 3,
  amount_usdcx: 1000,
  creator_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
  ...overrides,
});

// ── preflightRequested (entry guard) ─────────────────────────────────────────

test('preflightRequested rejects a missing disbursement', () => {
  assert.equal(preflightPassed(null, {}).ok, false);
  assert.equal(preflightRequested(null, {}).ok, false);
});

test('preflightRequested passes when disbursement exists', () => {
  assert.equal(preflightRequested(disbursement(), {}).ok, true);
});

// ── preflightPassed (verdict guard) ──────────────────────────────────────────

test('preflightPassed returns MANUAL_REVIEW_REQUIRED when no verdict', () => {
  const result = preflightPassed(disbursement(), {});
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'u8202');
  assert.equal(result.action, 'MANUAL_REVIEW_REQUIRED');
});

test('preflightPassed rejects a failing verdict', () => {
  const result = preflightPassed(disbursement({ preflight_result: FAILING_VERDICT }), {});
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'u8203');
  assert.equal(result.action, 'MANUAL_REVIEW_REQUIRED');
});

test('preflightPassed passes a passing verdict', () => {
  const result = preflightPassed(disbursement({ preflight_result: PASSING_VERDICT }), {});
  assert.equal(result.ok, true);
});

test('preflightPassed tolerates a JSON-stringified verdict', () => {
  const result = preflightPassed(disbursement({ preflight_result: FAILING_VERDICT_JSON }), {});
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'u8203');
});

test('preflightPassed tolerates the legacy plain string verdict (old format)', () => {
  const result = preflightPassed(disbursement({ preflight_result: 'passed' }), {});
  // Legacy 'passed' does not carry ok:true — treated as failure.
  assert.equal(result.ok, false);
});

// ── executeTransition persistence ────────────────────────────────────────────

test('executeTransition persists preflight_result as JSON on the disbursement row', async () => {
  const db = createFakeDb();
  db.when(/UPDATE disbursements\s+SET status = \$1/, () => ({ changes: 1, rows: [] }));
  const ctx = createTestCtx({ db, adapters: createMockAdapters() });

  // initiated→preflight_check runs runPreflightCheck which returns preflight_result
  const result = await executeTransition(
    disbursement({ status: S.DISBURSEMENT_INITIATED, preflight_result: undefined }),
    S.PREFLIGHT_CHECK,
    ctx,
    {}, 'test',
  );
  assert.equal(result.success, true);
  assert.equal(result.new_state, S.PREFLIGHT_CHECK);

  const call = db.findCall(/UPDATE disbursements SET preflight_result = \$4/);
  assert.ok(call, 'a preflight_result update was written');
  const parsed = JSON.parse(call.params[0]);
  assert.equal(typeof parsed.ok, 'boolean');
});

// ── bypass edge removed ──────────────────────────────────────────────────────

test('bypass edge disbursement_initiated→burn_submitted no longer exists', () => {
  assert.equal(canTransition(S.DISBURSEMENT_INITIATED, S.BURN_SUBMITTED), false);
  const next = getValidNextStates(S.DISBURSEMENT_INITIATED).map((n) => n.to);
  assert.ok(next.includes(S.PREFLIGHT_CHECK), 'preflight_check is still a valid next state');
  assert.ok(!next.includes(S.BURN_SUBMITTED), 'burn_submitted is no longer a valid next state');
});

// ── fail-closed escalation ──────────────────────────────────────────────────

test('executeTransition escalates to manual_review when the preflight verdict is failing', async () => {
  const db = createFakeDb();
  db.when(/UPDATE disbursements\s+SET status = \$1/, () => ({ changes: 1, rows: [] }));
  const ctx = createTestCtx({ db, adapters: createMockAdapters() });

  const result = await executeTransition(
    disbursement({ preflight_result: FAILING_VERDICT }),
    S.BURN_SUBMITTED,
    ctx, {}, 'test',
  );

  assert.equal(result.success, true);
  assert.equal(result.new_state, S.MANUAL_REVIEW);
  assert.equal(result.escalated_from_rejection, true);
  assert.equal(ctx.events[0]?.new_status, S.MANUAL_REVIEW);

  // A burn was never attempted.
  assert.equal(ctx.adapters.stacks.calls.burnUsdcx.length, 0);
  assert.equal(db.countMatching(/INSERT INTO external_refs/), 0);
});

test('executeTransition does NOT escalate when already in manual_review', async () => {
  const db = createFakeDb();
  const ctx = createTestCtx({ db, adapters: createMockAdapters() });

  // manual_review→burn_submitted is not a registered transition, so it returns
  // a hard failure rather than an escalation.
  const result = await executeTransition(
    disbursement({ status: S.MANUAL_REVIEW }),
    S.BURN_SUBMITTED,
    ctx, {}, 'test',
  );
  assert.equal(result.success, false);
  assert.equal(result.error_code, undefined);
});
