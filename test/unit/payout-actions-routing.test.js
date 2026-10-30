/**
 * Sprint P-1 / C2 — payout submit and confirm travel through the seam.
 *
 * The pivot this file pins: the payout leg must call the adapter, write the
 * external ref, label the API evidence, and build the callback URL from the
 * SAME resolved provider. A mismatch in any one of those is a silent provider
 * substitution — the failure mode P-1 exists to prevent.
 *
 * The default provider is still yellowcard, so the legacy alias
 * `submitYellowCardPayout` must keep behaving exactly as before.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  submitPayout,
  submitYellowCardPayout,
  confirmYellowCardPayout,
} from '../../src/services/bos/transitionActions.js';
import { createTestCtx } from '../helpers/ctx.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createFakeDb } from '../helpers/fakeDb.js';

const DISBURSEMENT = {
  id: 'd-routing-1',
  amount_ngn_expected: 4_125_000,
  exchange_rate: 1650,
  ngn_recipient: { account_number: '0123456789', bank_code: '044' },
};

function breetAdapter() {
  const calls = { submitSend: [], lookupSend: [] };
  return {
    calls,
    async submitSend(params) {
      calls.submitSend.push(params);
      return { send_id: 'mb-send-1', status: 'processing' };
    },
    async lookupSend(sendId) {
      calls.lookupSend.push(sendId);
      return { status: 'completed', data: { id: sendId } };
    },
  };
}

function ctxWith(provider, adapter, db = createFakeDb()) {
  const adapters = { ...createMockAdapters(), breet: adapter };
  return createTestCtx({ db, adapters, payoutProvider: provider });
}

function evidenceSource(db) {
  const call = db.findCall(/INSERT INTO disbursement_evidence/);
  if (!call) return null;
  const data = JSON.parse(call.params[3]);
  return data.source;
}

describe('C2: submitPayout routes every payout write through the resolved provider', () => {
  it('defaults to yellowcard and keeps the legacy alias identical', async () => {
    const ctx = ctxWith('yellowcard', breetAdapter());
    const result = await submitYellowCardPayout({ ...DISBURSEMENT, id: 'd-default' }, ctx);

    assert.equal(result.provider, 'yellowcard');
    assert.equal(ctx.adapters.yellowcard.calls.submitSend.length, 1);
    assert.equal(ctx.adapters.breet.calls.submitSend.length, 0);

    const ref = ctx.db.findCall(/INSERT INTO external_refs/);
    assert.equal(ref.params[1], 'yellowcard');
    assert.equal(ref.params[2], 'payout_id');
    assert.equal(ref.params[3], result.payout_id);
    assert.equal(evidenceSource(ctx.db), 'api:yellowcard.submitSend');
    assert.match(
      ctx.adapters.yellowcard.calls.submitSend[0].callback_url,
      /\/api\/bos\/webhooks\/yellowcard$/
    );
  });

  it('routes a non-default provider to its own adapter, ref, evidence, and callback', async () => {
    const adapter = breetAdapter();
    const ctx = ctxWith('breet', adapter);

    const result = await submitPayout({ ...DISBURSEMENT, id: 'd-breet' }, ctx);

    assert.equal(result.provider, 'breet');
    assert.equal(result.payout_id, 'mb-send-1');
    assert.equal(adapter.calls.submitSend.length, 1);
    assert.equal(ctx.adapters.yellowcard.calls.submitSend.length, 0);

    assert.equal(adapter.calls.submitSend[0].amount, 4_125_000);
    assert.match(adapter.calls.submitSend[0].callback_url, /\/api\/bos\/webhooks\/breet$/);

    const ref = ctx.db.findCall(/INSERT INTO external_refs/);
    assert.equal(ref.params[1], 'breet');
    assert.equal(ref.params[3], 'mb-send-1');
    assert.equal(JSON.parse(ref.params[4]).provider, 'breet');

    assert.equal(evidenceSource(ctx.db), 'api:breet.submitSend');
  });

  it('refuses to submit through a provider that cannot serve the NGN bank leg', async () => {
    const ctx = ctxWith('flutterwave', breetAdapter());

    await assert.rejects(
      () => submitPayout({ ...DISBURSEMENT, id: 'd-refused' }, ctx),
      (err) => err.code === 'PROVIDER_CAPABILITY_UNSUPPORTED'
    );

    assert.equal(ctx.db.countMatching(/INSERT INTO external_refs/), 0);
    assert.equal(ctx.db.countMatching(/INSERT INTO disbursement_evidence/), 0);
  });
});

describe('C2: confirmYellowCardPayout reads and writes through the resolved provider', () => {
  it('looks the payout up with the provider adapter and labels the evidence with it', async () => {
    const adapter = breetAdapter();
    const db = createFakeDb();
    db.when(/SELECT \* FROM external_refs/, ({ params }) =>
      params[1] === 'breet'
        ? {
            disbursement_id: params[0],
            external_system: 'breet',
            identifier_type: 'payout_id',
            identifier_value: 'mb-send-9',
            metadata: {},
          }
        : null
    );
    const ctx = ctxWith('breet', adapter, db);

    const result = await confirmYellowCardPayout({ ...DISBURSEMENT, id: 'd-confirm' }, ctx);

    assert.equal(result.payout_id, 'mb-send-9');
    assert.equal(result.provider, 'breet');
    assert.deepEqual(adapter.calls.lookupSend, ['mb-send-9']);
    assert.equal(ctx.adapters.yellowcard.calls.lookupSend.length, 0);
    assert.equal(evidenceSource(db), 'api:breet.lookupSend');
  });

  it('falls back to a legacy yellowcard ref rather than orphaning it', async () => {
    const adapter = breetAdapter();
    const db = createFakeDb();
    db.when(/SELECT \* FROM external_refs/, ({ params }) =>
      params[1] === 'yellowcard'
        ? {
            disbursement_id: params[0],
            external_system: 'yellowcard',
            identifier_type: 'payout_id',
            identifier_value: 'yc-legacy-1',
            metadata: { submitted_at: '2026-01-01T00:00:00.000Z' },
          }
        : null
    );
    const ctx = ctxWith('breet', adapter, db);

    const result = await confirmYellowCardPayout({ ...DISBURSEMENT, id: 'd-legacy' }, ctx);

    assert.equal(result.payout_id, 'yc-legacy-1');
    assert.deepEqual(adapter.calls.lookupSend, ['yc-legacy-1']);

    const ref = db.findCall(/INSERT INTO external_refs/);
    assert.equal(ref.params[1], 'breet', 'the confirmation is re-homed under the active provider');
    assert.equal(ref.params[3], 'yc-legacy-1');
  });

  it('does not consult a second adapter when the default provider is active', async () => {
    const db = createFakeDb();
    db.when(/SELECT \* FROM external_refs/, ({ params }) => ({
      disbursement_id: params[0],
      external_system: 'yellowcard',
      identifier_type: 'payout_id',
      identifier_value: 'yc-send-1',
      metadata: {},
    }));
    const adapters = createMockAdapters();
    adapters.breet = breetAdapter();
    const ctx = createTestCtx({ db, adapters, payoutProvider: 'yellowcard' });

    await confirmYellowCardPayout({ ...DISBURSEMENT, id: 'd-yc' }, ctx);

    assert.deepEqual(adapters.yellowcard.calls.lookupSend, ['yc-send-1']);
    assert.equal(adapters.breet.calls.lookupSend.length, 0);
  });
});

it('exposes the historical alias as the same function', () => {
  assert.equal(submitYellowCardPayout, submitPayout);
});
