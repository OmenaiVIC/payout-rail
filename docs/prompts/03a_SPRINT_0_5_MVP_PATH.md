\# 03a — SPRINT 0.5: MINIMUM VIABLE PATH



> Task: fix the P0 gaps and critical P1 blockers so a single payout can complete end-to-end in mock mode.

> Mode: implementation with tests. No redesign of the state machine.

> Outputs: working create/advance API, fail-closed preflight, tx-id persistence, NGN amount population, webhook signature verification, and an end-to-end mock test.



\---



\## Why This Sprint Exists



The Sprint 0 baseline (`docs/PRODUCT\_BASELINE.md`) revealed that the extracted scaffold does not complete a single payout as shipped. Three P0 gaps and three critical P1 blockers prevent any real disbursement from progressing.



The original Sprint 1 ("Standalone Orchestration Core") assumed the state machine did not exist and needed to be designed. That premise is false — the state machine exists (14 states, 45 registered transitions, guards, actions, workers). What it needs is to be \*\*made to work\*\*, not designed from scratch.



This sprint replaces Sprint 1. The original `03\_SPRINT\_1\_ORCHESTRATION.md` is superseded.



\---



\## Scope (In)



Six targeted fixes:



1\. \*\*G-02\*\* — Disbursements cannot be created (schema/code mismatch on NOT NULL columns)

2\. \*\*G-03\*\* — No public API to create / advance / retry / approve / resolve (minimum: create + get + advance)

3\. \*\*G-01\*\* — Preflight failure does not block the burn (fail-open)

4\. \*\*G-05\*\* — Burn confirmation dead-ends (`external\_tx\_id` never persisted on `disbursements`)

5\. \*\*G-04\*\* — `amount\_ngn\_expected` never populated → Yellow Card leg unreachable

6\. \*\*G-06\*\* — Webhook signature verification is not wired (no raw body, no HMAC check)



\## Scope (Out)



\- Redesigning the state machine

\- Real xReserve integration (Sprint 2)

\- Real Yellow Card integration (Sprint 3)

\- Full evidence chain (Sprint 4)

\- Public API contract freeze (Sprint 5)

\- Any new features not listed in "Scope (In)"



\---



\## Constraints



\- Do not modify CineX.

\- Do not redesign the state machine. Fix what is broken.

\- All changes must be covered by tests (per `tdd` skill).

\- Tests run without external credentials (mock mode only).

\- All P0 and P1 fixes must preserve behavioral fidelity where possible, and document any deviation.

\- Fail closed: any fix that gates a financial action must default to blocking, not allowing.



\---



\## Acceptance Criteria



1\. A disbursement can be created via a documented HTTP API and persists to the database.

2\. The preflight gate failure blocks progression to burn (verifiable by test).

3\. Burn transaction ID is persisted on `disbursements.external\_tx\_id` before `BURN\_CONFIRMED` is reachable.

4\. `amount\_ngn\_expected` and `exchange\_rate` are populated before the Yellow Card leg is reachable.

5\. Webhook signature verification rejects unsigned payloads.

6\. An end-to-end mock test demonstrates the full lifecycle: `PREFLIGHT\_CHECK → BURN\_SUBMITTED → BURN\_CONFIRMED → ATTESTATION\_REQUESTED → ATTESTATION\_CONFIRMED → DESTINATION\_RELEASE\_SUBMITTED → DESTINATION\_RELEASE\_CONFIRMED → YELLOWCARD\_PAYOUT\_SUBMITTED → YELLOWCARD\_PAYOUT\_CONFIRMED → SETTLED`.

7\. No tests require external credentials.

8\. All six fixes have tests. Tests are runnable via a single command.

9\. Documentation reflects the resulting API and lifecycle.



\---



\## Working Method (per Master Prompt §WORKING METHOD)



1\. \*\*Inspect\*\* — read the actual code for each of the six gaps; confirm the baseline's findings are still accurate.

2\. \*\*Baseline\*\* — run `node --check` on all files; confirm no other tests exist.

3\. \*\*Plan\*\* — produce `docs/SPRINT\_0\_5\_PLAN.md` with:

&#x20;  - Files to change per gap

&#x20;  - Test files to create

&#x20;  - Interfaces affected

&#x20;  - Any new dependencies required (e.g. `vitest` or `node:test`)

&#x20;  - Any deviation from the extraction baseline, with reason

&#x20;  - \*\*Wait for review before implementing.\*\*

4\. \*\*Implement\*\* — apply the six fixes as separate, reviewable commits.

5\. \*\*Test\*\* — write tests first (TDD); all fixes must have test coverage.

6\. \*\*Evidence\*\* — capture test output, node --check output, and the mock end-to-end run.

7\. \*\*Document\*\* — update README, add `docs/SPRINT\_0\_5\_REPORT.md`.



\---



\## Deliverables



\- `docs/SPRINT\_0\_5\_PLAN.md` — plan (produced first, reviewed before implementation)

\- Six fixes, each in its own commit

\- Test suite (framework chosen; propose in plan)

\- `docs/SPRINT\_0\_5\_REPORT.md` — evidence, deviations, what remains for Sprint 1+

\- Updated `README.md` with API documentation for the create/advance endpoints

\- No changes to CineX



\---



\## Blockers to Report (Do Not Silently Resolve)



If any of the following are true during implementation, STOP and report:



\- A fix requires redesigning more than the local module (e.g. state machine structure)

\- A fix cannot be tested without live credentials

\- A fix contradicts the baseline's findings (baseline says X, code shows Y)

\- A fix requires new infrastructure not anticipated in the plan



Report blockers with: what was found, what was expected, what options exist, and which option you recommend.



\---



\## Gate



Do NOT proceed to Sprint 1 until:



1\. All six fixes are implemented with tests

2\. All tests pass in mock mode without external credentials

3\. The mock end-to-end test demonstrates the full lifecycle

4\. `SPRINT\_0\_5\_REPORT.md` exists with evidence and deviations

5\. No CineX files were modified



Stop after Step 3 (Plan). Produce `SPRINT\_0\_5\_PLAN.md` and wait for review.

