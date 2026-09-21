# Payout Rail — Claims Register

> Generated: 2026-09-21 · Sprint 0 (Prompt 0) · Discovery only.
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
| "burn → xReserve attestation → destination release → Yellow Card payout → NGN" pipeline | `README.md:6` | State machine + adapters encode this lifecycle | IMPLEMENTED (partially; release leg is simulated) |
| "14-state state machine (`PREFLIGHT_CHECK` → `settled`)" | `README.md:7` | `types.js:18-33` defines 14 states | IMPLEMENTED |
| "workers advancing every non-terminal disbursement one step per tick" | `README.md:8` | `pipelineWorker.js:100-152` | IMPLEMENTED |
| `BOS_PIPELINE_BATCH_SIZE` default **50** | `README.md:48`, `.env.example:27` | Code default is **25** (`pipelineWorker.js:19`) | FALSE (doc drift; code default 25) |
| `BOS_POLL_INTERVAL_MS` default **30000** | `README.md:49`, `.env.example:28` | Code default is **60000** (`fallbackPoller.js:11`) | FALSE (doc drift; module is dead) |
| `BOS_MAX_POLL_ATTEMPTS` default **10** | `README.md:50`, `.env.example:29` | Code default is **30** (`fallbackPoller.js:12`) | FALSE (doc drift; module is dead) |
| "14 states, 28+ transitions" | `README.md:63` | 45 registered transitions (23 explicit + 22 generic, `stateMachine.js`) | PARTIAL (28+ is an undercount; count is odd to audit) |
| "manual_review_queue as the human-in-the-loop escape hatch" | `README.md:74-75` | `manual_review_queue` table exists but is **never written**; `manual_review` is a status only | PARTIAL / PLANNED |
| "circuit breaker guarding the payout leg" | `README.md:75` | Only `CircuitBreaker.check()` is called; `recordFailure/recordSuccess/trip/reset` never called (`preflight.js:12`, grep) | PARTIAL (breaker cannot trip from real outcomes — no failures are ever recorded) |
| Worker table incl. `stuckStateReaper` 60s, `reconciliationWorker` 5 min, `pipelineWorker` 30s | `README.md:79-84` | `index.js:78-81`; code intervals match | IMPLEMENTED |
| Routes: "`GET\|POST /api/bos/monitoring/*` … (gated by `CRON_SECRET`)" | `README.md:89` | `CRON_SECRET` gates **only** the four `/cron/*` endpoints (`bosMonitoring.js:17-23,190-232`); `/run`, `/workers/pipeline/run`, `/active`, `/alerts`, `/manual-review` etc. are open | PARTIAL / MISLEADING |
| `POST /api/bos/webhooks/yellowcard[/test]` (non-production) | `README.md:90` | `webhooks.js:17-48` | IMPLEMENTED |

## 2. Claims in `docs/EXTRACTION_REPORT.md`

| Claim | Location | Evidence | Status |
|---|---|---|---|
| "Preserved verbatim: BOS logic files … `fallbackPoller.js`, … `webhookVerifier.js`, `auditTimeline.js`" | `EXTRACTION_REPORT.md:18-23` | Files present, but each uses `module.exports` in an ESM package and is **not imported** | VERBATIM-PRESERVED but DEAD (import probe fails) |
| "Payout-rail's `runMigrations` maintains a `schema_migrations` table and runs only un-applied files" | `EXTRACTION_REPORT.md:56-59` | `database.js:85-114` | IMPLEMENTED |
| "exchange_rates seed runs exactly once" | `EXTRACTION_REPORT.md:57` (C-06) | Runner + seed in `disbursementService.init` (`disbursementService.js:25-42`) | IMPLEMENTED |
| C-05 resolved: "the three `require('crypto')` calls were replaced with a single module-level `import crypto from 'node:crypto'`" | `EXTRACTION_REPORT.md:90-93` | `webhookVerifier.js:8`, `yellowcardAdapter.js:16` | IMPLEMENTED |
| "No tests were copied" | `EXTRACTION_REPORT.md:118` | No test files/devDeps/test script | CONFIRMED |

## 3. Claims in module headers / inline docs

| Claim | Location | Evidence | Status |
|---|---|---|---|
| `stateMachine.js`: "13 states, 24 transitions" | `stateMachine.js:2` | 14 states, 45 registered transitions | FALSE (header out of date) |
| `types.js`: "13 disbursement states" | `types.js:3` | 14 states defined | FALSE (header out of date) |
| `disbursementService.js:4`: "All operations are idempotent under duplicate worker execution" | `disbursementService.js:4` | Idempotency keys: `disbursement:{source_ref}:{amt}:{Date.now()}` (`:81`) — timestamp makes retries non-deterministic (C-04); burn/release/payout action keys are stable per disbursement | PARTIAL / FALSE for create (C-04) |
| `transitionActions.js:4`: "All actions are idempotent" | `transitionActions.js:4` | `submitBurn` uses `burn:{disbursement.id}`; `releaseDestination` no-op; `submitSend` uses `payout:{disbursement.id}` | IMPLEMENTED for the executed actions (create still C-04) |
| `StacksAdapter.js`: "burn … (SIP-010 burn)" | `StacksAdapter.js:217-218` | Broadcasts `burn` on `USDCX_CONTRACT` (`usdcx` token) | IMPLEMENTED but target entrypoint UNVERIFIED vs current docs |
| `xreserveAdapter.js:10-19`: "xReserve is an ON-CHAIN protocol … burn tx IS the attestation trigger … releaseDestination → no-op" | `xreserveAdapter.js:6-19` | Accurate self-description of the simulated adapter | IMPLEMENTED (as documented) / SIMULATED externally |
| `xreserveAdapter.js:205-218`: "There is no on-chain 'release' call … returns … status 'confirmed'" | `xreserveAdapter.js:205-218` | No-op confirmed | SIMULATED (release unverifiable) |
| `yellowcardAdapter.js:6-8`: "Auth: YcHmacV1 scheme — HMAC-SHA256 over (timestamp + apiKey + bodyHash)" | `yellowcardAdapter.js:6-8` | `_computeAuth` matches its own comment (`:55-67`) but public provider docs (docs.yellowcard.engineering) describe `YcHmacV1 {apiKey}:{signature}` + `X-YC-Timestamp` over (timestamp + path + method [+ body]) | UNVERIFIED / INCORRECT-vs-docs (see below) |
| `yellowcardAdapter.js:13`: "Reference: docs/yellowcard-api-reference.md" | `yellowcardAdapter.js:13` | File **does not exist** in repo | MISSING (blocker for verification) |
| `yellowcardAdapter.js:21`: `YELLOW_CARD_ENV` config | `yellowcardAdapter.js:21` | Env read but **never used** in the adapter | DEAD VARIABLE |
| `fallbackPoller.js` header describes active polling | `fallbackPoller.js:1-9` | Not imported anywhere (`index.js` starts only monitor/reaper/reconciliation/pipeline) | DEAD |
| `auditTimeline.js` header: "enriched with external status snapshots" | `auditTimeline.js:1-6` | Reads `external_status_snapshots` (`auditTimeline.js:48-53`) which is never written; module itself dead | DEAD |
| `webhookVerifier.js` header: "Validates webhook authenticity" | `webhookVerifier.js:1-6` | Module dead; route performs no verification | DEAD / NOT WIRED |

## 4. Functional claims vs observed wiring

| Claim | Evidence | Status |
|---|---|---|
| Webhook signature verification is active | `webhooks.js` routes call only `handleYellowCardWebhook`; global `express.json()` (`index.js:19`) destroys raw body; `webhookVerifier`/`verifyWebhookSignature` unreferenced | FALSE |
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
| xReserve attestation/release semantics | No provider credentials; modeled only; release is synthetic | UNVERIFIED |
| Yellow Card auth scheme | Public docs describe `YcHmacV1 {apiKey}:{signature}` + `X-YC-Timestamp`; adapter sends a JSON-envelope `Authorization` without `X-YC-Timestamp`, message = timestamp+apiKey+hex(bodyHash) (**no path, no method**) | INCORRECT/OUTDATED vs docs (pending the missing `docs/yellowcard-api-reference.md`) |
| Yellow Card send endpoint/payload | Adapter: `POST /send`, body `{amount, currency, recipientType, recipient, callbackUrl}` + `X-Idempotency-Key`. Docs reference updated Sends terminology / fields (e.g. `sequenceId`, `destination`) | UNVERIFIED / potentially OUTDATED |
| Yellow Card sandbox | Base URL `https://sandbox.api.yellowcard.io/business` hard-coded default production; no credentials | SANDBOX-CAPABLE (no sandbox evidence) |

## 6. Claims register summary

- **IMPLEMENTED:** lifecycle scaffolding, adapters (as described), workers, monitoring, gates/2PA/breaker classes, DB + migrations, webhook route, evidence writes (3/6).
- **FALSE / DOC-DRIFT:** README env defaults (batch size, poll interval, poll attempts); "gated by CRON_SECRET" for all monitoring; transition counts in headers; `external_tx_id` write claim; creation works claim; signature verification active claim.
- **DEAD:** `fallbackPoller`, `webhookVerifier`, `auditTimeline` (ESM/CommonJS break + not imported).
- **SIMULATED:** xReserve attestation (Hiro proxy), xReserve release (no-op), mock adapters.
- **UNVERIFIED / UNKNOWN:** all external provider behaviors without credentials; Yellow Card auth & payload vs current docs; Stacks burn entrypoint.
- **NOT IMPLEMENTED / PLANNED:** `amount_ngn_expected`, `exchange_rate`, `external_*_id` column population; release-write tables; manual-review queue/resolution API; disbursement create/approve/recover API; tests.