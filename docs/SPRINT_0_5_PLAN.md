# Sprint 0.5 — Minimum Viable Path · Plan

> Source task: `docs/prompts/03a_SPRINT_0_5_MVP_PATH.md`
> Mode: plan-first. **This document is the Step-3 deliverable. No source code is changed by this step.**
> Baseline verified against working tree on 2026-09-21. `node --check` passes on all `src/**/*.js`; no test files exist.

---

## 1. Goal

Make a single payout complete end-to-end **in mock mode**, with tests, by fixing six gaps (G-01..G-06). The state machine is **not** redesigned — its structure, states, transitions, guards, actions and workers are kept. Only the broken plumbing is repaired.

**Definition of done for the sprint:** all six fixes have tests; one command runs the suite; the mock test walks the full lifecycle; `SPRINT_0_5_REPORT.md` records evidence and deviations; CineX untouched.

---

## 2. Change classification (per `docs/PRODUCT_CHANGE_CONTROL.md`)

| # | Work item | Class | Rationale |
|---|-----------|-------|-----------|
| 1 | G-01 fail-closed preflight + result persistence | **A** | Required by acceptance #2; explicitly requested by the sprint |
| 2 | G-02 create persists NOT NULL recipient columns | **A** | Required by acceptance #1 |
| 3 | G-03 disbursement HTTP API (create/get/advance) | **A** | Required by acceptance #1 |
| 4 | G-04 populate `amount_ngn_expected` + `exchange_rate` | **A** | Required by acceptance #4 |
| 5 | G-05 persist `external_tx_id` on `disbursements` | **A** | Required by acceptance #3 |
| 6 | G-06 webhook raw body + HMAC verification | **A** | Required by acceptance #5 |
| 7 | Test framework + mock adapter harness | **A** | Required by acceptance #6–8 |
| 8 | Persist sibling id columns (`attestation_id`/`release_id`/`payout_id`) | **B** | Same defect class as G-05; columns already exist (G-12). Product correctness |
| 9 | Remove direct `disbursement_initiated → burn_submitted` bypass edge | **B** | Fail-closed correctness: the bypass contradicts G-01 |
| 10 | Convert `webhookVerifier.js` to ESM / single verifier | **B** | Required to wire G-06 safely (G-14 subset) |
| 11 | Operator actor model / authz roles | **blocker** | Not implementable without a decision (§8) |
| 12 | G-11 deterministic idempotency key, G-10 manual-review resolution surface, G-13 breaker failure recording | **D/E** | Out of sprint scope → `docs/POSTPONED_BACKLOG.md` |

Nothing in this plan expands the product. Items 11–12 are reported, not built.

---

## 3. Test framework and harness proposal

**Test runner: `node:test` + `node:assert/strict` (built-in). No new dependency.**

Rationale: Node >= 18 is already required; `node --test` gives a single-command run, TAP output for evidence, and no config — satisfying acceptance #7 and #8 with zero supply-chain addition. `vitest` was considered and rejected for this sprint: it adds a dependency, a transform pipeline, and ESM config for no gain on a no-framework codebase.

Proposed `package.json` scripts:

```jsonc
"test":             "node --test --test-concurrency=1 test/",
"test:unit":        "node --test --test-concurrency=1 test/unit/",
"test:e2e":         "node --test --test-concurrency=1 test/e2e/",
"test:integration": "node --test --test-concurrency=1 test/integration/"
```

`--test-concurrency=1` keeps DB fixtures and the shared `NODE_ENV`/env-var expectations deterministic.

### 3.1 Database strategy (default suite = zero infra, zero credentials)

Two layers, deliberately separated:

- **Default suite (`test/unit` + `test/e2e`) — `FakeDb`.** A small in-repo test double implementing the same surface as `PgClient` (`get`, `run`, and `all` if present in `src/database.js`). It holds in-memory arrays for only the tables the pipeline touches (`disbursements`, `external_refs`, `disbursement_evidence`, `payout_gates`, `circuit_breaker_state`, `two_person_approvals`) and interprets the specific statements the code issues. This runs with no Postgres, no Docker, no credentials.
- **Opt-in suite (`test/integration`) — real Postgres.** Tests that actually exercise migrations and shell constraints (notably G-02's `NOT NULL`) run only when `TEST_DATABASE_URL` is set, and **skip** (not fail) otherwise, so the default command stays green and credential-free.

**Honesty note (important):** `FakeDb` validates orchestration and guards, but it does **not** execute SQL, so it cannot by itself prove a `NOT NULL` violation is gone. The G-02 regression is therefore two tests: a `FakeDb` test asserting the INSERT statement carries the columns, plus a Postgres-gated test asserting a real row inserts. `pg-mem` was considered as a single layer and rejected for now: its coverage of `gen_random_uuid()`, `JSONB`, partial indexes and `ON CONFLICT` in `migrations/*.sql` is not reliable enough to be the source of truth, and a fragile emulator would produce false confidence on the exact constraint this sprint must fix.

### 3.2 Adapter strategy (the mock E2E enabler)

`src/services/bos/bridgeAdapterFactory.js` returns a **mock only for xReserve**. `getStacksAdapter()` and `getYellowCardAdapter()` always return the real adapters. Acceptance #6 requires `BURN_CONFIRMED` and the Yellow Card legs to succeed, which in mock mode can only happen if those adapters are stubbed too.

**Proposed approach:** the E2E test constructs its own `ctx` (same shape as `ensureInit()` in `src/index.js`: `getDb`, `adapters`, `recipientRegistry`, `bosCtx`, `getLogger`) and injects in-memory mock `stacks` and `yellowcard` adapters. This keeps all mock machinery **test-only** and does not change production adapter selection. Production mock mode is left as-is.

- Mock `stacks`: `burnUsdcx()` → deterministic `0x<txid>`; `getTransactionStatus()` → `{ tx_status: 'success', block_height: 1 }`.
- Mock `yellowcard`: `verifyWebhookSignature()` (or the shared verifier), `createPayout()` → `{ payout_id, status: 'confirmed' }`, plus a status reader for reconciliation.
- `xreserve` already has a mock path via `BRIDGE_ADAPTER_ENV=mock`.

**Deviation:** the baseline's "mock mode" only covered xReserve. The sprint's acceptance #6 requires a broader mock seam. This is classified A and recorded in §7.

---

## 4. Fixes, file-by-file

Every gap below lists: confirmed mechanism → files to change → interfaces affected → tests.

### G-02 · Disbursements cannot be created (P0)

**Confirmed mechanism.** The only INSERT (`src/services/bos/disbursementService.js:96-111`) omits `recipient_bank_account` and `recipient_bank_code`, which are `TEXT NOT NULL` with no default (`migrations/001_bos_schema.sql:24-25`) → NOT NULL violation on every create.

**Fix direction.** Accept `recipient_bank_account` and `recipient_bank_code` in `initiateDisbursement()` and include them in the INSERT. Validate presence/format before inserting and fail closed with a clear error code. (Alternative — relax the columns — is rejected: the fields are genuinely required by the payout leg.)

**Files to change**
- `src/services/bos/disbursementService.js` — `initiateDisbursement()` signature + INSERT column list + input validation.
- `src/routes/disbursements.js` (new, see G-03) — pass the fields through from the request body.

**Interfaces affected.** `initiateDisbursement(params, ctx)` gains two required params. No transition/guard signature changes.

**Tests to create**
- `test/unit/disbursement-create.test.js` — missing bank fields ⇒ rejected, no row inserted (fail-closed).
- `test/unit/disbursement-create.test.js` — valid input ⇒ INSERT includes both columns.
- `test/integration/disbursement-create.pg.test.js` (gated on `TEST_DATABASE_URL`) — a real row inserts against `001`.

---

### G-03 · No public API to create / get / advance (P0)

**Confirmed mechanism.** `src/index.js` mounts only monitoring and webhooks; there is no HTTP caller for `initiateDisbursement`, `advanceDisbursement`, `retryDisbursement`, `recoverStuckDisbursement`, `twoPersonApproval.approve`, or manual-review resolution.

**Fix direction.** Add a new router `src/routes/disbursements.js` with the sprint minimum plus the cheap adjacent operations:

| Method | Path | Service call | Sprint requirement |
|--------|------|--------------|--------------------|
| POST | `/api/disbursements` | `initiateDisbursement` | required (acceptance #1) |
| GET | `/api/disbursements/:id` | `getDisbursement` | required |
| POST | `/api/disbursements/:id/advance` | `advanceDisbursement` (1 step; optional `?steps=n`) | required |
| GET | `/api/disbursements` | list (bounded, no new query surface beyond a simple SELECT) | low-cost, aids E2E/ops |
| POST | `/api/disbursements/:id/retry` | `retryDisbursement` | low-cost |
| POST | `/api/disbursements/:id/recover` | `recoverStuckDisbursement` | low-cost |

**Not added in this sprint:** `approve`, manual-review resolve. Both depend on an actor model that does not exist (§8, blocker). Two-person approval only engages at `amount_usd >= 1000` (`twoPersonApproval.js:3,7-10`); the E2E uses an amount below threshold and does not depend on it. Leaving the endpoints out is a deliberate, documented boundary, not an oversight.

**Auth (fail-closed by default).** New middleware in the router: constant-time compare of a bearer token from `BOS_API_TOKEN`. If the token is unset, requests are **rejected** unless `BOS_ALLOW_UNAUTHENTICATED_DEV=true` (a loud, non-production escape hatch for local runs). Deferred properly to the actor model once decided.

**Files to change**
- `src/routes/disbursements.js` (new).
- `src/index.js` — mount `/api/disbursements` and `express.json()` ordering for the webhook raw-body path (G-06).

**Interfaces affected.** New HTTP surface only. No service signature changes beyond G-02.

**Tests to create**
- `test/unit/disbursements-routes.test.js` — unauthenticated request rejected when token set; rejected when token unset and no dev flag; accepted with dev flag.
- `test/unit/disbursements-routes.test.js` — create → 201 with id; get → 200; advance → state moves one step.
- `test/e2e/mock-lifecycle.e2e.test.js` — drives create via the route, then advance to completion (shared with acceptance #6).

---

### G-01 · Preflight failure does not block the burn (P0)

**Confirmed mechanism.**
- `runPreflightCheck` only records gate results and logs; the `{preflight_result}` it produces is dropped by `executeTransition` (`src/services/bos/stateMachine.js`, extra-field whitelist) — `transitionActions.js:41-52`.
- `advanceDisbursement` always selects `nextStates[0]` (`disbursementService.js:174-178`).
- For `preflight_check`, `nextStates[0]` is `burn_submitted`, guarded only by `disbursementExists` (`stateMachine.js:24-27`).
- A direct `disbursement_initiated → burn_submitted` edge also exists, bypassing preflight entirely.
- Net effect: circuit breaker / payout gates / two-person approval are cosmetic; the burn proceeds past a failed gate.

**Fix direction (local to preflight plumbing and one guard; no state-machine redesign).**
1. `runPreflightCheck` returns `{ preflight_result: { ok, gate_results } }` (and still records gate rows).
2. `executeTransition` persists a whitelisted `preflight_result` field on `disbursements` (new column, migration 005).
3. New guard `preflightPassed` — true iff persisted `preflight_result.ok === true`; attach it to the `preflight_check → burn_submitted` transition.
4. `advanceDisbursement` no longer blindly takes `nextStates[0]`: when the chosen transition's guard fails, it selects the state's failure transition if one exists (here `manual_review`), otherwise leaves the row in place and returns the guard reason. This is the fail-closed behavior and the required change to extraction-faithful code.
5. Remove the bypass edge `disbursement_initiated → burn_submitted` so preflight cannot be skipped.

**New migration.** `migrations/005_sprint_0_5.sql` — `ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS preflight_result JSONB;`. (No new table; `payout_gates` and `disbursement_evidence` already exist.)

**Interfaces affected.** `advanceDisbursement` return shape gains a guard-failure reason; `executeTransition` persistence whitelist grows; new guard exported from `transitionGuards.js`. No state or transition is added or removed except the bypass edge.

**Tests to create**
- `test/unit/preflight-guard.test.js` — failing preflight ⇒ `advanceDisbursement` yields `manual_review`, never `burn_submitted`.
- `test/unit/preflight-guard.test.js` — passing preflight ⇒ `burn_submitted` reachable (positive control).
- `test/unit/preflight-guard.test.js` — `preflight_result` persists on the row and survives re-read.
- `test/unit/preflight-guard.test.js` — `disbursement_initiated` has no direct path to `burn_submitted`.

---

### G-05 · Burn confirmation dead-ends: `external_tx_id` never persisted (P1)

**Confirmed mechanism.** `submitBurn` writes an `external_refs` row (`transitionActions.js:96`) and returns `{ external_tx_id }`, but `executeTransition`'s extra-field whitelist keeps only timestamp fields, so the column stays `NULL`; `isBurnConfirmed` reads `disbursement.external_tx_id` (`transitionGuards.js:26-28`) and can never pass; `reconciliationWorker.js:172` reads the same column and skips. Permanent dead-end, retried every tick.

**Fix direction.** Extend `executeTransition`'s persistence whitelist to write the identifier fields that already exist on `disbursements`: `external_tx_id`, `attestation_id`, `release_id`, `payout_id` (added by `migrations/004_bos_e2e.sql:28-37`). Single source of truth becomes the column, matching what guards and reconciliation already read. This closes G-05 and the G-12 duplicate defect together. The `external_refs` write stays as the audit trail.

**Files to change**
- `src/services/bos/stateMachine.js` — persistence whitelist.
- (No guard or reconciliation change needed once the column is populated; verify in test.)

**Interfaces affected.** `executeTransition` persists more fields. No signatures change.

**Tests to create**
- `test/unit/tx-id-persistence.test.js` — `submitBurn` result lands in `disbursements.external_tx_id`.
- `test/unit/tx-id-persistence.test.js` — `burn_submitted → burn_confirmed` passes when the mock adapter reports success (regression for the dead-end).
- `test/unit/tx-id-persistence.test.js` — `attestation_id`/`release_id`/`payout_id` persist for their legs.

---

### G-04 · `amount_ngn_expected` never populated (P1)

**Confirmed mechanism.** `amount_ngn_expected` is written nowhere; it is read at `transitionActions.js:216-218` (throws if missing/zero) and by dashboard queries. `disbursements.exchange_rate` is also never written. Even with every upstream leg fixed, the payout cannot be submitted.

**Fix direction.** Populate both deterministically at creation, fail-closed:
- Resolve the `USDCx/NGN` rate from `exchange_rates` (seeded by `init()` with `DEFAULT_USDCX_NGN_RATE`, default `1650`).
- `exchange_rate = rate`; `amount_ngn_expected = round(amount_usdcx scaled by USDCx decimals × rate)`.
- If the rate is missing or ≤ 0, **reject creation** rather than insert a row that can never pay.
- Optionally wire the dormant `hasValidExchangeRate` guard (`transitionGuards.js:144`) onto the payout-reachability transition so a rate cannot go stale between create and payout. Marked optional because a full oracle/TTL is G-22 (P3) — this sprint only needs a value present and non-zero.

**Open detail to confirm at implementation (not a blocker):** the unit/decimals convention of `amount_usdcx` and `amount_ngn_expected` (USDCx is 6-dp; NGN minor units need confirming against `001` column types). The helper must be explicit about decimals so the round-trip is testable.

**Files to change**
- `src/services/bos/disbursementService.js` — rate lookup + computation in `initiateDisbursement`.
- `src/services/bos/transitionGuards.js` — only if `hasValidExchangeRate` is wired.

**Interfaces affected.** `initiateDisbursement` may now reject on missing rate. No transition changes.

**Tests to create**
- `test/unit/ngn-amount.test.js` — rate present ⇒ both fields populated and arithmetic correct for a known pair.
- `test/unit/ngn-amount.test.js` — rate absent/zero ⇒ creation rejected (fail-closed).
- `test/unit/ngn-amount.test.js` — `submitYellowCardPayout` no longer throws `amount_ngn_expected missing or zero`.

---

### G-06 · Webhook signature verification not wired (P1)

**Confirmed mechanism.** Global `express.json()` (`index.js:19`) consumes the body with no raw capture; `webhooks.js:17-25` passes `req.body` straight through; `webhookVerifier.js` is dead (`module.exports` under `"type":"module"` → `ReferenceError` on import) and fails open when no secret is set; `yellowcardAdapter.verifyWebhookSignature` (ESM, working) is never called. Any caller can post `{status:'completed'}` for a known payout. `POST /yellowcard/test` is additionally open outside production.

**Fix direction (verify → parse → handle idempotently, per the `webhook-handler-patterns` skill).**
1. Capture the raw body before JSON parsing. Preferred: add a `verify` hook to `express.json({ verify: (req,_res,buf) => { req.rawBody = buf } })`, so only the webhook route needs `req.rawBody`. (Alternative: mount the webhook router on `express.raw()` before `express.json()`; rejected as a larger ordering change across the app.)
2. In `webhooks.js`, **verify the HMAC over `req.rawBody` first**, using one canonical verifier. **Decision:** promote `webhookVerifier.js` to ESM and make `yellowcardAdapter.verifyWebhookSignature` delegate to it, so there is exactly one implementation. Fix the fail-open: **when the secret is unset, reject** (this is the fail-closed requirement of the sprint).
3. Reject unsigned/invalid payloads with 401 and do not touch state. Duplicate *valid* deliveries return 2xx and must not double-advance (idempotent handling — reject if the txid/payout transition already applied).
4. Put `/yellowcard/test` behind the same admin token as G-03, or disable it outside non-production.
5. Record the raw verified payload via the existing `recordWebhookPayload` evidence recorder (low cost; aligns with G-06's fix direction and the Sprint-4 evidence chain).

**Files to change**
- `src/index.js` — `express.json({ verify })` raw-body capture.
- `src/routes/webhooks.js` — verify-first ordering, 401 on invalid, idempotent handling, `/test` auth.
- `src/services/bos/webhookVerifier.js` — convert to ESM, remove fail-open.
- `src/services/bos/yellowcardAdapter.js` — delegate to the canonical verifier (optional if `webhooks.js` calls it directly).

**Interfaces affected.** `webhooks.js` now requires `req.rawBody`; verifier signature takes `(rawBody, signature, secret)`. No state-machine change.

**Tests to create**
- `test/unit/webhook-verify.test.js` — no signature ⇒ 401, state unchanged.
- `test/unit/webhook-verify.test.js` — wrong signature ⇒ 401.
- `test/unit/webhook-verify.test.js` — correct signature ⇒ handled; duplicate delivery ⇒ 2xx and no double transition.
- `test/unit/webhook-verify.test.js` — secret unset ⇒ reject (fail-closed), not fail-open.
- `test/unit/webhook-verify.test.js` — `/yellowcard/test` rejected without admin token.

---

## 5. End-to-end mock test (acceptance #6)

`test/e2e/mock-lifecycle.e2e.test.js` builds a `ctx` with `FakeDb` + mock `stacks`/`xreserve`/`yellowcard` adapters and drives the full path:

```
PREFLIGHT_CHECK → BURN_SUBMITTED → BURN_CONFIRMED → ATTESTATION_REQUESTED →
ATTESTATION_CONFIRMED → DESTINATION_RELEASE_SUBMITTED → DESTINATION_RELEASE_CONFIRMED →
YELLOWCARD_PAYOUT_SUBMITTED → YELLOWCARD_PAYOUT_CONFIRMED → SETTLED
```

It asserts, at each hop, that the row's status advanced, the corresponding id column is populated (G-05), and the terminal state is `SETTLED`. A second case asserts the negative path: a failed preflight stops at `MANUAL_REVIEW` and never burns (G-01). Both cases require no network and no credentials.

**Known fidelity gap to state in the report, not hide:** a mock `xreserve` returns "release confirmed" without external assurance (GAP-08). The E2E therefore proves *orchestration* completes, not that release is externally true. It is the correct test for Sprint 0.5's scope (mock only) and the honesty limit is recorded in `SPRINT_0_5_REPORT.md`.

---

## 6. Dependencies

| Dependency | Type | Action |
|------------|------|--------|
| `node:test`, `node:assert/strict` | built-in | use, no install |
| Postgres | infrastructure | already required to run the app; used only by the opt-in `test:integration` suite via `TEST_DATABASE_URL` |
| `vitest` / `pg-mem` | candidate | **not added** (§3) |

**New npm dependencies: none.** New runtime env vars introduced: `BOS_API_TOKEN`, `BOS_ALLOW_UNAUTHENTICATED_DEV`. New migration: `migrations/005_sprint_0_5.sql`.

---

## 7. Deviations from the extraction baseline

| # | Deviation | Reason | Class |
|---|-----------|--------|-------|
| D1 | Preflight changes from fail-open to fail-closed; `advanceDisbursement` stops blindly taking `nextStates[0]` and routes guard failure to `manual_review` | The fail-open behavior is the P0 defect; the sprint mandates fail-closed. Flagged in the gap register as needing approval | A / **needs confirmation** |
| D2 | `external_tx_id` (and sibling ids) now persisted on `disbursements`, where the baseline deferred this as C-01 to "Sprint 1" | It is a hard P1 dead-end; Sprint 0.5 replaces Sprint 1 and acceptance #3 requires it | A |
| D3 | New column `disbursements.preflight_result` + new guard | No existing durable place held the preflight verdict; a column matches how guards already read row state | A |
| D4 | `webhookVerifier.js` converted to ESM and made the single verifier; fail-open removed | Part of G-14; required to wire G-06 without a dead module and without fail-open | B |
| D5 | Direct `disbursement_initiated → burn_submitted` edge removed | It bypasses preflight and contradicts G-01's fail-closed intent | B |
| D6 | Mock adapters for Stacks and Yellow Card supplied by the test (not by production `bridgeAdapterFactory`) | Keeps mock machinery test-only; baseline mock mode covered xReserve only | A |
| D7 | `approve` / manual-review-resolve endpoints deliberately omitted | Depend on an actor model that is undecided (§8) | blocker |

No CineX files are touched. No state is added or removed. No transition other than the bypass edge in D5 is altered.

---

## 8. Blockers to report (do NOT silently resolve)

Per the sprint's "Blockers to Report" section. Each is a decision for review, recommended option first.

1. **Preflight fail-open → fail-closed is a behavior change on extraction-faithful code (D1).**
   *Found:* gates are cosmetic today. *Expected:* they must block. *Options:* (a) fail-closed + route to `manual_review` [recommended]; (b) fail-closed + `FAILED`; (c) status quo. The gap register itself lists this as requiring sign-off. **Confirm (a) before implementation.**

2. **Operator actor model is undecided.**
   *Found:* no create/advance/approve caller exists. *Options:* (a) MVP: single shared admin token `BOS_API_TOKEN`, fail-closed, plus a dev escape hatch [recommended for this sprint]; (b) full roles/identity now [out of scope]; (c) defer all auth [rejected: violates fail-closed]. This decides whether `approve`/manual-review resolve can be built in-sprint; under (a) they stay out and go to the backlog.

3. **Mock seam for Stacks/Yellow Card (D6).**
   *Found:* only xReserve has a mock adapter; acceptance #6 needs all three. *Options:* (a) test-injected mock adapters [recommended, test-only]; (b) extend production `bridgeAdapterFactory` mock mode [larger production surface]. **Confirm (a).**

4. **Database testing strategy (§3.1).**
   *Found:* no tests today; G-02's regression is a real-Postgres constraint. *Options:* (a) `FakeDb` default + opt-in Postgres integration test [recommended]; (b) add `pg-mem` [fragile on these migrations]; (c) require Docker Postgres for the default suite [adds infra to acceptance #7]. **Confirm (a).**

The two open details (G-04 decimals/units; whether to wire `hasValidExchangeRate`) are **not** blockers and will be resolved during implementation.

---

## 9. Commit sequence (once approved)

One commit per fix, each with its tests, all green before the next:

1. `test: add node:test harness, FakeDb, mock adapters`
2. `fix(g-02): persist recipient bank columns on create`
3. `fix(g-03): add disbursement create/get/advance API with fail-closed auth`
4. `fix(g-01): fail-closed preflight with persisted result and guard`
5. `fix(g-05): persist external tx id (and sibling ids) on disbursements`
6. `fix(g-04): populate amount_ngn_expected and exchange_rate at create`
7. `fix(g-06): verify webhook signatures over raw body, fail closed`
8. `test(e2e): full mock lifecycle`
9. `docs: README API section + SPRINT_0_5_REPORT.md`

---

## 10. Acceptance-criteria traceability

| AC | Covered by |
|----|------------|
| 1 create via HTTP API and persist | G-02 + G-03 tests |
| 2 preflight failure blocks burn | G-01 tests |
| 3 tx id persisted before `BURN_CONFIRMED` | G-05 tests |
| 4 `amount_ngn_expected` + `exchange_rate` before payout | G-04 tests |
| 5 signature verification rejects unsigned | G-06 tests |
| 6 full mock lifecycle | §5 E2E |
| 7 no external credentials | §3.1 default suite |
| 8 all six fixes tested, one command | §3 scripts |
| 9 docs reflect API/lifecycle | §9 step 9 |

---

## STOP — awaiting review

This is the end of Step 3. No source file has been modified. On approval (including decisions on the four blockers in §8), implementation proceeds in the commit order of §9.
