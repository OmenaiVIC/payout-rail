/**
 * G-05: External tx ids are persisted onto the `disbursements` row.
 *
 * Regression for the dead-end: `submitBurn` returned `{ external_tx_id }` but
 * `executeTransition`'s persistence whitelist dropped it, so `isBurnConfirmed`
 * could never pass and the reconciliation worker skipped the row forever.
 *
 * These tests assert that the four identifier columns that already exist on
 * `disbursements` (external_tx_id, attestation_id, release_id, payout_id) are
 * written by the transitions that produce them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { executeTransition } from '../../src/services/bos/stateMachine.js';
import { DisbursementState as S } from '../../src/services/bos/types.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createTestCtx } from '../helpers/ctx.js';

const VALID_CREATOR = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';
const VALID_BTC = 'bc1qexample000000000000000000000000000000000';

/** A column-specific ref row for _getExternalRef / isXConfirmed guards. */
function ref(identifierType, identifierValue) {
  return {
    disbursement_id: 'd-tx',
    external_system: 'xreserve',
    identifier_type: identifierType,
    identifier_value: identifierValue,
    metadata: {},
  };
}

function seedExternalRefs(db, row) {
  db.when(/SELECT \* FROM external_refs/, () => row);
}

const def = (overrides = {}) => ({
  id: 'd-tx',
  amount_usdcx: 1000,
  ...overrides,
});

describe('G-05: submitBurn persists external_tx_id on the disbursement row', () => {
  it('lands the burn tx id in external_tx_id via the whitelist', async () => {
    const db = createFakeDb();
    const adapters = createMockAdapters();
    const ctx = createTestCtx({ db, adapters });

    const result = await executeTransition(
      def({ status: S.PREFLIGHT_CHECK, preflight_result: { ok: true, reasons: [] }, creator_address: VALID_CREATOR }),
      S.BURN_SUBMITTED,
      ctx,
      {},
      'test',
    );

    assert.equal(result.success, true, `transition failed: ${result.error}`);
    assert.equal(result.new_state, S.BURN_SUBMITTED);

    const upsert = db.findCall(/UPDATE disbursements SET external_tx_id = \$4/);
    assert.ok(upsert, 'expected an UPDATE that persists external_tx_id');
    assert.equal(upsert.params[0], result.details.external_tx_id, 'the persisted value is the burn tx id');
    assert.equal(upsert.params[1], 'd-tx', 'the row is targeted by id');
    assert.equal(adapters.stacks.calls.burnUsdcx.length, 1, 'the burn was submitted once');
  });
});

describe('G-05: burn_submitted → burn_confirmed regression (dead-end)', () => {
  it('passes when the tx id is on the row and the chain confirms', async () => {
    const db = createFakeDb();
    const adapters = createMockAdapters();
    const ctx = createTestCtx({ db, adapters });

    const result = await executeTransition(
      def({ status: S.BURN_SUBMITTED, external_tx_id: '0xburn-1' }),
      S.BURN_CONFIRMED,
      ctx,
      {},
      'test',
    );

    assert.equal(result.success, true, `transition failed: ${result.error}`);
    assert.equal(result.new_state, S.BURN_CONFIRMED);
    // Guard and confirmation action each poll the chain for the burn tx.
    assert.ok(adapters.stacks.calls.getTransactionStatus.length >= 1, 'chain was polled');
    assert.equal(adapters.stacks.calls.getTransactionStatus[0], '0xburn-1');
  });
});

describe('G-05: attestation_id / release_id / payout_id persist for their legs', () => {
  it('requestAttestation persists attestation_id', async () => {
    const db = createFakeDb();
    const adapters = createMockAdapters();
    const ctx = createTestCtx({ db, adapters });

    const result = await executeTransition(
      def({ status: S.BURN_CONFIRMED, external_tx_id: '0xburn-1' }),
      S.ATTESTATION_REQUESTED,
      ctx,
      {},
      'test',
    );

    assert.equal(result.success, true, `transition failed: ${result.error}`);
    assert.equal(result.new_state, S.ATTESTATION_REQUESTED);

    const upsert = db.findCall(/UPDATE disbursements SET attestation_id = \$4/);
    assert.ok(upsert, 'expected an UPDATE that persists attestation_id');
    assert.equal(upsert.params[0], result.details.attestation_id, 'persisted value matches the attestation returned');
    assert.equal(adapters.xreserve.calls.requestAttestation[0].tx_id, '0xburn-1');
  });

  it('submitDestinationRelease persists release_id', async () => {
    const db = createFakeDb();
    const adapters = createMockAdapters();
    // Guard re-validates the attestation against xReserve.
    adapters.xreserve.getAttestationStatus = async () => ({ status: 'confirmed', attestation_id: 'att-1' });
    seedExternalRefs(db, ref('attestation_id', 'att-1'));

    const ctx = createTestCtx({ db, adapters });

    const result = await executeTransition(
      def({ status: S.ATTESTATION_CONFIRMED, external_tx_id: '0xburn-1', creator_btc_address: VALID_BTC }),
      S.DESTINATION_RELEASE_SUBMITTED,
      ctx,
      {},
      'test',
    );

    assert.equal(result.success, true, `transition failed: ${result.error}`);
    assert.equal(result.new_state, S.DESTINATION_RELEASE_SUBMITTED);

    const upsert = db.findCall(/UPDATE disbursements SET release_id = \$4/);
    assert.ok(upsert, 'expected an UPDATE that persists release_id');
    assert.equal(upsert.params[0], result.details.release_id, 'persisted value matches the release returned');
  });

  it('submitYellowCardPayout persists payout_id and clears the amount_ngn_expected throw', async () => {
    const db = createFakeDb();
    const adapters = createMockAdapters();
    adapters.xreserve.getReleaseStatus = async () => ({ status: 'confirmed', release_id: 'rel-1' });
    seedExternalRefs(db, ref('release_id', 'rel-1'));

    // Payout gates: amountTolerance (no milestone row → pass with warning)
    db.when(/SELECT amount_usd as expected_amount FROM disbursements/, () => null);
    // attributableFunds: escrow exists, nothing disbursed yet, funded == requested
    db.when(/SELECT d\.id FROM disbursements d WHERE d\.source_reference/, () => ({ id: 'd-other' }));
    db.when(/as total_disbursed/, () => ({ total_disbursed: 0 }));
    db.when(/as total_funded/, () => ({ total_funded: 1000 }));

    const ctx = createTestCtx({ db, adapters });

    const result = await executeTransition(
      def({
        status: S.DESTINATION_RELEASE_CONFIRMED,
        external_tx_id: '0xburn-1',
        attestation_id: 'att-1',
        release_id: 'rel-1',
        creator_address: VALID_CREATOR,
        creator_btc_address: VALID_BTC,
        source_reference: 'campaign-001',
        amount_usd: 500,
        amount_ngn_expected: 1500000,
        ngn_recipient: { account_number: '0123456789', bank_code: '044' },
      }),
      S.YELLOWCARD_PAYOUT_SUBMITTED,
      ctx,
      {},
      'test',
    );

    assert.equal(result.success, true, `transition failed: ${result.error}`);
    assert.equal(result.new_state, S.YELLOWCARD_PAYOUT_SUBMITTED);

    const upsert = db.findCall(/UPDATE disbursements SET payout_id = \$4/);
    assert.ok(upsert, 'expected an UPDATE that persists payout_id');
    assert.equal(upsert.params[0], result.details.payout_id, 'persisted value matches the payout returned');
    assert.equal(upsert.params[1], 'd-tx');
  });
});

describe('G-05: whitespace-only PERSISTED_ACTION_FIELDS are untouched', () => {
  it('a transition that returns no identifier field does not write one', async () => {
    const db = createFakeDb();
    const ctx = createTestCtx({ db, adapters: createMockAdapters() });

    await executeTransition(
      def({ status: S.PREFLIGHT_CHECK, preflight_result: { ok: true, reasons: [] }, creator_address: VALID_CREATOR }),
      S.BURN_SUBMITTED,
      ctx,
      {},
      'test',
    );

    const updates = db.callsMatching(/UPDATE disbursements SET (attestation_id|release_id|payout_id) = \$4/);
    assert.equal(updates.length, 0, 'no sibling id column should be written by the burn leg');
  });
});