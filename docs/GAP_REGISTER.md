# Payout Rail — Gap Register (P0–P3)

> Generated: 2026-09-21 · Sprint 0 (Prompt 0) · Discovery only.
> Severity:
> **P0** — technically unsafe or fundamentally incorrect; must be fixed before any real-money use.
> **P1** — blocks the core product objective (a working USDCx→NGN payout).
> **P2** — important improvement, does not block a pilot.
> **P3** — future enhancement.
>
> Every entry cites evidence (`file:line`) and the minimum required fix direction. Carry-forwards
> `C-01`/`C-04` (see `docs/POSTPONED_BACKLOG.md` and `docs/EXTRACTION_REPORT.md`) are mapped in.

---

## P0 — technically unsafe or fundamentally incorrect

### G-01  Preflight failure does NOT block the burn (fail-open)  [P0]
- **Evidence:** `runPreflightCheck` only records gate results and logs (`transitionActions.js:41-52`);
  `advanceDisbursement` always picks `nextStates[0]` (`disbursementService.js:174-178`); for
  `preflight_check` the first next state is `BURN_SUBMITTED` guarded only by `disbursementExists`
  (`stateMachine.js:24-27`). `preflight.js:22-48` returns `ok:false` for breaker/gate/2PA failures but
  nothing acts on it.
- **Risk:** gating (circuit breaker, payout gates, 2-person approval) is cosmetic; money can be burned
  past a failed gate. Violates the §8 SAFE Forwarding design intent and the fail-closed principle.
- **Fix direction:** after `runPreflightCheck`, resolve to `MANUAL_REVIEW`/`FAILED` when `!ok`
  (e.g. guard on `preflight_result` for the `PREFLIGHT_CHECK→BURN_SUBMITTED` transition, or route
  failure states in `advanceDisbursement`).

### G-02  Disbursements cannot be created as shipped (schema/code mismatch)  [P0]
- **Evidence:** the only `INSERT INTO disbursements` (`disbursementService.js:96-111`) omits
  `recipient_bank_account TEXT NOT NULL` and `recipient_bank_code TEXT NOT NULL`
  (`migrations/001_bos_schema.sql:24-25`, no default) → NOT NULL violation on every creation.
- **Risk:** zero inputs to the pipeline; end-to-end demo impossible even with adapters fixed.
- **Fix direction:** supply those columns (or make them nullable / move into `ngn_recipient` JSONB)
  and align the schema with the code's actual insert path; add an integration test that creates a row.

### G-03  No public API to create / retry / recover / approve / resolve manual review  [P0]
- **Evidence:** `index.js:95-96` mounts only monitoring and webhooks. `initiateDisbursement`,
  `retryDisbursement`, `recoverStuckDisbursement`, `twoPersonApproval.approve/requestApproval`, and
  manual-review resolution have **no HTTP caller** (grep). Operators cannot create a payout, approve a
  large one, retry, or resolve manual review via the API.
- **Risk:** the human-in-the-loop workflow is unreachable for operators.
- **Fix direction:** add an authenticated disbursement API (create / list / get / retry / recover /
  approve / manual-review resolve); decide actor model for approvals & review before go-live.

---

## P1 — blocks the core product objective

### G-04  `amount_ngn_expected` is never populated → Yellow Card leg unreachable  [P1]
- **Evidence:** grep — written nowhere; read only at `transitionActions.js:216-218` (throws if
  missing/zero) and by dashboard queries (`dashboardQueries.js:55,174`).
- **Risk:** even with all upstream legs fixed, the payout cannot be submitted.
- **Fix direction:** populate `amount_ngn_expected` (and `exchange_rate`) deterministically at or
  before payout time from a verified USDC→NGN rate, plus `hasValidExchangeRate` guard wiring.

### G-05  Burn confirmation dead-ends: `external_tx_id` never persisted on `disbursements` (C-01 carry-forward)  [P1]
- **Evidence:** `submitBurn` writes tx id to `external_refs` and returns `{external_tx_id}` that
  `executeTransition` discards (`stateMachine.js:282-297`); `isBurnConfirmed` reads
  `disbursement.external_tx_id` (`transitionGuards.js:26-28`) which stays `NULL`; `recordBurnConfirmation`
  upserts with a `NULL` value (`transitionActions.js:96`); reconciliation skips (`reconciliationWorker.js:172`).
  Documented as C-01 (postponed → Sprint 1).
- **Risk:** burned funds sit unconfirmed and are reaped to manual review or mis-failed.
- **Fix direction:** persist `external_tx_id` on submit (or read from `external_refs` by key) before
  `BURN_CONFIRMED` is reachable; then make reconciliation resolve against the same source of truth.

### G-06  No webhook signature verification (and no raw body)  [P1]
- **Evidence:** global `express.json()` (`index.js:19`) consumes the body; `webhooks.js:17-25` passes
  `req.body` straight on; `webhookVerifier.js` is dead (`module.exports` + not imported);
  `yellowcardAdapter.verifyWebhookSignature` never wired.
- **Risk:** any caller can post `{status:'completed'}` for a known `payout_id` and advance a payout,
  including `POST /yellowcard/test` (open outside production) — a funds-flow attack / false finality.
- **Fix direction:** raw-body middleware, verify HMAC against the provider's scheme before handling,
  restrict `/test` behind admin auth, and record webhook payloads as evidence.

### G-07  Yellow Card authentication is INCORRECT/OUTDATED vs public provider docs  [P1 / Sprint 3 go-live]
- **Evidence:** `yellowcardAdapter._computeAuth` (`:55-67`) builds `Authorization: YcHmacV1 {timestamp,
  apiKey, bodyHash, signature}` with message `timestamp + apiKey + hex(bodyHash)` and no
  `X-YC-Timestamp` header. Current public docs (docs.yellowcard.engineering) specify `YcHmacV1 {apiKey}:{signature}`
  plus an `X-YC-Timestamp` header, with the message including request path and method (base64 body hash).
  The in-repo reference it cites (`docs/yellowcard-api-reference.md`, `:13`) does not exist.
- **Risk:** production sends will be rejected 401/403; cannot be claimed authenticated.
- **Fix direction:** obtain/regenerate the provider API reference, reimplement auth to the documented
  scheme, add contract tests against the sandbox (see `flutterwave-testing`/`flutterwave-transfers`
  skills for repeatable test strategy), verify before go-live. **Must ship before Sprint 3.**

### G-08  xReserve "destination release" is a fabricated, unverifiable confirmation  [P1]
- **Evidence:** `releaseDestination` returns `{release_id: attestation_id, status:'confirmed'}` with no
  external assurance (`xreserveAdapter.js:220-229`); `getReleaseStatus` is the same Hiro tx proxy
  (`:242-255`); the release target is `creator_btc_address`/`creator_address` (`transitionActions.js:167`),
  but canonical USDCx settlement releases USDC to an EVM/USDC destination wallet — **there is no BTC leg**.
- **Risk:** the state machine records "release confirmed" without proof; a disbursement could be advanced
  to the payout leg even though the source USDC never actually reached its destination.
- **Status (Sprint 2): RESOLVED-IN-MODEL.** The fabricated `releaseDestination()`/`getReleaseStatus()`
  pair is removed. The app records a `release_status` observation (`unobserved | observed_pending |
  observed_confirmed | observed_failed`) from `xreserveAdapter.observeDestinationRelease`, reaches
  `destination_release_confirmed` only on `observed_confirmed` (guard + persisted column, `u8234/u8226`
  fail-closed), and no-evidence rows time out to `manual_review` via the reaper. The **real external
  settlement surface remains UNVERIFIED** (the adapter returns a fail-closed `xreserve.unverified` stub)
  — see `docs/SPRINT_2_REPORT.md`. External verification is a later, authorized, verification-only sprint.
- **Fix direction (verified externally, future):** wire the real `observeDestinationRelease` read to the
  actual attestation/settlement surface so `observed_confirmed` means the destination wallet received USDC.

### G-09  Stacks burn entrypoint is UNVERIFIED against contract docs  [P1]
- **Evidence:** `StacksAdapter.burnUsdcx` calls `burn` on `USDCX_CONTRACT` (the `usdcx` token contract)
  (`StacksAdapter.js:224-237`, `chainConfig.js:48`); current docs describe burning through the
  `usdcx-v1` protocol entrypoint.
- **Risk:** a burn broadcast to the wrong contract does nothing (or fails), so funds may be sent to a
  routine that can't complete.
- **Status (Sprint 2):** seam extracted but gap still OPEN. The burn target now resolves through
  `chainConfig.getBurnTarget()` (`chainConfig.js`) and the entrypoint is marked UNVERIFIED in
  `StacksAdapter.burnUsdcx`; changing target/function/args is now a one-line config correction.
- **Fix direction (unchanged):** verify the burn function/entrypoint vs the deployed contract ABI
  (testnet) with a real stub, set `verified: true` in `getBurnTarget()` to the correct principal +
  argument encoding, and test on testnet.

### G-10  No public/verifiable way to resolve manual review; `manual_review_queue` never written  [P1]
- **Evidence:** reaper moves to `manual_review` status (`stuckStateReaper.js:155`); `MANUAL_REVIEW→`
  transitions are baked in (`stateMachine.js:131-145`); the `manual_review_queue` table (`001:141-157`)
  is never inserted into; no resolution endpoint exists.
- **Risk:** stuck/mis-routed funds are stranded with no operator path.
- **Fix direction:** resolve manual review via a reviewed, auditable reconcile step (case-by-case
  decision → `SETTLED`/`FAILED`/`CANCELLED` with evidence + note), and populate the queue/evidence.

---

## P2 — important improvements (do not block a pilot)

### G-11  Weak idempotency key can duplicate a payout (C-04 carry-forward)  [P2 / must-fix before Sprint 3]
- **Evidence:** `idempotency_key = disbursement:{source_reference}:{amount_usdcx}:{Date.now()}`
  (`disbursementService.js:81`) — non-deterministic for retries, so a duplicate dispatch isn't detected.
- **Fix direction (from C-04):** derive a deterministic key from stable inputs, enforce via
  `UNIQUE(idempotency_key)`, and thread the same key through burn → attestation → release → payout.

### G-12  `external_tx_id / attestation_id / release_id / payout_id` columns exist on `disbursements` but were never written  [P2]
- **Evidence (original):** `004_bos_e2e.sql:28-37` adds the columns; grep showed no UPDATE/INSERT of them; actions
  returned them but `executeTransition` dropped them (`stateMachine.js:286`).
- **Status (Sprint 0.5/1.5/2):** RESOLVED. `external_tx_id`, `attestation_id`, `payout_id`, and (new)
  `release_status` are written by their transitions via the `PERSISTED_ACTION_FIELDS` whitelist
  (`stateMachine.js:22-32`); `release_id` was the synthetic id of the removed `releaseDestination()` call
  and is deliberately retired (never written again).
- **Fix direction:** (resolved) keep guards reading the row columns as the single source of truth.

### G-13  Circuit breaker never records failures (check-only)  [P2]
- **Evidence:** `recordFailure/recordSuccess/trip/reset` defined (`circuitBreaker.js:25-100`) but never
  called; only `check` is invoked (`preflight.js:12`). The breaker can be hired but never actually trips
  from real failure data.
- **Fix direction:** record success/failure at adapter call sites (or a middleware) so
  `closed→open→half_open` transitions reflect reality, and expose trip/reset to operators.

### G-14  Dead ESM/CommonJS modules would crash on import  [P2]
- **Evidence:** `webhookVerifier.js:124`, `fallbackPoller.js:199`, `auditTimeline.js:168` use
  `module.exports` under `"type":"module"` → `ReferenceError: module is not defined` on import;
  `auditTimeline` also reads never-written `external_status_snapshots` (`auditTimeline.js:48-53`).
- **Fix direction:** convert to ESM `export`, wire them in (poller, verifier, timeline) or delete and
  track removal in a ticket.

### G-15  Monitoring endpoints are open by default; state-changing ones unauthenticated  [P2]
- **Evidence:** `requireCronAuth` applied only to `/cron/*` (`bosMonitoring.js:190-232`); `POST /run`,
  `POST /workers/pipeline/run`, `/manual-review`, `/alerts/stats` etc. open when `CRON_SECRET` unset.
- **Fix direction:** require auth on write endpoints (and warn loudly when `CRON_SECRET` unset); rate-limit reads.

### G-16  Write-dead audit tables  [P2]  — CLOSED (Sprint 4, approved plan §4)
- **Evidence:** `yellow_card_webhook_events`, `on_chain_events`, `relay_wallet_activity`,
  `external_status_snapshots`, `config_snapshots` are created by migrations but written nowhere (grep).
- **Fix direction:** wire the appropriate recorder into transitions/evidence/quality-of-life or drop
  them; don't carry unused tables.
- **Disposition (Sprint 4):**
  - `yellow_card_webhook_events` — **WIRED** (`disbursementService.js`): `handleYellowCardWebhook`
    inserts one journal row per verified delivery (derived `event_id` → `payment_id`, sanitized summary
    only — never the raw body).
  - `on_chain_events` — **WIRED** (`transitionActions.js`): `submitBurn` writes the `broadcast` row,
    `recordBurnConfirmation` writes the `confirmation` row (with `block_height`).
  - `external_status_snapshots` — **WIRED** (`evidenceCollector.js`): every external-observation
    recorder (`recordApiResponse`, `recordTxHash`, `recordWebhookPayload`, `recordPollResult`) appends a
    point-in-time snapshot.
  - `manual_review_queue` — **WIRED**: `moveToManualReview` enqueues (ON CONFLICT on the open-row
    partial unique index), terminal transitions resolve; dashboard query retargeted onto the table.
  - `config_snapshots` — **REMOVED** (`migrations/008_sprint_4.sql` + POSTPONED_BACKLOG S4-2):
    write-dead and superseded by the per-gate `gate_result` + canonical `transition` records.
  - `relay_wallet_activity` — **REMOVED** (`migrations/008_sprint_4.sql` + POSTPONED_BACKLOG S4-1):
    write-dead, CineX-owned (E-class); `on_chain_events` covers on-chain tracking.
  - Tests: `test/unit/dead-tables.test.js` proves the four wired tables receive rows through their
    real flows and that the removed tables are referenced nowhere under `src/`.

### G-17  Unused pieces: `hasValidExchangeRate`, evidence recorders, `YELLOW_CARD_ENV`, `exchange_rate`  [P2]  — CLOSED (Sprint 4, approved plan §2/§3)
- **Evidence:** `hasValidExchangeRate` never referenced by any transition (`transitionGuards.js:144`);
  `recordWebhookPayload/recordManualNote/recordPollResult/getEvidence` unused (`evidenceCollector.js`);
  `YELLOW_CARD_ENV` read but unused (`yellowcardAdapter.js:21`); `disbursements.exchange_rate` never written.
- **Fix direction:** wire the ones the product needs (see G-06, G-10) and remove the rest.
- **Disposition (Sprint 4):**
  - `recordWebhookPayload` — **WIRED** and now **awaited** in `handleYellowCardWebhook` (guardrail:
    any write failure is logged at ERROR with id + evidence type, never silent).
  - `recordPollResult` — **WIRED** into all three observation actions
    (`recordReleaseObservation`, `confirmDestinationRelease`, `recordReleaseObservedFailed`).
  - `recordManualNote` — **WIRED in API contract, no production caller yet** (Sprint 5 operator
    surface); envelope-compliant and unit-tested (`evidence-recorders.test.js`).
  - `getEvidence` — **WIRED** as the ordered read path (created_at, id) used by tooling/receipts.
  - `recordTransitionEvidence` / `recordReconciliationDetection` — new, wired into
    `executeTransition` (canonical, exactly one per successful transition) and the reconciliation
    worker (4b), respectively.
  - `hasValidExchangeRate`, `YELLOW_CARD_ENV`, `disbursements.exchange_rate` — out of 4a scope;
    tracked unchanged (G-22).

### G-18  Missing `docs/yellowcard-api-reference.md`  [P2]
- **Evidence:** `yellowcardAdapter.js:13` references a file that does not exist.
- **Fix direction:** add a current provider API reference (auth, endpoints, payloads, webhooks,
  sandbox notes) as a vetted source; treat it as the acceptance baseline for G-07.

### G-19  `attributable_funds` gate self-references `disbursements` and fails the FIRST disbursement of each `source_reference`  [P2]
- **Evidence:** requires a prior row with same `source_reference` (`payoutGates.js:134-146`); escrow is
  modeled as rows in the same table; only `source_reference` differs — semantics of the CineX campaign
  escrow were not extracted.
- **Fix direction:** define the escrow model explicitly (funding record vs payout records), seed
  required rows, or replace with a real escrow/funding source query; document behavior.

---

## P3 — future enhancements

- **G-20** Provider sandbox loop for Yellow Card (auth → send → status → webhook) with repeatable
  fixtures; classify as SANDBOX VERIFIED before any prod claim.
- **G-21** Event-sourcing/outbox for state transitions and idempotent webhook/worker processing
  (see `idempotent-financial-workflows` skill guidance).
- **G-22** Exchange-rate oracle + TTL (`hasValidExchangeRate`) so `amount_ngn_expected` is market-based
  and re-verifiable at payout time.
- **G-23** Reconciliation as monitoring: state drift between `disbursements`, `external_refs`, and
  provider reports surfaced to the dashboard.
- **G-24** Test/CI baseline: unit tests for the state machine, gates, adapters (contract tests), and an
  integration harness (see `tdd`, `flutterwave-testing` skills) — none exist today.
- **G-25** Public API (create/approve/recover/manual-review) with authz roles, per the Sprint 5
  "public interface" prompt; today there is no operator surface.
- **G-26** Multi-country / multi-currency payout support; keeper-style custodian/equivalent for the
  burn signer; alerting hardening (dedup, escalation).

---

## Notes for Sprint 1 scoping (per Prompt 0 §11 — do NOT build yet)

Recommended Sprint 1 focus, pending owner confirmation:
1. **P0 harden the gate decisions** (G-01) — fail closed on preflight/2PA/gate/breaker failure.
2. **Make creation work and reachable** (G-02, G-03) — schema fix + minimal create/advance/retry/
   approve/resolve API under auth.
3. **Unblock the burn/burn-confirmation path** (G-05, G-09) and the payout value plumbing (G-04, G-11,
   G-12) with deterministic idempotency.
4. **Webhook security** (G-06) and manual-review resolution (G-10).
5. Keep xReserve/Yellow Card changes (G-07, G-08) sequenced with Sprint 3 go-live decisions.

**Blockers requiring human decisions:**
- Approve fail-`ok`→fail-`closed` behavior change on preflight (changes extraction-faithful code).
- Approve the xReserve re-model (app must observe, not fake, "release confirmed") — this contradicts
  `POSTPONED_BACKLOG` wording only insofar as it is a new, evidence-based correction requirement.
- Confirm the Yellow Card API reference source to re-verify auth before Sprint 3.
- Decide whether undisbursed CineX campaign/escrow semantics should be reproduced or replaced.