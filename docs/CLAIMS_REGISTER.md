# Payout Rail — Claims Register

> Generated: 2026-09-21 · Sprint 0 (Prompt 0) · Discovery only · **maintained through Sprint 7 (2026-09-23).**
> Every significant product/technical claim found in `README.md`, `.env.example`,
> `docs/*.md`, migration headers, and module headers is listed with evidence and a status.
>
> Status legend (from Prompt 0 §9, mapped to evidence attainable in this sprint):
> `IMPLEMENTED` · `TESTED` (automated test evidence) · `VERIFIED` (external system evidence) ·
> `SANDBOX VERIFIED` · `MOCKED` · `PLANNED` · `UNKNOWN`.
> Where a claim cannot be fully established, an additional tag (`PARTIAL` / `UNVERIFIED` /
> `FALSE` / `DEAD`) is used for precision. **No claim is upgraded merely because the code looks plausible.**

---

## 1. Claims in `README.md`

| Claim | Location | Evidence | Status |
|---|---|---|---|
| "burn → xReserve attestation → destination release → Yellow Card payout → NGN" pipeline | `README.md:6` | State machine + adapters encode this lifecycle | IMPLEMENTED (release model corrected in Sprint 2 — observed, not simulated; see `docs/SPRINT_2_REPORT.md` §3) |
| State machine (`PREFLIGHT_CHECK` → `settled`) | `README.md` §3 | `types.js:22-38` defines 15 states; 48 transitions registered (24 explicit + 24 generic) | IMPLEMENTED (reconciled Sprint 7 — 15 states / 48 transitions) |
| "workers advancing every non-terminal disbursement one step per tick" | `README.md:8` | `pipelineWorker.js:100-152` | IMPLEMENTED |
| `BOS_PIPELINE_BATCH_SIZE` default **50** | `README.md:48`, `.env.example:27` (both Sprint 0 era) | Code default is **25** (`pipelineWorker.js:19`) | RESOLVED (Sprint 7 — `README.md` §9 env reference and `.env.example:27` now state `25`) |
| `BOS_POLL_INTERVAL_MS` default **30000** | `README.md:49`, `.env.example:28` | Env var **removed** in Sprint 1.5 (G-14) with `fallbackPoller.js` (dead module, zero importers) | RESOLVED (doc drift source deleted; see `docs/SPRINT_1_5_REPORT.md` D3) |
| `BOS_MAX_POLL_ATTEMPTS` default **10** | `README.md:50`, `.env.example:29` | Env var **removed** in Sprint 1.5 (G-14) with `fallbackPoller.js` (dead module, zero importers) | RESOLVED (doc drift source deleted; see `docs/SPRINT_1_5_REPORT.md` D3) |
| "14 states, 28+ transitions" | `README.md:63` (Sprint 0 era) | 48 registered transitions (24 explicit + 24 generic, `stateMachine.js:40-209`); runtime check `getAllTransitions().length === 48` | RESOLVED (Sprint 7 — README rewritten; canonical 15 states / 48 transitions per `types.js:22-38` + `stateMachine.js`) |
| "manual_review_queue as the human-in-the-loop escape hatch" | `README.md:74-75` | `manual_review_queue` table exists but is **never written**; `manual_review` is a status only | PARTIAL / PLANNED |
| "circuit breaker guarding the payout leg" | `README.md:75` | Only `CircuitBreaker.check()` is called; `recordFailure/recordSuccess/trip/reset` never called (`preflight.js:12`, grep) | PARTIAL (breaker cannot trip from real outcomes — no failures are ever recorded) |
| Worker table incl. `stuckStateReaper` 60s, `reconciliationWorker` 5 min, `pipelineWorker` 30s | `README.md:79-84` | `index.js:78-81`; code intervals match | IMPLEMENTED |
| Routes: "`GET\|POST /api/bos/monitoring/*` … (gated by `CRON_SECRET`)" | `README.md:89` | `CRON_SECRET` gates **only** the four `/cron/*` endpoints (`bosMonitoring.js:17-23,190-232`); `/run`, `/workers/pipeline/run`, `/active`, `/alerts`, `/manual-review` etc. are open | PARTIAL / MISLEADING |
| `POST /api/bos/webhooks/yellowcard[/test]` (non-production) | `README.md:90` | `webhooks.js:17-48` | IMPLEMENTED |

## 2. Claims in `docs/EXTRACTION_REPORT.md`

| Claim | Location | Evidence | Status |
|---|---|---|---|
| "Preserved verbatim: BOS logic files … `fallbackPoller.js`, … `webhookVerifier.js`, `auditTimeline.js`" | `EXTRACTION_REPORT.md:18-23` | `fallbackPoller.js` **removed** in Sprint 1.5 (G-14); `webhookVerifier.js` is **wired live** in Sprint 0.5/3 (`webhooks.js:15`, `yellowcardAdapter.js:22`); `auditTimeline.js` is ESM-converted (imports cleanly; still not imported by the app — test-only) | VERBATIM-PRESERVED at extraction; disposition changed since (per import graph, Sprint 7 re-audit) |
| "Payout-rail's `runMigrations` maintains a `schema_migrations` table and runs only un-applied files" | `EXTRACTION_REPORT.md:56-59` | `database.js:85-114` | IMPLEMENTED |
| "exchange_rates seed runs exactly once" | `EXTRACTION_REPORT.md:57` (C-06) | Runner + seed in `disbursementService.init` (`disbursementService.js:25-42`) | IMPLEMENTED |
| C-05 resolved: "the three `require('crypto')` calls were replaced with a single module-level `import crypto from 'node:crypto'`" | `EXTRACTION_REPORT.md:90-93` | `webhookVerifier.js:8`, `yellowcardAdapter.js:16` | IMPLEMENTED |
| "No tests were copied" | `EXTRACTION_REPORT.md:118` | No test files/devDeps/test script | CONFIRMED |

## 3. Claims in module headers / inline docs

| Claim | Location | Evidence | Status |
|---|---|---|---|
| `stateMachine.js`: "13 states, 24 transitions" | `stateMachine.js:1-3` | Header now reads "15 states, observation-based destination release"; 48 registered transitions (24 explicit + 24 generic) | RESOLVED (Sprint 7 — header updated in Sprint; JSdoc and registration reconciled) |
| `types.js`: "13 disbursement states" | `types.js:1-2` | Header now reads "15 disbursement states"; `types.js:22-38` defines 15 states | RESOLVED (Sprint 7 — header reconciled to code) |
| `disbursementService.js:4`: "All operations are idempotent under duplicate worker execution" | `disbursementService.js:4` | Idempotency keys: `disbursement:{source_ref}:{amt}:{Date.now()}` (`:81`) — timestamp makes retries non-deterministic (C-04); burn/release/payout action keys are stable per disbursement | PARTIAL / FALSE for create (C-04) |
| `transitionActions.js:4`: "All actions are idempotent" | `transitionActions.js:4` | `submitBurn` uses `burn:{disbursement.id}`; `releaseDestination` no-op; `submitSend` uses `payout:{disbursement.id}` | IMPLEMENTED for the executed actions (create still C-04) |
| `StacksAdapter.js`: "burn … (SIP-010 burn)" | `StacksAdapter.js:217-218` | Broadcasts `burn` on `USDCX_CONTRACT` (`usdcx` token) | IMPLEMENTED but target entrypoint UNVERIFIED vs current docs |
| `xreserveAdapter.js:10-19`: "xReserve is an ON-CHAIN protocol … burn tx IS the attestation trigger … releaseDestination → no-op" | `xreserveAdapter.js:6-19` | Header rewritten in Sprint 2: the fabrication claims are removed; the adapter now OBSERVES (`observeDestinationRelease`) and never fabricates a `confirmed` release | RESOLVED (Sprint 2 — model corrected; external surface still SIMULATED / UNVERIFIED) |
| `xreserveAdapter.js:205-218`: "There is no on-chain 'release' call … returns … status 'confirmed'" | `xreserveAdapter.js:205-218` | The no-op `confirmed` release is REMOVED in Sprint 2; replaced by the 4-value `release_status` observation surface | RESOLVED (Sprint 2 — removed) |
| `yellowcardAdapter.js:6-8`: "Auth: YcHmacV1 scheme — HMAC-SHA256 over (timestamp + apiKey + bodyHash)" | `yellowcardAdapter.js:6-8` | `_computeAuth` now builds `Authorization: YcHmacV1 {apiKey}:{signature}` + `X-YC-Timestamp`, signing message = timestamp + signed path (`new URL(url).pathname`, no query) + method [+ base64(SHA256(body)) for POST/PUT]; signature = **base64** HMAC-SHA256. Matches docs.yellowcard.engineering; reference in `docs/yellowcard-api-reference.md`. Live sandbox verification still gated on credentials (see G-20). | RESOLVED (Sprint 3 — wire-level; external live UNVERIFIED) |
| `yellowcardAdapter.js:13`: "Reference: docs/yellowcard-api-reference.md" | `yellowcardAdapter.js:13` | `docs/yellowcard-api-reference.md` — created in Sprint 3 (auth scheme, base URLs, send/lookup payloads, webhooks, UNVERIFIED list) | RESOLVED (Sprint 3) — reference exists and is the acceptance baseline |
| `yellowcardAdapter.js:21`: `YELLOW_CARD_ENV` config | `yellowcardAdapter.js:21` | Env read but **never used** in the adapter | DEAD VARIABLE |
| `fallbackPoller.js` header describes active polling | `fallbackPoller.js:1-9` | Not imported anywhere (`index.js` starts only monitor/reaper/reconciliation/pipeline) | DEAD |
| `auditTimeline.js` header: "enriched with external status snapshots" | `auditTimeline.js:1-6` | Reads `external_status_snapshots` (`auditTimeline.js:48-53`) which is never written; module itself dead | DEAD |
| `webhookVerifier.js` header: "Validates webhook authenticity" | `webhookVerifier.js:1-6` | `webhooks.js:15,21-27` imports `verifyYellowCardWebhook` and verifies the **raw** body (`req.rawBody`) before handling; fails closed on missing secret; `verifyHmac` accepts hex/base64/base64url and checks `x-yc-signature` first | RESOLVED (Sprint 2 G-06 wired; Sprint 3 made decodings artifact-correct + `x-yc-signature` primary) |

## 4. Functional claims vs observed wiring

| Claim | Evidence | Status |
|---|---|---|
| Webhook signature verification is active | `webhooks.js` verifies the **raw** body (`req.rawBody`) before handling (`verifyRequest`, :21-27); unsigned / wrong signature / missing-secret → 401 with no state touched; verified payloads recorded as evidence | IMPLEMENTED |
| Preflight gates block the burn when they fail | `runPreflightCheck` records results only; `advanceDisbursement` picks `nextStates[0]` → `BURN_SUBMITTED` (`stateMachine.js:24-27`) | FALSE (fail-open) |
| 2-person approval is enforceable | `twoPersonApproval.check` returns `ok:false` only if approvals < 2 (>=$1000); but preflight failure does not block burn, and the payout guard (`destinationReleasedForPayout`) is downstream of an unreachable leg; **no route** calls `approve`/`requestApproval` | PARTIAL |
| Circuit breaker trips on real failures | `recordFailure/recordSuccess/trip/reset` never called | FALSE (dead write paths) |
| Whitelist registry rejects by default | `BOS_RECIPIENT_REGISTRY=null` → `NullRecipientRegistry.check` returns `eligible:false` (`RecipientRegistry.js:1-9`) | IMPLEMENTED (as designed) |
| `amount_ngn_expected` is available at payout time | Never written anywhere; read only at `transitionActions.js:216`; always null/0 → throws | FALSE / UNIMPLEMENTED |
| `disbursements.exchange_rate` populated | Never written | FALSE / UNIMPLEMENTED |
| Burn tx id lands in `disbursements.external_tx_id` | Written only to `external_refs` (`transitionActions.js:73-81`); `executeTransition` drops the field (`stateMachine.js:286`) | FALSE (C-01) |
| Reconciliation can catch unconfirmed burns | `reconcileUnrecordedBurns` skips disbursements with `external_tx_id` NULL (`reconciliationWorker.js:172`) | FALSE in practice (C-01) |
| Disbursement creation is possible | Single INSERT omits 2 NOT NULL columns (`disbursementService.js:96-111` vs `001:24-25`); plus no route calls it | FALSE (schema/code mismatch + no API) |
| Running app reaches `settled` for real flows | Requires passing every layer above; at minimum INSERT fails and burn confirm dead-ends | FALSE (violates claims of a working pipeline) |

## 5. Provider-verification claims (external)

| Claim | Evidence | Status |
|---|---|---|
| Stacks/USDCx withdrawal works per contracts | Canonical model: burn via `usdcx-v1` entry point; BOS burns on `usdcx` token contract | UNVERIFIED (needs ABI/chain verification) |
| xReserve attestation/release semantics | No provider credentials; modeled only. Sprint 2 removed the fabricated `releaseDestination()`/`getReleaseStatus()` pair — release is now the observed `release_status` surface (UNVERIFIED stub) | MODEL CORRECTED / UNVERIFIED EXTERNAL (see `docs/SPRINT_2_REPORT.md`) |
| Yellow Card auth scheme | Adapter sends `YcHmacV1 {apiKey}:{signature}` + `X-YC-Timestamp`; signing message = timestamp + signed path (note: the query is excluded) + method [+ base64(SHA256(body)) for POST/PUT]; signature = **base64** HMAC-SHA256; documented in `docs/yellowcard-api-reference.md`. Live sandbox proof blocked on credentials (G-20). | RESOLVED vs docs (Sprint 3 — wire-level; external live UNVERIFIED) |
| Yellow Card send endpoint/payload | Adapter: `POST {SENDS_BASE_URL}/send` with the documented Sends body `{sequenceId, channelType: 'bank'|'momo', country, currency, localAmount, forceAccept, destination}`; legacy `amount`/`recipient`/`recipientType`/`callbackUrl` and the `X-Idempotency-Key` header dropped. Wire-level per `docs/yellowcard-api-reference.md`. Live field precision (kobo vs USD, networkId) UNVERIFIED (G-20). | RESOLVED vs docs (Sprint 3) — external live UNVERIFIED |
| Yellow Card sandbox | Base URL `https://sandbox.api.yellowcard.io/business` hard-coded default production; no credentials | SANDBOX-CAPABLE (no sandbox evidence) |

## 6. Claims register summary

- **IMPLEMENTED:** lifecycle scaffolding, adapters (as described), workers, monitoring, gates/2PA/breaker classes, DB + migrations, webhook route, evidence writes. Sprint 4 closed G-16/G-17: **all six recorders live** (webhook, poll, manual-note, api, tx-hash, gate) plus the canonical `transition` record per successful transition and the `reconciliation_detection` type (4b writer); the four write-dead tables are wired and the two dead tables dropped (see `docs/PRODUCT_BASELINE.md`, `docs/GAP_REGISTER.md`).
- **FALSE / DOC-DRIFT:** poll env vars (removed Sprint 1.5); "gated by CRON_SECRET" for all monitoring; transition counts in headers (reconciled Sprint 7); `external_tx_id` write claim; creation works claim; signature verification active claim. (`BOS_PIPELINE_BATCH_SIZE` doc drift was corrected Sprint 7 — README §9 env reference and `.env.example` now state the code default `25`.)
- **DEAD (Sprint 7 re-audit):** `fallbackPoller` — **removed** in Sprint 1.5 (G-14), no longer in the tree. `auditTimeline` — ESM-converted in Sprint 1.5, imports cleanly, but is still **not imported by the app** (referenced only by its own unit test); treated as leftover pending wiring. `webhookVerifier` — **no longer dead**: wired live at `webhooks.js:15` and `yellowcardAdapter.js:22`.
- **SIMULATED:** xReserve attestation (Hiro proxy); xReserve destination-release **observation surface**
  (records exactly what it is told; the fabricated no-op was removed in Sprint 2); mock adapters.
- **UNVERIFIED / UNKNOWN:** all external provider behaviors without credentials; Yellow Card auth & payload vs current docs; Stacks burn entrypoint.
- **NOT IMPLEMENTED / PLANNED:** `amount_ngn_expected`, `exchange_rate`, `external_*_id` column population; manual-review resolution API; disbursement create/approve/recover API; tests. (Sprint 4 wired `manual_review_queue` enqueue + resolution-on-terminal, but the operator resolution API stays Sprint 5.)