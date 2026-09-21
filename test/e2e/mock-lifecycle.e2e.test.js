/**
 * E2E — Full mock lifecycle (Sprint 0.5 acceptance #6, Sprint 2 G-08 model).
 *
 * Builds a ctx with FakeDb + mock stacks/xreserve/yellowcard adapters and
 * drives one disbursement from create to SETTLED (G-05). The destination
 * release leg now follows the corrected (G-08) model: the app parks in
 * destination_release_unobserved, records evidence exactly as a latched mock
 * settlement surface emits it (pending → confirmed), and pays out only on a
 * persisted observed_confirmed — it never fabricates the release.
 *
 * No network, no Postgres, no credentials: the default suite stays green.
 *
 * Fidelity gap (reported, not hidden): the latched evidence source proves the
 * state machine coerces evidence — not that real xReserve settlement behaves
 * like the mock. The real observation surface stays UNVERIFIED (see
 * xreserveAdapter.observeDestinationRelease).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { init, initiateDisbursement, advanceDisbursement, getDisbursement } from '../../src/services/bos/disbursementService.js';
import { DisbursementState as S } from '../../src/services/bos/types.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createMockEvidenceSource } from '../helpers/mockExternalEvidence.js';
import { createTestCtx } from '../helpers/ctx.js';

const VALID_CREATOR = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';
const VALID_BTC = 'bc1qexample000000000000000000000000000000000';
const AMOUNT_USDCX = 50_000_000; // 50 USDCx @ 6dp
const AMOUNT_USD = 50; // below the 2-of-N threshold (>= 1000)
const RATE = 1650;
const EXPECTED_NGN_KOBO = Math.round(50 * RATE) * 100; // 8_250_000

/**
 * Build the full pipeline harness:
 *  - a live `row` object (SELECT * FROM disbursements WHERE id = $1) kept in
 *    sync with the status + persisted-field UPDATEs executedTransition issues,
 *  - the external_refs lookups guards/actions perform,
 *  - the escrow/gate seeds payout gates need,
 *  - mock adapters overridden to return the 'confirmed' statuses the guards read,
 *  - a latched mock settlement surface (observeDestinationRelease) the test
 *    scripts with emitReleaseEvidence(id, status) — the ONLY way evidence exists.
 */
function buildHarness() {
  const db = createFakeDb();
  const adapters = createMockAdapters();
  const evidenceSource = createMockEvidenceSource();

  // xReserve attestation guard requires status 'confirmed' (mock default is 'complete').
  adapters.xreserve.getAttestationStatus = async (id) => {
    adapters.xreserve.calls.getAttestationStatus.push(id);
    return { attestation_id: id, status: 'confirmed' };
  };

  // G-08: evidence exists only where the test scripts it; default = unobserved.
  adapters.xreserve.observeDestinationRelease = async (params) => {
    adapters.xreserve.calls.observeDestinationRelease.push(params);
    return evidenceSource.observe(params);
  };

  const row = {
    id: 'd-e2e',
    idempotency_key: 'e2e',
    source_reference: 'e2e-campaign-1',
    source_application: 'campaign',
    amount_usd: AMOUNT_USD,
    amount_usdcx: AMOUNT_USDCX,
    creator_address: VALID_CREATOR,
    creator_btc_address: VALID_BTC,
    recipient_bank_account: '0123456789',
    recipient_bank_code: '044',
    ngn_recipient: JSON.stringify({ account_number: '0123456789', bank_code: '044', type: 'bank_account' }),
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
  };

  // ── Row read / write handlers (kept consistent with executeTransition) ──
  // Create INSERT populates the row object (FakeDb does not replay SQL).
  db.when(/^INSERT INTO disbursements \(([\s\S]*?)\)\s+VALUES/, ({ sql, params }) => {
    const cols = sql.match(/^INSERT INTO disbursements \(([\s\S]*?)\)\s+VALUES/)[1].split(',').map((c) => c.trim());
    cols.forEach((col, i) => {
      if (params[i] !== undefined && !['last_heartbeat_at', 'created_at', 'updated_at'].includes(col)) {
        row[col] = params[i];
      }
    });
    return { changes: 1, rows: [] };
  });

  db.when(/SELECT \* FROM disbursements WHERE id = \$1/, () => ({ ...row }));
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

  // ── Rate lookup: a valid rate exists before create (G-04). ─────────────
  db.when(/SELECT rate FROM exchange_rates/, () => ({ rate: RATE }));

  // ── external_refs lookups (guards + confirmation actions). ──────────────
  // Values mirror what the mock adapters generate, so confirmation actions and
  // guards agree on the ids even though FakeDb does not replay the upserts.
  // `release_id` is retired (G-08): no action writes or looks it up.
  const refs = {
    'xreserve|attestation_id': { external_system: 'xreserve', identifier_type: 'attestation_id', identifier_value: 'att-mock-1', metadata: {} },
    'yellowcard|payout_id': { external_system: 'yellowcard', identifier_type: 'payout_id', identifier_value: 'yc-mock-1', metadata: {} },
  };
  db.when(/SELECT \* FROM external_refs\s+WHERE disbursement_id = \$1/, ({ params }) =>
    refs[`${params[1]}|${params[2]}`] || null);

  // ── Payout-gate seeds. The campaign escrows the exact payout amount. ────
  db.when(/SELECT d\.id FROM disbursements d WHERE d\.source_reference/, () => ({ id: 'd-escrow' }));
  db.when(/as total_disbursed/, () => ({ total_disbursed: 0 }));
  db.when(/as total_funded/, () => ({ total_funded: AMOUNT_USDCX }));

  return { db, adapters, row, emitReleaseEvidence: evidenceSource.emit };
}

/**
 * Drive the disbursement through every hop asserting the row/view at each step.
 * The release leg is driven by a latched mock settlement surface: the test must
 * script evidence (emitReleaseEvidence) or the row stays parked.
 */
async function assertFullLifecycle({ db, adapters, row, emitReleaseEvidence }) {
  const ctx = createTestCtx({ db, adapters });
  await init(ctx);

  const created = await initiateDisbursement({
    source_reference: 'e2e-campaign-1',
    amount_usd: AMOUNT_USD,
    amount_usdcx: AMOUNT_USDCX,
    creator_address: VALID_CREATOR,
    creator_btc_address: VALID_BTC,
    recipient_bank_account: '0123456789',
    recipient_bank_code: '044',
    ngn_recipient: { account_number: '0123456789', bank_code: '044' },
  });

  // G-04: both fields populated at create.
  assert.equal(created.amount_ngn_expected, EXPECTED_NGN_KOBO, 'amount_ngn_expected in kobo at create');
  assert.equal(created.exchange_rate, RATE, 'exchange_rate resolved at create');
  assert.equal(created.status, S.PREFLIGHT_CHECK, 'create runs initiated → preflight_check');

  const id = created.id;

  // ── Legs before the destination release (burn → attestation). ──────────
  const preRelease = [
    [S.BURN_SUBMITTED, 'external_tx_id'],
    [S.BURN_CONFIRMED, null],
    [S.ATTESTATION_REQUESTED, 'attestation_id'],
    [S.ATTESTATION_CONFIRMED, null],
  ];

  for (const [nextState, idColumn] of preRelease) {
    const result = await advanceDisbursement(id);
    assert.ok(result?.success, `advance → ${nextState} failed: ${result?.error}`);
    assert.equal(result.new_state, nextState);

    const view = await getDisbursement(id);
    assert.equal(view.status, nextState, 'row status advanced in the db');
    if (idColumn) {
      assert.ok(view[idColumn], `${idColumn} persisted before/at ${nextState}`);
    }
  }

  // ── G-08 destination release leg: observed, never fabricated. ───────────
  const unobserved = await advanceDisbursement(id);
  assert.ok(unobserved?.success, `advance → unobserved failed: ${unobserved?.error}`);
  assert.equal(unobserved.new_state, S.DESTINATION_RELEASE_UNOBSERVED);
  let view = await getDisbursement(id);
  assert.equal(view.status, S.DESTINATION_RELEASE_UNOBSERVED);
  assert.equal(view.release_status, 'unobserved', 'release_status pinned unobserved on entry');
  assert.equal(adapters.xreserve.calls.observeDestinationRelease.length, 0,
    'beginning the observation makes NO external call (nothing is requested)');

  // The external settlement surface emits "pending" evidence.
  emitReleaseEvidence(id, 'observed_pending');
  const observed = await advanceDisbursement(id);
  assert.ok(observed?.success, `advance → observed failed: ${observed?.error}`);
  assert.equal(observed.new_state, S.DESTINATION_RELEASE_OBSERVED);
  view = await getDisbursement(id);
  assert.equal(view.status, S.DESTINATION_RELEASE_OBSERVED);
  assert.equal(view.release_status, 'observed_pending', 'evidence persisted exactly as observed');

  // The settlement surface reports the release completed.
  emitReleaseEvidence(id, 'observed_confirmed');
  const confirmed = await advanceDisbursement(id);
  assert.ok(confirmed?.success, `advance → confirmed failed: ${confirmed?.error}`);
  assert.equal(confirmed.new_state, S.DESTINATION_RELEASE_CONFIRMED);
  view = await getDisbursement(id);
  assert.equal(view.status, S.DESTINATION_RELEASE_CONFIRMED);
  assert.equal(view.release_status, 'observed_confirmed', 'confirmation persisted only from evidence');

  // ── Payout + settlement legs. ───────────────────────────────────────────
  const postRelease = [
    [S.YELLOWCARD_PAYOUT_SUBMITTED, 'payout_id'],
    [S.YELLOWCARD_PAYOUT_CONFIRMED, null],
    [S.SETTLED, null],
  ];

  for (const [nextState, idColumn] of postRelease) {
    const result = await advanceDisbursement(id);
    assert.ok(result?.success, `advance → ${nextState} failed: ${result?.error}`);
    assert.equal(result.new_state, nextState);

    const v = await getDisbursement(id);
    assert.equal(v.status, nextState, 'row status advanced in the db');
    if (idColumn) {
      assert.ok(v[idColumn], `${idColumn} persisted before/at ${nextState}`);
    }
  }

  const settled = await getDisbursement(id);
  assert.equal(settled.status, S.SETTLED);
  assert.ok(settled.settled_at, 'settled_at recorded');
  assert.equal(settled.external_tx_id, `0x${String(1).padStart(64, '0')}`, 'burn tx id persisted');
  assert.equal(settled.attestation_id, 'att-mock-1', 'attestation id persisted');
  assert.equal(settled.payout_id, 'yc-mock-1', 'payout id persisted');
  assert.equal(settled.release_id, null, 'no fabricated release_id was ever written (G-08)');
  assert.equal(settled.release_status, 'observed_confirmed', 'release observation persisted to settlement');

  // G-05 columns persisted even if advance is called again on a terminal row.
  assert.equal(await advanceDisbursement(id), null, 'terminal state has nothing to advance');

  assert.equal(adapters.stacks.calls.burnUsdcx.length, 1, 'burn submitted exactly once');
  assert.ok(adapters.stacks.calls.getTransactionStatus.length >= 2, 'chain polled until confirmed');
  assert.equal(adapters.yellowcard.calls.submitSend.length, 1, 'payout submitted exactly once');
  assert.equal(adapters.yellowcard.calls.lookupSend.length, 2, 'guard + action poll yellowcard');
  assert.ok(adapters.xreserve.calls.observeDestinationRelease.length >= 4,
    'the observation surface was polled for every advance (never once for the begin)');

  // Evidence chain holds the burn tx hash + API responses (incl. observations).
  assert.ok(db.countMatching(/INSERT INTO disbursement_evidence/) >= 4, 'evidence rows recorded');
  assert.ok(db.findCall(/INSERT INTO external_refs/), 'external refs written');

  return settled;
}

test('E2E: full mock lifecycle drives one payout to SETTLED', async () => {
  const harness = buildHarness();
  const settled = await assertFullLifecycle(harness);
  assert.equal(settled.status, S.SETTLED);
});

const ENV_KEYS = ['BOS_MAX_PER_DISBURSEMENT_USD', 'BOS_DAILY_PAYOUT_CAP_USD'];

test('E2E: failed preflight stops at MANUAL_REVIEW and never burns', async () => {
  const snapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    process.env.BOS_MAX_PER_DISBURSEMENT_USD = '0.01'; // per-disbursement cap fails
    delete process.env.BOS_DAILY_PAYOUT_CAP_USD;

    const { db, adapters, row } = buildHarness();
    const ctx = createTestCtx({ db, adapters });
    await init(ctx);

    const created = await initiateDisbursement({
      source_reference: 'e2e-campaign-1',
      amount_usd: AMOUNT_USD,
      amount_usdcx: AMOUNT_USDCX,
      creator_address: VALID_CREATOR,
      creator_btc_address: VALID_BTC,
      recipient_bank_account: '0123456789',
      recipient_bank_code: '044',
      ngn_recipient: { account_number: '0123456789', bank_code: '044' },
    });

    assert.equal(created.status, S.PREFLIGHT_CHECK, 'create still reaches preflight_check');

    // The preflight verdict persisted on the row says the gates failed.
    const verdict = JSON.parse(created.preflight_result);
    assert.equal(verdict.ok, false, 'preflight verdict records the failure');
    assert.equal(verdict.action, 'MANUAL_REVIEW_REQUIRED');

    const advanced = await advanceDisbursement(created.id);
    assert.equal(advanced?.new_state, S.MANUAL_REVIEW, failedMsg(advanced));
    assert.equal(advanced.escalated_from_rejection, true, 'guard failure escalated to manual review');

    const view = await getDisbursement(created.id);
    assert.equal(view.status, S.MANUAL_REVIEW, 'row is parked in manual_review');
    assert.equal(adapters.stacks.calls.burnUsdcx.length, 0, 'the burn was never submitted');
  } finally {
    for (const k of ENV_KEYS) {
      if (snapshot[k] !== undefined) process.env[k] = snapshot[k];
      else delete process.env[k];
    }
  }
});

function failedMsg(result) {
  return `advance failed: ${result?.error || JSON.stringify(result)}`;
}