/**
 * Sprint 5 — v1 public API route tests: GET /:id/receipt.
 *
 * Deterministic, mocked (FakeDb), no credentials, no network. The fixture rows
 * mirror test/unit/settlement-receipt.test.js so the assertions read the same
 * §7.1 envelope.
 *
 * Guardrails under test:
 *  - the wrapper returns the Sprint 4 generator's output verbatim (unmodified)
 *  - an unknown disbursement is a normalized 404, never a 500
 *  - the route path performs reads only
 *  - a non-settled final status is reported as fact, not fabricated
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { init } from '../../src/services/bos/disbursementService.js';
import { generateSettlementReceipt } from '../../src/services/bos/settlementReceipt.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createTestCtx } from '../helpers/ctx.js';
import { createV1Store, makeV1App, listen, snapshotEnv, restoreEnv } from '../helpers/v1Api.js';

function evidenceRow(id, type, status, payloadHash, createdAt) {
  return {
    id,
    evidence_type: type,
    evidence_data: JSON.stringify({ event_type: type, status, payload_hash: payloadHash }),
    recorded_by: 'system',
    created_at: createdAt,
  };
}

const SETTLED_ROW = {
  id: 'bos_settled_1',
  source_reference: 'campaign-x',
  amount_usdcx: 10_000_000,
  amount_ngn_expected: 5_123_400,
  status: 'settled',
  external_tx_id: '0x9b2acf',
  attestation_id: 'att_3c88',
  release_status: 'observed_confirmed',
  payout_id: 'sing_9f2d',
  created_at: '2026-09-22T09:58:00.000Z',
  settled_at: '2026-09-22T10:12:40.000Z',
};

const SETTLED_DATA = {
  external_refs: [
    { id: 1, external_system: 'stacks', identifier_type: 'tx_id', identifier_value: '0x9b2acf', metadata: {} },
    { id: 2, external_system: 'xreserve', identifier_type: 'attestation_id', identifier_value: 'att_3c88', metadata: {} },
    {
      id: 3,
      external_system: 'yellowcard',
      identifier_type: 'payout_id',
      identifier_value: 'sing_9f2d',
      metadata: {
        submitted_at: '2026-09-22T10:10:02.000Z',
        confirmed_at: '2026-09-22T10:11:30.000Z',
        external_settlement_reference: 'ext_ref_7k19',
      },
    },
  ],
  external_status_snapshots: [
    { id: 1, source: 'xreserve.attestation', status: 'confirmed', captured_at: '2026-09-22T10:05:00.000Z' },
    { id: 2, source: 'xreserve.observeDestinationRelease', status: 'observed_confirmed', captured_at: '2026-09-22T10:09:45.000Z' },
    { id: 3, source: 'yellowcard.lookupSend', status: 'completed', captured_at: '2026-09-22T10:11:30.000Z' },
  ],
  on_chain_events: [
    { id: 1, event_type: 'broadcast', tx_hash: '0x9b2acf', status: 'broadcast', created_at: '2026-09-22T10:00:00.000Z' },
    { id: 2, event_type: 'confirmation', tx_hash: '0x9b2acf', status: 'confirmed', created_at: '2026-09-22T10:04:12.000Z' },
  ],
  yellow_card_webhook_events: [
    {
      id: 1,
      disbursement_id: 'bos_settled_1',
      payment_id: 'ext_ref_7k19',
      event_type: 'yellowcard',
      payload: JSON.stringify({ status: 'completed', reference: 'ext_ref_7k19' }),
      created_at: '2026-09-22T10:11:30.000Z',
    },
  ],
  disbursement_evidence: [
    evidenceRow('evt-1', 'transition', { from: 'yellowcard_payout_confirmed', to: 'settled' }, 'sha256:ab12...', '2026-09-22T10:12:40.000Z'),
    evidenceRow('evt-2', 'webhook_payload', { result: 'confirmed' }, 'sha256:cd34...', '2026-09-22T10:11:31.000Z'),
  ],
};

const PENDING_ROW = {
  id: 'bos_pending_2',
  source_reference: 'campaign-y',
  amount_usdcx: 20_000_000,
  amount_ngn_expected: null,
  status: 'burn_confirmed',
  external_tx_id: '0xaa11',
  attestation_id: null,
  release_status: null,
  payout_id: null,
  created_at: '2026-09-22T08:00:00.000Z',
  settled_at: null,
};

test('v1 public API: settlement receipt (GET /:id/receipt)', async (t) => {
  const env = snapshotEnv();
  t.afterEach(() => restoreEnv(env));

  const db = createFakeDb();

  // Read-side handlers for the receipt generator over seeded tables. Registered
  // BEFORE createV1Store so their first-match-wins handlers are not shadowed by
  // the store's empty-array external_refs fallback.
  const tables = ['external_refs', 'external_status_snapshots', 'on_chain_events', 'yellow_card_webhook_events', 'disbursement_evidence'];
  for (const table of tables) db.seed(table, []);
  db.when(/FROM external_refs WHERE disbursement_id/, ({ db: d }) => d.table('external_refs'));
  db.when(/FROM external_status_snapshots WHERE disbursement_id/, ({ db: d }) => d.table('external_status_snapshots'));
  db.when(/FROM on_chain_events WHERE disbursement_id/, ({ db: d }) => d.table('on_chain_events'));
  db.when(/FROM yellow_card_webhook_events WHERE disbursement_id/, ({ db: d }) => d.table('yellow_card_webhook_events'));
  db.when(/FROM disbursement_evidence\s+WHERE disbursement_id = \$1/, ({ db: d }) => d.table('disbursement_evidence'));

  const store = createV1Store(db);

  const resetData = (data = {}) => {
    store.setRow(null);
    for (const [table, rows] of Object.entries(data)) {
      const arr = db.table(table);
      arr.length = 0;
      arr.push(...rows);
    }
  };

  const ctx = createTestCtx({ db, adapters: createMockAdapters() });
  await init(ctx);

  const app = makeV1App();
  const { base, close } = await listen(app);
  t.after(() => close());

  const headers = { 'content-type': 'application/json', authorization: 'Bearer secret-token' };
  const setAuth = () => {
    delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;
    process.env.BOS_API_TOKEN = 'secret-token';
  };

  await t.test('(9) GET receipt → 200 §7.1 envelope, byte-identical to the generator (unmodified)', async () => {
    setAuth();
    resetData(SETTLED_DATA);
    store.setRow(SETTLED_ROW);

    const res = await fetch(`${base}/api/v1/disbursements/bos_settled_1/receipt`, { headers });
    assert.equal(res.status, 200);
    const { receipt } = await res.json();

    const direct = await generateSettlementReceipt({ db, disbursementId: 'bos_settled_1' });
    assert.equal(JSON.stringify(receipt), JSON.stringify(direct), 'route output is the generator output, verbatim');

    assert.equal(receipt.schema_version, 1);
    assert.equal(receipt.reconstructed_from, 'evidence');
    assert.equal(receipt.final_status, 'settled');
    assert.equal(receipt.stacks_leg.burn_tx_hash, '0x9b2acf');
    assert.equal(receipt.settlement_reference.provider_payout_id, 'sing_9f2d');
    assert.deepEqual(receipt.gaps, []);
  });

  await t.test('(9) GET receipt → normalized 404 for an unknown disbursement (never a 500)', async () => {
    setAuth();
    resetData();
    store.reset();

    const res = await fetch(`${base}/api/v1/disbursements/does-not-exist/receipt`, { headers });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error_code, 'not_found');
  });

  await t.test('(9) GET receipt → reads only through the route (no INSERT/UPDATE)', async () => {
    setAuth();
    resetData(SETTLED_DATA);
    store.setRow(SETTLED_ROW);
    const callsBefore = db.calls.length;

    const res = await fetch(`${base}/api/v1/disbursements/bos_settled_1/receipt`, { headers });
    assert.equal(res.status, 200);
    const writes = db.calls.slice(callsBefore).filter((c) => c.method === 'run');
    assert.deepEqual(writes, [], 'the receipt path performs no writes');
  });

  await t.test('(9) GET receipt → a non-settled final status is reported as fact, not fabricated', async () => {
    setAuth();
    resetData({
      external_refs: SETTLED_DATA.external_refs.filter((r) => r.external_system === 'stacks'),
      external_status_snapshots: [],
      on_chain_events: [
        { id: 1, event_type: 'broadcast', tx_hash: '0xaa11', status: 'broadcast', created_at: '2026-09-22T08:01:00.000Z' },
        { id: 2, event_type: 'confirmation', tx_hash: '0xaa11', status: 'confirmed', created_at: '2026-09-22T08:02:00.000Z' },
      ],
      yellow_card_webhook_events: [],
      disbursement_evidence: [
        evidenceRow('evt-3', 'transition', { from: 'burn_submitted', to: 'burn_confirmed' }, 'sha256:11', '2026-09-22T08:02:00.000Z'),
      ],
    });
    store.setRow(PENDING_ROW);

    const res = await fetch(`${base}/api/v1/disbursements/bos_pending_2/receipt`, { headers });
    assert.equal(res.status, 200);
    const { receipt } = await res.json();
    assert.equal(receipt.final_status, 'burn_confirmed');
    assert.equal(receipt.timeline.settled_at, null);
    assert.equal(receipt.provider_leg.status, null, 'no fabricated provider status');
    assert.deepEqual(receipt.gaps, []);
  });
});