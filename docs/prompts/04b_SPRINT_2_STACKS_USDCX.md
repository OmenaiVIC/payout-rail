\# 04b — SPRINT 2: STACKS/USDCx WITHDRAWAL LIFECYCLE (MODEL CORRECTION)



> Task: replace incorrect xReserve assumptions with a correct \*model\* of the canonical Stacks/USDCx withdrawal lifecycle. This sprint does NOT verify external behavior — it corrects the internal model and marks every external dependency as UNVERIFIED.

> Mode: plan-first, implementation-with-tests, but no external network calls.

> Outputs: corrected state model, observation-based lifecycle, deterministic mocked tests, updated documentation, and a clear separation between "orchestration we control" and "external settlement we observe."



\---



\## Why This Sprint Exists



The Sprint 0 baseline (`docs/PRODUCT\_BASELINE.md` §6) found that the current code models the xReserve "destination release" step as an application-controlled operation that returns `{ status: 'confirmed' }` without external verification (G-08). This is incorrect against the canonical Stacks/USDCx lifecycle, where:



1\. The app initiates a USDCx \*\*burn\*\* on Stacks.

2\. The burn is the attestation trigger.

3\. External services (Stacks attestation service → xReserve → USDC release to destination wallet) process the withdrawal \*\*outside the app's control\*\*.

4\. The app's role is to \*\*observe\*\* and \*\*record\*\*, not to fake confirmation.



The current code does steps 1 and 4 correctly, but fabricates step 3 as if it were internal. This creates a false "confirmed" state that the state machine accepts as truth.



Sprint 2 corrects the model. It does not attempt to reach testnet or xReserve — that requires credentials and belongs in a later, verification-only sprint.



\---



\## Scope (In)



1\. \*\*Re-model destination release as an observation, not an action.\*\*

&#x20;  - Remove the fabricated `releaseDestination()` returning `confirmed`.

&#x20;  - Replace with an observation step: the app queries a status surface (or reads an evidence record) and only advances when the observed state is confirmed by an external source.

&#x20;  - The interface must distinguish:

&#x20;    - `release\_status: 'observed\_confirmed'` — external evidence exists

&#x20;    - `release\_status: 'observed\_pending'` — external process still in progress

&#x20;    - `release\_status: 'observed\_failed'` — external process failed

&#x20;    - `release\_status: 'unobserved'` — no external evidence yet

&#x20;  - The state machine must only reach `destination\_release\_confirmed` when the status is `observed\_confirmed`.



2\. \*\*Correct the burn entrypoint model (G-09).\*\*

&#x20;  - Document that the current code targets `usdcx` token contract, and that the canonical entrypoint may be `usdcx-v1`.

&#x20;  - Do NOT change the target contract in this sprint (needs testnet verification), but:

&#x20;    - Record the discrepancy as a named open item in `docs/GAP\_REGISTER.md` update.

&#x20;    - Add an assertion or a comment that this target is `UNVERIFIED`.

&#x20;    - Prepare the adapter interface so it can be swapped without a redesign.



3\. \*\*Add an explicit `unobserved` state to the lifecycle.\*\*

&#x20;  - The state machine must have a distinct state that means "we are waiting for external evidence, but none exists yet."

&#x20;  - This state must not allow progression to Yellow Card payout.

&#x20;  - It must have a timeout that routes to `manual\_review`.



4\. \*\*Add a mocked external-evidence source.\*\*

&#x20;  - A test-only mock that simulates the external settlement process emitting evidence.

&#x20;  - The E2E test uses this mock to demonstrate the correct full lifecycle.



5\. \*\*Tests.\*\*

&#x20;  - Each new state transition has a deterministic mocked test.

&#x20;  - Tests cover: observed\_pending → still waiting, observed\_confirmed → advance, observed\_failed → fail path, no-evidence timeout → manual\_review.

&#x20;  - The existing Sprint 1.5 duplicate-handling tests must still pass.



6\. \*\*Update documentation.\*\*

&#x20;  - `docs/PRODUCT\_BASELINE.md` §6 — update the settlement model section to reflect the corrected model.

&#x20;  - `docs/CLAIMS\_REGISTER.md` — reclassify any claim about "release confirmed" as SIMULATED → MODEL CORRECTED / UNVERIFIED EXTERNAL.

&#x20;  - `docs/GAP\_REGISTER.md` — mark G-08 as resolved-in-model (still unverified externally) and update G-09.



\## Scope (Out)



\- Reaching real Stacks testnet

\- Reaching real xReserve

\- Reaching real Yellow Card sandbox

\- Yellow Card adapter changes (Sprint 3)

\- Evidence chain implementation (Sprint 4)

\- Public API changes (Sprint 5)

\- Any new state that is not directly required to model the external lifecycle correctly



\---



\## Constraints



\- Do not modify CineX.

\- Do not perform any external network call. All tests are offline.

\- Do not claim external verification — every external step remains `UNVERIFIED` until a later, explicitly authorized verification sprint.

\- All tests must run via `npm test` with no credentials.

\- No new runtime npm dependencies.

\- Fail closed: unobserved or ambiguous states must not advance to Yellow Card payout.

\- One commit per logical fix.



\---



\## Acceptance Criteria



1\. `releaseDestination()` no longer returns a fabricated `confirmed` status.

2\. The state machine has an explicit `unobserved` state (or equivalent) between burn confirmation and destination release confirmation.

3\. `destination\_release\_confirmed` is only reachable when external evidence is `observed\_confirmed`.

4\. A timeout routes an unobserved state to `manual\_review`.

5\. The burn entrypoint discrepancy (G-09) is documented and marked `UNVERIFIED` in code comments and `docs/GAP\_REGISTER.md`.

6\. Every new state and transition has deterministic mocked tests.

7\. The E2E mock lifecycle test demonstrates the correct model end-to-end.

8\. All Sprint 0.5 and Sprint 1.5 tests still pass.

9\. `docs/PRODUCT\_BASELINE.md`, `docs/CLAIMS\_REGISTER.md`, and `docs/GAP\_REGISTER.md` reflect the corrected model.

10\. No external network calls in any test or production path affected by this sprint.

11\. No new runtime npm dependencies.



\---



\## Working Method (per Master Prompt §WORKING METHOD)



1\. \*\*Inspect\*\* — read `xreserveAdapter.js`, `transitionActions.js` (releaseDestination), `stateMachine.js`, `types.js`, and the existing tests.

2\. \*\*Baseline\*\* — run `npm test`; confirm Sprint 1.5 state (69/68/0/1).

3\. \*\*Plan\*\* — produce `docs/SPRINT\_2\_PLAN.md` with:

&#x20;  - The exact set of new states and transitions

&#x20;  - The observation interface shape

&#x20;  - The evidence-source mock design

&#x20;  - The state-machine changes required (which transitions are added/removed)

&#x20;  - Whether any existing state must be renamed or removed (justify if yes)

&#x20;  - Test files to create

&#x20;  - Deviations from the Sprint 1.5 state, with reason

&#x20;  - \*\*Explicit statement of what remains UNVERIFIED and why\*\*

&#x20;  - \*\*Wait for review before implementing.\*\*

4\. \*\*Implement\*\* — one commit per fix.

5\. \*\*Test\*\* — full suite must pass.

6\. \*\*Evidence\*\* — capture test output; note external verification as BLOCKED, not claimed.

7\. \*\*Document\*\* — update the three baseline documents and add `docs/SPRINT\_2\_REPORT.md`.



\---



\## Deliverables



\- `docs/SPRINT\_2\_PLAN.md` — plan (produced first, reviewed before implementation)

\- Corrected release model (observation-based, not fabrication)

\- Explicit `unobserved` state with timeout

\- Mocked external-evidence source

\- Tests for every new state and transition

\- Updated `PRODUCT\_BASELINE.md`, `CLAIMS\_REGISTER.md`, `GAP\_REGISTER.md`

\- `docs/SPRINT\_2\_REPORT.md`

\- No changes to CineX

\- No new runtime npm dependencies

\- No external network calls



\---



\## Blockers to Report (Do Not Silently Resolve)



If any of the following are true during implementation, STOP and report:



\- The corrected model requires removing a state that other code depends on

\- The corrected model requires a structural change to the state machine that exceeds "add a state, add transitions"

\- The evidence-source mock cannot be made deterministic without a design compromise

\- An existing Sprint 0.5 or 1.5 test can no longer pass because the model changed

\- A new transition cannot be tested without external credentials



Report blockers with: what was found, what was expected, options, and recommended option.



\---



\## Gate



Do NOT proceed to Sprint 3 until:



1\. The corrected release model is implemented

2\. The `unobserved` state exists and is tested

3\. All new transitions have deterministic mocked tests

4\. The E2E mock lifecycle demonstrates the corrected model

5\. All Sprint 0.5 and 1.5 tests still pass

6\. The three baseline documents reflect the correction

7\. `SPRINT\_2\_REPORT.md` exists, and every external dependency is marked UNVERIFIED with a clear reason

8\. No CineX files were modified

9\. No new runtime npm dependencies were added

10\. No external network calls were made



Stop after Step 3 (Plan). Produce `SPRINT\_2\_PLAN.md` and wait for review.

