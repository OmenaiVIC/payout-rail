# Payout Rail — Session Handoff

Continuing work on the Payout Rail project. This file is the authoritative
state-of-play for the next session. Verify everything against the actual
repository before trusting any line below.

## The project

Payout Rail is an open-source orchestration layer that connects Stacks applications'
on-chain settlement to local fiat payouts in emerging markets. Repository:
https://github.com/OmenaiVIC/payout-rail

## Current repository state (as of 2026-10-10)

- Local HEAD = origin/main = 3a0a9c0. Everything is pushed. Working tree clean.
- Test suite: 259 tests, 258 pass, 0 fail, 1 skip (the Postgres-gated integration case).
  
pm test is the source of truth; run it before trusting any count.
- Recent commits (newest first):
  - 3a0a9c0 docs(provider-adapters): document Breet adapter and 2026-10-09 repairs
  - e35b312 chore: add .gitattributes (LF) and .prettierignore (*.js)
  - 9f7bd7d fix: repair regressions from 3903653 (Breet webhook sprint)

## What was repaired on 2026-10-09 / 2026-10-10

Commit 3903653 ("feat: add Breet webhook verification, route, env vars, tests,
and sprint report") introduced three regressions, repaired in commit 9f7bd7d:

1. src/routes/webhooks.js imported a nonexistent
   ../services/bos/webhookHandlers.js. The handlers
   (handleYellowCardWebhook, handleFlutterwaveWebhook) live in
   disbursementService.js. The import was restored to the correct path (file
   reverted to its last coherent revision, a5e98b).
2. src/services/bos/breetAdapter.js captured BREET_* env vars at module load
   time, so tests that set process.env after import saw stale values. The
   adapter now reads env at call time via seven accessor functions.
3. 	est/unit/breet-webhook.test.js asserted that Yellow Card uses a plain
   shared-secret signature. That is false — Yellow Card signs an HMAC-SHA256 over
   the body. The regression guard now asserts dispatcher routing only.

Also: classifyError in reetAdapter.js was relaxed so a plain

ew Error('fetch failed') classifies as 	ransient (message match, not
error.name === 'TypeError').

## What is still incomplete

**Five docs were to be updated for Breet. Only one is done.**

- DONE: docs/PROVIDER_ADAPTERS.md (commit 3a0a9c0).
- REMAINING:
  - docs/ARCHITECTURE.md — add a Breet entry to the adapter boundary summary.
  - README.md — add a Breet mention to the provider-adapters bullet or roadmap.
  - docs/COMMERCIAL_MODEL.md — add a Breet row to the Key Partners table.
  - docs/CLAIMS_REGISTER.md — add a Breet claim row.

These four were NOT updated by the prior agent. Verify each against the actual
file before editing.

**The Breet webhook verifier is DEFERRED.** The prior attempt broke the existing
Flutterwave and Yellow Card webhook routes and was reverted. Breet has no verifier
branch and no route today. A future focused sprint must add it as isolated,
additive-only code — do not modify existing functions or routes in webhooks.js
or webhookVerifier.js.

## Process notes learned this session

- **Prior-agent failure mode characterized.** Commit 3903653 contained
  out-of-scope breakage and claimed completion with failing tests. A later agent
  session inherited a dirty working tree and did not notice. Compounding of
  dirty state, not ongoing disobedience.
- **Verify against actual files, always.** Run git status --short before and
  after any agent task. Save the before output so changes can be attributed.
- **Prettier was the hidden churn source.** editor.formatOnSave with Prettier
  converted single quotes to double and rewrapped long lines on every save,
  turning a ~25-line edit into a 194-line diff. Fixed by:
  - .prettierignore containing *.js (committed, e35b312).
  - .vscode/settings.json with editor.formatOnSave: false (workspace-local).
  - .gitattributes with * text=auto eol=lf (committed, e35b312).
- **The audit prompt works.** When unsure what an agent changed, ask it to
  enumerate files via git status --short, then verify with
  git --no-pager diff. Do not accept a prose summary as evidence.

## Rules that govern this project (carry them forward)

- A sprint is complete when and only when 
pm test shows zero failures.
- Never weaken, delete, or skip a test to make it pass.
- No external network calls in the default test suite.
- No new runtime npm dependencies.
- One commit per logical fix.
- Do not modify CineX (a separate protected source product).
- Fail closed. Never fabricate.
- Verify claims against actual files. Do not trust agent self-reports.

## What the next session needs to do

### Task 1 — Fix the remaining four docs

For each of docs/ARCHITECTURE.md, README.md, docs/COMMERCIAL_MODEL.md,
docs/CLAIMS_REGISTER.md:

1. Paste the full content of the file.
2. Get the exact Breet edit — the actual text to add and where.
3. Apply, verify against git diff, commit one file per commit.

Do not batch. One doc per agent prompt, fresh session, .prettierignore in place.

### Task 2 — Plan the next sprint

Candidate directions, to decide together after the docs are clean:
- Complete the Breet webhook verifier as a focused sprint with a strict
  constraint: do not modify any existing function or route in webhooks.js or
  webhookVerifier.js. Add only new, isolated code.
- Sprint 8a/8b/8c for the Stacks Endowment grant evidence package.
- Sprint 9 for the commercial model.

## Historical note — do not treat as current

An earlier handoff (kept outside the repo) stated "253 tests, 252 pass, 0 fail,
1 skip" and "local HEAD is 12+ commits ahead of origin/main." Neither was true
of the committed tree at any point in the last session. The committed tree at
the start of that session was 230 tests, 221 pass, 8 fail, 1 skip, because
commit 3903653 broke two test files at import. The repaired and current state
is 259 tests, 258 pass, 0 fail, 1 skip, fully pushed.
