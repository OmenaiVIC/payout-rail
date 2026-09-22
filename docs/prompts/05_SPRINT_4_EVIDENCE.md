\# 05 — SPRINT 4: SETTLEMENT EVIDENCE AND RECONCILIATION



> Task: make every payout auditable from source settlement through local payout. Build the immutable evidence chain, wire the unused evidence writers and dead tables, add reconciliation workers, and generate settlement receipts.

> Mode: plan-first, implementation-with-tests, no external network calls.

> Outputs: complete evidence trail, reconciliation workers, settlement receipt generator, tests, updated documentation.



\---



\## Why This Sprint Exists



The Sprint 0 baseline (`docs/PRODUCT\_BASELINE.md`) found that:



1\. `evidenceCollector.js` has six recorders, of which only three are used (G-17).

2\. Six tables are created by migrations but written nowhere (G-16): `yellow\_card\_webhook\_events`, `on\_chain\_events`, `relay\_wallet\_activity`, `external\_status\_snapshots`, `config\_snapshots`, `manual\_review\_queue`.

3\. There is no reconciliation worker that can detect inconsistent states across sources.

4\. There is no settlement receipt generation.



Sprint 4 completes the evidence chain. It is the sprint that gives the product a defensible audit trail, which is one of the core value propositions of the product thesis.



\---



\## Scope (In)



\### 1. Evidence records — immutable, complete



\- Define the evidence record shape (already partially defined by `evidenceCollector.js`): event type, source, external reference, timestamp, status, payload hash, verification result.

\- Ensure every payout lifecycle transition writes exactly one evidence record (immutable, append-only).

\- Wire the three unused recorders in `evidenceCollector.js`:

&#x20; - `recordWebhookPayload` (partially wired in Sprint 0.5's G-06 — verify and complete)

&#x20; - `recordManualNote`

&#x20; - `recordPollResult`

\- Do NOT store sensitive financial data in evidence records. Payload hashes, not raw payloads, where sensitive.



\### 2. Dead table disposition



For each of these six tables, decide: wire it, or remove it.



\- `yellow\_card\_webhook\_events` — likely wire (webhook payloads should be recorded)

\- `on\_chain\_events` — decide (Stacks events could feed reconciliation)

\- `relay\_wallet\_activity` — likely remove (relay is CineX-owned, out of scope)

\- `external\_status\_snapshots` — likely wire (used by `auditTimeline.js` — Sprint 1.5 converted it; Sprint 4 should populate it)

\- `config\_snapshots` — decide (may be useful for audit of config changes, may be over-engineering)

\- `manual\_review\_queue` — wire (operator queue needs to be populated when rows enter manual\_review)



Each decision must be justified in the plan. Removal requires a migration that drops the table, with a note in `docs/POSTPONED\_BACKLOG.md` explaining what was removed and why.



\### 3. Reconciliation workers



Implement reconciliation that detects these five failure modes:



\- Missing webhook (expected event never arrived)

\- Duplicate event (same event twice with different timestamps)

\- Inconsistent status (source says X, provider says Y)

\- Timeout escalation (state has been pending beyond SLA)

\- Orphaned payouts (disbursement exists but no evidence for a leg that should have evidence)



Route inconsistencies to `manual\_review` with an evidence record describing the detection. The reconciliation worker must be deterministic and testable offline.



\### 4. Settlement receipt generation



Implement a function that, given a disbursement ID, produces a machine-readable settlement receipt containing:



\- BOS Payout ID

\- Stacks TX

\- USDCx amount

\- Burn status

\- Withdrawal status

\- External settlement reference

\- Provider

\- Provider payout ID

\- NGN amount

\- Final status

\- Timestamps

\- Evidence references



The receipt must be reconstructable from stored evidence alone. If any evidence is missing, the receipt must clearly mark the gap. The receipt must be deterministic (same input, same output).



\### 5. Tests



\- Each evidence recorder has a deterministic test.

\- Each dead-table disposition has a test or a removal note.

\- Each reconciliation scenario has a deterministic test.

\- Receipt generation has deterministic tests, including the case where evidence is incomplete.



\## Scope (Out)



\- Reaching real external services

\- Yellow Card integration changes (Sprint 3)

\- Public API changes (Sprint 5)

\- Multi-corridor support

\- Any new state or transition (that was Sprint 2)



\---



\## Constraints



\- Do not modify CineX.

\- No external network calls.

\- No new runtime npm dependencies.

\- Fail closed: if evidence is incomplete, reconciliation must route to `manual\_review`, not advance.

\- Evidence records are immutable: never update or delete a record. If a correction is needed, append a new record that supersedes the old one.

\- No sensitive data in evidence (hashes, not raw payloads for sensitive fields).

\- One commit per logical fix.



\---



\## Acceptance Criteria



1\. Every payout lifecycle transition writes exactly one evidence record. Verified by test.

2\. All six dead tables have a documented disposition (wired or removed with backlog note).

3\. Reconciliation detects all five failure modes listed in Scope §3. Verified by test for each.

4\. Settlement receipt generation works for:

&#x20;  - A complete lifecycle (all evidence present)

&#x20;  - A partial lifecycle (evidence missing for some legs)

&#x20;  - A lifecycle with inconsistent evidence

5\. The receipt is deterministic and reconstructable from stored evidence alone.

6\. The E2E mock lifecycle from Sprint 2 still passes and now produces a complete evidence trail.

7\. All existing tests (Sprint 0.5, 1.5, 2) still pass.

8\. Documentation reflects the evidence model, receipt format, and reconciliation logic.

9\. No external network calls in any test or production path.

10\. No new runtime npm dependencies.



\---



\## Working Method (per Master Prompt §WORKING METHOD)



1\. \*\*Inspect\*\* — read `evidenceCollector.js`, the six dead tables, `reconciliationWorker.js`, `auditTimeline.js`, and the existing tests.

2\. \*\*Baseline\*\* — run `npm test`; confirm Sprint 2 state (78/77/0/1).

3\. \*\*Plan\*\* — produce `docs/SPRINT\_4\_PLAN.md` with:

&#x20;  - The exact evidence record shape

&#x20;  - Every transition → evidence writer mapping

&#x20;  - Disposition decision for each of the six dead tables, with reason

&#x20;  - The reconciliation algorithm for each failure mode

&#x20;  - The settlement receipt format (with an example)

&#x20;  - Test files to create

&#x20;  - Deviations from the Sprint 2 state, with reason

&#x20;  - \*\*Scope check:\*\* if the plan exceeds \~10 commits, propose a split into 4a / 4b and recommend which half to do first

&#x20;  - \*\*Wait for review before implementing.\*\*



4\. \*\*Implement\*\* — one commit per fix.

5\. \*\*Test\*\* — full suite must pass.

6\. \*\*Evidence\*\* — capture test output; produce an example settlement receipt from the E2E run.

7\. \*\*Document\*\* — update README, add `docs/SPRINT\_4\_REPORT.md`.



\---



\## Deliverables



\- `docs/SPRINT\_4\_PLAN.md` — plan (reviewed before implementation)

\- Complete evidence chain (all transitions write evidence)

\- Dead table dispositions (wire or remove, all justified)

\- Reconciliation workers (five failure modes)

\- Settlement receipt generator

\- Tests for every new component

\- Example settlement receipt from the E2E run

\- Updated documentation

\- `docs/SPRINT\_4\_REPORT.md`

\- No CineX changes

\- No new runtime npm dependencies

\- No external network calls



\---



\## Blockers to Report (Do Not Silently Resolve)



If any of the following are true during implementation, STOP and report:



\- A dead table cannot be wired without a schema change that breaks existing code

\- A dead table cannot be removed because something reads from it that the baseline did not find

\- The reconciliation algorithm requires state that does not exist

\- The receipt format cannot be reconstructed from evidence alone

\- The plan's scope exceeds what one sprint can deliver safely (recommend split)

\- A new test cannot pass because an existing test's assertion now conflicts



Report blockers with: what was found, what was expected, options, and recommended option.



\---



\## Gate



Do NOT proceed to Sprint 3 or Sprint 5 until:



1\. Every transition writes exactly one evidence record

2\. All six dead tables have documented dispositions

3\. All five reconciliation failure modes are detected and tested

4\. Settlement receipt generation works for complete, partial, and inconsistent lifecycles

5\. The E2E mock lifecycle produces a complete evidence trail and a valid receipt

6\. All existing tests still pass

7\. Documentation reflects the evidence model and receipt format

8\. `SPRINT\_4\_REPORT.md` exists with evidence

9\. No CineX files were modified

10\. No new runtime npm dependencies were added

11\. No external network calls were made



Stop after Step 3 (Plan). Produce `SPRINT\_4\_PLAN.md` and wait for review.

