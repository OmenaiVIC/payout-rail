# Sprint Breet Webhook — REPORT

Plan: `docs/SPRINT_BREET_WEBHOOK_PLAN.md` (revision 3, approved — four corrections
applied, plus the revised Step 0). Workflow: `docs/SPRINT_WORKFLOW.md` Phase 4-5.

## 1. What shipped

An isolated `POST /api/bos/webhooks/breet` route that verifies the Breet
`x-webhook-secret` header against `BREET_WEBHOOK_SECRET` (a **static shared secret**
plain-string comparison — not an HMAC), then returns the honest verified body
inline. The route does **not** parse fields, resolve a target, advance the state
machine, or write evidence: payload resolution and the state advance are deferred to
P-1.

- Success body (exact): `{ processed: true, advanced: false, reason: 'breet webhook
  verified; payload resolution and state advance deferred to P-1' }`
- Failure body (exact, mirrors the Flutterwave route): `{ processed: false, reason }`
  → 401. Fails closed when `BREET_WEBHOOK_SECRET` is unset.

## 2. Commit list (with hashes)

New commits on `main` on top of the pre-sprint HEAD `eeeb1f7`:

| # | Hash | Message | Files |
|---|---|---|---|
| 0 | `3345d30` | `docs: add Sprint Breet Webhook plan` | `docs/SPRINT_BREET_WEBHOOK_PLAN.md` |
| 1 | `923721a` | `test: add failing Breet webhook route tests (RED)` | `test/unit/breet-webhook-route.test.js` |
| 2 | `ec08dfc` | `feat: add isolated POST /api/bos/webhooks/breet route (GREEN)` | `src/routes/webhooks.js` |
| 3 | `5856884` | `docs: correct stale "no Breet verifier branch" claims` | `docs/SESSION_HANDOFF.md`, `docs/PROVIDER_ADAPTERS.md` |
| 4 | *this commit* | `docs: add Sprint Breet Webhook report` | `docs/SPRINT_BREET_WEBHOOK_REPORT.md`, `docs/POSTPONED_BACKLOG.md` |

Commit 1 is a distinct RED commit in history (it was authored, confirmed failing,
then held locally and pushed together with commit 2, so `origin/main` never carried
a failing suite). No commits were squashed.

## 3. Gate results

- **Commit 0:** `npm test` → 259 tests, 258 pass, 0 fail, 1 skip (baseline
  unchanged). `git show --stat` → only the plan file. Pushed (`eeeb1f7..3345d30`).
- **Commit 1 (RED):** `npm test` → **268 tests, 258 pass, 9 fail, 1 skip**. The 9
  failures were exactly the new file (1 parent + 8 subtests) failing with `404 !==
  401/200` — the route did not yet exist. Committed; **not pushed**.
- **Commit 2 (GREEN):** `npm test` → **268 tests, 267 pass, 0 fail, 1 skip**.
  `git show --stat HEAD~1 HEAD` → commits 1 and 2 together touched only
  `test/unit/breet-webhook-route.test.js` and `src/routes/webhooks.js`. Pushed
  together (`3345d30..ec08dfc`).
- **Commit 3:** `npm test` → 268 tests, 267 pass, 0 fail, 1 skip. `git show --stat`
  → only the two named docs. Pushed (`ec08dfc..5856884`).
- **Commit 4:** `npm test` → 268 tests, 267 pass, 0 fail, 1 skip (docs-only; suite
  unchanged).

## 4. Full test suite output (final, commit 4)

```
ℹ tests 268
ℹ suites 15
ℹ pass 267
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ duration_ms 12177.0724
```

Baseline before this sprint was 259 tests, 258 pass, 0 fail, 1 skip. The +9 tests
are the new file (1 parent + 8 subtests); the +9 passing tests are the same. The
single skip is the unchanged Postgres-gated `G-02 (integration)` case
(`TEST_DATABASE_URL` unset).

## 5. Confirmations

- **No existing test was edited, weakened, or deleted.** The only test file added is
  `test/unit/breet-webhook-route.test.js` (new). `test/unit/breet-webhook.test.js`,
  `test/unit/webhook-verify.test.js`, and `test/unit/flutterwave-webhook.test.js`
  were not modified.
- **No CineX file was touched.** This repo (`payout-rail`) contains no CineX source;
  the diff is limited to the five files in §2.
- **No new runtime npm dependency was added.** `package.json` is unchanged.
- **No hard-constraint violation.** `src/services/bos/webhookVerifier.js` is
  byte-for-byte unchanged; `src/services/bos/disbursementService.js` is untouched
  (no `handleBreetWebhook`); no existing function or route in
  `src/routes/webhooks.js` was modified — the change is additive (one new import,
  one new `verifyBreetRequest` helper, one new `/breet` route). No `.env`
  read/write; `process.env.BREET_*` is referenced by name only; no secret value
  appears in any test, fixture, log, or commit.
- **Cross-talk regression guard present and passing:** `verif-hash` does not
  authenticate `/breet`, and `x-webhook-secret` does not authenticate `/flutterwave`
  or `/yellowcard`; the Yellow Card HMAC path still advances to
  `YELLOWCARD_PAYOUT_CONFIRMED` and the Flutterwave path still acknowledges.

## 6. Sandbox validation (Phase 5 requirement)

**Sandbox validation was NOT performed.** No live Breet delivery was captured.

- **Why:** Breet's sandbox mock-trade trigger is unreachable with the provided
  credentials. Attempts hit only errors — `sandbox` + `asset="TRX_TEST"` → 404
  "wallet not found" (the wallet exists per `GET /trades/wallets`, `isActive=true`);
  `sandbox` + `asset=<asset id>` → 500-class; `development` + `asset="TRX_TEST"` →
  500-class; `development` elsewhere → 401 "wrong app id and secret combination".
  Breet's own docs contradict each other on the required `X-Breet-Env` value. This
  is a Breet-side blocker, not ours.
- **Script:** none. Per the revised Step 0, **no** sandbox replay script was written
  (`scripts/breet-webhook-sandbox-check.mjs` was **not** created).
- **Exit code:** n/a.
- **Substitute:** the hermetic loopback test in
  `test/unit/breet-webhook-route.test.js` (no network calls), run against a
  **synthetic** fixture.

## 7. UNVERIFIED (reproduced)

1. **Breet webhook payload shape(s)** for the documented events — conceptually
   described, never captured from a live event (`breet-api-reference.md:86`). Still
   UNVERIFIED: the §8 capture was attempted but deferred. Test 4 uses a synthetic
   fixture matching the documented shape; upgrading it is backlog **P-8**.
2. **Whether Breet actually emits `x-webhook-secret` on real deliveries**, and its
   scope (per-merchant vs per-event). Not confirmed — no live delivery captured.
3. **Live Breet sandbox end-to-end** (deposit → webhook → withdrawal) — attempted
   and could not be performed (mock-trade trigger unreachable; docs inconsistent).
   Tracked as backlog **P-8**.
4. **`SESSION_HANDOFF.md` was internally stale** (named a HEAD one commit behind
   itself and asserted "no verifier branch"). Corrected by commit 3.

## 8. Deviations from the plan, with reason

1. **Plan committed first as commit 0 (five commits, not four).** The plan file was
   an uncommitted artifact that chronologically precedes the RED tests; committing
   it first gives honest history. Authorized by the reviewer's amendment.
2. **RED commit held locally, pushed together with GREEN.** The per-commit gate
   ("`npm test` → 0 failures") and TDD RED conflict; the reviewer ruled that
   `origin/main` must never carry a failing suite. Commits 1 and 2 were created
   locally and pushed together. No squash.
3. **Live sandbox capture deferred (revised Step 0).** Breet-side blocker; tests use
   a synthetic UNVERIFIED fixture; no replay script written.
4. **Adjacent stale line left in place (flagged, not changed).**
   `docs/PROVIDER_ADAPTERS.md:147-148` still reads "sandbox/live UNVERIFIED. No
   credentials in this environment." The second sentence is stale — Breet sandbox
   credentials *do* exist in this environment; the blocker is the mock-trade trigger,
   not credential absence. It was outside the plan-named correction range
   (`:159-165`, `:194`), so it was not edited. **Recommended follow-up:** correct
   `:147-148` in a subsequent docs commit.

## 9. Status

`npm test` → 268 tests, 267 pass, **0 fail**, 1 skip. Sprint complete pending the
reviewer's Phase 6 verification.
