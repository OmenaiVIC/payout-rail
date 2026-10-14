# Payout Rail — Session Handoff

Continuing work on the Payout Rail project. This file is the authoritative
state-of-play for the next session. Verify everything against the actual
repository before trusting any line below.

## The project

Payout Rail is an open-source orchestration layer that connects Stacks applications'
on-chain settlement to local fiat payouts in emerging markets. Repository:
https://github.com/OmenaiVIC/payout-rail

## Current repository state (as of 2026-10-14)

- Local HEAD = origin/main = `b32afc1`. Everything is pushed. Working tree clean.
- Test suite: 268 tests, 267 pass, 0 fail, 1 skip (the Postgres-gated integration case).
  `npm test` is the source of truth; run it before trusting any count.
- Recent commits (newest first):
  - `b32afc1` docs(provider-adapters): correct stale Breet credential claim
  - `0861010` docs: add Sprint Breet Webhook report
  - `5856884` docs: correct stale "no Breet verifier branch" claims
  - `ec08dfc` feat: add isolated POST /api/bos/webhooks/breet route (GREEN)
  - `923721a` test: add failing Breet webhook route tests (RED)
  - `3345d30` docs: add Sprint Breet Webhook plan
  - `eeeb1f7` docs(session-handoff): correct HEAD to e74444b

## Sprint Breet Webhook: COMPLETE

The Breet webhook verifier sprint is done. Six commits (`3345d30` → `b32afc1`),
+9 tests (259 → 268). Deliverables:

- **Route added:** `POST /api/bos/webhooks/breet` in `src/routes/webhooks.js`,
  isolated, additive-only. Existing `webhookVerifier.js` and
  `disbursementService.js` are byte-for-byte unchanged.
- **Verifier:** the Breet branch already existed in `webhookVerifier.js`
  (`getBreetSecret()`, `verifyBreetWebhook`, `case 'breet'` dispatch). The
  prior repair `9f7bd7d` reverted only the route; the verifier survived intact.
- **Response body:** `{ processed: true, advanced: false, reason: 'breet webhook
  verified; payload resolution and state advance deferred to P-1' }`.
- **Failure envelope:** mirrors Flutterwave — `{ processed: false, reason }` on 401.
- **Cross-talk guard:** verif-hash must NOT authenticate `/breet`; x-webhook-secret
  must NOT authenticate `/flutterwave` or `/yellowcard`.

**Sandbox validation: NOT PERFORMED.** Breet's mock-trade trigger is unreachable
for this account tier (returns "wallet not found" despite an active, verified
wallet; Breet's own docs contradict each other on the required `X-Breet-Env` value
for that endpoint). The payload shape is therefore UNVERIFIED against a real
delivery. Tracked as backlog **P-8**.

## Task 1 — five Breet docs: COMPLETE

All five docs now document the Breet adapter:

- `docs/PROVIDER_ADAPTERS.md` — Breet §2 subsection, §3 row, §3 UNVERIFIED matrix entry
- `docs/ARCHITECTURE.md` — Breet row in the §5 boundary table, new §5.2 subsection
- `README.md` — Breet mention in §4 provider-adapters bullet, §5 roadmap, refreshed test counts
- `docs/COMMERCIAL_MODEL.md` — Breet row in Key Partners, updated partner-role honesty blockquote
- `docs/CLAIMS_REGISTER.md` — new §5.2 Breet provider claims, summary entries

## Markdown-escape cleanup: COMPLETE

21 docs were stored with escaped markdown (`\#`, `\*\*`, `\|`, etc.) and rendered as
plain text on GitHub. They were unescaped across four commits. Deliberately untouched:

- `docs/CLAIMS_REGISTER.md` — one `\|` inside a code span is load-bearing.
- `docs/prompts/01_PROMPT_0A_EXTRACTION.md` — only `\.` and `\_` escapes; the
  unescape script does not touch those, file is unchanged and consistent.

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

**Live Breet sandbox webhook capture (P-8).** The route and verifier are tested
against a synthetic fixture; a real Breet-sandbox-originated delivery has not been
captured. Unblocking it needs either (a) Breet support clarifying the mock-trade
`X-Breet-Env` requirement, or (b) a real sandbox deposit. Small follow-up.

**Provider routing (P-1) is not implemented.** `PAYOUT_PROVIDER` selects the
adapter at the config layer only; the payout leg remains hard-wired to
`ctx.adapters.yellowcard`. This blocks the Breet route from advancing the state
machine (its `advanced: false` response is by design, not a bug).

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
- **RED commits stay local; push RED+GREEN together.** The workflow's
  per-commit gate protects `origin/main` from ever carrying a failing suite.
  TDD requires the RED commit in local history; it does not require pushing it.
  This was resolved during Sprint Breet Webhook and worked correctly.
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
- No secret value in any test, fixture, log, or commit. `.env` is gitignored;
  reference credentials via `process.env.<NAME>` by name only.

## What the next session needs to do

### Task 2 — plan the next sprint

Candidate directions, to decide together:

- **Sprint 8a/8b/8c** — Stacks Endowment grant evidence package.
- **Sprint 9** — commercial model.

Recommended skill sets from `docs/SKILLS.md`:

- **Sprint 8:** `grant-writing`, `mdcp`, `strategy-doc`, `design-doc`
- **Sprint 9:** `strategy-doc`, `grant-writing`, `mdcp`

Update this file when a direction is chosen.

## Outstanding housekeeping

- **Rotate Breet sandbox credentials.** The App Secret, Webhook Secret, and a
  webhook.site URL appeared in a chat transcript. Regenerate them from the Breet
  dashboard and update `.env` before the next Breet-related work.
- **Email Breet support** about the mock-trade doc contradiction (`sandbox` vs
  `development` for `X-Breet-Env`) and the "wallet not found" behavior on an
  active wallet. Unblocks P-8.

## Historical note — do not treat as current

An earlier handoff (kept outside the repo) stated "253 tests, 252 pass, 0 fail,
1 skip" and "local HEAD is 12+ commits ahead of origin/main." Neither was true
of the committed tree at any point. The committed tree at the start of that
session was 230 tests, 221 pass, 8 fail, 1 skip, because commit `3903653` broke
two test files at import. The repaired and current state is 268 tests, 267 pass,
0 fail, 1 skip, fully pushed.