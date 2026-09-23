# Payout Rail — Extraction Report

> **ARCHIVED — historical record (Sprint 7).**
> This document records the Sprint 0 extraction of the BOS subsystem from CineX.
> It is **superseded by** `docs/ARCHITECTURE.md` and `docs/INTEGRATION.md` for current
> system description and is not a reference to current behavior. Links to it are
> preserved for provenance only (see `docs/ATTRIBUTION.md`).

Extraction of the BOS (Bridge Orchestration Service) payout subsystem from the CineX
backend into the standalone `payout-rail` project.

- **Origin:** `https://github.com/OmenaiVIC/CineX.git`
- **Origin commit:** `8985b4142be4e12b845098d7485b048b26222e04`
- **License:** MIT © 2026 Victor Omenai (see `LICENSE`, `ATTRIBUTION.md`)
- **Extracted tree:** `backend/src/services/bos/**`, `backend/src/routes/{bosMonitoring,webhooks}.js`,
  `backend/src/config/chain.js`, `backend/src/migrations/006_bos_schema.sql` + `009_bos_e2e.sql`
- **New files written for the extraction:** `src/index.js`, `src/database.js`,
  `src/services/bos/RecipientRegistry.js`, `src/config/chainConfig.js`, `package.json`,
  scaffold (`README.md`, `.env.example`, `.gitignore`, `.npmrc`, `LICENSE`, `ATTRIBUTION.md`),
  this report, `migrations/001–004`.

## Scope boundary

- **Preserved verbatim:** BOS logic files — `stateMachine.js`, `types.js`,
  `transitionGuards.js`, `transitionActions.js`, `payoutGates.js`, `preflight.js`,
  `circuitBreaker.js`, `twoPersonApproval.js`, `disbursementService.js`,
  `stuckStateReaper.js`, `reconciliationWorker.js`, `pipelineWorker.js`,
  `fallbackPoller.js`, `evidenceCollector.js`, `auditTimeline.js`, `webhookVerifier.js`,
  `xreserveAdapter.js`, `yellowcardAdapter.js`, `monitoring/*`.
- **Preserved on modification (decoupling only, no behavior change):**
  `bridgeAdapterFactory.js` (actor wiring below), `StacksAdapter.js`, `monitorJob.js`,
  `bosMonitoring.js`, `webhooks.js`, `notifier.js` (rebrand), `types.js` (map count fix).
- **Deliberately NOT extracted:** campaign/escrow/verification, AI, activity feed,
  passkey/relay, funding pool, tests, the non-BOS database layer.

## Dependency surface (external)

`express`, `cors`, `@stacks/network`, `@stacks/transactions`, `nodemailer`, `dotenv`,
plus dynamic `pg` / `@neondatabase/serverless` / `ws`. No other runtime deps; no
devDependencies (tests intentionally not extracted).

## Deviations from CineX

1. **`getStacksAdapter()` now takes no arguments.** CineX passed
   `contractService` and built adapters from it; the extraction builds a minimal
   `StacksAdapter` on `chainConfig` directly. `bridgeAdapterFactory.js` rewired:
   `stacks: getStacksAdapter()`, `xreserve: getXReserveAdapter()`,
   `yellowcard: getYellowCardAdapter()`.
2. **`src/index.js` uses static named imports** for `stuckStateReaper`,
   `reconciliationWorker`, `disbursementService`, `pipelineWorker`
   (`* as` namespaces / `import monitorJob from`), replacing CineX's
   `import({ default })` dynamic pattern. Same modules, same behavior.
3. **`emitEvent` emits `from_state` and `to_state` and awaits the DB.**
   CineX's `index.js` `emitEvent` did not populate `from_state`/`to_state` columns
   and leaked the client (`db` never released). The extraction writes
   `old_status → new_status` and `release()`s in a `finally`.
4. **DB layer replaced** (`database.pg.js` plus callers that passed `db` around):
   `src/database.js` owns one pool (`PgClient` with `.get/.all/.run/.release`,
   auto-`RETURNING *` on INSERTs lacking it) and exposes `getDb()`, `initDb()`,
   `closeDb()`. Disbursement callers now `await getDb()` per operation.
5. **Migration runner changed:** CineX re-ran every migration file on every boot
   (no tracking — see the POSTPONED_BACKLOG entry). Payout-rail's `runMigrations`
   maintains a `schema_migrations` table and runs only un-applied files in lexical
   order. **Single point of divergence by design**: behavior matches "apply each file
   exactly once", not CineX's "apply every boot".
6. **`exchange_rates` unique index deferred.** CineX `006` seed had no unique
   constraint (duplicate seed rows across restarts). Payout-rail keeps the table and
   a plain seed (`DEFAULT_USDCX_NGN_RATE`) but **no** unique index — deferred to
   POSTPONED_BACKLOG; range query in `transitionActions.js:162-166` reads are not
   affected.
7. **`campaign_id` → `source_reference`, `milestone_index` → `source_application`**
   (migration 001) with the type change INTEGER → TEXT NOT NULL. All worker/code
   references updated. No CineX behavior change (CineX kept original names).
8. **Nullable `amount_ngn_expected` / `exchange_rate`** in `disbursements`
   (001) — populated only at payout time; worker reads guard with `??`.
9. **Chain config** consolidated into `src/config/chainConfig.js` (replaces
   `backend/src/config/chain.js`) with `PAYOUT_*` env naming, default network
   `testnet`, default contract `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx`.
10. **`types.js` state-map count 25 → 26** (`attestation_received` was present in
    the map but missing from the count constant).
11. **`idx_extrefs_unique` naming fix** and audit-union: `disbursement_audit` /
    `relay_wallet_activity` union view adds nullable `disbursement_id` so a single
    `ACTIVITY_FEED_TYPE`-style query works across both tables.
12. **`monitorJob` fetch-timeout constant** — uses env (`BOS_POLL_INTERVAL_MS`
    default), matching CineX behavior after its own fix, kept here as-is.
13. **`notifier.js` rebrand** — mail/console metadata references updated to
    `payout-rail` where it did not touch alerting semantics.
14. **Migration file contents split 006/009 → 001/002/003/004** with `depends_on`-free
    lexical ordering (CineX numbered migrations sequentially too).
15. **`webhookVerifier.js:8` and `yellowcardAdapter.js:57,107` use `require('crypto')`**
    inside ESM modules. This is a carried-over **latent bug from CineX**: under strict
    ESM, `require` is not defined and the `webhook` / `initiatePayout` verify paths will
    throw `ReferenceError: require is not defined`. **Preserved verbatim per scope
    boundary** — flagged here for the owner to fix (swap to `node:crypto` named imports).

RESOLVED IN DECISION A (2026-09-21): the three `require('crypto')` calls were replaced
with a single module-level `import crypto from 'node:crypto'` in `webhookVerifier.js`
and `yellowcardAdapter.js`. CineX retains the original latent bug. See
POSTPONED_BACKLOG.md C-05 (CLOSED).

## Carry-forwards (known issues preserved verbatim)

- C-01 `external_tx_id` latent bug: `submitBurn` upsert leaves `external_tx_id` NULL
  until confirmation, so `isBurnConfirmed` re-reads it before the confirming adapter
  writes — burned-but-unconfirmed disbursements can fall through to the reaper →
  `manual_review`. Preserved.
- C-02 `BRIDGE_ADAPTER_ENV` kept (reads `BRIDGE_ADAPTER_ENV`, default `xreserve`,
  `mock` for tests).
- C-03 `XRESERVE_PROTOCOL_CONTRACT` env override kept.
- C-04 Weak idempotency key: `disbursement:${source_reference}:${amount_usdcx}:${Date.now()}`
  — timestamp makes retries non-deterministic. Preserved.
- C-05 — RESOLVED (Decision A). ESM `require('crypto')` replaced with `node:crypto`
  import. CineX still has the latent bug; a separate CineX ticket is advised.
- C-06 `exchange_rates` unique-index deferral (deviation 6 above) + seed re-running
  avoided by the new schema-tracking runner only in payout-rail; **CineX still replays
  migration 009's seed on boot** (see POSTPONED_BACKLOG).
- C-07 `POSTPONED_BACKLOG.md` created in **CineX `docs/`** (the single permitted CineX
  mutation) documenting the migration-tracking defect the extraction surfaced.

## Verification

`node --check` passes on every extracted/written `.js` file (see run output at
extraction time). Runtime DB/kick-off is not exercised as part of the extraction;
no tests were copied (CineX's `tests/bosWorkers.test.js` stays in CineX).

## Files notice

While CineX distributed these files under MIT, please note the source repository
may have additional usage notes or restrictions outside the copied code (the
`AGENTS.md` prompt is not code and is not part of the copy unless referenced).