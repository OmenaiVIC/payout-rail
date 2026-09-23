# Payout Rail — Product Baseline

> **ARCHIVED — historical snapshot (Sprint 7).**
> This is a Sprint 0 baseline snapshot of the repository. Rows below that describe
> pre-Sprint-3 auth and pre-Sprint-0.5/3 webhook handling **contradict current code**
> and must not be treated as current. It is **superseded by** `docs/ARCHITECTURE.md`
> and `docs/INTEGRATION.md`; links to it are preserved for provenance only.

> Generated: 2026-09-21 · Sprint 0 (Prompt 0) · Mode: discovery, classification, documentation.
> This document describes **what the repository actually is and does**, with `file:line` evidence.
> It intentionally does not describe intended behavior as implemented behavior.

> **Sprint 2 amendment (2026-09-21) — settlement model corrected (G-08).**
> §4 rows 6–7 and §6 are superseded: the fabricated `releaseDestination()`/`getReleaseStatus()` pair is
> **removed**. The app now records a `release_status` observation (`unobserved | observed_pending |
> observed_confirmed | observed_failed`) and reaches `destination_release_confirmed` only on observed
> confirmation. Rows below that still describe the no-op remain as history — see `docs/SPRINT_2_REPORT.md`.

---

## 1. Executive summary

`payout-rail` is the standalone extraction of the CineX **BOS (Bridge Orchestration Service)**
payout subsystem. It is a Node.js ESM Express application that models a four-leg payout pipeline
over PostgreSQL:

1. **Burn** — `StacksAdapter.burnUsdcx()` broadcasts a USDCx burn on Stacks.
2. **Attestation** — `xreserveAdapter.requestAttestation()` proxies a Hiro tx-status lookup.
3. **Destination release** — removed in Sprint 2 (G-08): the app **observes** external settlement
   evidence (`release_status`) instead of fabricating a release (see the Sprint 2 amendment + §6).
4. **Yellow Card payout** — `yellowcardAdapter.submitSend()` is a real REST client whose auth scheme
   and request payload are **unverified against current provider docs**.

**Verified operational status:** the running app wires DB init, migration runner, 4 background workers,
a monitoring API, and a webhook route — but **no real disbursement can complete the lifecycle as shipped**.
The following are confirmed blockers, in dependency order:

- **No way to create a disbursement that persists.**
  - The single `INSERT INTO disbursements` (`disbursementService.js:96`) omits
    `recipient_bank_account` and `recipient_bank_code`, both `NOT NULL` with no default
    (`migrations/001_bos_schema.sql:24-25`). Every creation attempt throws a NOT NULL violation.
  - No HTTP route calls `initiateDisbursement` anyway (`src/index.js` mounts only monitoring + webhooks).
- **Burn confirmation dead-ends (carry-forward C-01).** `submitBurn` returns `external_tx_id` but
  `executeTransition` only persists `settled_at|failed_at|cancelled_at|manual_review_at`
  (`stateMachine.js:286`); the tx hash is stored in `external_refs`, while `disbursements.external_tx_id`
  stays `NULL`. Guard `isBurnConfirmed` reads `disbursement.external_tx_id` (`transitionGuards.js:26-28`)
  and rejects on `NULL` → the burn never confirms → stuck-state reaper routes to manual review.
- **Preflight failure does not block the burn (fail-open, P0).** `runPreflightCheck` merely records gate
  results; `advanceDisbursement` always takes `nextStates[0]` (`disbursementService.js:174-178`) and for
  `preflight_check` the first next state is `BURN_SUBMITTED` guarded only by `disbursementExists`
  (`stateMachine.js:24-27`). Circuit-breaker / payout-gate / 2-person-approval failures are logged and
  recorded but **do not prevent burning**.
- **Yellow Card payout leg is unreachable.** `submitYellowCardPayout` throws when
  `amount_ngn_expected` is missing/zero (`transitionActions.js:216-218`), and no code path ever writes
  `amount_ngn_expected` (grep: read only here + dashboard queries). `disbursements.exchange_rate` is
  likewise never populated.

There are **no tests, no mocks, no fixtures, no CI**. All 31 `.js` files pass `node --check`
(syntax only). Three modules carry `module.exports` inside a `"type":"module"` project
(`webhookVerifier.js`, `fallbackPoller.js`, `auditTimeline.js`) and **will crash with
`ReferenceError: module is not defined in ES module scope` if imported**; none are imported by the
running app.

---

## 2. Repository snapshot

| Aspect | Finding | Evidence |
|---|---|---|
| Git | 2 commits on `main` (`e9bbbf2` extraction from CineX @ `8985b41`; `9316a68` docs import); clean tree | `git log`, `git status` |
| Node / npm | Node v24.12.0, npm 11.6.2 present | `node -v`, `npm -v` |
| `node_modules` | **Absent** | `Test-Path` |
| `.env` | **Absent** (only `.env.example`) | `git ls-files` |
| Package | `"type":"module"`, Node >=18; 8 runtime deps, **no devDependencies** | `package.json` |
| Tests | **None**: no test files, no `test` script, no test framework | `git ls-files`, `package.json` |
| Migrations | `001_bos_schema.sql` – `004_bos_e2e.sql`, tracked by `schema_migrations` runner | `database.js:85-114` |
| CI | None | repo tree |

### Source file inventory (31 files)

| File | Role |
|---|---|
| `src/index.js` | Express entry point; wires context, adapters, workers, routes |
| `src/database.js` | Pool (`pg` / Neon), `PgClient`, migration runner |
| `src/config/chainConfig.js` | Network-aware Stacks config (USDCx, Hiro, explorer, PAYOUT_API_BASE_URL) |
| `src/routes/webhooks.js` | `POST /yellowcard`, `POST /yellowcard/test` |
| `src/routes/bosMonitoring.js` | Monitoring/dashboard/cron endpoints |
| `src/services/bos/types.js` | 15-state enum, terminal/failed sets, JSDoc types, `ReleaseStatus` enum |
| `src/services/bos/stateMachine.js` | Transition registry + `executeTransition` |
| `src/services/bos/transitionGuards.js` | Guards (incl. unused `hasValidExchangeRate`) |
| `src/services/bos/transitionActions.js` | Side-effect actions + `external_refs` upsert |
| `src/services/bos/disbursementService.js` | Orchestrator: initiate/advance/retry/recover/webhook |
| `src/services/bos/preflight.js` | Circuit breaker + 2PA + `runAllGates` preflight |
| `src/services/bos/payoutGates.js` | 6 payout gates |
| `src/services/bos/circuitBreaker.js` | Breaker (only `check()` is called) |
| `src/services/bos/twoPersonApproval.js` | 2-of-N approvals (no route exposes it) |
| `src/services/bos/RecipientRegistry.js` | Null / Permissive registries |
| `src/services/bos/StacksAdapter.js` | Hiro client + USDCx burn broadcast |
| `src/services/bos/xreserveAdapter.js` | Attestation proxy + **observation-only release surface** (Sprint 2: `observeDestinationRelease`, no release call) |
| `src/services/bos/yellowcardAdapter.js` | Yellow Card REST client |
| `src/services/bos/bridgeAdapterFactory.js` | Adapter selection + in-memory mock |
| `src/services/bos/pipelineWorker.js` | 30s advance loop (batch 25, interval 30000) |
| `src/services/bos/stuckStateReaper.js` | 60s SLA reaper → manual review |
| `src/services/bos/reconciliationWorker.js` | 5min burn/payout drift scan |
| `src/services/bos/fallbackPoller.js` | **Dead** (`module.exports`; not imported) |
| `src/services/bos/webhookVerifier.js` | **Dead** (`module.exports`; not imported) |
| `src/services/bos/auditTimeline.js` | **Dead** (`module.exports`; not imported) |
| `src/services/bos/evidenceCollector.js` | Evidence writes (3 of 6 recorders used) |
| `monitoring/monitorJob.js` | 5min SLA/webhook/rate checks |
| `monitoring/thresholdConfig.js` | SLA thresholds + reaper multipliers |
| `monitoring/alertDeduplicator.js` | `bos_alerts` dedup + ack |
| `monitoring/dashboardQueries.js` | Dashboard read queries |
| `monitoring/notifier.js` | Slack/email/console notifications |

---

## 3. Architecture map (as implemented)

```
Express app (src/index.js)
  ├─ GET /health, GET /warmup
  ├─ /api/bos/monitoring/*            (bosMonitoring.js — mostly OPEN, see notes)
  ├─ /api/bos/webhooks/yellowcard[/test]  (webhooks.js — NO signature verification)
  │
  ├─ context: { getDb, adapters, recipientRegistry, emitEvent, getLogger }
  │
  ├─ DisbursementService (orchestrator)
  │    initiate → advance → retry → recover → handleYellowCardWebhook
  ├─ StateMachine (48 registered transitions: explicit + generic)
  │    ├─ Guards  (transitionGuards.js)
  │    └─ Actions (transitionActions.js)
  │                └─ evidenceCollector (recordApiResponse/TxHash/GateResult)
  ├─ Preflight (preflight.js) → circuitBreaker.check → runAllGates → twoPersonApproval.check
  │
  ├─ Workers (started from index.js)
  │    ├─ pipelineWorker           30s  — advance one step per disbursement
  │    ├─ stuckStateReaper         60s  — SLA → manual_review
  │    ├─ reconciliationWorker     5min — unrecorded burns / orphaned payouts
  │    └─ monitorJob               5min — alerts (notifier: Slack/email/console)
  │
  ├─ Adapters (bridgeAdapterFactory)
  │    ├─ stacks     → StacksAdapter (Hiro + burn tx)
  │    ├─ xreserve   → xreserveAdapter (Hiro tx proxy + observation-only surface)
  │    └─ yellowcard → yellowcardAdapter (REST client)
  │
  └─ Persistence (database.js → Postgres / Neon)
       migrations 001–004 → 14 tables incl. schema_migrations
       Write-active: disbursements, disbursement_audit, external_refs, payout_gates,
                     two_person_approvals, circuit_breaker_state, bos_alerts,
                     disbursement_evidence, exchange_rates(seed)
       Wired (Sprint 4): yellow_card_webhook_events, on_chain_events,
                     external_status_snapshots, manual_review_queue
       Removed (migrations/008_sprint_4.sql): relay_wallet_activity, config_snapshots
```

Notes:
- **Sprint 4 evidence model** (`evidenceCollector.js`, plan §2): every evidence record is a v1 envelope
  `{v, event_type, source, external_ref, observed_at, status, payload_hash, verification, details}` with a
  `crypto.randomUUID` id and a deterministic `sha256` over the stable canonical payload — **raw PII and
  sensitive financial payloads are never stored** (hashes + sanitized summaries only). `executeTransition`
  writes exactly one canonical `transition` record per successful transition, after the audit row, with the
  leg's external id linked as `external_ref` (payout_id > attestation_id > external_tx_id). External-observation
  recorders also append one `external_status_snapshots` row each.
- The four write-dead tables are now live (G-16 closed): webhook journal rows, `on_chain_events`
  broadcast/confirmation rows, observation snapshots, and `manual_review_queue` items via the open-row
  `ON CONFLICT` guard (migration 008 partial unique index). `relay_wallet_activity` and `config_snapshots`
  were dropped (reasons in `POSTPONED_BACKLOG.md` S4-1/S4-2).

Notes:
- `disbursements.external_tx_id / attestation_id / payout_id / release_status` are written by Sprint 0.5/1.5/2
  transitions via the `PERSISTED_ACTION_FIELDS` whitelist (`stateMachine.js:22-32`). `release_id` was the
  synthetic id of the removed `releaseDestination()` call and is **retired** (never written again).
- `executeTransition` persists only whitelisted fields from action returns (`stateMachine.js:22-32`);
  anything else is recorded in the audit log but never persisted to the row.
- Monitoring routes are authenticated with `CRON_SECRET` **only on the four `/cron/*` endpoints**
  (`bosMonitoring.js:17-23,190-232`). All other endpoints (`/pipeline`, `/active`, `/alerts`,
  `/manual-review`, `/run`, `/workers`, `/workers/pipeline/run`, `/disbursement/:id/timeline`,
  `/alerts/:id/acknowledge`) are **open** when `CRON_SECRET` is unset. `POST /run` and
  `POST /workers/pipeline/run` are state-changing and unauthenticated in that default.

---

## 4. Payout lifecycle trace (what actually happens)

`initiateDisbursement({...})` — internal function, no route.

| # | Step | Code | Actual outcome |
|---|---|---|---|
| 1 | Insert requirement | `disbursementService.js:96-111` | **INSERT fails**: omits `recipient_bank_account` / `recipient_bank_code` (`NOT NULL`, `001:24-25`); also `idempotency_key` is timestamp-based (`C-04`). |
| 1b | (if inserted) FIRST transition | `disbursementService.js:129-135` → `executeTransition` → `runPreflightCheck` | Preflight gates recorded (`payout_gates`), message logged; **no state effect** — record stays `preflight_check` regardless of pass/fail. |
| 2 | Advance | `pipelineWorker._tick` → `advanceDisbursement` | For `preflight_check`, `nextStates[0]` = `BURN_SUBMITTED` guarded only by `disbursementExists` (`stateMachine.js:24-27`); **fails open**. `whitelist` gate (`NullRecipientRegistry`, default) and `attributable_funds` do **not** block. |
| 3 | Burn | `submitBurn` → `StacksAdapter.burnUsdcx` (`StacksAdapter.js:224-237`) | Broadcasts `burn` on `USDCX_CONTRACT` (`usdcx` token contract). Needs `PAYOUT_TX_SIGNING_KEY` or throws (`StacksAdapter.js:40,226`). Tx id stored in `external_refs` (`transitionActions.js:73`); `disbursements.external_tx_id` stays `NULL`. |
| 4 | Burn confirm | `isBurnConfirmed` (`transitionGuards.js:26-38`) | Rejects: `No external tx_id on record` (column `NULL`). **Dead-end** → reaper → `manual_review`. |
| 5 | Attestation | `requestAttestation` → `xreserveAdapter` | Only reachable if burn confirmed (isn't). Proxies Hiro tx status; `attestation_id = tx_id` (`xreserveAdapter.js:169-178`). Never populates `disbursements.attestation_id`. |
| 6 | Release | ~~`releaseDestination`~~ → **removed in Sprint 2.** `beginReleaseObservation` parks `destination_release_unobserved` with `release_status='unobserved'` and makes **no** adapter call (`transitionActions.js:157-168`). The external settlement surface releases USDC to the destination wallet on its own; the app records `observeDestinationRelease` evidence exactly as observed (`transitionActions.js:177-203`). |
| 7 | Release confirm | ~~`getReleaseStatus` (Hiro tx proxy)~~ → **removed in Sprint 2.** `destination_release_observed → destination_release_confirmed` requires a fresh `observed_confirmed` observation (`transitionGuards.js:110-119`); the payout guard additionally requires the persisted `release_status='observed_confirmed'` (`transitionGuards.js:145-153`). |
| 8 | Yellow Card | `submitYellowCardPayout` | **Unreachable**: throws if `amount_ngn_expected` missing/zero (`transitionActions.js:216-218`), which is always. Also requires gate/2PA guard `destinationReleasedForPayout` (`transitionGuards.js:101-118`). |
| 9 | Webhook confirm | `handleYellowCardWebhook` → `advanceDisbursement` | Route exists; `express.json()` global middleware means **no raw body, no signature verification** (`index.js:19`, `webhooks.js:17-25`). |
| 10 | Settled | `markSettled` | Terminal state reachable only via an unverifiable path or manual review resolution. |

No code path writes `disbursements.amount_ngn_expected`, `exchange_rate`, `external_tx_id`,
`attestation_id`, `release_id`, or `payout_id` (verified by grep).

---

## 5. Integration classification matrix

| Integration | Component | Classification | Evidence |
|---|---|---|---|
| Stacks — tx interaction | `StacksAdapter.burnUsdcx` | **REAL API implementation** (broadcasts a real contract call via Hiro) — burn function/entrypoint choice **UNVERIFIED** against current USDCx docs | `StacksAdapter.js:224-237`; docs show burn via `.usdcx-v1` entrypoint, code targets the `usdcx` token contract |
| Stacks — tx lookup | `getTxStatus` / `getTransactionStatus` | **REAL API implementation** (Hiro `/extended/v1/tx`) | `StacksAdapter.js:177-214` |
| Stacks — event handling / withdrawal tracking | `on_chain_events` table | **NOT IMPLEMENTED** — table exists (`001:182-197`), no code writes or reads it | grep |
| USDCx burn usability | — | **INCOMPLETE** — silent skip if signing key missing; real funds require key + gas | `StacksAdapter.js:36-50,225-226` |
| xReserve — attestation | `requestAttestation`/`getAttestationStatus` | **SIMULATED** — proxy of Hiro tx status, no actual attestation service call | `xreserveAdapter.js:14-19,169-203` |
| xReserve — release | `observeDestinationRelease` (**Sprint 2**) | **OBSERVATION MODEL** — the fabricated `releaseDestination`/`getReleaseStatus` pair is removed; the surface returns evidence only (`unobserved` default, source `xreserve.unverified`), external truth UNVERIFIED | `xreserveAdapter.js:20-22,85-128` |
| xReserve — health | `healthCheck` | **REAL** (Hiro reachability + contract presence) | `xreserveAdapter.js:262-296` |
| Yellow Card — payout initiation | `submitSend` (POST `/send`) | **REAL REST client**; request shape + auth **UNVERIFIED/OUTDATED** vs current public docs | `yellowcardAdapter.js:147-176` |
| Yellow Card — status | `lookupSend`, `listSends`, `getSendFee`, `resolveBankAccount`, `getChannels`, `getRates` | **REAL REST client** (calls implemented); exact endpoints/auth unverified | `yellowcardAdapter.js:185-387` |
| Yellow Card — HMAC/signature | `_computeAuth` | **INCORRECT/OUTDATED vs public docs** (JSON-envelope `Authorization`, no `X-YC-Timestamp`, message lacks path+method; docs specify `YcHmacV1 {apiKey}:{signature}` + `X-YC-Timestamp`) | `yellowcardAdapter.js:55-67`; `docs/yellowcard-api-reference.md` referenced at `:13` is **missing** |
| Yellow Card — webhook verify | `verifyWebhookSignature`/`signWebhook` | Implemented in adapter but **never wired** into the route | `yellowcardAdapter.js:121-129`; `webhooks.js` |
| Webhooks (inbound) | `/api/bos/webhooks/yellowcard` | **IMPLEMENTED route, NO signature verification** (no raw body; `webhookVerifier.js` dead) | `index.js:19`, `webhooks.js:17-25` |
| Sandbox capability | Yellow Card `sandbox.api.yellowcard.io` | **SANDBOX-CAPABLE in principle** — no credentials, no sandbox run evidence → NOT SANDBOX VERIFIED | `yellowcardAdapter.js:10-11,18` |
| Mock adapters | `BRIDGE_ADAPTER_ENV=mock` | **MOCKED** (in-memory canned responses), only ever used if env set | `bridgeAdapterFactory.js:54-83` |
| Polling fallback | `fallbackPoller.js` | **DEAD** — not imported; `module.exports` → crashes under ESM | probe result; `index.js` |
| Retries | `withinRetryBudget` + `retryDisbursement` | **IMPLEMENTED** but `retryDisbursement` has no caller/route | `transitionGuards.js:174-180`, `disbursementService.js:188-245` |
| Reconciliation | `reconciliationWorker` | **IMPLEMENTED** (burn scan + payout scan) but burn scan is dead in practice due to C-01 (`external_tx_id` NULL → `continue`) | `reconciliationWorker.js:154-217` |
| Monitoring / alerting | `monitorJob`, `alertDeduplicator`, `notifier` | **IMPLEMENTED** (checks run; notifier to Slack/email/console) | `monitorJob.js`, `notifier.js` |
| Manual review | `manual_review` status + monitoring view | **PARTIAL** — status transitions exist; `manual_review_queue` table never written; no resolution route | grep; `001:141-157` |

---

## 6. Settlement model verification (xReserve / USDCx)

Canonical withdrawal lifecycle (current Stacks/USDCx + xReserve model, per public docs):

1. User invokes a **burn of USDCx** on Stacks via the `usdcx-v1` protocol entrypoint.
2. USDCx token contract emits the burn; the burn is the attestation trigger.
3. a **Stacks assestation service** detects the burn and signs a burn-intent message.
4. The burn intent + signature is forwarded to **xReserve's attestation service**.
5. xReserve verifies and issues an attestation and **releases USDC to the destination wallet**
   — **an Ethereum/USDC destination address**, not a BTC address.
6. The app's role is to **initiate the burn and observe status**; attestation and release are
   external, off-chain processes the app should query/record — not re-implement.

| Canonical step | BOS implementation (Sprint 2, corrected) | Verdict |
|---|---|---|
| Burn on `usdcx-v1` entrypoint | Burn called on `USDCX_CONTRACT` (`usdcx` token) via `chainConfig.getBurnTarget()` seam | **UNVERIFIED / POSSIBLY INCORRECT** target contract (G-09) — seam extracted for a one-site correction |
| Burn triggers attestation | Burn tx id is captured (in `external_refs` + `disbursements.external_tx_id`) | Correct direction |
| Stacks attestation service signs intent | Not modeled | absent |
| xReserve verifies burn, issues attestation | Simulated as Hiro tx-status proxy (`attestation_id = tx_id`) | **SIMULATED** |
| xReserve releases USDC to destination USDC wallet | **MODEL CORRECTED (Sprint 2):** the fabricated `releaseDestination()` is removed. The app records an observation (`release_status` = `unobserved`/`observed_pending`/`observed_confirmed`/`observed_failed`) returned by `xreserveAdapter.observeDestinationRelease`, and reaches `destination_release_confirmed` only on `observed_confirmed` (guard + persisted column). The real observation surface is a fail-closed UNVERIFIED stub (`xreserve.unverified`) | **MODEL CORRECTED / UNVERIFIED EXTERNAL** (see `docs/SPRINT_2_REPORT.md`) |
| App observes/records external evidence | `observeDestinationRelease` payload recorded via `recordApiResponse` + observation external_ref (`transitionActions.js:177-239`) | Implemented |
| BOS cannot independently prove release | Acknowledged: no-evidence rows park in `destination_release_unobserved` and time out to `manual_review` via the reaper (`stuckStateReaper.js:17-24`) | Corrected — never asserts unproven confirmation |

**Correction requirement (per Prompt 0 §4) — STATUS: IMPLEMENTED in Sprint 2.** The destination-release
leg is re-modeled so the app **observes and records** external settlement status instead of fabricating
confirmation; the BTC release target ("`creator_btc_address`") is gone with the removed action. What
remains UNVERIFIED is the real external surface itself (xReserve attestation → off-chain USDC release);
with the stub, a real deployment parks in `unobserved` and times out — by design.

---

## 7. Test baseline

Per Prompt 0 §6 ("Run the existing test suite / record why it cannot run"):

- **Total tests: 0.** No `test` script (`package.json:7-10`), no test files in git, no
  devDependencies.
- **Passing: 0 · Failing: 0 · Skipped: 0 · Errors: 0.**
- **Environmental blockers:**
  - `node_modules` absent and dependency install is out of scope for Sprint 0, so no runtime
    dependency-loaded suite can run.
  - No `DATABASE_URL` (`.env` absent), so DB-backed integration tests cannot run.
  - No provider credentials for any sandbox.
- **Static gates applied instead:** all 31 `.js` files pass `node --check`; a targeted probe showed
  `webhookVerifier.js`, `fallbackPoller.js`, and `auditTimeline.js` each fail ESM import with
  `ReferenceError: module is not defined in ES module scope` (CommonJS `module.exports`).
- CineX did not copy its BOS test (`EXTRACTION_REPORT.md:28,118`).

---

## 8. What is / is not implemented

**Implemented (verified):** DB layer + tracked migrations; 15-state enum; 48-transition registry;
initiate/advance/retry/recover/webhook orchestration functions; 6 payout gates; 2-person-approval +
circuit-breaker classes (check-only); 3 real adapters (Stacks real, xReserve simulated + observation-only
release, Yellow Card REST); 4 background workers; monitoring checks + alerting + dashboard queries; webhook route.

**Partially implemented:** preflight gating (records, doesn't block); manual review (status only);
reconciliation (burn leg inert due to C-01); evidence (3 of 6 recorders used).

**Mocked / simulated:** xReserve attestation (Hiro proxy); the destination-release **observation surface**
(records exactly what the mock reports, never fabricates); mock adapter factory (`BRIDGE_ADAPTER_ENV=mock`).

**Incomplete:** inbound signature verification; public disbursement API; manual-review resolution;
`amount_ngn_expected`/`exchange_rate` population; write-active use of 6 schema tables.

**Externally dependent:** real burn broadcasting (needs `PAYOUT_TX_SIGNING_KEY` + funded Stacks
wallet); any provider call; alert email (SMTP creds).

**Not implemented:** tests, CI, event-source ingestion, campaign/escrow integration (source data),
any route to create/approve/resolve disbursements.

**Known limitations:** see `docs/GAP_REGISTER.md` (P0–P3).

---

## 9. Cross-references

- `docs/EXTRACTION_REPORT.md` — provenance, 15 deviations, carry-forwards including C-01 … C-07.
- `docs/POSTPONED_BACKLOG.md` — C-01 (postponed, Sprint 1), C-04 (must-fix before Sprint 3).
- `docs/CLAIMS_REGISTER.md` — every product/technical claim vs evidence.
- `docs/GAP_REGISTER.md` — P0–P3 issues with required fixes.