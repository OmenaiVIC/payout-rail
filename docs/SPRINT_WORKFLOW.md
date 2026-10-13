# Payout Rail — Resume Sprint Workflow

The five docs are now fixed and the repository is pushed. Here is the state and the procedure I want to follow for all future sprints.

## Repository state

- origin/main is up to date with local main.
- Test suite: verify the current count yourself before we proceed — run `npm test` and
  report the exact pass/fail/skip. Do not trust any test count written in this doc or
  the handoff; they go stale with every commit.
- The Breet adapter is in the repository as a partial sprint (adapter works, webhook verifier deferred, five docs now fixed).

## The sprint workflow I want to sustain

For every sprint going forward, use the following procedure. This is the same procedure we have used for Sprints 0.5 through 13.

### Phase 1 — Session constitution

Before any task, I will paste a short constitution message. You will:

1. Read docs/prompts/00_MASTER.md and docs/PRODUCT_CHANGE_CONTROL.md.
2. Load the skills relevant to the sprint (I will name them).
3. Confirm you have read both documents and loaded the skills.
4. Summarize the key principles you will operate under.
5. Wait for the task.

You do not write anything until I paste the task directive.

### Phase 2 — Plan-first

When I paste the task directive, you will:

1. Inspect the relevant files.
2. Run `npm test` to establish the baseline. Report the exact pass/fail/skip counts.
3. Produce a plan file (e.g., docs/SPRINT_<NAME>_PLAN.md) covering:
   - The exact change per file
   - The exact wire shapes if external APIs are involved
   - Test files to create
   - Deviations from the prior state, with reason
   - A UNVERIFIED list for anything that cannot be confirmed offline
4. Stop and wait for my review.

You do NOT implement anything in this phase. You do NOT modify source files. You do NOT commit.

### Phase 3 — Review gate

I will review the plan. I may ask for corrections. We iterate on the plan until it is sound. Only then do I authorize implementation.

### Phase 4 — Implementation

When I authorize, you will:

1. Implement in the commit order specified in the plan.
2. One commit per logical fix.
3. Run `npm test` after each commit and confirm 0 failures before moving to the next.
4. Do not begin any other sprint. Do not start Sprint 8a/8b/8c or Sprint 9 until
   this sprint is confirmed complete.
5. After each commit: run `npm test` and confirm 0 failures; run
   `git show --stat HEAD` and confirm the commit touches only the files the plan
   named; then `git push origin main`. If either check fails, STOP — do not push,
   do not amend blindly, report.
6. If a blocker arises, STOP and report. Do not guess. Do not skip a file. Do not weaken a test.

### Phase 5 — Report
The report must state, for any sprint involving external provider credentials:
whether sandbox validation was performed, which script performed it, the exit
code, and the captured output. If sandbox validation was not performed, the
report must say so explicitly and list it in the UNVERIFIED section.

At the end of implementation, produce a sprint report (e.g., docs/SPRINT_<NAME>_REPORT.md) covering:

1. Every commit hash.
2. Full test suite output.
3. Confirmation that no existing test was edited, weakened, or deleted.
4. Confirmation that no CineX file was touched.
5. Confirmation that no new runtime npm dependency was added.
6. The UNVERIFIED list, reproduced.
7. Any deviations from the plan, with reason.

Then stop and wait for my review before we plan the next sprint.

### Phase 6 — Verification by me

Before accepting the sprint as complete, I will independently verify:
- The test count.
- The commit list.
- The state of each file the sprint claimed to touch.

A sprint is complete when and only when `npm test` shows zero failures and I have verified the claims against the actual files.

## Rules to carry into every future sprint

- A sprint is complete when `npm test` shows 0 failures. Nothing else counts.
- Never weaken, delete, or skip a test to make it pass. If the test is wrong, rewrite it to match the plan, not the implementation.
- No external network calls in the default test suite.
- No new runtime npm dependencies.
- One commit per logical fix.
- Do not modify CineX.
- Fail closed. Never fabricate.
- When I ask for a fix to a file, use the file-write tool. Do not use shell redirection. If a write fails, report the exact error and stop.
- If you cannot complete a task, say so. Do not report completion that is not true.

## What I want to do now

Before we begin the next sprint, we will decide together which direction is next. Candidates:
- Complete the Breet webhook verifier as a focused sprint with a strict constraint: do not modify any existing function or route in webhooks.js or webhookVerifier.js. Add only new, isolated code.
- Sprint 8a/8b/8c for the Stacks Endowment grant evidence package.
- Sprint 9 for the commercial model.

Tell me your recommendation, and I will decide.

Do not begin any work until we have agreed on the direction and I have pasted the session constitution.