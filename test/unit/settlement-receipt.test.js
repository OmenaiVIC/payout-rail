/**
 * Sprint 4b — Settlement receipt: deterministic, evidence-reconstructable,
 * explicit gaps (plan §7).
 *
 * Cases:
 *  1  a fully-settled disbursement yields the §7.1 shape, gap-free, and the
 *     output is byte-identical across calls (no wall-clock fields)
 *  2  the receipt is constructed purely from stored rows — only SELECTs hit
 *     the db, no adapters, no writes
 *  3  missing evidence populates explicit `gaps` entries with the inspected
 *     evidence ids
 *  4  a non-settled final status is reported as fact (respecting the row's
 *     own status), not fabricated
 *
 * No network, no Postgres: FakeDb + generateSettlementReceipt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateSettlementReceipt } from '../../src/services/bos/settlementReceipt.js';
import { createFakeDb } from '../helpers/fakeDb.js';

function buildDb({ row, refs, snapshots, onChain, webhooks, evidence }) {
  const db = createFakeDb();
  db.seed('external_refs', refs);
  db.seed('external_status_snapshots', snapshots);
  db.seed('on_chain_events', onChain);
  db.seed('yellow_card_webhook_events', webhooks);
  db.seed('disbursement_evidence', evidence);

  db.when(/SELECT \* FROM disbursements WHERE id = \$1/, () => row);
  db.when(/FROM external_refs WHERE disbursement_id/, ({ db: d }) => d.table('external_refs'));
  db.when(/FROM external_status_snapshots WHERE disbursement_id/, ({ db: d }) => d.table('external_status_snapshots'));
  db.when(/FROM on_chain_events WHERE disbursement_id/, ({ db: d }) => d.table('on_chain_events'));
  db.when(/FROM yellow_card_webhook_events WHERE disbursement_id/, ({ db: d }) => d.table('yellow_card_webhook_events'));
  db.when(/FROM disbursement_evidence\s+WHERE disbursement_id = \$1/, ({ db: d }) => d.table('disbursement_evidence'));

  return db;
}

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

const SETTLED_EVIDENCE = [
  evidenceRow(
    'evt-1',
    'transition',
    { from: 'yellowcard_payout_confirmed', to: 'settled' },
    'sha256:ab12...',
    '2026-09-22T10:12:40.000Z'
  ),
  evidenceRow('evt-2', 'webhook_payload', { result: 'confirmed' }, 'sha256:cd34...', '2026-09-22T10:11:31.000Z'),
];

const SETTLED_REFS = [
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
];

const SETTLED_SNAPSHOTS = [
  { id: 1, source: 'xreserve.attestation', status: 'confirmed', captured_at: '2026-09-22T10:05:00.000Z' },
  { id: 2, source: 'xreserve.observeDestinationRelease', status: 'observed_confirmed', captured_at: '2026-09-22T10:09:45.000Z' },
  { id: 3, source: 'yellowcard.lookupSend', status: 'completed', captured_at: '2026-09-22T10:11:30.000Z' },
];

const SETTLED_ONCHAIN = [
  { id: 1, event_type: 'broadcast', tx_hash: '0x9b2acf', status: 'broadcast', created_at: '2026-09-22T10:00:00.000Z' },
  { id: 2, event_type: 'confirmation', tx_hash: '0x9b2acf', status: 'confirmed', created_at: '2026-09-22T10:04:12.000Z' },
];

const SETTLED_WEBHOOKS = [
  {
    id: 1,
    disbursement_id: 'bos_settled_1',
    payment_id: 'ext_ref_7k19',
    event_type: 'yellowcard',
    payload: JSON.stringify({ status: 'completed', reference: 'ext_ref_7k19' }),
    created_at: '2026-09-22T10:11:30.000Z',
  },
];

test('settlement receipt: complete settled receipt matches §7.1 and is deterministic across calls', async () => {
  const db = buildDb({
    row: SETTLED_ROW,
    refs: SETTLED_REFS,
    snapshots: SETTLED_SNAPSHOTS,
    onChain: SETTLED_ONCHAIN,
    webhooks: SETTLED_WEBHOOKS,
    evidence: SETTLED_EVIDENCE,
  });

  const receipt = await generateSettlementReceipt({ db, disbursementId: 'bos_settled_1' });
  const again = await generateSettlementReceipt({ db, disbursementId: 'bos_settled_1' });

  assert.deepEqual(receipt, again);
  assert.equal(JSON.stringify(receipt), JSON.stringify(again), 'byte-identical across calls (no wall-clock fields)');

  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.receipt_version, 1);
  assert.equal(receipt.reconstructed_from, 'evidence');
  assert.equal(receipt.bos_payout_id, 'bos_settled_1');
  assert.equal(receipt.final_status, 'settled');

  assert.deepEqual(receipt.settlement_reference, {
    provider: 'yellowcard',
    provider_payout_id: 'sing_9f2d',
    external_settlement_reference: 'ext_ref_7k19',
  });

  assert.deepEqual(receipt.stacks_leg, {
    burn_tx_hash: '0x9b2acf',
    usdcx_amount_base_units: '10000000',
    burn_status: 'confirmed',
    burn_confirmed_at: '2026-09-22T10:04:12.000Z',
    attestation_id: 'att_3c88',
    attestation_status: 'confirmed',
  });

  assert.deepEqual(receipt.release_leg, {
    release_status: 'observed_confirmed',
    observed_at: '2026-09-22T10:09:45.000Z',
  });

  assert.deepEqual(receipt.provider_leg, {
    status: 'confirmed',
    payout_submitted_at: '2026-09-22T10:10:02.000Z',
    payout_confirmed_at: '2026-09-22T10:11:30.000Z',
    ngn_amount: '5123400',
  });

  assert.equal(receipt.timeline.initiated_at, '2026-09-22T09:58:00.000Z');
  assert.equal(receipt.timeline.settled_at, '2026-09-22T10:12:40.000Z');
  assert.equal(receipt.evidence_refs.length, 2);
  assert.deepEqual(receipt.evidence_refs[0].status, { from: 'yellowcard_payout_confirmed', to: 'settled' });
  assert.deepEqual(receipt.gaps, []);
});

test('settlement receipt: built from stored rows only — reads, no writes, no adapters', async () => {
  const db = buildDb({
    row: SETTLED_ROW,
    refs: SETTLED_REFS,
    snapshots: SETTLED_SNAPSHOTS,
    onChain: SETTLED_ONCHAIN,
    webhooks: SETTLED_WEBHOOKS,
    evidence: SETTLED_EVIDENCE,
  });

  await generateSettlementReceipt({ db, disbursementId: 'bos_settled_1' });

  assert.ok(db.calls.length > 0);
  for (const call of db.calls) {
    assert.ok(['get', 'all'].includes(call.method), `receipt must not write: got ${call.method}`);
  }
});

test('settlement receipt: missing evidence produces explicit gaps with inspected ids', async () => {
  const db = buildDb({
    row: {
      ...SETTLED_ROW,
      attestation_id: null,
      release_status: null,
      payout_id: null,
    },
    refs: [
      SETTLED_REFS.find((r) => r.external_system === 'stacks'),
      {
        ...SETTLED_REFS.find((r) => r.external_system === 'yellowcard'),
        metadata: { submitted_at: '2026-09-22T10:10:02.000Z' },
      },
    ],
    snapshots: [],
    onChain: SETTLED_ONCHAIN,
    webhooks: [],
    evidence: SETTLED_EVIDENCE,
  });

  const receipt = await generateSettlementReceipt({ db, disbursementId: 'bos_settled_1' });

  assert.equal(receipt.final_status, 'settled', 'a settled row stays reported as settled');
  assert.equal(receipt.stacks_leg.attestation_id, null);
  assert.equal(receipt.release_leg.release_status, null);
  assert.equal(receipt.provider_leg.payout_confirmed_at, null);
  assert.equal(receipt.settlement_reference.external_settlement_reference, null, 'no external settlement ref on file');

  assert.ok(receipt.gaps.length >= 4, `expected explicit gaps, got ${receipt.gaps.length}`);
  assert.ok(receipt.gaps.some((g) => g.leg === 'release' && g.reason === 'no attestation_id persisted'));
  assert.ok(receipt.gaps.some((g) => g.leg === 'release' && /no release status/.test(g.reason)));
  assert.ok(receipt.gaps.some((g) => g.leg === 'provider' && /no external settlement reference/.test(g.reason)));
  assert.ok(receipt.gaps.some((g) => g.leg === 'provider' && /no payout confirmation/.test(g.reason)));

  const attestationGap = receipt.gaps.find((g) => g.reason === 'no attestation_id persisted');
  assert.deepEqual(attestationGap.evidence_ids_checked, [], 'attestation evidence never existed — inspected id list empty');
});

test('settlement receipt: a non-settled final status is reported as fact, not fabricated', async () => {
  const db = buildDb({
    row: {
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
    },
    refs: [{ id: 1, external_system: 'stacks', identifier_type: 'tx_id', identifier_value: '0xaa11', metadata: {} }],
    snapshots: [],
    onChain: [
      { id: 1, event_type: 'broadcast', tx_hash: '0xaa11', status: 'broadcast', created_at: '2026-09-22T08:01:00.000Z' },
      { id: 2, event_type: 'confirmation', tx_hash: '0xaa11', status: 'confirmed', created_at: '2026-09-22T08:02:00.000Z' },
    ],
    webhooks: [],
    evidence: [
      evidenceRow('evt-3', 'transition', { from: 'burn_submitted', to: 'burn_confirmed' }, 'sha256:11', '2026-09-22T08:02:00.000Z'),
    ],
  });

  const receipt = await generateSettlementReceipt({ db, disbursementId: 'bos_pending_2' });

  assert.equal(receipt.final_status, 'burn_confirmed');
  assert.equal(receipt.timeline.settled_at, null);
  assert.equal(receipt.stacks_leg.burn_status, 'confirmed');
  assert.equal(receipt.stacks_leg.burn_confirmed_at, '2026-09-22T08:02:00.000Z');
  assert.equal(receipt.provider_leg.status, null, 'provider leg not reached — no fabricated status');
  assert.equal(receipt.provider_leg.ngn_amount, null);
  assert.deepEqual(receipt.release_leg, { release_status: null, observed_at: null });
  assert.deepEqual(receipt.gaps, [], 'stopped state has no missing-evidence violation');
});