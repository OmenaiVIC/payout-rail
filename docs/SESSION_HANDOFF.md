# Payout Rail — Session Handoff

Continuing work on the Payout Rail project. This file is the authoritative
state-of-play for the next session. Verify everything against the actual
repository before trusting any line below.

## The project

Payout Rail is an open-source orchestration layer that connects Stacks applications'
on-chain settlement to local fiat payouts in emerging markets. Repository:
https://github.com/OmenaiVIC/payout-rail

## Current repository state (as of 2026-10-30)

- Local HEAD = origin/main (check `git rev-parse HEAD`). Everything is pushed. Working tree clean.
- Test suite: 283 tests, 282 pass, 0 fail, 1 skip (the Postgres-gated integration case).
  `npm test` is the source of truth; run it before trusting any count.
- **Active Sprint:** P-1 (Provider Routing). Plan is at `docs/SPRINT_P1_PLAN.md` (untracked, pending commit).
  - **C1 (Seam) and C2 (Actions) are COMPLETE and pushed.**
  - **Next up is C3 (Guards) and C4 (Reconciliation).**

## P-1 Sprint Progress & Constraints

The goal of P-1 is to resolve the payout adapter dynamically at 20 hard-coded sites, parameterizing the evidence chain and receipts so they don't assume Yellow Card.

**Decisions locked in (D-P1-1 through D-P1-6):**
- Single active provider per process (`PAYOUT_PROVIDER`), default `yellowcard`.
- Keep `yellowcard_payout_*` state names as historical labels.
- Flutterwave startup error (F-1 blocker) because it's not an NGN payout leg.
- Parameterize verification `{ok, method}` arg (remove hardcoded `hmac-sha256`).
- Breet = verified/recorded, `advanced:false`.
- Flutterwave webhooks record evidence but don't advance.

**Remaining P-1 Commits:**
- **C3:** Guard routing (`transitionGuards.js`).
- **C4:** Reconciliation routing (`reconciliationWorker.js`).
- **C5:** Webhook evidence & SQL routing.
- **C6:** Settlement Receipt parameterization (`settlementReceipt.js`).

## Critical Backburner Items (Must not be forgotten)

1. **P0 Gaps (G-01 & G-02):** We must audit `docs/GAP_REGISTER.md` to see if G-01 (fail-open preflight) and G-02 (schema/code mismatch) are still listed as Open P0s. If the code is fixed but the register is stale, this is a massive red flag for investors. This must be done *after* P-1 is fully merged.
2. **Sprint 8 (Grant Evidence Package):** We still need to compile the grant evidence package. The Q&A from the Stacks Endowment team needs to be retrieved, updated with our recent P-1 and P-8 wins, and finalized for the grant submission.

## What was repaired on 2026-10-09 / 2026-10-10

Commit `3903653` ("feat: add Breet webhook verification, route, env vars, tests, and
sprint report") introduced three regressions, repaired in commit `9f7bd7d`:

1. `src/routes/webhooks.js` imported a nonexistent `../services/bos/webhookHandlers.js`. The handlers live in `disbursementService.js`. The import was restored.
2. `src/services/bos/breetAdapter.js` captured `BREET_*` env vars at module load time; it now reads env at call time via seven accessor functions.
3. `test/unit/breet-webhook.test.js` asserted that Yellow Card uses a plain shared-secret signature (false). The regression guard now asserts dispatcher routing only.

## Process notes learned this session

- **Verify against actual files, always.** Run `git status --short` before and after any agent task. Save the before output so changes can be attributed.
- **Prettier was the hidden churn source.** Fixed by `.prettierignore` (`*.js`), `.vscode/settings.json` (`editor.formatOnSave: false`), and `.gitattributes` (`* text=auto eol=lf`).
- **RED commits stay local; push RED+GREEN together.** The workflow's per-commit gate protects `origin/main` from ever carrying a failing suite. TDD requires the RED commit in local history; it does not require pushing it.
- **Markdown-unescape method.** A PowerShell function (`Unescape-Md`) walks each file line-by-line, skips fenced code blocks and inline code spans, and unescapes only `\#`, `\*\*`, line-start `\.`, line-start `\- `, and standalone `\---`. Verify with a symmetric insertion/deletion count and a "backtick balance" scanner before committing.

## Rules that govern this project (carry them forward)

- A sprint is complete when and only when `npm test` shows zero failures.
- Never weaken, delete, or skip a test to make it pass.
- No external network calls in the default test suite.
- No new runtime npm dependencies.
- One commit per logical fix.
- Do not modify CineX (a separate protected source product).
- Fail closed. Never fabricate.
- Verify claims against actual files. Do not trust agent self-reports.
- No secret value in any test, fixture, log, or commit. `.env` is gitignored.

## Historical note

An earlier handoff stated "253 tests". The committed tree at the start of that session was actually 230 tests, 221 pass, 8 fail, 1 skip, because commit `3903653` broke two test files at import. The repaired and current state is 283 tests, 282 pass, 0 fail, 1 skip, fully pushed.