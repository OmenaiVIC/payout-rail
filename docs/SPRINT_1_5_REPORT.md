# SPRINT 1.5 — Orchestration Hardening Report

> Task source: `docs/prompts/04a_SPRINT_1_5_HARDENING.md`
> Plan: `docs/SPRINT_1_5_PLAN.md` (reviewed and approved before implementation)
> Mode: implementation with tests. Existing state machine preserved; one targeted concurrency guard added after a real hole was exposed (see D6).

---

## 1. Outcome summary

| Deliverable | Result |
|---|---|
| G-11 deterministic idempotency key | **Done.** `disbursement:` + SHA-256 over four stable inputs; migration 006 normalizes uniqueness to a named UNIQUE index |
| G-14 dead-module disposition | **Done.** `fallbackPoller.js` deleted (logged to `docs/POSTPONED_BACKLOG.md` C-07); `auditTimeline.js` converted to ESM with snapshot-column drift fixed; route wiring deferred to Sprint 4 |
| Duplicate-handling tests (04a §3) | **Done.** 5 offline cases (3–7) in `test/unit/duplicate-handling.test.js`, plus 5 G-11 key tests |
| Worker-restart safety | **Done.** Case 4 (tick on already-advanced) and case 5 (restart mid-transition) |
| Bonus: double-spend hardening | **Done via approved deviation D6.** Concurrent-advance case 7 exposed a real hole; fixed with an optimistic-concurrency claim on `executeTransition` |

All seven 04a gate items are now true — Sprint 2 may proceed.

---

## 2. Commits (one per logical fix)

| # | Hash | Title | Files |
|---|------|-------|-------|
| 1 | `25799e5` | `fix(g-11): derive deterministic idempotency key from stable inputs` | `disbursementService.js`, `migrations/006_sprint_1_5.sql`, `test/unit/idempotency-key.test.js` |
| 2 | `704a43b` | `fix(g-14): resolve dead ESM/CommonJS modules` | `auditTimeline.js` (→ESM), `fallbackPoller.js` (deleted), `docs/POSTPONED_BACKLOG.md`, `test/unit/auditTimeline.test.js` |
| 3 | `8e3709d` | `fix(g-11): optimistic concurrency guard on executeTransition prevents duplicate burns` | `stateMachine.js`, `test/unit/duplicate-handling.test.js`, `test/unit/preflight-guard.test.js`, `test/unit/tx-id-persistence.test.js` |
| 4 | _(this commit)_ | `docs: sprint 1.5 report + README idempotency/module dispositions` | `README.md`, `.env.example`, `docs/SPRINT_1_5_PLAN.md` (committed), `docs/SPRINT_1_5_REPORT.md` |

Full hashes:

- `25799e5baa6bd8717a2c4b43097344c239851710`
- `704a43b1f8d1940fd94cd7f4f877543151c1a370`
- `8e3709daaecd30197fcfdb1827a9a600f3ad0788`
- Commit 4 (this docs commit) — see `git log --oneline -4` / `git rev-parse HEAD`.

---

## 3. What changed

### 3.1 G-11 — deterministic idempotency key

- **Before:** `disbursement:${source_reference}:${amount_usdcx}:${Date.now()}` — retries were non-deterministic and treated as new payouts.
- **After:** `deriveDisbursementIdempotencyKey()` builds

  ```
  "disbursement:" + hex(sha256(join("|", [
    source_reference.trim(),
    (source_application || "campaign").trim(),
    String(amount_usdcx).trim(),
    recipient_bank_account.trim(),
  ])))
  ```

  Same stable inputs → same key, across calls and wall-clock time; different inputs → different keys. The downstream dedupe `SELECT ... WHERE idempotency_key = $1` and the `INSERT` are unchanged — the same key, now deterministic, flows through.

- **Migration 006** (`migrations/006_sprint_1_5.sql`) normalizes uniqueness: drops the redundant non-unique `idx_disbursements_idempotency` and creates a named unique index `idx_disbursements_idempotency_unique ON disbursements(idempotency_key)`. The base `001` already declared `idempotency_key TEXT UNIQUE NOT NULL`, so no new constraint semantics were added — the enforcement is now explicit and self-documenting.

### 3.2 G-14 — dead modules

- **`fallbackPoller.js` → deleted.** Zero importers; its stated job (polling external APIs when webhooks fail/delay) is already covered by the confirmation guards (`getTransactionStatus` / `getAttestationStatus` / `getReleaseStatus` / `lookupSend` during normal advancement) plus `stuckStateReaper` and `reconciliationWorker`. Removal logged to `docs/POSTPONED_BACKLOG.md` **C-07** with resurrection conditions. The two documented-but-drifted env vars it owned (`BOS_POLL_INTERVAL_MS`, `BOS_MAX_POLL_ATTEMPTS`) were removed from `README.md` and `.env.example` (they were already flagged FALSE in `docs/CLAIMS_REGISTER.md`).
- **`auditTimeline.js` → converted to ESM.** Now `export`-based; imports cleanly under `"type":"module"`. Snapshot join fixed to the real `external_status_snapshots` columns (`source`, `captured_at` — the old `external_system`/`created_at` did not exist). Route wiring deferred to Sprint 4 (deviation D2).
- **`webhookVerifier.js`** was converted in Sprint 0.5 (G-06); no Sprint 1.5 change needed.

### 3.3 Duplicate-handling & optimistic concurrency (commit 3)

Five offline cases plus the G-11 duplicate-create test cover the four duplicate vectors in 04a §3. Case 7 (two concurrent advances) **failed against the pre-fix code** (`burnUsdcx` fired twice) — the action ran before the state write, and the write had no guard. Per the approved deviation D6, `executeTransition` now:

1. **Claims the row with a CAS before running the side-effect:**
   ```
   UPDATE disbursements
   SET status = $1, updated_at = NOW(), last_heartbeat_at = NOW(),
       retry_count = CASE WHEN $1 = $2 THEN retry_count + 1 ELSE retry_count END,
       error_message = NULL
   WHERE id = $3 AND status = $2
   ```
   The `status = $2` predicate is a compare-and-swap, **not** an accidental condition — a maintainer note in the code makes this explicit. A concurrent advance that already moved the row affects 0 rows and bails as `{ success:false, error:'already advanced', error_code:'u8293', already_advanced:true }`, a **benign no-op** that never re-runs the action.
2. **Runs the action only when the claim wins.**
3. **Rolls the claim back on action failure** (`status` → `fromState`, `error_message`/`last_error` recorded) — preserves the pre-existing observable behavior of "row left in source state + error recorded", so a later retry can re-attempt.

No provider-side idempotency keys were touched (`burn:${id}` / `release:${id}` / `payout:${id}` stay as-is). New call-site behavior was verified: `pipelineWorker`, `advanceDisbursement`/`retryDisbursement`, the webhook handler, and `recoverStuckDisbursement` all treat a `success:false` transition result as data, never throwing — so no call-site modification was required (the internal-change constraint held).

---

## 4. Test evidence

### 4.1 Baseline → final

| Stage | tests | pass | fail | skip | note |
|---|---|---|---|---|---|
| Baseline (before commit 1) | 55 | 54 | 0 | 1 | Postgres-gated |
| After commit 1 (G-11) | 60 | 59 | 0 | 1 | — |
| After commit 2 (G-14) | 64 | 63 | 0 | 1 | — |
| **After commit 3 (duplicates + CAS)** | **72** | **71** | **0** | **1** | Postgres-gated |

### 4.2 Full final suite (`node --test --test-concurrency=1`)

```
✔ E2E: full mock lifecycle drives one payout to SETTLED
✔ E2E: failed preflight stops at MANUAL_REVIEW and never burns
✔ test\helpers\ctx.js
✔ test\helpers\fakeDb.js
✔ test\helpers\mockAdapters.js
﹣ G-02 (integration): a real disbursement row inserts with both bank columns satisfied # TEST_DATABASE_URL not set — skipping
✔ G-14: auditTimeline module imports cleanly under ESM
✔ G-14: buildTimeline renders a chronological, labelled timeline
✔ G-14: formatTimelineText joins entries into a readable string
✔ G-14: snapshot joins only attach rows within one minute of the event
✔ G-02: create rejects when recipient bank details are missing (fail-closed, no INSERT)
✔ G-02: create rejects a blank bank field
✔ G-02: create persists recipient_bank_account and recipient_bank_code in the INSERT
✔ disbursement routes (6 subtests: token rejection, wrong bearer, no-token strict, full flow, 404, dev escape hatch)
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
✔ G-05: submitBurn persists external_tx_id via the whitelist
✔ G-05: burn_submitted → burn_confirmed regression (dead-end) passes
✔ G-05: attestation_id / release_id / payout_id persist for their legs — 3 subtests
✔ G-05: whitespace-only PERSISTED_ACTION_FIELDS are untouched
✔ G-06: webhook verification ordering — 6 subtests (unsigned/wrong-signature/no-secret fail closed, valid advances once, sha256= prefix, /test behind admin token)

tests 72 │ suites 7 │ pass 71 │ fail 0 │ cancelled 0 │ skipped 1 │ duration ≈ 6.0s
```

The single skip is the real-Postgres integration test (runs when `TEST_DATABASE_URL` is set; not run to avoid external credentials, per Standing Constraints).

### 4.3 Duplicate-handling case outcomes (commit 3)

| Case | Vector | Result |
|---|---|---|
| 3 | duplicate webhook delivery on `YELLOWCARD_PAYOUT_SUBMITTED` | first advances to `YELLOWCARD_PAYOUT_CONFIRMED`, second is `processed:false` "already applied"; guard+action polled exactly once each |
| 4 | worker tick on already-advanced row (`burn_confirmed`) | burn never re-submitted; tick advances the next leg (`attestation_requested`) |
| 5 | worker restart mid-transition | tick 1 broadcasts the burn once; the restarted worker confirms the leg without re-burning (0 burns post-restart) |
| 6 | retry of a burned payout | retry resumes from `burn_confirmed` (audit-derived reset point), never re-enters the burn leg; exactly 1 burn broadcast across survive+retry |
| 7 | two concurrent `advanceDisbursement` calls | **exactly one** burn broadcast; winner claims the row, loser receives the benign `already advanced` no-op (`u8293`); nothing throws |

---

## 5. Deviations

| # | Deviation | Reason |
|---|-----------|--------|
| D1 | Migration 006 **normalizes existing** uniqueness rather than adding a new constraint | 001 already declares `idempotency_key TEXT UNIQUE NOT NULL`; a second constraint would be redundant/confusing. A named UNIQUE index keeps the invariant explicit and the redundant-index drop clean. |
| D2 | `auditTimeline.js` converted + test-imported but **not wired to a route** this sprint | New public endpoint is new API surface better defined when Sprint 4 sets the evidence-chain contract. 04a acceptance satisfied by "converted to ESM and imported successfully by a test". |
| D3 | `fallbackPoller.js` removed along with its two env vars, requiring README/env cleanup | The module is dead; the env vars were already flagged as doc drift in `CLAIMS_REGISTER.md`. Deletion (prompt-preferred) removes the drift at the source. |
| D4 | Concurrent-advance test asserts the **application-level** invariant only (FakeDb has no row-locking) | No external credentials allowed; true DB-level serialization is enforced by the UNIQUE constraint + the CAS claim. Re-asserted as a Postgres-gated test in the future (see Open items). |
| D5 | No changes to provider-side adapter keys (`burn:${id}` / `release:${id}` / `payout:${id}`) | Already stable and disbursement-scoped; retries cannot change them. |
| **D6** | **Case 7 exposed a real double-spend hole; fixed via optimistic concurrency on `executeTransition`.** | Pre-fix, two concurrent advances both passed the guard, both ran the burn side-effect, and the (unguarded) state write let one win. Scope rationale: duplicate-handling was this sprint's theme; the finding is inside it. The fix is a targeted, additive claim in `executeTransition` — no state-machine redesign, no call-site changes, no new deps (per approved instruction, and reported before implementing). |

**Change-control compliance:** D6 was **reported to the user before any source change** (04a §Blockers STOP-and-report path) and implemented only after explicit approval. No D/E-classified item was implemented.

---

## 6. Open items (Sprint 2+)

- **Postgres-gated DB-level serialization test.** FakeDb has no row-locking; the CAS invariant is proven at the application level. A future integration suite (`TEST_DATABASE_URL`) should fire two real concurrent transitions against Postgres and assert exactly one wins (the UNIQUE constraint + `WHERE status = $2` make the second `affects 0 rows`).
- **`auditTimeline` route wiring (Sprint 4).** Expose the timeline behind the evidence-chain contract, including `external_status_snapshots` writes that currently birth the module.
- **C-07 `fallbackPoller` resurrection** if Sprint 3 webhook-delivery SLAs require proactive polling (conditions in `docs/POSTPONED_BACKLOG.md`).
- **G-11 residual:** the create-time key covers duplicate creates and the dedupe path; the burn/attestation/release/payout legs keep their existing per-leg keys (D5). A full "one key threads the whole lifecycle" refactor remains a post-Sprint-2 candidate if evidence-chain requirements grow to demand it.

---

## 7. Standing-constraints confirmations

- **No CineX files modified.** All changes are within this repo (`src/`, `migrations/`, `test/`, `docs/`, `README.md`, `.env.example`). CineX provenance untouched.
- **No new runtime npm dependencies.** `package.json` unchanged; all tests run on the existing dependencies.
- **No pushes to any remote.** Work is local-commit only.
- **Offline testability preserved.** Full suite runs on FakeDb + mock adapters; the only skip is the credentialed Postgres integration test.
- **Fail closed preserved.** The CAS rollback returns an explicit failure result; guards and webhook verification ordering unchanged from Sprint 0.5.