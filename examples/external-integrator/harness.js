/**
 * Demo loopback harness for the external-integrator example.
 *
 * Boots the REAL v1 disbursement router (`src/routes/disbursementsV1.js`) over an
 * ephemeral 127.0.0.1 listener, backed entirely by in-repo test doubles:
 *   - createFakeDb (SQL-recording, no database)
 *   - createMockAdapters (stacks / xreserve / yellowcard, no network)
 *   - the v1 route store shared with the public-API tests
 *   - a stateful mock settlement surface whose evidence follows the row's own
 *     destination-release progress (never fabricated)
 *
 * THIS IS DEMO INFRASTRUCTURE ONLY. It is not part of the API contract, and it is
 * deliberately zero-fidelity to real chains/banks/escrow. A real integration calls
 * a deployed Payout Rail instance over HTTPS — see README.md.
 *
 * Nothing in this file (or client.js) touches src/, migrations/, or adds deps.
 */

import { init } from '../../src/services/bos/disbursementService.js';
import { createFakeDb } from '../../test/helpers/fakeDb.js';
import { createMockAdapters } from '../../test/helpers/mockAdapters.js';
import { createTestCtx } from '../../test/helpers/ctx.js';
import { createV1Store, makeV1App, listen } from '../../test/helpers/v1Api.js';

/** Release-leg statuses the pipeline itself drives towards settlement. */
const POST_RELEASE = new Set([
  'destination_release_unobserved',
  'destination_release_observed',
  'destination_release_confirmed',
  'yellowcard_payout_submitted',
  'yellowcard_payout_confirmed',
  'settled',
]);

/**
 * Stateful mock settlement surface. Evidence is derived from the FakeDb row's own
 * status: before the release leg it reads fail-closed (`unobserved`), from the
 * moment the release leg begins it reports pending, and once the row has moved
 * onto/past the observed state it reports observed_confirmed. That is precisely
 * the evidence the G-08 guards require to keep advancing — the payout settles
 * without any external script, and the release is never fabricated.
 */
export function createSettlementEvidenceSimulator(store) {
  return async function observeDestinationRelease(params) {
    const status = store.row ? store.row.status : null;
    let release_status = 'unobserved';
    if (status === 'destination_release_unobserved') release_status = 'observed_pending';
    else if (POST_RELEASE.has(status)) release_status = 'observed_confirmed';
    return {
      release_status,
      source: 'marketplace-demo-harness',
      evidence: null,
      observed_at: new Date().toISOString(),
      request: params,
    };
  };
}

/**
 * Replay the external_refs INSERTs exactly as the real JSONB upsert merges them,
 * filtered to the requested disbursement.
 */
function makeRefsMaterializer(db) {
  return function materializedRefs(disbursementId) {
    const merged = new Map();
    let seq = 0;
    for (const c of db.calls) {
      if (!/^INSERT INTO external_refs/.test(c.sql)) continue;
      if (c.params[0] !== disbursementId) continue;
      const [disbursementId2, system, idType, idValue, metadataJson] = c.params;
      void disbursementId2;
      const key = `${system}|${idType}`;
      if (!merged.has(key)) {
        seq += 1;
        merged.set(key, {
          id: seq,
          disbursement_id: disbursementId,
          external_system: system,
          identifier_type: idType,
          identifier_value: idValue,
          metadata: {},
        });
      }
      const record = merged.get(key);
      record.metadata = { ...record.metadata, ...(metadataJson ? JSON.parse(metadataJson) : {}) };
    }
    return Array.from(merged.values());
  };
}

/** Replay the evidence chain in insert order (id ASC ≈ created_at ASC here). */
function makeEvidenceMaterializer(db) {
  return function materializedEvidence(disbursementId) {
    return db.calls
      .filter((c) => /INSERT INTO disbursement_evidence/.test(c.sql))
      .filter((c) => c.params[0] === disbursementId)
      .map((c, i) => ({
        id: i + 1,
        evidence_type: c.params[2],
        evidence_data: c.params[3],
        recorded_by: c.params[4],
        created_at: null,
      }));
  };
}

/**
 * Boot the demo: hooks the fake DB up the way the full (mock) lifecycle needs,
 * starts the real v1 router, and returns handles the example + tests drive.
 *
 * @param {object} [opts]
 * @param {number} [opts.totalFundedUsdcx]  amount the demo escrow covers, in
 *   6-dp USDCx base units (must equal the order's amount_usdcx for G-03).
 */
export async function bootDemoHarness({ totalFundedUsdcx = 25_000_000 } = {}) {
  const db = createFakeDb();
  const adapters = createMockAdapters();
  const materializedRefs = makeRefsMaterializer(db);
  const materializedEvidence = makeEvidenceMaterializer(db);

  // ── Registration order matters (FakeDb = first match wins). ─────────────
  // (1)-(5) Settlement-receipt reconstruction tables. Registered before the
  // route store so its `/FROM external_refs WHERE disbursement_id/ → []` fallback
  // can never shadow them.

  // Receipt: external refs with the JSONB metadata merge the real upsert performs.
  db.when(/FROM external_refs\s+WHERE disbursement_id = \$1\s+ORDER BY id ASC/, ({ params }) => (
    materializedRefs(params[0])
  ));
  // Snapshot / on-chain / webhook journals are empty in the mock pipeline.
  db.when(/FROM external_status_snapshots\s+WHERE disbursement_id = \$1\s+ORDER BY/, () => []);
  db.when(/FROM on_chain_events\s+WHERE disbursement_id = \$1\s+ORDER BY/, () => []);
  db.when(/FROM yellow_card_webhook_events\s+WHERE disbursement_id = \$1\s+ORDER BY/, () => []);
  // Receipt + audit trail: the evidence chain.
  db.when(/FROM disbursement_evidence\s+WHERE disbursement_id = \$1\s+ORDER BY created_at ASC, id ASC/, ({ params }) => (
    materializedEvidence(params[0])
  ));

  // (6) Guard/confirmation ref mirror — the ids the mock adapters generate.
  const refsMirror = {
    'xreserve|attestation_id': { external_system: 'xreserve', identifier_type: 'attestation_id', identifier_value: 'att-mock-1', metadata: {} },
    'yellowcard|payout_id': { external_system: 'yellowcard', identifier_type: 'payout_id', identifier_value: 'yc-mock-1', metadata: {} },
  };
  db.when(/SELECT \* FROM external_refs\s+WHERE disbursement_id = \$1/, ({ params }) => (
    refsMirror[`${params[1]}|${params[2]}`] || null
  ));
  // Ref lookups by single identifier types resolve against the mirror too.
  db.when(/FROM external_refs WHERE disbursement_id = \$1 AND identifier_type/, ({ params }) => (
    Object.values(refsMirror).find((r) => r.identifier_type === params[2]) || null
  ));

  // (7) Payout-gate seeds — the (single) demo escrow covers the exact payout.
  db.when(/SELECT d\.id FROM disbursements d WHERE d\.source_reference/, () => ({ id: 'd-escrow' }));
  db.when(/as total_disbursed/, () => ({ total_disbursed: 0 }));
  db.when(/as total_funded/, () => ({ total_funded: totalFundedUsdcx }));

  // (8) PERSISTED_ACTION_FIELDS writes the state machine issues each hop.
  let store;
  db.when(/^UPDATE disbursements SET ([\s\S]+?), updated_at = NOW\(\) WHERE id = \$\d+$/, ({ sql, params }) => {
    const body = sql.match(/^UPDATE disbursements SET ([\s\S]+?), updated_at = NOW\(\) WHERE id = \$\d+$/)[1];
    const tokens = [...body.matchAll(/([a-z_]+) = \$\d+/g)];
    if (store && store.row) {
      tokens.forEach((m, i) => { store.row[m[1]] = params[i]; });
    }
    return { changes: 1, rows: [] };
  });

  // (9) The shared route store: rate, insert, reads, idempotency, status claims,
  // scalar field persists, list. Registered last so (1)-(8) keep priority.
  store = createV1Store(db);

  // (10) Mock settlement surface: attestation guard wants status 'confirmed'
  // (mock default is 'complete'), release evidence follows the row's progress.
  adapters.xreserve.getAttestationStatus = async (id) => {
    adapters.xreserve.calls.getAttestationStatus.push(id);
    return { attestation_id: id, status: 'confirmed' };
  };
  adapters.xreserve.observeDestinationRelease = createSettlementEvidenceSimulator(store);

  const ctx = createTestCtx({ db, adapters });
  await init(ctx);

  const app = makeV1App();
  const { base, close } = await listen(app);

  return { base, close, store, db, adapters };
}