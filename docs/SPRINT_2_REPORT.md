# SPRINT 2 — Stacks/USDCx Withdrawal Lifecycle (Model Correction) Report

> Task source: `docs/prompts/04b_SPRINT_2_STACKS_USDCX.md`
> Plan: `docs/SPRINT_2_PLAN.md` (reviewed and approved before implementation; the plan authored for review
> used guards/actions named `isReleaseObservedPending`/`recordReleaseObservedPending` and a 3-way `unobserved`
> branch — the executor renamed them and routed the observation states as a **chain**, see D1).
> Mode: implementation with tests. Standing constraints honored: only A/B/explicitly-authorized C work built,
> one commit per logical fix, every commit green, no pushes, no external network, no new runtime deps, no CineX edits.

---

## 1. Outcome summary

| Deliverable | Result |
|---|---|
| G-08 fabricated destination release removed | **Done.** `releaseDestination()`/`getReleaseStatus()` are gone from every adapter (incl. the `mock` factory). |
| Observation model | **Done.** 4-value `ReleaseStatus` enum, `release_status` column (migration 007) + CHECK constraint; states `destination_release_unobserved` (new) and `destination_release_observed` (renamed from `destination_release_submitted`); 15 states total. |
| Fail-closed confirmation | **Done.** `destination_release_confirmed` requires a **fresh** `observed_confirmed` poll; the payout guard additionally requires the **persisted** `release_status='observed_confirmed'` (`u8234`/`u8226`). No TTL/recency column — the design re-observes on every tick instead (proposal logged, `POSTPONED_BACKLOG` S2-1). |
| no-evidence timeout → manual review | **Done.** Reaper SLA: `destination_release_unobserved` 30 min → reaped at 60 min to `manual_review` (`stuck_in_destination_release_unobserved_beyond_sla`); covered by a deterministic `reapOnce()` test. |
| Monitoring/ops alignment (D5, scope-limited) | **Done.** `monitorJob.checkDestinationReleaseFailures` retargeted to the two observation states; reaper SLA keys, audit timeline labels, pipeline/README comments updated. Extra monitoring ideas → `POSTPONED_BACKLOG` S2-2. |
| G-09 burn entrypoint | **Done (seam only).** `getBurnTarget()` extracted in `chainConfig`; `burnUsdcx` marked `UNVERIFIED`; named open item in `GAP_REGISTER`. Contract unchanged — gap stays open. |
| Evidence-driven tests | **Done.** `test/helpers/mockExternalEvidence.js` gives tests a latched, scripted settlement surface; every new transition + the timeout are covered offline. Suite: **78/77/0/1**. |

All eleven plan §13 gate items are true (10 verified by tests below).

---

## 2. Commits (one per logical fix)

| # | Hash | Title | Files |
|---|------|-------|-------|
| 1 | `93f2d74` | `fix(g-08): observation-based destination release replaces the fabricated leg` | `migrations/007_sprint_2.sql`, `src/services/bos/{types,stateMachine,transitionGuards,transitionActions,xreserveAdapter,bridgeAdapterFactory}.js`, `test/helpers/mockAdapters.js`, `test/unit/{harness,tx-id-persistence}.test.js`, `test/e2e/mock-lifecycle.e2e.test.js` |
| 2 | `316177f` | `fix(g-08): observe-unobservable timeout + monitoring/ops alignment` | `stuckStateReaper.js`, `monitoring/monitorJob.js`, `auditTimeline.js`, `pipelineWorker.js`, `README.md` |
| 3 | `df61148` | `test(g-08): mocked external-evidence source + deterministic observation tests` | `test/helpers/mockExternalEvidence.js` (new), `test/unit/release-observation.test.js` (new), `test/e2e/mock-lifecycle.e2e.test.js` |
| 4 | `b93db71` | `chore(g-09): mark burn entrypoint UNVERIFIED + extract getBurnTarget seam` | `chainConfig.js`, `StacksAdapter.js`, `docs/GAP_REGISTER.md` |
| 5 | _(this commit)_ | `docs: sprint 2 corrected settlement model` | `docs/PRODUCT_BASELINE.md`, `docs/CLAIMS_REGISTER.md`, `docs/GAP_REGISTER.md`, `docs/POSTPONED_BACKLOG.md`, `docs/SPRINT_2_PLAN.md` (committed), `docs/SPRINT_2_REPORT.md` |

Full hashes:
- `93f2d7412427c92e5f7b14fe7a46fc32dc13bbb9`
- `316177f098cc6946c50f63131930b11f01a448a2`
- `df61148cbb549fd2130dc1ecf8c71568f08181ba`
- `b93db7194f6ba134e64ff21191a13fb5167a578b`
- Commit 5 (this docs commit) — see `git rev-parse HEAD`.

---

## 3. What changed

### 3.1 The corrected model (G-08)

- **Removed:** `releaseDestination()` + `getReleaseStatus()` from `xreserveAdapter` and the mock factory —
  the fabricated `{ release_id: attestation_id, status: 'confirmed' }` return and its Hiro tx-status
  "confirmation" no longer exist anywhere, including `BRIDGE_ADAPTER_ENV=mock`.
- **Added (model):** `ReleaseStatus` enum (`unobserved | observed_pending | observed_confirmed |
  observed_failed`); a single observation method `observeDestinationRelease({disbursement_id,
  external_tx_id, attestation_id})` on the xReserve seam that **returns the current observation only**;
  migration 007 adds `release_status TEXT` + CHECK constraint. `release_id` is retired (no longer in
  `PERSISTED_ACTION_FIELDS`, stays NULL, never written again).
- **States:** `attestation_confirmed → destination_release_unobserved` (entry action `beginReleaseObservation`
  pins `release_status='unobserved'` and makes **no adapter call**), `destination_release_unobserved →
  destination_release_observed`, `destination_release_observed → destination_release_confirmed`, and
  `unobserved/observed → failed` on `observed_failed` evidence.
- **Guards (fail-closed):**
  - `isReleaseObserved` — any real evidence (pending/confirmed/failed) leaves `unobserved`; a poll error or
    still-`unobserved` masks it (`u8224`/`u8225`).
  - `isReleaseObservedConfirmed` — only a **fresh** `observed_confirmed` passes (`u8224`/`u8226`).
  - `isReleaseObservedFailed` — a fresh `observed_failed` passes (`u8224`/`u8227`).
  - `destinationReleasedForPayout` — persisted `release_status` must equal `observed_confirmed` **and** a
    fresh observation must confirm it, before any gate/2PA/YC interaction (`u8234`/`u8226`). A hand-edited
    or stale state can never unlock money movement.
- **Timeout:** `stuckStateReaper.STATE_SLA_MS` now has `destination_release_unobserved` (1 800 000 / 30 min)
  and `destination_release_observed` (3 600 000 / 60 min). `last_heartbeat_at` refreshes only on a successful
  claim, so guard-rejected parking rows age out and are reaped to `manual_review`.

### 3.2 Burn entrypoint (G-09) — seam, not fix

`chainConfig.getBurnTarget()` returns `{ contract: USDCX_CONTRACT, function: 'burn', verified: false, note }`;
`StacksAdapter.burnUsdcx` resolves its target through it instead of hardcoding, and both carry explicit
`UNVERIFIED` markers. `GAP_REGISTER` G-09 is updated with the named open item (verify ABI on the `usdcx-v1`
entrypoint, then swap via `getBurnTarget()`); the gap stays open, no contract change.

### 3.3 Tests

- `test/helpers/mockExternalEvidence.js` — scripted, latched settlement surface (`emit`/`observe`; default
  `unobserved`). Observation evidence exists in tests exactly as in production: only what the surface reports.
- `test/unit/release-observation.test.js` — begin (no call, `release_status` pinned), the observation chain,
  no-pending-cannot-confirm, both `observed_failed` failure routes, both fail-closed payout blockers, and the
  reaper `reapOnce()` timeout → `manual_review` with the SLA reason.
- `mock-lifecycle.e2e.test.js` drives evidence `unobserved → observed_pending → observed_confirmed` and
  asserts `release_status` persists per hop, `release_id` stays `null`, `observeDestinationRelease` is the
  poll surface, and `releaseDestination` never exists.

---

## 4. Test evidence

### 4.1 Baseline → final (`npm test`)

| Stage | tests | pass | fail | skip | note |
|---|---|---|---|---|---|
| Baseline (before commit 1) | 69 | 68 | 0 | 1 | Postgres-gated (skip) |
| After commit 1 | 69 | 68 | 0 | 1 | test-surface rewritten onto the new model |
| After commit 2 | 69 | 68 | 0 | 1 | ops alignment only |
| **After commit 3** | **78** | **77** | **0** | **1** | helper + 9 new G-08 cases |
| After commit 4 / 5 | 78 | 77 | 0 | 1 | G-09 seam + docs |

The single skip is the `TEST_DATABASE_URL`-gated Postgres integration test (never run; no external
credentials, per Standing Constraints).

### 4.2 Full final suite (`npm test`, `node --test --test-concurrency=1`)

```
✔ E2E: full mock lifecycle drives one payout to SETTLED
✔ E2E: failed preflight stops at MANUAL_REVIEW and never burns
﹣ G-02 (integration): ... # TEST_DATABASE_URL not set — skipping Postgres integration test
✔ G-14: auditTimeline module imports cleanly under ESM
✔ G-14: buildTimeline renders a chronological, labelled timeline
✔ G-14: formatTimelineText joins entries into a readable string
✔ G-14: snapshot joins only attach rows within one minute of the event
✔ G-02: create rejects when recipient bank details are missing (fail-closed, no INSERT)
✔ G-02: create rejects a blank bank field
✔ G-02: create persists recipient_bank_account and recipient_bank_code in the INSERT
✔ disbursement routes (6 subtests)
✔ case 3: duplicate webhook delivery does not advance state twice
✔ case 4: worker tick on an already-advanced disbursement never re-burns
✔ case 5: worker restart mid-transition does not double-execute the burn
✔ case 6: retrying a burned payout does not create a second burn
✔ case 7: two concurrent advance attempts do not both execute the burn
✔ FakeDb: records every call and answers from registered handlers
✔ FakeDb: unmatched queries fall through to null / empty array
✔ FakeDb: run() normalises to the PgClient result shape
✔ FakeDb: when() rejects a global regex (stateful lastIndex)
✔ FakeDb: all() and table seeding
✔ mock adapters: expose the exact methods the pipeline consumes
✔ mock adapters: createMockAdapters wires all three
✔ createTestCtx: matches the ensureInit() bosCtx shape
✔ createTestCtx: permissive registry admits a recipient, null registry rejects
✔ createTestCtx: emits audit events without a database
✔ BOS module graph imports cleanly under ESM
✔ G-11: key is deterministic — same inputs yield the same key across calls
✔ G-11: key does not depend on wall-clock time
✔ G-11: distinct stable inputs produce distinct keys
✔ G-11: duplicate create returns the existing disbursement and does not INSERT a second row
✔ G-11: the deterministic key (no timestamp) is threaded into the INSERT
✔ computeAmountNgnExpected (decimals convention): converts base units, rounds kobo
✔ G-04: initiateDisbursement resolves and persists the rate (fail closed) — 3 subtests
✔ G-04: submitYellowCardPayout no longer throws "amount_ngn_expected missing or zero" — 2 subtests
✔ preflightRequested / preflightPassed guard unit tests (8 subtests)
✔ executeTransition persists preflight_result as JSON on the disbursement row
✔ bypass edge disbursement_initiated→burn_submitted no longer exists
✔ executeTransition escalates to manual_review when the preflight verdict is failing
✔ executeTransition does NOT escalate when already in manual_review
✔ G-08: attestation_confirmed → destination_release_unobserved (begin) — 1 subtest
✔ G-08: destination release observation chain (unobserved → observed → confirmed) — 3 subtests
✔ G-08: observed failure evidence lands the row in failed — 2 subtests
✔ G-08: payout is fail-closed on release confirmation — 2 subtests
✔ G-08: permanently-unobserved disbursement is reaped to manual_review — 1 subtest
✔ G-05: submitBurn persists external_tx_id via the whitelist
✔ G-05: burn_submitted → burn_confirmed regression (dead-end) passes
✔ G-05: attestation_id / release_status / payout_id persist for their legs — 3 subtests
✔ G-05: whitespace-only PERSISTED_ACTION_FIELDS are untouched
✔ G-06: webhook verification ordering — 6 subtests

ℹ tests 78 │ suites 12 │ pass 77 │ fail 0 │ cancelled 0 │ skipped 1 │ duration ≈ 2.5s
```

---

## 5. Deviations (planning model → executor reality)

| # | Deviation | Reason |
|---|-----------|--------|
| **D1** | The plan §4.2 three-way `unobserved` branch (`observed → confirmed → failed`) is **unroutable**: `advanceDisbursement` attempts only `nextStates[0]` (`disbursementService.js:259-269`). Implemented as an observation **chain**: `unobserved → observed → confirmed`, mutually exclusive evidence-guards instead. | The executor verified `advanceDisbursement` semantics before writing the transition table; a 3-way branch would never reach the second candidate. Chain keeps the plan's exact model (evidenced confirmation, parking, fail-closed payout) while honoring the existing one-step-per-tick engine. |
| D2 | Plan guard/action names `isReleaseObservedPending` / `recordReleaseObservedPending` became `isReleaseObserved` / `recordReleaseObservation`. | The guard accepts *any* real evidence (pending/confirmed/failed) to exit `unobserved`; "pending-only" would wrongly block a first-tick confirmed observation. |
| D3 | Plan §7 had interface-driven test updates distributed across commits 1 and 3; executed **all in commit 1** (mockAdapters body, harness, e2e rewrite, tx-id rewrite) because they reference removed methods/states and must land with the removal to keep every commit green. | Commitment: `npm test` green **at every commit**. Commit 3 then adds the shared helper + new coverage, which is purely additive. |
| D4 | The e2e rewrite in commit 1 used an **inline latched evidence** override (wire the shared `mockExternalEvidence` in commit 3) instead of creating the helper in commit 1. | Same split rationale as D3 — minimizes the size of the behavioral commit and defers the infra addition to the test commit. Commit 3 refactored the e2e onto the helper. |
| D5 | `destination_release_unobserved` SLA = **30 min** (plan proposal) and `destination_release_observed` keeps the old 60 min value; reaper acts at 2× (= 60 min for `unobserved`). | Plan-approved values; placeholders to be re-tuned from real corridor data (plan §12). |
| D6 | `monitorJob` retarget strictly scoped to the state-reference swap (`D5` guardrail). | Approved: thresholds/messages/dedup keys/severity and all extra monitoring ideas deferred to `POSTPONED_BACKLOG` S2-2. |

**Change-control compliance:** the D1 design deviation (chain vs branch — a behavioral difference from the
approved plan) was **flagged to the user during implementation and approved before the commit**. No D/E-class
item was implemented (G-09 stayed a documented seam; verification deferred).

---

## 6. Open items (Sprint 3+)

- **G-08 external verification (not this sprint by design):** the real `observeDestinationRelease` returns
  `{ release_status: 'unobserved', source: 'xreserve.unverified', evidence: null }` — a fail-closed stub. A
  real deployment parks release-waiting rows in `unobserved` and they time out to `manual_review` **by
  design** until a later, explicitly authorized verification-only sprint wires the real surface.
- **G-09 named open item:** verify the burn ABI on the `usdcx-v1` entrypoint on testnet, then swap via the
  `getBurnTarget()` seam (`verified: true`).
- **Whether `observed_failed` is detectable on the real surface:** unknown; no verified endpoint/event
  distinguishes "release failed" from "no information". The enum models it; the stub cannot yet produce it.
- **Measurement of timeout magnitudes** (30/60 min): placeholders — re-tuned from real corridor observations.
- **Postgres-gated timing test (Sprint 1.5 open item, still open):** true DB-level serialization evidence
  for the CAS claim.
- **Postponed:** evidence chain (Sprint 4), public disbursement API (Sprint 5), Yellow Card (Sprint 3).

---

## 7. Standing-constraints confirmations

- **No CineX files modified.** All changes are within this repo (`src/`, `migrations/`, `test/`, `docs/`,
  `README.md`). CineX provenance untouched.
- **No new runtime npm dependencies.** `package.json` unchanged.
- **No pushes to any remote.** Work is local-commit only.
- **Offline testability preserved.** Full suite runs on FakeDb + mock/evidence adapters; the only skip is
  the credentialed Postgres integration test.
- **Fail-closed preserved and strengthened.** The release leg can no longer fabricate a confirmation;
  payout requires live `observed_confirmed` corroborated by the persisted column.