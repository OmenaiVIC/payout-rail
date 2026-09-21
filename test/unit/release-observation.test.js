/**
 * G-08 — Destination release is OBSERVED, never fabricated.
 *
 * Deterministic, offline coverage of the corrected release model for every
 * release transition, the fail-closed payout guard, and the reaper timeout
 * that escorts a permanently-unobserved disbursement to manual_review.
 *
 * Evidence is scripted through the mockExternalEvidence source wired into
 * observeDestinationRelease; nothing here performs a real network call or
 * waits on real time.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { executeTransition } from '../../src/services/bos/stateMachine.js';
import { DisbursementState as S, ReleaseStatus as RS } from '../../src/services/bos/types.js';
import { createFakeDb } from '../helpers/fakeDb.js';
import { createMockAdapters } from '../helpers/mockAdapters.js';
import { createMockEvidenceSource } from '../helpers/mockExternalEvidence.js';
import { createTestCtx } from '../helpers/ctx.js';
import { init as initDisbursementService } from '../../src/services/bos/disbursementService.js';
import * as reaper from '../../src/services/bos/stuckStateReaper.js';

const TXID = '0xburn-1';
const ATT_ID = 'att-1';
const ID = 'd-obs';

/**
 * A window onto the release leg of a disbursement: the live row we feed to the
 * next executeTransition (mirroring what a worker tick re-fetches) plus ctx.
 * The evidence source is shared so the test can script the settlement surface.
 */
function releaseCtx({ release_status }) {
  const db = createFakeDb();
  db.when(/UPDATE disbursements\s+SET status = \$1/, () => ({ changes: 1, rows: [] }));
  const adapters = createMockAdapters();
  adapters.xreserve.getAttestationStatus = async () => ({ status: 'confirmed', attestation_id: ATT_ID });
  const evidenceSource = createMockEvidenceSource();
  adapters.xreserve.observeDestinationRelease = async (params) => evidenceSource.observe(params);

  // Attestation external_ref, read by the attestation re-validating guards.
  db.when(/SELECT \* FROM external_refs/, () => ({
    disbursement_id: ID,
    external_system: 'xreserve',
    identifier_type: 'attestation_id',
    identifier_value: ATT_ID,
    metadata: {},
  }));

  const ctx = createTestCtx({ db, adapters });
  const row = {
    id: ID,
    external_tx_id: TXID,
    attestation_id: ATT_ID,
    release_status,
  };
  return { ctx, row, evidenceSource, db };
}

describe('G-08: attestation_confirmed → destination_release_unobserved (begin)', () => {
  it('parks the row as unobserved and performs no external release call', async () => {
    const { ctx, row, evidenceSource, db } = releaseCtx({ release_status: null });
    // Even if the surface already reports evidence, beginning the observation
    // does NOT read it: nothing is requested and nothing is fabricated.
    evidenceSource.emit(ID, RS.OBSERVED_CONFIRMED);

    const began = await executeTransition(
      { ...row, status: S.ATTESTATION_CONFIRMED },
      S.DESTINATION_RELEASE_UNOBSERVED,
      ctx,
      {},
      'test',
    );

    assert.equal(began.success, true, `transition failed: ${began.error}`);
    assert.equal(began.new_state, S.DESTINATION_RELEASE_UNOBSERVED);
    assert.equal(began.details.release_status, RS.UNOBSERVED);
    assert.equal(evidenceSource.statusOf(ID), RS.OBSERVED_CONFIRMED, 'surface evidence left untouched');
    assert.equal(adaptersFor(ctx).xreserve.calls.observeDestinationRelease.length, 0,
      'beginning the observation performs no external read or call (G-08)');
    const upsert = db.findCall(/UPDATE disbursements SET release_status = \$4/);
    assert.ok(upsert && upsert.params[0] === RS.UNOBSERVED, 'release_status pinned unobserved on entry');
  });
});

describe('G-08: destination release observation chain (unobserved → observed → confirmed)', () => {
  it('advances one hop per evidence change and never fabricates confirmation', async () => {
    const { ctx, row, evidenceSource } = releaseCtx({ release_status: null });

    // attestation_confirmed → destination_release_unobserved
    const began = await beginRelease(ctx, row);
    assert.equal(began.new_state, S.DESTINATION_RELEASE_UNOBSERVED);
    assert.equal(began.details.release_status, RS.UNOBSERVED);

    // unobserved → observed once ANY real evidence exists (pending is enough).
    evidenceSource.emit(ID, RS.OBSERVED_PENDING);
    const pendingRow = { ...row, status: S.DESTINATION_RELEASE_UNOBSERVED, release_status: RS.UNOBSERVED };
    const observed = await hop(pendingRow, S.DESTINATION_RELEASE_OBSERVED, ctx);
    assert.equal(observed.new_state, S.DESTINATION_RELEASE_OBSERVED);
    assert.equal(observed.details.release_status, RS.OBSERVED_PENDING, 'evidence persisted exactly as observed');

    // observed → confirmed only on a fresh observed_confirmed read.
    evidenceSource.emit(ID, RS.OBSERVED_CONFIRMED);
    const confirmedRow = { ...pendingRow, status: S.DESTINATION_RELEASE_OBSERVED, release_status: RS.OBSERVED_PENDING };
    const confirmed = await hop(confirmedRow, S.DESTINATION_RELEASE_CONFIRMED, ctx);
    assert.equal(confirmed.new_state, S.DESTINATION_RELEASE_CONFIRMED);
    assert.equal(confirmed.details.release_status, RS.OBSERVED_CONFIRMED, 'confirmation persisted only from evidence');
  });

  it('rejects the observation hop while the surface still reports unobserved', async () => {
    const { ctx, row } = releaseCtx({ release_status: RS.UNOBSERVED });
    const attempted = await hop({ ...row, status: S.DESTINATION_RELEASE_UNOBSERVED }, S.DESTINATION_RELEASE_OBSERVED, ctx);
    assert.equal(attempted.success, false);
    assert.equal(attempted.error_code, 'u8225', 'no evidence → still parked unobserved');
  });

  it('rejects confirmed while evidence is only pending (u8226)', async () => {
    const { ctx, row, evidenceSource } = releaseCtx({ release_status: RS.OBSERVED_PENDING });
    evidenceSource.emit(ID, RS.OBSERVED_PENDING);
    const attempted = await hop(
      { ...row, status: S.DESTINATION_RELEASE_OBSERVED, release_status: RS.OBSERVED_PENDING },
      S.DESTINATION_RELEASE_CONFIRMED,
      ctx,
    );
    assert.equal(attempted.success, false);
    assert.equal(attempted.error_code, 'u8226', 'pending evidence can never confirm the release');
  });
});

describe('G-08: observed failure evidence lands the row in failed', () => {
  it('unobserved → failed on observed_failed evidence', async () => {
    const { ctx, row, evidenceSource } = releaseCtx({ release_status: RS.UNOBSERVED });
    evidenceSource.emit(ID, RS.OBSERVED_FAILED);
    const result = await hop({ ...row, status: S.DESTINATION_RELEASE_UNOBSERVED }, S.FAILED, ctx);
    assert.equal(result.new_state, S.FAILED);
    assert.equal(result.details.release_status, RS.OBSERVED_FAILED);
  });

  it('observed → failed on observed_failed evidence', async () => {
    const { ctx, row, evidenceSource } = releaseCtx({ release_status: RS.OBSERVED_PENDING });
    evidenceSource.emit(ID, RS.OBSERVED_FAILED);
    const result = await hop({ ...row, status: S.DESTINATION_RELEASE_OBSERVED }, S.FAILED, ctx);
    assert.equal(result.new_state, S.FAILED);
    assert.equal(result.details.release_status, RS.OBSERVED_FAILED);
  });
});

describe('G-08: payout is fail-closed on release confirmation', () => {
  it('blocks the payout when the persisted release_status is not observed_confirmed (u8234)', async () => {
    const { ctx, row, evidenceSource } = releaseCtx({ release_status: RS.OBSERVED_PENDING });
    // Even a fresh observation claiming confirmation must not help a row whose
    // persisted value was never confirmed (hand-edited / stale state).
    evidenceSource.emit(ID, RS.OBSERVED_CONFIRMED);

    const attempted = await hop({
      ...row,
      status: S.DESTINATION_RELEASE_CONFIRMED,
      release_status: RS.OBSERVED_PENDING,
    }, S.YELLOWCARD_PAYOUT_SUBMITTED, ctx);

    assert.equal(attempted.success, false);
    assert.equal(attempted.error_code, 'u8234', 'payout blocked before any yellowcard interaction');
  });

  it('blocks the payout when a fresh observation no longer confirms (u8226)', async () => {
    const { ctx, row, evidenceSource } = releaseCtx({ release_status: RS.OBSERVED_CONFIRMED });
    evidenceSource.emit(ID, RS.OBSERVED_PENDING);

    const attempted = await hop({
      ...row,
      status: S.DESTINATION_RELEASE_CONFIRMED,
      release_status: RS.OBSERVED_CONFIRMED,
    }, S.YELLOWCARD_PAYOUT_SUBMITTED, ctx);

    assert.equal(attempted.success, false);
    assert.equal(attempted.error_code, 'u8226', 'stale confirmation cannot unlock money movement');
  });
});

describe('G-08: permanently-unobserved disbursement is reaped to manual_review', () => {
  it('reapOnce flags destination_release_unobserved beyond its SLA', async () => {
    const db = createFakeDb();
    const adapters = createMockAdapters();
    const ctx = createTestCtx({ db, adapters });

    // disbursementService.init seeds a rate only if the table is empty.
    db.when(/SELECT id FROM exchange_rates WHERE pair = 'USDCx\/NGN' LIMIT 1/, () => ({ id: 1 }));

    const stuckRow = {
      id: ID,
      status: S.DESTINATION_RELEASE_UNOBSERVED,
      last_heartbeat_at: new Date(Date.now() - 4_000_000).toISOString(), // 66 min > 60 min reaper threshold
      external_tx_id: TXID,
      attestation_id: ATT_ID,
    };
    db.when(/SELECT \* FROM disbursements WHERE id = \$1/, () => stuckRow);
    db.when(/SELECT \* FROM disbursements\s+WHERE status = \$1/, ({ params }) =>
      params[0] === S.DESTINATION_RELEASE_UNOBSERVED ? [stuckRow] : []);
    db.when(/UPDATE disbursements\s+SET status = \$1/, () => ({ changes: 1, rows: [] }));

    await initDisbursementService(ctx);
    reaper.init(ctx);

    const statsBefore = reaper.getStats();
    await reaper.reapOnce();

    assert.equal(reaper.getStats().flagged, statsBefore.flagged + 1, 'exactly one stuck disbursement flagged');

    const claim = db.findCall(/UPDATE disbursements\s+SET status = \$1/);
    assert.ok(claim, 'the row was claimed');
    assert.equal(claim.params[0], S.MANUAL_REVIEW, 'reaped straight to manual_review (never paid out)');

    const recovery = ctx.events.find((e) => e.new_status === S.MANUAL_REVIEW);
    assert.ok(recovery, 'manual_review transition emitted an audit event');
    assert.equal(recovery.details.recovery_reason, `stuck_in_${S.DESTINATION_RELEASE_UNOBSERVED}_beyond_sla`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function adaptersFor(testCtx) {
  return testCtx.adapters;
}

async function hop(row, toState, testCtx) {
  return executeTransition(row, toState, testCtx, {}, 'test');
}

async function beginRelease(testCtx, row) {
  return hop({ ...row, status: S.ATTESTATION_CONFIRMED }, S.DESTINATION_RELEASE_UNOBSERVED, testCtx);
}