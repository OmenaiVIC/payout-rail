# Sprint 0.5 — Minimum Viable Path · Report

> Source task: `docs/prompts/03a_SPRINT_0_5_MVP_PATH.md` · Plan: `docs/SPRINT_0_5_PLAN.md`
> Implemented and verified on 2026-09-21 against the working tree at `a7769b2`.

---

## 1. Summary

All six gaps (G-01..G-06) are fixed, each with tests. One command (`npm test`) runs
the default suite against an in-memory `FakeDb` + mock adapters — zero Postgres, zero
credentials. A new mock E2E walks a single payout from create to `SETTLED`, and the
negative path proves a failed preflight stops at `MANUAL_REVIEW` before any burn.
CineX is untouched. No runtime npm dependencies were added.

**Result (final full suite run):**

```
ℹ tests 55   ℹ pass 54   ℹ fail 0   ℹ skipped 1
```

The single skip is the opt-in Postgres integration test (G-02 `NOT NULL` regression),
which runs only when `TEST_DATABASE_URL` is set. Its `FakeDb` complement — asserting
the INSERT carries the recipient bank columns — is in the default suite.

---

## 2. Accepted deviations from the baseline (plan §7 + implementation)

| # | Deviation | Class | Status |
|---|-----------|-------|--------|
| D1 | Preflight fail-open → fail-closed; `advanceDisbursement` routes guard failure to `manual_review` instead of blindly taking `nextStates[0]` | A | done — sign-off requested; the plan flagged this as needing confirmation |
| D2 | `external_tx_id` + sibling ids (`attestation_id`, `release_id`, `payout_id`) now persist on `disbursements` | A | done |
| D3 | New `disbursements.preflight_result` column (migration 005) + `preflightPassed` guard | A | done |
| D4 | `webhookVerifier.js` converted to ESM, made the single canonical verifier; fail-open removed | B | done |
| D5 | Direct `disbursement_initiated → burn_submitted` bypass edge removed | B | done |
| D6 | Mock adapters for Stacks and Yellow Card supplied by the test, not by production `bridgeAdapterFactory` | A | done |
| D7 | `approve` / manual-review-resolve endpoints deliberately omitted (actor model undecided) | blocker | reported only, not built |
| D8 | G-05 test file named to the plan's `tx-id-persistence.test.js` (WIP draft renamed) | cosmetic | resolved, no deviation remains |
| D9 | G-04 tests must seed the `USDCx/NGN` rate in the G-02/G-03 fixtures (a rate is a hard create-time requirement after G-04) | — | done |
| D10 | G-06 requires the idempotent guard + evidence recording inside `handleYellowCardWebhook` (`disbursementService.js`), a file not listed in the plan | — | done — the plan named only the route/verifier files |
| D11 | Commit 5 also landed the pre-existing, unmodified `package-lock.json` | — | done — pinning the renegotiated `npm` lockfile; no dependency added |

No CineX files were modified. No state was added or removed; the only transition
removed is the G-01 bypass edge (D5).

---

## 3. Commit sequence (§9), with hashes

| # | Message | Commit |
|---|---------|--------|
| 1 | `test: add node:test harness, FakeDb, mock adapters` | `a7769b2bca4a0c15b39d0a2354a0212aa0e1dd2d` |
| 2 | `fix(g-02): persist recipient bank columns on create` | `fad6c0ea9cb0b6a4db9b22cb78db44634b04b7fc` |
| 3 | `fix(g-03): add disbursement create/get/advance API with fail-closed auth` | `a12e4bc8622fa79c2baf94dc072f65c7155973d9` |
| 4 | `fix(g-01): fail-closed preflight with persisted result and guard` | `89623864c6e273843f4ff04c6fc70bd84125c24c` |
| 5 | `fix(g-05): persist external tx id (and sibling ids) on disbursements` | `9128f1fc4bb95bbbeb785aae9082f447e1c6bc3b` |
| 6 | `fix(g-04): populate amount_ngn_expected and exchange_rate at create` | `61c0824cf99c42b674f3702bb19cfcb885db1c3f` |
| 7 | `fix(g-06): verify webhook signatures over raw body, fail closed` | `5432a2f2135f326eac39105b06a80016f5aeafff` |
| 8 | `test(e2e): full mock lifecycle` | `2d3fdc116ec68b70d276b29b05303ede81a5f7c6` |
| 9 | `docs: README API section + SPRINT_0_5_REPORT.md` | this commit |

Each commit's suite was green before the next was started (one commit per fix, per §9).

---

## 4. Fix-by-fix summary

### G-02 — create was a NOT NULL violation (P0)
`initiateDisbursement` omitting `recipient_bank_account`/`recipient_bank_code` from the
only INSERT. Now validates presence first (fail-closed, `400
missing_recipient_bank_details`) and includes the columns. Tests: `disbursement-create.test.js`
(reject + INSERT columns) and the Postgres-gated `disbursement-create.pg.test.js`.

### G-03 — no HTTP caller (P0)
New `src/routes/disbursements.js` (create/get/advance/list/retry/recover) with
constant-time bearer-token auth from `BOS_API_TOKEN`, rejecting by default and honoring
`BOS_ALLOW_UNAUTHENTICATED_DEV=true` only as a dev escape hatch. Tests:
`disbursements-routes.test.js` (unauth → 401 in all three states; authenticated create →
read → advance).

### G-01 — gates were cosmetic; burn proceeded past a failed gate (P0)
`runPreflightCheck` now returns `preflight_result`; `executeTransition` persists it
(whitelist, migration 005); new `preflightPassed` guard blocks the burn; guard failure
escalates to `manual_review`; the direct `initiated → burn_submitted` bypass is removed.
Tests: `preflight-guard.test.js` (fail→manual_review, never burn; pass→burn reachable;
verdict persists; bypass gone; no escalation loop).

### G-05 — burn confirmation dead-end (P1)
`executeTransition`'s persistence whitelist now writes `external_tx_id`, `attestation_id`,
`release_id`, `payout_id`, so `isBurnConfirmed` and reconciliation read the columns the
guards already expect. Tests: `tx-id-persistence.test.js` (id lands on the row;
`burn_submitted → burn_confirmed` passes; sibling ids persist per leg).

### G-04 — `amount_ngn_expected`/`exchange_rate` never populated (P1)
Create-time rate resolution (fail-closed on missing/≤0 rate), `amount_ngn_expected` in
kobo via `computeAmountNgnExpected` (`round(amount_usdcx / 1e6 × rate × 100)`), both
columns in the INSERT. Tests: `ngn-amount.test.js` (fields + arithmetic; reject on
missing/zero rate; `submitYellowCardPayout` no longer throws).

### G-06 — webhook verification not wired (P1)
Raw-body capture via `express.json({ verify })`; `webhooks.js` verifies the HMAC over
`req.rawBody` first and rejects unsigned/invalid payloads with `401` before touching
state; `webhookVerifier.js` is ESM and fails **closed** when no secret is configured;
`yellowcardAdapter.verifyWebhookSignature` delegates to the canonical verifier; duplicate
deliveries are idempotent (acknowledged, no double-advance); each verified payload is
recorded into the evidence chain by `handleYellowCardWebhook`; `/yellowcard/test` sits
behind the admin token. Tests: `webhook-verify.test.js` (unsigned/wrong/no-secret →
401 + no state; correct → handled once; sha256= prefix; /test auth).

---

## 5. E2E result (acceptance #6)

`test/e2e/mock-lifecycle.e2e.test.js` — mock stacks/xreserve/yellowcard adapters over
FakeDb, no network:

```
✔ E2E: full mock lifecycle drives one payout to SETTLED
✔ E2E: failed preflight stops at MANUAL_REVIEW and never burns
```

Positive path walks `preflight_check → burn_submitted → burn_confirmed →
attestation_requested → attestation_confirmed → destination_release_submitted →
destination_release_confirmed → yellowcard_payout_submitted → yellowcard_payout_confirmed
→ settled`, asserting status and the four persisted id columns at each hop, plus
create-time `amount_ngn_expected`/`exchange_rate`. Negative path seeds a failing
per-disbursement cap: the row is parked in `manual_review` and `burnUsdcx` is never
called.

**Fidelity gap, stated not hidden (GAP-08):** the mock xreserve returns "release
confirmed" without external assurance. The E2E proves orchestration completes in mock
mode, not that a real release is true. That is the correct boundary for a mock-only
sprint and is not dressed up as more.

---

## 6. Full-suite evidence (final run)

```
> payout-rail@0.1.0 test
> node --test --test-concurrency=1 "test/**/*.test.js"

✔ E2E: full mock lifecycle drives one payout to SETTLED
✔ E2E: failed preflight stops at MANUAL_REVIEW and never burns
↳ G-02 (integration): a real disbursement row inserts with both bank columns satisfied  # TEST_DATABASE_URL not set — skipping
✔ G-02: create rejects when recipient bank details are missing (fail-closed, no INSERT)
✔ G-02: create rejects a blank bank field
✔ G-02: create persists recipient_bank_account and recipient_bank_code in the INSERT
▶ disbursement routes
  ✔ rejects when BOS_API_TOKEN is set and no bearer is presented
  ✔ rejects a wrong bearer token
  ✔ rejects when no token is configured and dev escape hatch is off
  ✔ accepts with the correct bearer token: create → read → advance
  ✔ returns 404 for an unknown id
  ✔ honours the BOS_ALLOW_UNAUTHENTICATED_DEV escape hatch
▶ computeAmountNgnExpected (decimals convention)
  ✔ converts USDCx base units (6-dp) to NGN kobo at the given rate
  ✔ rounds fractional kobo to the nearest integer
▶ G-04: initiateDisbursement resolves and persists the rate (fail closed)
  ✔ populates exchange_rate and amount_ngn_expected in the INSERT when a rate exists
  ✔ rejects creation when no rate is on file (fail closed, no INSERT)
  ✔ rejects creation when the rate is zero or negative
▶ G-04: submitYellowCardPayout no longer throws "amount_ngn_expected missing or zero"
  ✔ submits the payout when amount_ngn_expected is populated at create time
  ✔ still throws (fail closed) when amount_ngn_expected is missing entirely
▶ preflight guards + fail-closed escalation
  ✔ preflightRequested rejects a missing disbursement / passes when disc. exists
  ✔ preflightPassed MANUAL_REVIEW_REQUIRED when no verdict / rejects failing / passes passing
  ✔ preflightPassed tolerates JSON-stringified and legacy plain-string verdicts
  ✔ executeTransition persists preflight_result as JSON on the disbursement row
  ✔ bypass edge disbursement_initiated→burn_submitted no longer exists
  ✔ executeTransition escalates to manual_review when the preflight verdict is failing
  ✔ executeTransition does NOT escalate when already in manual_review
▶ G-05: submitBurn persists external_tx_id on the disbursement row
  ✔ lands the burn tx id in external_tx_id via the whitelist
▶ G-05: burn_submitted → burn_confirmed regression (dead-end)
  ✔ passes when the tx id is on the row and the chain confirms
▶ G-05: attestation_id / release_id / payout_id persist for their legs
  ✔ requestAttestation persists attestation_id
  ✔ submitDestinationRelease persists release_id
  ✔ submitYellowCardPayout persists payout_id and clears the amount_ngn_expected throw
▶ G-05: whitespace-only PERSISTED_ACTION_FIELDS are untouched
  ✔ a transition that returns no identifier field does not write one
▶ G-06: webhook verification ordering
  ✔ rejects an unsigned payload with 401 and touches no state
  ✔ rejects a wrong signature with 401 and touches no state
  ✔ rejects with 401 when no secret is configured (fail closed, not fail open)
  ✔ handles a correctly signed payload and advances exactly once
  ✔ supports the sha256= header prefix
  ✔ puts /yellowcard/test behind the admin token
✔ FakeDb: records every call, answers from handlers, null fallthrough, run() shape, global-regex guard, all()/seed
✔ mock adapters: expose the exact methods the pipeline consumes; wired by createMockAdapters
✔ createTestCtx: matches ensureInit() bosCtx shape; permissive/null registries; audit events without a DB
✔ BOS module graph imports cleanly under ESM

ℹ tests 55   ℹ pass 54   ℹ fail 0   ℹ skipped 1   ℹ duration_ms ≈ 5.2s
```

---

## 7. Acceptance-criteria traceability

| AC | Coverage |
|----|----------|
| 1 create via HTTP API and persist | G-02 + G-03 tests |
| 2 preflight failure blocks burn | G-01 tests + E2E negative path |
| 3 tx id persisted before `BURN_CONFIRMED` | G-05 tests |
| 4 `amount_ngn_expected` + `exchange_rate` before payout | G-04 tests |
| 5 signature verification rejects unsigned | G-06 tests |
| 6 full mock lifecycle | `test/e2e/mock-lifecycle.e2e.test.js` |
| 7 no external credentials | default suite = FakeDb + mocks |
| 8 all six fixes tested, one command | `npm test` → 54 pass / 1 skip / 0 fail |
| 9 docs reflect API/lifecycle | README: Disbursement API, Webhooks, Tests sections |

---

## 8. New/changed surface

- **Routes** — `src/routes/disbursements.js` (new); `src/routes/webhooks.js` (verify-first,
  /test behind token).
- **Env vars** — `BOS_API_TOKEN`, `BOS_ALLOW_UNAUTHENTICATED_DEV` (new); existing
  `YELLOW_CARD_WEBHOOK_SECRET`, `DEFAULT_USDCX_NGN_RATE` now enforced.
- **Migration** — `migrations/005_sprint_0_5.sql` (`disbursements.preflight_result JSONB`).
- **Dependencies** — none added. `node:test` built-in; `package-lock.json` renegotiated on
  an npm version change (no new package, D11).
- **Decimals convention** — USDCx is 6-dp base units; `amount_ngn_expected` is NGN kobo:
  `Math.round(amount_usdcx_base_units / 1e6 × rate × 100)`.

---

## 9. Blocker delivered to review (do NOT silently resolve)

Per plan §8, the one behavior change on extraction-faithful code:

1. **Preflight fail-open → fail-closed (D1).** Implemented as recommended option (a):
   failed gate ↗ `manual_review`, burn never reached. This changes the shape of
   `advanceDisbursement`'s result on guard failure (adds `escalated_from_rejection` +
   guard `error/reason`). Needs the sign-off the plan asked for.
2. **Operator actor model.** Still undecided. Under the shared-token MVP the
   `approve`/manual-review-resolve endpoints remain unexposed (D7) and go to
   `docs/POSTPONED_BACKLOG.md` alongside G-10/G-11/G-13 (plan items 11–12).

---

## 10. Open items (Sprint 1+)

- Winner/`manual_review` resolution surface + actor authz roles (blocked on decision).
- G-11 deterministic idempotency key (currently `source_reference:amount:Date.now()`).
- G-10 manual-review resolution API; G-13 breaker failure recording.
- Wire the dormant `hasValidExchangeRate` guard (rate staleness) — optional, needs an
  oracle/TTL (G-22, P3).
- Run the Postgres integration suite (`TEST_DATABASE_URL`) in CI to lock the G-02
  `NOT NULL` constraint; then the skip disappears.