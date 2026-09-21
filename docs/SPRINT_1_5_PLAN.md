# SPRINT 1.5 — Orchestration Hardening Plan

> Task source: `docs/prompts/04a_SPRINT_1_5_HARDENING.md`
> Mode: implementation with tests. No redesign of the state machine.
> This document is the **plan**. Produced first; implementation waits for review (per Working Method Step 3: "Wait for review before implementing").

---

## 1. Scope (in / out)

**In:** G-11 deterministic idempotency key + migration 006; G-14 dead-module disposition (`fallbackPoller.js`, `auditTimeline.js`); duplicate-handling tests (6 cases); worker-restart safety test.

**Out (unchanged from Sprint 0.5):** state machine redesign; Sprint 2 (Stacks/USDCx lifecycle); Sprint 3 (Yellow Card); Sprint 4 (evidence chain); Sprint 5 (public API freeze); `approve`/manual-review resolution endpoints; any feature not listed above.

**Standing constraints carried forward:** do not modify CineX; no new runtime npm dependencies; tests run without external credentials (FakeDb + mock adapters); fail closed; one commit per logical fix; STOP-and-report on the blocked list (04a §Blockers); D/E-classified changes go to `docs/POSTPONED_BACKLOG.md`, never implemented.

---

## 2. Inspection findings (evidence)

| # | Find | Evidence |
|---|------|----------|
| 1 | Current key is non-deterministic: `` `disbursement:${source_reference}:${amount_usdcx}:${Date.now()}` `` | `src/services/bos/disbursementService.js:146` |
| 2 | The `disbursements.idempotency_key` column **already** has an inline `UNIQUE` constraint | `migrations/001_bos_schema.sql` → `idempotency_key TEXT UNIQUE NOT NULL` |
| 3 | A redundant **non-unique** index exists on the same column | `001_bos_schema.sql` → `idx_disbursements_idempotency` |
| 4 | `fallbackPoller.js` (CommonJS) has **zero importers** | import probe: `rg fallbackPoller src` → no hits |
| 5 | `auditTimeline.js` (CommonJS) has **zero importers**; its snapshot query uses column names that do not exist (`external_system`, `created_at` on `external_status_snapshots`; real columns are `source`, `captured_at`) | import probe: no hits; `auditTimeline.js:48-53` vs `001_bos_schema.sql` table 4 |
| 6 | Full baseline suite passes before any change | `npm test` → **55 tests, 54 pass, 1 skip (Postgres-gated), 0 fail** |
| 7 | Per-leg adapter idempotency keys are already stable and disbursement-scoped: `burn:${disbursement.id}`, `release:${disbursement.id}`, `payout:${disbursement.id}` | `src/services/bos/transitionActions.js:72,171,228` |
| 8 | All four stable key inputs are `NOT NULL` columns on `disbursements` and are validated in `initiateDisbursement` before INSERT | `001_bos_schema.sql`; `disbursementService.js:110-140` |

**Conclusion:** no blocker on the 04a §Blockers list triggers at planning time:
- The deterministic key **can** be derived — all inputs are required, non-null, validated fields (not missing columns).
- The UNIQUE constraint does not conflict with data — dev-only DB, no rows (migration runner tracks applied migrations).
- Deleting the dead modules removes **no required capability** (justification in §4).
- Duplicate-handling tests will be written against the existing state machine, not a redesign.
- Worker-restart safety is testable at the application level (state persists before the next tick can act; adapter keys anchor the financial action).

---

## 3. G-11 — Deterministic idempotency key

### 3.1 Derivation formula (exact)

Replace the `Date.now()`-based key with a SHA-256 digest over the four stable inputs, canonicalized in a fixed order:

```
key = "disbursement:" + hex(sha256(N|V))
where
  N = join("|", [
    String(source_reference?.trim() ?? ""),
    String(source_application?.trim() ?? "")     // defaults to "campaign" upstream
    String(amount_usdcx),
    String(recipient_bank_account?.trim() ?? ""),
  ])
```

- Stable, cross-call deterministic: **no timestamp, no random value.**
- Bound length (`16 + 64` chars) — fits the `TEXT` column regardless of input length.
- Distinct-input separation: two disbursements differing in **any one** of the four inputs get different keys; identical inputs always collide → the existing `UNIQUE` constraint makes the second create fail-closed via the pre-INSERT lookup (returns the existing row) and at the DB level (no duplicate row possible).
- Collision risk is SHA-256-grade; no collision handling needed beyond the existing `UNIQUE` constraint (fail-closed).

### 3.2 Implementation

- Add an exported pure helper so the formula is individually testable:

  ```js
  // disbursementService.js
  import { createHash } from 'crypto';
  export function deriveDisbursementIdempotencyKey({ source_reference, source_application = 'campaign', amount_usdcx, recipient_bank_account }) {
    const N = [source_reference, source_application, amount_usdcx, recipient_bank_account]
      .map((v) => String(v ?? '').trim())
      .join('|');
    return `disbursement:${createHash('sha256').update(N).digest('hex')}`;
  }
  ```

- Replace line 146 (`const idempotency_key = ...Date.now()`) with a call to the helper. The downstream dedupe `SELECT ... WHERE idempotency_key = $1` (lines 149-156) and the INSERT (162-170) are unchanged — the same key, now deterministic, flows through.
- **Threading note:** the prompt asks that "the same key" flow through burn → attestation → release → payout. That is already satisfied by the existing per-leg adapter keys (`burn:${disbursement.id}`, `release:${disbursement.id}`, `payout:${disbursement.id}`), which are (a) derived from the stable `disbursement.id`, (b) reused on any retry because `retryDisbursement` leaves the row id untouched. So a retry of a burned payout submits burn again with the **same** `burn:${id}` key → provider-side dedupe, no second burn. The Sprint 1.5 change makes the **create-time** key deterministic so a duplicate create is recognised as the same disbursement instead of being minted as a new row. Acceptance Criterion 3 is verified by test (§5, case 6).

### 3.3 Schema change — migration 006

`001_bos_schema.sql` already declares `idempotency_key TEXT UNIQUE NOT NULL` (find #2). Migration 006 therefore **normalizes** the enforcement — it makes the uniqueness explicit and named, and removes the now-redundant non-unique index:

```sql
-- 006_sprint_1_5.sql
-- Deterministic idempotency key: make uniqueness explicit and self-documenting.
-- 001 already declared `idempotency_key TEXT UNIQUE NOT NULL` (auto-created constraint
-- index). This migration drops the redundant non-unique index in favour of a named
-- UNIQUE index so the invariant is enforceable and introspectable by name.
DROP INDEX IF EXISTS idx_disbursements_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS idx_disbursements_idempotency_unique
  ON disbursements(idempotency_key);
```

- **Migration path for existing rows:** dev-only DB; the migration runner tracks applied migrations and this key column was never previously written with a value that could collide, so there is no backfill or dedup needed. If duplicate keys ever existed, the `CREATE UNIQUE INDEX` fails closed (index not created, migration errors) — the correct behaviour for a financial safety invariant. No `reseed`/backfill step.

---

## 4. G-14 — Dead-module disposition

### 4.1 `fallbackPoller.js` → **DELETE** (log to POSTPONED_BACKLOG)

- **Reason:** zero importers (find #4). Its stated job — polling external APIs when webhooks fail or are delayed — is already covered by the existing confirmation guards (which call `getTransactionStatus` / `getAttestationStatus` / `getReleaseStatus` / `lookupSend` during normal advancement) plus the already-wired `stuckStateReaper` and `reconciliationWorker` (`src/index.js:81-82`). No Sprint 2 or 3 requirement needs an independent poller. The 04a prompt states: **prefer deletion** unless a concrete need exists in Sprint 2/3; none does.
- **Also removed by deletion:** two documented-but-drifted env vars (`BOS_POLL_INTERVAL_MS`, `BOS_MAX_POLL_ATTEMPTS`) whose claimed defaults are already flagged FALSE in `docs/CLAIMS_REGISTER.md` (lines 23-24). Deleting the module removes the drift source; the README/env rows will be cleaned in the documentation step.
- **Where logged:** append a section to `docs/POSTPONED_BACKLOG.md` (new item, e.g. "C-XX — `fallbackPoller.js` deleted in Sprint 1.5") with: capability (polling fallback), reason deferred (redundant with guards + reaper + reconciliation worker), suggested resurrection conditions (Sprint 3 webhook-delivery SLAs requiring proactive polling), dependencies (adapters already exist), complexity (broken out).

### 4.2 `auditTimeline.js` → **CONVERT to ESM + unit test; route wiring deferred**

- **Reason:** zero importers today, but the Sprint 4 evidence chain (out of scope this sprint, yet explicitly the near-term future per 04a: "Prefer conversion if the Sprint 4 evidence chain will need it") depends on human-readable timelines from `disbursement_audit` + `disbursement_evidence`. Deleting it would force a rewrite inside Sprint 4. It is a small, pure file — conversion is cheap and it can sit dormant-but-import-safe until wired.
- **Conversion work:**
  1. `module.exports` → `export` statements (`buildTimeline`, `formatTimelineText`, `STATE_LABELS`).
  2. Fix snapshot schema drift: `external_status_snapshots` query columns `external_system`/`created_at` → `source`/`captured_at` (real schema, find #5). The evidence/audit queries already match the schema.
- **Route wiring:** deferred out of scope. There is already a read path for audit history (`GET /api/disbursements/:id` returns `audit_log`), and adding a new public endpoint is new API surface better introduced when Sprint 4 defines the evidence chain contract. Logged as a deviation (§7).
- **Test:** `test/unit/auditTimeline.test.js` imports the converted module and exercises `buildTimeline` + `formatTimelineText` against a seeded FakeDb (satisfies acceptance "#4(a) converted to ESM and imported successfully by a test").

---

## 5. Duplicate-handling tests (6 cases)

New file `test/unit/duplicate-handling.test.js` plus focused additions in `test/unit/idempotency-key.test.js`. All run offline via FakeDb + mock adapters; no new deps. Adapter call-counts come from `createMockAdapters` (`calls.*` arrays).

| # | Case | Assertion | File |
|---|------|-----------|------|
| 1 | **Deterministic key formula** — same inputs → same key, across calls; differing inputs → different keys; no `Date.now()` influence | `deriveDisbursementIdempotencyKey` stable; INSERT param 2 matches derived key | `idempotency-key.test.js` |
| 2 | **Duplicate create (same stable inputs)** — second `initiateDisbursement` is idempotent | exactly **one** `INSERT INTO disbursements`; second call returns the **same id** as the first; no error | `idempotency-key.test.js` |
| 3 | **Duplicate webhook delivery** — `completed` webhook delivered twice | webhook advances exactly once (`processed:true` first, `processed:false "already applied"` second); payout-confirm action/adapter `lookupSend` called once per delivery but **no second state advance**; audit has one `yellowcard_payout_submitted {→confirmed}` transition | `duplicate-handling.test.js` |
| 4 | **Worker tick on already-advanced disbursement is a no-op** — seed at `burn_confirmed`, run `pipelineWorker.runOnce()` | no re-run of the burn action (`stacks.burnUsdcx.calls` length unchanged); next transition attempted is attestation, not burn; `getValidNextStates` no longer includes `burn_submitted` | `duplicate-handling.test.js` |
| 5 | **Worker restart mid-transition** — simulate warm restart: run one full tick advancing `burn_submitted → burn_confirmed`, then construct a **fresh ctx/adapter double** and run `runOnce()` again | the financial action is not double-executed: `burnUsdcx` called exactly **once** across both runs; second tick advanced to attestation only. (Provider-level dedupe via `burn:${id}` is additionally stable across restarts since `disbursement.id` is unchanged.) | `duplicate-handling.test.js` |
| 6 | **Retry of a burned payout does not create a second burn** (Acceptance Criterion 3) — burn `burn_submitted → burn_confirmed`, fail the disbursement, `retryDisbursement`, re-advance | `stacks.burnUsdcx` called exactly **once** for the disbursement across the whole survive→retry→re-advance sequence | `duplicate-handling.test.js` |
| 7 | **Two concurrent advance attempts do not both succeed** — `Promise.all([advanceDisbursement(id), advanceDisbursement(id)])` on a fresh disbursement | financial action (`burnUsdcx`/`submitSend` for the relevant leg) fires at most **once**; at most one transition to the target state observed; the loser resolves with a guard/no-op result, not a second side-effect. (FakeDb has no row-locking — this proves the application invariant "at most one financial action per step"; the Postgres-grade serialization guarantee is provided by the `UNIQUE` constraint + state-machine guard ordering, and is noted as a candidate for the future Postgres-gated suite.) | `duplicate-handling.test.js` |

> Scope §3 lists five cases; rows 3–7 cover exactly those five and rows 1–2 cover the G-11 acceptance criteria (deterministic key + duplicate-create returns existing). Case 6 covers Acceptance Criterion 3.

---

## 6. Deliverable files

| Deliverable | Action |
|---|---|
| `src/services/bos/disbursementService.js` | add `deriveDisbursementIdempotencyKey`, use at line 146 |
| `migrations/006_sprint_1_5.sql` | new migration (drop redundant index, named UNIQUE index) |
| `src/services/bos/fallbackPoller.js` | **delete** |
| `src/services/bos/auditTimeline.js` | **convert to ESM** + fix snapshot column drift |
| `docs/POSTPONED_BACKLOG.md` | append deletion entry for `fallbackPoller.js` |
| `test/unit/idempotency-key.test.js` | new (G-11 formula + duplicate create) |
| `test/unit/duplicate-handling.test.js` | new (cases 3–7) |
| `test/unit/auditTimeline.test.js` | new (import + exercise converted module) |
| `test/e2e/mock-lifecycle.e2e.test.js` | unchanged — must still pass (Acceptance #5) |
| `docs/SPRINT_1_5_REPORT.md` | new — evidence, deviations, open items |
| `README.md` | update idempotency key derivation + module dispositions (idempotency section exists; extend) |

---

## 7. Deviations from the Sprint 0.5 state (with reasons)

| # | Deviation | Reason |
|---|-----------|--------|
| 1 | Migration 006 **normalizes existing** uniqueness rather than adding a new constraint | The base migration already declares `idempotency_key ... UNIQUE`; adding a second constraint would be redundant and confusing. Normalizing to a named UNIQUE index keeps the invariant explicit and drop-of-redundant-index clean. |
| 2 | `auditTimeline.js` is converted and test-imported but **not wired to a route** this sprint | New public endpoint is new API surface better defined when Sprint 4 sets the evidence-chain contract. The 04a acceptance is satisfied by "converted to ESM and imported successfully by a test". |
| 3 | `fallbackPoller.js` removed along with its two env vars, which requires cleaning README/env references | The module is dead; the env vars are already flagged as doc drift in CLAIMS_REGISTER. Deletion (prompt-preferred) removes the drift at the source. |
| 4 | Concurrent-advance test asserts the **application-level** invariant only (FakeDb has no row-locking) | No external credentials allowed; true serialization is enforced by the DB UNIQUE constraint + guard ordering. Noted as future Postgres-gated coverage, not silently dropped. |
| 5 | No changes to the provider-side adapter keys (`burn:${id}` / `release:${id}` / `payout:${id}`) | Already stable and disbursement-scoped (find #7); retries cannot change them. Changing them to carry the create-key would be an unnecessary behavioural change to external providers. |

---

## 8. Implementation plan (post-review; one commit per logical fix)

1. **Commit 1 (G-11):** `deriveDisbursementIdempotencyKey` + usage at line 146; migration `006_sprint_1_5.sql`; `test/unit/idempotency-key.test.js`. Full suite green.
2. **Commit 2 (G-14):** delete `fallbackPoller.js`; convert `auditTimeline.js` to ESM + fix snapshot columns; append POSTPONED_BACKLOG deletion entry; `test/unit/auditTimeline.test.js`. Full suite green.
3. **Commit 3 (duplicate handling):** `test/unit/duplicate-handling.test.js` (cases 3–7). Only if a real idempotency hole is exposed does any `src/` change happen — and that change is **scoped to the fix**, with the 04a §Blockers STOP-and-report path applied first.
4. **Commit 4 (docs):** README idempotency + module-disposition updates; `docs/SPRINT_1_5_REPORT.md` with full-suite evidence, deviations (§7), open items.
5. **Verify each commit:** `npm test` (full suite, `--test-concurrency=1`) green, including the Sprint 0.5 regression suite; no CineX files touched; no new runtime npm deps.
6. **Gate check (04a §Gate) after Commit 4:** all seven gate items true → then, and only then, may Sprint 2 be considered.

**Stop now.** This plan awaits review before any implementation begins.