/**
 * Shared test harness for the v1 public disbursement API
 * (test/unit/public-api-*.test.js).
 *
 * Provides:
 *  - VALID_BODY — a create payload that passes the service's fail-closed checks
 *  - createV1Store(db) — FakeDb handlers that mirror the disbursement table for
 *    the route-driven flow (create / get / list / advance / retry / recover and
 *    the PERSISTED_ACTION_FIELDS writes of the state machine)
 *  - makeV1App() / listen() — the v1 router over a real HTTP listener
 *  - wireApprovals(db) — FakeDb handlers for the two_person_approvals table
 *
 * Auth decisions (BOS_API_TOKEN / BOS_ALLOW_UNAUTHENTICATED_DEV) belong to each
 * test file (they snapshot/restore process.env like disbursements-routes.test.js).
 */

import express from 'express';
import router from '../../src/routes/disbursementsV1.js';

export const VALID_BODY = {
  source_reference: 'camp-1',
  source_application: 'test-app',
  amount_usd: 25,
  amount_usdcx: 25_000_000,
  creator_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
  creator_btc_address: 'bc1qexample000000000000000000000000000000000',
  recipient_bank_account: '0123456789',
  recipient_bank_code: '044',
  ngn_recipient: { bankCode: '044', accountNumber: '0123456789' },
};

/**
 * Register FakeDb handlers that emulate the `disbursements` table for the
 * route-driven flow. `presetRow` seeds an existing row (e.g. for the 409
 * guard-rejection and wrong-state tests).
 */
export function createV1Store(db, { presetRow = null } = {}) {
  let row = presetRow;

  // G-04: a seeded USDCx/NGN rate is required for creation to succeed.
  db.when(/SELECT rate FROM exchange_rates/, () => ({ rate: 1650 }));

  // Idempotency lookup: a duplicate create (same deterministic key) hits the
  // existing row and is NOT inserted again.
  db.when(/SELECT \* FROM disbursements WHERE idempotency_key = \$1/, ({ params }) => (
    row && row.idempotency_key === params[0] ? row : null
  ));

  db.when(/INSERT INTO disbursements/, ({ params }) => {
    row = {
      id: params[0],
      idempotency_key: params[1],
      source_reference: params[2],
      source_application: params[3],
      amount_usd: params[4],
      amount_usdcx: params[5],
      creator_address: params[6],
      creator_btc_address: params[7],
      recipient_bank_account: params[8],
      recipient_bank_code: params[9],
      ngn_recipient: params[10],
      status: params[11],
      metadata: params[12],
      amount_ngn_expected: params[13],
      exchange_rate: params[14],
      retry_count: 0,
      max_retries: 3,
      error_message: null,
      last_error: null,
      release_status: null,
      created_at: '2026-09-22T10:00:00.000Z',
      updated_at: '2026-09-22T10:00:00.000Z',
    };
    return { changes: 1, rows: [] };
  });

  db.when(/SELECT \* FROM disbursements WHERE id = \$1/, ({ params }) => (
    row && row.id === params[0] ? { ...row } : null
  ));
  db.when(/SELECT id FROM disbursements WHERE id = \$1/, ({ params }) => (
    row && row.id === params[0] ? { id: row.id } : null
  ));

  // Optimistic-concurrency claim (executeTransition).
  db.when(/UPDATE disbursements\s+SET status = \$1/, ({ params }) => {
    if (row) row.status = params[0];
    return { changes: row ? 1 : 0, rows: [] };
  });

  // PERSISTED_ACTION_FIELDS writes — apply onto the row for status assertions.
  const scalarFields = {
    settled_at: (v) => { row.settled_at = v; },
    failed_at: (v) => { row.failed_at = v; },
    cancelled_at: (v) => { row.cancelled_at = v; },
    manual_review_at: (v) => { row.manual_review_at = v; },
    external_tx_id: (v) => { row.external_tx_id = v; },
    attestation_id: (v) => { row.attestation_id = v; },
    payout_id: (v) => { row.payout_id = v; },
    release_status: (v) => { row.release_status = v; },
  };
  db.when(/UPDATE disbursements SET (settled_at|failed_at|cancelled_at|manual_review_at|external_tx_id|attestation_id|payout_id|release_status) = \$4/, ({ params, sql }) => {
    const field = /UPDATE disbursements SET (\w+) = \$4/.exec(sql);
    if (field && scalarFields[field[1]]) scalarFields[field[1]](params[0]);
    return { changes: 1, rows: [] };
  });

  db.when(/UPDATE disbursements SET preflight_result = \$4/, ({ params }) => {
    if (row) row.preflight_result = params[0];
    return { changes: 1, rows: [] };
  });

  db.when(/UPDATE disbursements SET error_message/, () => ({ changes: 1, rows: [] }));
  db.when(/UPDATE manual_review_queue/, () => ({ changes: 1, rows: [] }));

  // getDisbursement enrichment.
  db.when(/FROM external_refs WHERE disbursement_id/, () => []);
  db.when(/FROM disbursement_audit WHERE disbursement_id/, () => []);

  // listDisbursements.
  db.when(/SELECT \* FROM disbursements\s+ORDER BY created_at DESC/, () => (row ? [{ ...row }] : []));
  db.when(/SELECT COUNT\(\*\) as total FROM disbursements/, () => ({ total: row ? 1 : 0 }));

  return {
    get row() { return row; },
    setRow(next) { row = next; },
    reset() { row = null; },
  };
}

/**
 * Register FakeDb handlers that emulate the two_person_approvals table
 * (disbursement_id, approver_address, UNIQUE pair). Returns a live array of
 * approved pairs plus the handler for counting.
 */
export function wireApprovals(db) {
  const approvals = [];
  db.when(/SELECT id FROM two_person_approvals WHERE disbursement_id = \$1 AND approver_address = \$2/, ({ params }) => {
    const found = approvals.find((r) => r.disbursement_id === params[0] && r.approver_address === params[1]);
    return found ? { id: found.id } : null;
  });
  db.when(/INSERT INTO two_person_approvals/, ({ params }) => {
    const present = approvals.some((r) => r.disbursement_id === params[0] && r.approver_address === params[1]);
    if (!present) {
      approvals.push({ id: approvals.length + 1, disbursement_id: params[0], approver_address: params[1] });
      return { changes: 1, rows: [] };
    }
    return { changes: 0, rows: [] };
  });
  db.when(/SELECT COUNT\(\*\) as cnt FROM two_person_approvals WHERE disbursement_id = \$1/, ({ params }) => ({
    cnt: approvals.filter((r) => r.disbursement_id === params[0]).length,
  }));
  return { approvals };
}

export function makeV1App() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/disbursements', router);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

export async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

export const ENV_KEYS = ['BOS_API_TOKEN', 'BOS_ALLOW_UNAUTHENTICATED_DEV'];

export function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

export function restoreEnv(snapshot) {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}