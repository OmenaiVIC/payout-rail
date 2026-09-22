/**
 * Sprint 4 — Evidence recorder correctness (4a, §9).
 *
 * Cases:
 *  1  every record is a complete v1 envelope (all fields)
 *  2  payload_hash present and the RAW payload absent (hash-not-payload)
 *  3  PII / sensitive fields never appear in evidence_data
 *  4  external-observation recorders also write one external_status_snapshots row
 *  5  recordManualNote / recordPollResult are wired and envelope-compliant
 *  6  getEvidence orders by (created_at, id) and parses the data column
 *
 * No network, no Postgres, no credentials: FakeDb only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  recordApiResponse,
  recordTxHash,
  recordWebhookPayload,
  recordManualNote,
  recordGateResult,
  recordPollResult,
  recordTransitionEvidence,
  getEvidence,
  deriveWebhookEventId,
  hashPayload,
} from '../../src/services/bos/evidenceCollector.js';
import { createFakeDb } from '../helpers/fakeDb.js';

const ENVELOPE_KEYS = ['v', 'event_type', 'source', 'external_ref', 'observed_at', 'status', 'payload_hash', 'verification', 'details'];

/** Last disbursement_evidence INSERT call's parsed data + raw params. */
function lastEvidenceInsert(db) {
  const calls = db.callsMatching(/INSERT INTO disbursement_evidence/);
  assert.ok(calls.length > 0, 'expected at least one evidence insert');
  const call = calls[calls.length - 1];
  return {
    params: call.params,
    envelope: JSON.parse(call.params[3]),
    raw: call.params[3],
  };
}

test('envelope: every recorder emits a complete v1 envelope and a uuid id', async () => {
  const db = createFakeDb();

  await recordManualNote({ db, disbursementId: 'd-1', reviewer: 'ops@example.com', note: 'manual check passed' });
  let { params, envelope } = lastEvidenceInsert(db);
  assert.equal(params[1], 'd-1');
  assert.equal(params[2], 'manual_note');
  assert.equal(params[4], 'ops@example.com', 'manual notes are recorded by the reviewer');
  assert.ok(crypto.randomUUID && typeof params[0] === 'string' && params[0].length === 36, 'uuid-shaped id');
  assert.deepEqual(Object.keys(envelope).sort(), [...ENVELOPE_KEYS].sort(), 'complete envelope');
  assert.equal(envelope.v, 1);
  assert.equal(envelope.event_type, 'manual_note');
  assert.match(envelope.payload_hash, /^sha256:[0-9a-f]{64}$/, 'deterministic payload hash');
  assert.ok(!Number.isNaN(Date.parse(envelope.observed_at)), 'observed_at is a timestamp');
  assert.equal(envelope.external_ref, null);
  assert.deepEqual(envelope.verification, null);

  await recordTransitionEvidence({ db, disbursementId: 'd-1', fromState: 'burn_submitted', toState: 'burn_confirmed', triggeredBy: 'worker', details: { external_tx_id: '0xabc' } });
  ({ params, envelope } = lastEvidenceInsert(db));
  assert.equal(params[2], 'transition');
  assert.deepEqual(envelope.status, { from: 'burn_submitted', to: 'burn_confirmed' });
  assert.deepEqual(envelope.external_ref, { system: 'stacks', type: 'tx_id', value: '0xabc' }, 'transition links the leg artifact');
  assert.deepEqual(envelope.verification, { ok: true, method: 'guard' });
});

test('hash-not-payload: sensitive keys stripped, payload_hash survives', async () => {
  const db = createFakeDb();

  const response = {
    status: 'completed',
    data: {
      id: 'yc-mock-1',
      amount: 8250000,
      recipient: { account_number: '0123456789', bank_code: '044' },
    },
  };
  await recordApiResponse({ db, disbursementId: 'd-2', adapter: 'yellowcard', method: 'lookupSend', response });

  const { params, envelope, raw } = lastEvidenceInsert(db);
  assert.equal(params[2], 'api_response');
  assert.match(envelope.payload_hash, /^sha256:/);

  // Sensitive financial fields must never survive the sanitize step.
  for (const secret of ['0123456789', '044']) {
    assert.ok(!raw.includes(secret), `sensitive value leaked: ${secret}`);
  }
  assert.ok(!raw.includes('account_number'), 'sensitive key absent from the summary');

  // Hash is over the canonical raw payload (sorted keys, recursive) — recompute
  // via the exported helper to prove the record matches its input exactly.
  const full = { response: response || null, error: null };
  const rehash = `sha256:${hashPayload(full)}`;
  assert.equal(envelope.payload_hash, rehash, 'hash is over the canonical raw payload');
});

test('PII: sensitive fields never appear in evidence_data', async () => {
  const db = createFakeDb();

  const payload = {
    payout_id: 'yc-payout-9',
    status: 'completed',
    recipient: {
      account_number: '0123456789',
      bank_code: '044',
      bank_name: 'Access Bank',
      phone: '+2348000000000',
      email: 'beneficiary@example.com',
    },
    amount_ngn: 8250000,
  };

  await recordWebhookPayload({ db, disbursementId: 'd-3', source: 'yellowcard', payload, signatureValid: true });
  const { raw, envelope } = lastEvidenceInsert(db);

  for (const secret of ['0123456789', '044', '+2348000000000', 'beneficiary@example.com', 'Access Bank']) {
    assert.ok(!raw.includes(secret), `PII leaked: ${secret}`);
  }
  assert.equal(envelope.status.verified, true);
  assert.equal(envelope.verification.ok, true);
  assert.equal(envelope.external_ref.value, 'yc-payout-9', 'external ref survives (payout id is not PII)');
  assert.ok(!raw.includes('recipient_name') && !raw.includes('account_number'), 'sensitive keys stripped, not blanked');

  // Manual notes may legitimately carry reviewer context but the recipient is
  // still walled off. A reviewer is an operator context field, not PII.
  await recordManualNote({ db, disbursementId: 'd-3', reviewer: 'ops', note: 'recipient bank resolved to Access' });
  const manual = lastEvidenceInsert(db);
  assert.ok(manual.raw.includes('recipient bank resolved'), 'reviewer note is the point');
});

test('snapshots: external-observation recorders each append one external_status_snapshots row', async () => {
  const db = createFakeDb();
  const d = 'd-4';

  await recordApiResponse({ db, disbursementId: d, adapter: 'xreserve', method: 'observeDestinationRelease', response: { release_status: 'observed_pending' } });
  await recordTxHash({ db, disbursementId: d, chain: 'stacks', txHash: '0x' + '1'.repeat(64) });
  await recordWebhookPayload({ db, disbursementId: d, source: 'yellowcard', payload: { payout_id: 'p-1', status: 'completed' }, signatureValid: true });
  await recordPollResult({ db, disbursementId: d, adapter: 'xreserve', method: 'observeDestinationRelease', status: 'observed_confirmed' });

  const snap = db.callsMatching(/INSERT INTO external_status_snapshots/);
  assert.equal(snap.length, 4, 'api_response + tx_hash + webhook_payload + poll_result all snapshot');
  assert.equal(snap[0].params[2], 'ok');
  assert.equal(snap[1].params[2], 'broadcast');
  assert.equal(snap[2].params[2], 'completed');
  assert.equal(snap[3].params[2], 'observed_confirmed');
  assert.ok(typeof snap[3].params[3] === 'string' && snap[3].params[3].includes('payload_hash'), 'snapshot keeps the payload hash, not the body');

  // Internal recorders must NOT snapshot.
  const db2 = createFakeDb();
  await recordGateResult({ db: db2, disbursementId: d, gateName: 'round_amount_gate', passed: true, reason: 'ok' });
  await recordManualNote({ db: db2, disbursementId: d, reviewer: 'ops', note: 'reviewed' });
  await recordTransitionEvidence({ db: db2, disbursementId: d, fromState: 'a', toState: 'b', triggeredBy: 'worker', details: {} });
  assert.equal(db2.countMatching(/INSERT INTO external_status_snapshots/), 0, 'gate_result / manual_note / transition never snapshot');
});

test('poll_result: wired and envelope-compliant with an external ref', async () => {
  const db = createFakeDb();
  await recordPollResult({
    db,
    disbursementId: 'd-5',
    adapter: 'xreserve',
    method: 'observeDestinationRelease',
    externalId: 'rel-9',
    status: 'observed_confirmed',
    advanceAction: 'confirmDestinationRelease',
  });

  const { params, envelope } = lastEvidenceInsert(db);
  assert.equal(params[2], 'poll_result');
  assert.equal(envelope.source, 'poll:xreserve.observeDestinationRelease');
  assert.deepEqual(envelope.external_ref, { system: 'xreserve', type: 'id', value: 'rel-9' });
  assert.equal(envelope.status.poll_status, 'observed_confirmed');
  assert.equal(envelope.status.advance_action, 'confirmDestinationRelease');
});

test('getEvidence: orders by (created_at, id) and parses the data column', async () => {
  const db = createFakeDb();
  db.when(/ORDER BY created_at ASC, id ASC/, () => [
    {
      id: 'evt-old',
      evidence_type: 'manual_note',
      evidence_data: JSON.stringify({ v: 1, event_type: 'manual_note', source: 'operator.manual_review', external_ref: null, observed_at: 't1', status: { reviewer: 'ops' }, payload_hash: 'sha256:a', verification: null, details: { reviewer: 'ops', note: 'n' } }),
      recorded_by: 'ops',
      created_at: '2026-09-21T00:00:00Z',
    },
    {
      id: 'evt-new',
      evidence_type: 'transition',
      evidence_data: JSON.stringify({ v: 1, event_type: 'transition', source: 'bos.state_machine', external_ref: null, observed_at: 't2', status: { from: 'a', to: 'b' }, payload_hash: 'sha256:b', verification: { ok: true, method: 'guard' }, details: {} }),
      recorded_by: 'system',
      created_at: '2026-09-21T00:01:00Z',
    },
  ]);

  const rows = await getEvidence({ db, disbursementId: 'd-6' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ['evt-old', 'evt-new'], 'oldest first');
  assert.equal(rows[1].type, 'transition');
  assert.equal(rows[0].data.event_type, 'manual_note', 'data column parsed');
});

test('deriveWebhookEventId: stable across redeliveries with event_id or reference', () => {
  assert.equal(deriveWebhookEventId({ event_id: 'evt-1', reference: 'ref-1' }), 'evt-1');
  assert.equal(deriveWebhookEventId({ reference: 'ref-1' }), 'ref-1');
  assert.equal(deriveWebhookEventId({ status: 'completed' }), null);
});