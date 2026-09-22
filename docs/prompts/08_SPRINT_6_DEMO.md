# 08 — SPRINT 6: REPRODUCIBLE NIGERIA PAYOUT DEMONSTRATION

> Task: produce the strongest possible reproducible evidence of the Nigeria corridor without pretending unavailable external infrastructure exists.
> Mode: plan-first, implementation-with-tests, no external network calls.
> Outputs: demo runner (DEMO_MODE + SANDBOX_MODE), human-readable transaction timeline, machine-readable settlement receipt, reproducible command, documentation of what the demo proves and does not prove.

---

## Why This Sprint Exists

Sprint 5 produced a working example client. Sprint 3 corrected the Yellow Card adapter model. Sprint 4 built the evidence chain, reconciliation, and settlement receipt generator.

What is missing is the **demonstration**: a single command that runs the full payout lifecycle end-to-end and produces both a human-readable timeline and a machine-readable receipt. This is the artifact a grant reviewer, an operator, or an auditor actually runs.

Sprint 6 produces that demonstration. It does NOT claim live settlement. It does NOT require credentials. It is honest about the difference between DEMO_MODE (all external dependencies mocked) and SANDBOX_MODE (real sandbox services when credentials exist).

---

## The Two Modes

### DEMO_MODE

- All external dependencies are mocked (Stacks, xReserve, Yellow Card)
- Every mocked event is clearly labelled as mocked in the output
- The lifecycle runs deterministically end-to-end
- The command produces a transaction timeline and a settlement receipt
- The output states in plain text: "DEMO_MODE — all external events are simulated"

### SANDBOX_MODE

- Uses actual test/sandbox services where credentials exist
- If credentials are absent, the mode **reports the missing external verification** rather than fabricating success
- Never mixes demo evidence with real evidence
- The output labels each event with its source: SANDBOX or DEMO

**Never mix the two.** A DEMO_MODE event must never appear in a SANDBOX_MODE run, and vice versa.

---

## Scope (In)

1. **Demo runner script.**
   - New file: `scripts/demo-payout-ngn.js`
   - Invoked via `npm run demo:payout:ngn`
   - Accepts `--mode=demo` (default) or `--mode=sandbox`
   - Uses the v1 public API from Sprint 5 (not internal services)
   - Runs the full lifecycle:
     - Create payout
     - Advance through the state machine
     - Retrieve the settlement receipt
     - Print a transaction timeline
   - Exits 0 on success, non-zero on failure

2. **Transaction timeline (human-readable).**
   - Printed to stdout
   - Each event labelled with:
     - Timestamp
     - State transition (`from → to`)
     - Source (DEMO or SANDBOX)
     - Evidence reference id
   - Clearly announces which mode is running at the top

3. **Machine-readable settlement receipt.**
   - Retrieved from `GET /api/v1/disbursements/:id/receipt`
   - Written to `demo-output/receipt-<id>.json` (gitignored)
   - Includes gaps if any exist, never fabricates completeness

4. **Demo documentation.**
   - New file: `docs/DEMO.md`
   - Explains:
     - How to run the demo (`npm run demo:payout:ngn`)
     - How to run it in sandbox mode (and what credentials are needed)
     - What the demo proves
     - What the demo does NOT prove
     - How to read the transaction timeline
     - How to read the settlement receipt
     - How to interpret gaps
   - Explicitly states the DEMO vs SANDBOX distinction

5. **Tests.**
   - A test that runs the demo runner in DEMO_MODE and asserts:
     - Exit code is 0
     - The lifecycle completes to a terminal state
     - The timeline contains each expected transition
     - The receipt file is written and valid
   - A test that asserts SANDBOX_MODE without credentials reports the missing verification rather than fabricating success

6. **README update.**
   - Add a "Demo" section pointing to `docs/DEMO.md`

## Scope (Out)

- Real sandbox calls (requires credentials)
- Any adapter change (Sprint 3 owns that)
- Any API change (Sprint 5 owns that)
- Any state machine change
- Any evidence chain change (Sprint 4 owns that)
- Multi-corridor support (NGN only)
- Any new external dependency

---

## Constraints

- Do not modify CineX.
- No external network calls in DEMO_MODE.
- No new runtime npm dependencies.
- Fail closed: if the demo cannot complete, exit non-zero with a clear error.
- Never mix DEMO and SANDBOX evidence.
- Every mocked event must be visibly labelled as mocked in the output.
- One commit per logical fix.

---

## Acceptance Criteria

1. `npm run demo:payout:ngn` runs the full lifecycle in DEMO_MODE and exits 0.
2. The transaction timeline is printed to stdout and clearly labels each event as DEMO.
3. A machine-readable receipt is written to `demo-output/` and is valid JSON.
4. `docs/DEMO.md` exists and explains what the demo proves and does not prove.
5. Running with `--mode=sandbox` without credentials reports the missing verification rather than fabricating success.
6. Tests cover DEMO_MODE completion and SANDBOX_MODE honest failure.
7. All existing tests still pass (181 baseline).
8. No external network calls in DEMO_MODE.
9. No new runtime npm dependencies.
10. The demo output never claims production readiness or live settlement.
11. `demo-output/` is added to `.gitignore`.

---

## Working Method (per Master Prompt §WORKING METHOD)

1. **Inspect** — read `examples/simple-payout-client/client.js`, the v1 API routes, and the settlement receipt generator.
2. **Baseline** — run `npm test`; confirm Sprint 3 state (181/180/0/1).
3. **Plan** — produce `docs/SPRINT_6_PLAN.md` with:
   - The exact demo runner structure
   - The timeline format (what fields, what layout)
   - The receipt retrieval flow
   - The DEMO vs SANDBOX labelling scheme
   - The test files to create
   - Deviations from the Sprint 3 state, with reason
   - **Wait for review before implementing.**
4. **Implement** — one commit per logical fix.
5. **Test** — full suite must pass; the demo itself must run and exit 0.
6. **Evidence** — capture the actual demo run output; it becomes part of the sprint report.
7. **Document** — add `docs/DEMO.md`, update README, add `docs/SPRINT_6_REPORT.md`.

---

## Deliverables

- `docs/SPRINT_6_PLAN.md` — plan (reviewed before implementation)
- `scripts/demo-payout-ngn.js` — the demo runner
- `npm run demo:payout:ngn` — the reproducible command
- Transaction timeline output (captured in the report)
- Settlement receipt file written to `demo-output/`
- `docs/DEMO.md` — the demo documentation
- Tests for DEMO_MODE and SANDBOX_MODE honesty
- README update
- `.gitignore` update for `demo-output/`
- `docs/SPRINT_6_REPORT.md` — with the actual demo run output
- No CineX changes
- No new runtime npm dependencies
- No external network calls in DEMO_MODE

---

## Blockers to Report (Do Not Silently Resolve)

If any of the following are true during implementation, STOP and report:

- The demo cannot complete in DEMO_MODE without a change to an adapter
- The v1 API does not support a step the demo needs (report the gap; do not bypass the API)
- The receipt cannot be retrieved from the v1 endpoint
- A test cannot be written without external credentials
- The demo would need to mix DEMO and SANDBOX evidence to work

Report blockers with: what was found, what was expected, options, and recommended option.

---

## Gate

Do NOT proceed to Sprint 7 or Sprint 8 until:

1. `npm run demo:payout:ngn` runs end-to-end in DEMO_MODE and exits 0
2. The transaction timeline is printed and labelled
3. The settlement receipt is written to `demo-output/`
4. `docs/DEMO.md` exists and explains what is and is not proven
5. SANDBOX_MODE without credentials reports the missing verification rather than fabricating
6. All existing tests still pass
7. No CineX files were modified
8. No new runtime npm dependencies were added
9. `demo-output/` is gitignored
10. No external network calls were made in DEMO_MODE

Stop after Step 3 (Plan). Produce `SPRINT_6_PLAN.md` and wait for review.
