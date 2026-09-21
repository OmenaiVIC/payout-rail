\# 04a — SPRINT 1.5: ORCHESTRATION HARDENING



> Task: close the leftover Sprint 1 concerns — deterministic idempotency, dead-module cleanup, and worker-restart safety.

> Mode: implementation with tests. No redesign of the state machine.

> Outputs: deterministic idempotency key (G-11), two dead modules resolved (G-14), duplicate-handling tests, and a worker-restart safety test.



\---



\## Why This Sprint Exists



Sprint 0.5 fixed the six P0/P1 blockers and produced a working mock-mode MVP. The original Sprint 1 ("Standalone Orchestration Core") covered many of the same areas and is now largely delivered. Three items from the original Sprint 1 scope remain open:



1\. \*\*G-11 — Deterministic idempotency key.\*\* The current key is `disbursement:{source\_reference}:{amount\_usdcx}:{Date.now()}`. The timestamp makes retries non-deterministic, which means a retry is treated as a new payout instead of the same one. This is the last remaining double-payout risk.



2\. \*\*G-14 — Dead modules.\*\* Sprint 0.5 fixed `webhookVerifier.js` (G-06). Two modules remain dead under `"type":"module"`: `fallbackPoller.js` and `auditTimeline.js`. Each uses `module.exports` and will throw `ReferenceError: module is not defined` on import.



3\. \*\*Duplicate-handling tests.\*\* Sprint 0.5 proved webhook signature verification. It did not prove that duplicate webhooks, duplicate worker ticks, or worker restarts cannot duplicate a financial action. That invariant must be tested.



This sprint closes those three items. It does NOT begin Sprint 2 (Stacks/USDCx) or Sprint 3 (Yellow Card).



\---



\## Scope (In)



1\. \*\*G-11 — Deterministic idempotency key.\*\*

&#x20;  - Replace `Date.now()`-based key with a deterministic derivation from stable inputs: `source\_reference` + `source\_application` + `amount\_usdcx` + `recipient\_bank\_account` (or a documented canonical subset).

&#x20;  - Enforce `UNIQUE(idempotency\_key)` in the schema.

&#x20;  - Thread the same key through burn → attestation → release → payout so a retry cannot create a second payout.

&#x20;  - A duplicate create request with the same stable inputs must return the existing disbursement, not create a new one.



2\. \*\*G-14 — Dead module cleanup.\*\*

&#x20;  - `fallbackPoller.js` — either convert to ESM and wire it as a real fallback for webhook failures, or delete it and log removal in POSTPONED\_BACKLOG. \*\*Prefer deletion\*\* unless there is a concrete need in Sprint 2 or 3.

&#x20;  - `auditTimeline.js` — either convert to ESM and wire it to a route, or delete it and log removal. \*\*Prefer conversion\*\* if the Sprint 4 evidence chain will need it; otherwise delete.

&#x20;  - If either module is deleted, record the removal in POSTPONED\_BACKLOG with reason.

&#x20;  - If either is converted, add a test that imports and exercises it.



3\. \*\*Duplicate-handling tests.\*\*

&#x20;  - Test: a duplicate create request (same stable inputs) does not create a second disbursement.

&#x20;  - Test: a duplicate webhook delivery does not advance the state twice.

&#x20;  - Test: a worker tick on an already-advanced disbursement is a no-op.

&#x20;  - Test: simulating a worker restart mid-transition does not double-execute a financial action.

&#x20;  - Test: two concurrent advance attempts on the same disbursement do not both succeed.



\## Scope (Out)



\- Redesigning the state machine

\- Sprint 2 (Stacks/USDCx lifecycle)

\- Sprint 3 (Yellow Card)

\- Sprint 4 (evidence chain)

\- Sprint 5 (public API contract freeze)

\- Any new feature not listed in "Scope (In)"

\- `approve` / manual-review resolution endpoints (still blocked on actor model)



\---



\## Constraints



\- Do not modify CineX.

\- Do not redesign the state machine.

\- All changes must be covered by tests (per `tdd` skill).

\- Tests run without external credentials (FakeDb + mock adapters, as in Sprint 0.5).

\- Fail closed: any idempotency fix that gates a financial action must default to blocking, not allowing.

\- No new runtime npm dependencies.



\---



\## Acceptance Criteria



1\. A duplicate create request with the same stable inputs returns the existing disbursement, not a new one. Verified by test.

2\. The `disbursements.idempotency\_key` column has a UNIQUE constraint enforced in the schema.

3\. A retry (`retryDisbursement`) of a burned payout does not create a second burn. Verified by test.

4\. `fallbackPoller.js` and `auditTimeline.js` are either (a) converted to ESM and imported successfully by a test, or (b) deleted, with removal logged to `docs/POSTPONED\_BACKLOG.md`.

5\. The full lifecycle test from Sprint 0.5 still passes.

6\. Duplicate webhook delivery does not advance state twice. Verified by test.

7\. A worker restart mid-transition does not double-execute. Verified by test.

8\. No tests require external credentials.

9\. Documentation reflects the idempotency key derivation and the module dispositions.



\---



\## Working Method (per Master Prompt §WORKING METHOD)



1\. \*\*Inspect\*\* — read the current idempotency key construction in `disbursementService.js`; check where it is used downstream; read the two dead modules; identify what would be lost if each is deleted.

2\. \*\*Baseline\*\* — run `npm test` to confirm the Sprint 0.5 suite passes.

3\. \*\*Plan\*\* — produce `docs/SPRINT\_1\_5\_PLAN.md` with:

&#x20;  - The exact derivation formula for the deterministic idempotency key

&#x20;  - The schema change (migration 006) for `UNIQUE(idempotency\_key)`

&#x20;  - Migration path for any existing rows (dev-only, so likely none)

&#x20;  - Disposition decision for each dead module (convert or delete), with reason

&#x20;  - Test files to create

&#x20;  - Deviations from the Sprint 0.5 state, with reason

&#x20;  - \*\*Wait for review before implementing.\*\*

4\. \*\*Implement\*\* — one commit per logical fix, tests included.

5\. \*\*Test\*\* — run the full suite; all tests must pass, including the Sprint 0.5 regression suite.

6\. \*\*Evidence\*\* — capture final test output.

7\. \*\*Document\*\* — update README's idempotency section; add `docs/SPRINT\_1\_5\_REPORT.md`.



\---



\## Deliverables



\- `docs/SPRINT\_1\_5\_PLAN.md` — plan (produced first, reviewed before implementation)

\- Deterministic idempotency key, migration 006, tests

\- Dead module dispositions, with tests or deletion notes

\- Duplicate-handling tests (at least 5 cases, per Scope §3)

\- `docs/SPRINT\_1\_5\_REPORT.md` — evidence, deviations, open items

\- Updated README with idempotency documentation

\- No changes to CineX

\- No new runtime npm dependencies



\---



\## Blockers to Report (Do Not Silently Resolve)



If any of the following are true during implementation, STOP and report:



\- The deterministic key cannot be derived without a column that does not exist

\- The UNIQUE constraint conflicts with existing data

\- Deleting a dead module removes a capability that Sprint 2 or 3 needs

\- A duplicate-handling test reveals an idempotency hole that requires more than the scoped fix

\- A worker restart test reveals a race condition that requires structural change



Report blockers with: what was found, what was expected, options, and recommended option.



\---



\## Gate



Do NOT proceed to Sprint 2 until:



1\. G-11 is implemented with the UNIQUE constraint and duplicate-create tests pass

2\. Both dead modules are resolved (converted with tests, or deleted with backlog note)

3\. All duplicate-handling tests pass

4\. The Sprint 0.5 lifecycle test still passes

5\. `SPRINT\_1\_5\_REPORT.md` exists with evidence

6\. No CineX files were modified

7\. No new runtime npm dependencies were added



Stop after Step 3 (Plan). Produce `SPRINT\_1\_5\_PLAN.md` and wait for review.

