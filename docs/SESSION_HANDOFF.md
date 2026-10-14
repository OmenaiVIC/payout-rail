# Payout Rail — Session Handoff

Continuing work on the Payout Rail project. This file is the authoritative
state-of-play for the next session. Verify everything against the actual
repository before trusting any line below.

## The project

Payout Rail is an open-source orchestration layer that connects Stacks applications'
on-chain settlement to local fiat payouts in emerging markets. Repository:
https://github.com/OmenaiVIC/payout-rail

## Current repository state (as of 2026-10-12)

- Local HEAD = origin/main = `e74444b`. Everything is pushed. Working tree clean.
- Test suite: 259 tests, 258 pass, 0 fail, 1 skip (the Postgres-gated integration case).
  `npm test` is the source of truth; run it before trusting any count.
- Recent commits (newest first):
  - `3c4eeac` docs(multi-corridor-plan): refresh stale test count and adapter count
  - `4cecd45` docs(prompts): unescape markdown so prompt library renders on GitHub
  - `b6798aa` docs: unescape markdown in grant application and strategy docs
  - `a9ddf31` docs: unescape markdown in top-level strategy and reference docs
  - `798321b` docs(commercial-model): add Breet to Key Partners and partner-role honesty
  - `1e1fff7` docs(claims-register): add Breet provider claims (§5.2) and summary entries
  - `e5646a2` docs(readme): document Breet adapter; refresh stale test counts
  - `a0fd367` docs(architecture): document Breet adapter in the boundary summary

## Task 1 — five Breet docs: COMPLETE

All five docs now document the Breet adapter:

- `docs/PROVIDER_ADAPTERS.md` — Breet §2 subsection, §3 row, §3 UNVERIFIED matrix entry
- `docs/ARCHITECTURE.md` — Breet row in the §5 boundary table, new §5.2 subsection
- `README.md` — Breet mention in §4 provider-adapters bullet, §5 roadmap, refreshed test counts
- `docs/COMMERCIAL_MODEL.md` — Breet row in Key Partners, updated partner-role honesty blockquote
- `docs/CLAIMS_REGISTER.md` — new §5.2 Breet provider claims, summary entries

## Markdown-escape cleanup: COMPLETE

21 docs were stored with escaped markdown (`\#`, `\*\*`, `\|`, etc.) and rendered as
plain text on GitHub. They were unescaped across four commits (three batches plus the
`COMMERCIAL_MODEL.md` lead-in). Deliberately untouched:

- `docs/CLAIMS_REGISTER.md` — one `\|` inside a code span is load-bearing.
- `docs/prompts/01_PROMPT_0A_EXTRACTION.md` — only `\.` and `\_` escapes; script
  doesn't touch those, file is unchanged and consistent.

## What was repaired on 2026-10-09 / 2026-10-10

Commit `3903653` ("feat: add Breet webhook verification, route, env vars, tests, and
sprint report") introduced three regressions, repaired in commit `9f7bd7d`:

1. `src/routes/webhooks.js` imported a nonexistent
   `../services/bos/webhookHandlers.js`. The handlers
   (`handleYellowCardWebhook`, `handleFlutterwaveWebhook`) live in
   `disbursementService.js`. The import was restored to the correct path (file
   reverted to its last coherent revision, `ba5e98b`).
2. `src/services/bos/breetAdapter.js` captured `BREET_*` env vars at module load
   time, so tests that set `process.env` after import saw stale values. The
   adapter now reads env at call time via seven accessor functions.
3. `test/unit/breet-webhook.test.js` asserted that Yellow Card uses a plain
   shared-secret signature. That is false — Yellow Card signs an HMAC-SHA256 over
   the body. The regression guard now asserts dispatcher routing only.

Also: `classifyError` in `breetAdapter.js` was relaxed so a plain
`new Error('fetch failed')` classifies as `transient` (message match, not
`error.name === 'TypeError'`).

## What is still incomplete

**Breet webhook verifier — stale claim corrected (Sprint Breet Webhook).** A
previous revision of this handoff stated Breet "has no verifier branch and no
route." That was half false. The Breet **verifier branch already exists and is
tested**: `getBreetSecret()` (`webhookVerifier.js:10`), `verifyBreetWebhook`
(`:110-129`), the `case 'breet'` dispatch (`:142-143`), and the export (`:154`),
covered by `test/unit/breet-webhook.test.js`. The prior attempt (`3903653`) broke
the existing Flutterwave and Yellow Card routes; the revert (`9f7bd7d`) removed the
Breet **route** but left the verifier branch intact. Only the route was missing,
and it is now added as isolated, additive-only code in `src/routes/webhooks.js` —
no existing function or route in `webhooks.js` or `webhookVerifier.js` was
modified. (Live sandbox webhook capture remains UNVERIFIED — see backlog P-8.)

**Provider routing (P-1) is not implemented.** `PAYOUT_PROVIDER` selects the
adapter at the config layer only; the payout leg remains hard-wired to
`ctx.adapters.yellowcard`.

## Process notes learned this session

- **Prior-agent failure mode characterized.** Commit `3903653` contained
  out-of-scope breakage and claimed completion with failing tests. A later agent
  session inherited a dirty working tree and did not notice. Compounding of
  dirty state, not ongoing disobedience.
- **Verify against actual files, always.** Run `git status --short` before and
  after any agent task. Save the before output so changes can be attributed.
- **Prettier was the hidden churn source.** `editor.formatOnSave` with Prettier
  converted single quotes to double and rewrapped long lines on every save,
  turning a ~25-line edit into a 194-line diff. Fixed by:
  - `.prettierignore` containing `*.js` (committed, `e35b312`).
  - `.vscode/settings.json` with `editor.formatOnSave: false` (workspace-local).
  - `.gitattributes` with `* text=auto eol=lf` (committed, `e35b312`).
- **The audit prompt works.** When unsure what an agent changed, ask it to
  enumerate files via `git status --short`, then verify with
  `git --no-pager diff`. Do not accept a prose summary as evidence.
- **Markdown-unescape method.** A PowerShell function (`Unescape-Md`) walks each
  file line-by-line, skips fenced code blocks and inline code spans, and unescapes
  only `\#`, `\*\*`, line-start `\.`, line-start `\- `, and standalone `\---`.
  It leaves `\|`, `\_`, `\[`, `\]`, and single `\*` alone. Verify with a
  symmetric insertion/deletion count and a "backtick balance" scanner before
  committing.

## Rules that govern this project (carry them forward)

- A sprint is complete when and only when `npm test` shows zero failures.
- Never weaken, delete, or skip a test to make it pass.
- No external network calls in the default test suite.
- No new runtime npm dependencies.
- One commit per logical fix.
- Do not modify CineX (a separate protected source product).
- Fail closed. Never fabricate.
- Verify claims against actual files. Do not trust agent self-reports.

## What the next session needs to do

### Task 2 — plan the next sprint

Candidate directions, to decide together:

- **Breet webhook verifier** as a focused sprint with a strict constraint: do not
  modify any existing function or route in `webhooks.js` or `webhookVerifier.js`.
  Add only new, isolated code. Must include a test that verifies the Yellow Card
  and Flutterwave routes still work (a regression guard).
- **Sprint 8a/8b/8c** for the Stacks Endowment grant evidence package.
- **Sprint 9** for the commercial model.

Update this file when a direction is chosen.

## Historical note — do not treat as current

An earlier handoff (kept outside the repo) stated "253 tests, 252 pass, 0 fail,
1 skip" and "local HEAD is 12+ commits ahead of origin/main." Neither was true
of the committed tree at any point in the last session. The committed tree at
the start of that session was 230 tests, 221 pass, 8 fail, 1 skip, because
commit `3903653` broke two test files at import. The repaired and current state
is 259 tests, 258 pass, 0 fail, 1 skip, fully pushed.