/**
 * Sprint P-1 / C3 — the payout-confirmation guard travels through the seam.
 *
 * The pivot this file pins: `isPayoutConfirmed` must read the payout external
 * ref under the configured provider and poll the adapter that matches the ref it
 * actually found. The dangerous case is the legacy fallback: an in-flight payout
 * written under `yellowcard` before P-1 must be polled against Yellow Card, never
 * against the newly configured provider (a cross-wire of one provider's payout id
 * into another provider's API).
 *
 * Provider names are limited by PAYOUT_LEGS (yellowcard, breet, flutterwave), and
 * resolvePayoutProvider() normalizes everything else to yellowcard. `breet` is
 * therefore the non-default provider used here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isPayoutConfirmed } from '../../src/services/bos/transitionGuards.js';
import { createTestCtx } from '../helpers/ctx.js';
import { createFakeDb } from '../helpers/fakeDb.js';

const DISBURSEMENT = { id: 'd-guard-routing-1' };

function createProviderMock(name) {
  const calls = { lookupSend: [] };
  return {
    calls,
    lookupResult: { status: 'completed', data: { id: name } },
    lookupError: null,
    async lookupSend(identifier) {
      calls.lookupSend.push(identifier);
      if (this.lookupError) throw this.lookupError;
      return this.lookupResult;
    },
  };
}

function dbWithRefs(refsBySystem) {
  const db = createFakeDb();
  db.when(/SELECT \* FROM external_refs/, ({ params }) => {
    const row = refsBySystem[params[1]];
    if (!row) return null;
    return {
      disbursement_id: params[0],
      external_system: params[1],
      identifier_type: params[2],
      ...row,
    };
  });
  return db;
}

function readSystems(db) {
  return db.calls
    .filter((c) => /SELECT \* FROM external_refs/.test(c.sql))
    .map((c) => c.params[1]);
}

function makeCtx({ db, provider, yellowcard, breet }) {
  return createTestCtx({
    db,
    payoutProvider: provider,
    adapters: { yellowcard, breet },
  });
}

describe('C3: isPayoutConfirmed resolves the payout ref by configured provider', () => {
  it('polls the configured provider when its payout ref exists', async () => {
    const db = dbWithRefs({
      breet: { identifier_value: 'breet-send-1', metadata: { provider: 'breet' } },
    });
    const yellowcard = createProviderMock('yellowcard');
    const breet = createProviderMock('breet');
    const ctx = makeCtx({ db, provider: 'breet', yellowcard, breet });

    const result = await isPayoutConfirmed({ ...DISBURSEMENT }, ctx);

    assert.deepEqual(result, { ok: true, details: { payout_id: 'breet-send-1' } });
    assert.deepEqual(breet.calls.lookupSend, ['breet-send-1']);
    assert.deepEqual(yellowcard.calls.lookupSend, []);
    assert.deepEqual(readSystems(db), ['breet']);
  });

  it('falls back to the legacy yellowcard row and polls yellowcard, not the configured provider', async () => {
    const db = dbWithRefs({
      yellowcard: { identifier_value: 'yc-legacy-1', metadata: {} },
    });
    const yellowcard = createProviderMock('yellowcard');
    const breet = createProviderMock('breet');
    const ctx = makeCtx({ db, provider: 'breet', yellowcard, breet });

    const result = await isPayoutConfirmed({ ...DISBURSEMENT }, ctx);

    assert.deepEqual(result, { ok: true, details: { payout_id: 'yc-legacy-1' } });
    assert.deepEqual(readSystems(db), ['breet', 'yellowcard'], 'the configured provider is consulted before the fallback');
    assert.deepEqual(yellowcard.calls.lookupSend, ['yc-legacy-1']);
    assert.deepEqual(breet.calls.lookupSend, [], 'a yellowcard payout_id must never be polled against breet');
  });

  it('uses metadata.provider to select the adapter when the legacy row names its issuer', async () => {
    const db = dbWithRefs({
      yellowcard: { identifier_value: 'issued-by-breet-1', metadata: { provider: 'breet' } },
    });
    const yellowcard = createProviderMock('yellowcard');
    const breet = createProviderMock('breet');
    const ctx = makeCtx({ db, provider: 'breet', yellowcard, breet });

    const result = await isPayoutConfirmed({ ...DISBURSEMENT }, ctx);

    assert.deepEqual(result, { ok: true, details: { payout_id: 'issued-by-breet-1' } });
    assert.deepEqual(breet.calls.lookupSend, ['issued-by-breet-1']);
    assert.deepEqual(yellowcard.calls.lookupSend, []);
  });

  it('returns u8231 when neither the configured nor the legacy ref exists', async () => {
    const db = dbWithRefs({});
    const yellowcard = createProviderMock('yellowcard');
    const breet = createProviderMock('breet');
    const ctx = makeCtx({ db, provider: 'breet', yellowcard, breet });

    const result = await isPayoutConfirmed({ ...DISBURSEMENT }, ctx);

    assert.deepEqual(result, {
      ok: false,
      error_code: 'u8231',
      reason: 'No payout external_ref found',
    });
    assert.deepEqual(readSystems(db), ['breet', 'yellowcard']);
    assert.deepEqual(breet.calls.lookupSend, []);
    assert.deepEqual(yellowcard.calls.lookupSend, []);
  });

  it('preserves u8232 when the resolved provider reports a non-completed status', async () => {
    const db = dbWithRefs({
      breet: { identifier_value: 'breet-pending-1', metadata: {} },
    });
    const yellowcard = createProviderMock('yellowcard');
    const breet = createProviderMock('breet');
    breet.lookupResult = { status: 'pending' };
    const ctx = makeCtx({ db, provider: 'breet', yellowcard, breet });

    const result = await isPayoutConfirmed({ ...DISBURSEMENT }, ctx);

    assert.deepEqual(result, {
      ok: false,
      error_code: 'u8232',
      reason: 'Payout status: pending',
    });
  });

  it('preserves u8233 when the resolved provider lookup throws', async () => {
    const db = dbWithRefs({
      breet: { identifier_value: 'breet-boom-1', metadata: {} },
    });
    const yellowcard = createProviderMock('yellowcard');
    const breet = createProviderMock('breet');
    breet.lookupError = new Error('boom');
    const ctx = makeCtx({ db, provider: 'breet', yellowcard, breet });

    const result = await isPayoutConfirmed({ ...DISBURSEMENT }, ctx);

    assert.deepEqual(result, {
      ok: false,
      error_code: 'u8233',
      reason: 'Payout poll failed: boom',
    });
  });

  it('preserves the default yellowcard path for u8232 and u8233', async () => {
    const pendingDb = dbWithRefs({
      yellowcard: { identifier_value: 'yc-pending-1', metadata: {} },
    });
    const pendingYellowcard = createProviderMock('yellowcard');
    pendingYellowcard.lookupResult = { status: 'processing' };
    const pendingCtx = makeCtx({
      db: pendingDb,
      provider: 'yellowcard',
      yellowcard: pendingYellowcard,
      breet: createProviderMock('breet'),
    });

    assert.deepEqual(await isPayoutConfirmed({ ...DISBURSEMENT }, pendingCtx), {
      ok: false,
      error_code: 'u8232',
      reason: 'Payout status: processing',
    });

    const throwDb = dbWithRefs({
      yellowcard: { identifier_value: 'yc-boom-1', metadata: {} },
    });
    const throwYellowcard = createProviderMock('yellowcard');
    throwYellowcard.lookupError = new Error('socket hang up');
    const throwCtx = makeCtx({
      db: throwDb,
      provider: 'yellowcard',
      yellowcard: throwYellowcard,
      breet: createProviderMock('breet'),
    });

    assert.deepEqual(await isPayoutConfirmed({ ...DISBURSEMENT }, throwCtx), {
      ok: false,
      error_code: 'u8233',
      reason: 'Payout poll failed: socket hang up',
    });
  });
});
