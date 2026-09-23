# Payout Rail — Sprint 7 Report

> Generated: 2026-09-23 · Sprint 7 · Scope: documentation-only opensource-readiness release.
> Status: **COMPLETE** — all seven commits landed; verification gates passed unchanged.

---

## 1. What this sprint did

Reframed Payout Rail's documentation from "BOS subsystem extracted from CineX" to a
product-facing landing page, added five reference docs (architecture, integration,
provider adapters, security, development), made the maturity claim truthful, reconciled
repositories with the code, and removed contradictory documentation — with **zero code
changes**.

## 2. Docs delivered

| Doc | Type | Purpose |
|---|---|---|
| `docs/ARCHITECTURE.md` | new | System context, 15-state / 48-transition machine, evidence chain, reconciliation, worker model |
| `docs/INTEGRATION.md` | new | v1 API, error contract, webhooks, idempotency, actors, auth |
| `docs/PROVIDER_ADAPTERS.md` | new | Adapter boundary, per-adapter veracity, adding an adapter, corridor configuration |
| `docs/SECURITY.md` | new | Custody model, auth, fail-closed behavior, evidence as security property, known limitations |
| `docs/DEVELOPMENT.md` | new | Prerequisites, test/demo commands, repo layout, contributing scope, sprint discipline |
| `README.md` | rewritten | Product positioning, maturity, claims/evidence table, quick start, env reference, doc index |
| `docs/CLAIMS_REGISTER.md` | reconciled | F1/F2 counts → 15 / 48; header + DEAD-summary re-audited vs import graph |
| `docs/POSTPONED_BACKLOG.md` | updated | C-04 marked fulfilled (evidence F4); C-01 annotated (still open as G-05) |
| `docs/PRODUCT_BASELINE.md` | archived in place | ARCHIVED banner + "superseded by" pointer (pre-Sprint-3 snapshot) |
| `docs/EXTRACTION_REPORT.md` | archived in place | ARCHIVED banner; provenance-only |
| `.env.example` | corrected | line 27 `BOS_PIPELINE_BATCH_SIZE` `50` → `25` (comment-only) |

## 3. Commit log

| Commit | Message | Contents |
|---|---|---|
| `0dd5447` | docs: sprint 7 plan (reframe, maturity, docs) | `docs/SPRINT_7_PLAN.md` |
| `2af0f51` | docs: add core technical story - architecture and integration reference | `ARCHITECTURE.md`, `INTEGRATION.md` |
| `a30201b` | docs: add provider adapter and security reference | `PROVIDER_ADAPTERS.md`, `SECURITY.md` |
| `f37386c` | docs: add developer guide | `DEVELOPMENT.md` |
| `2096a64` | docs: rewrite readme as product-facing landing page | `README.md`, `.env.example` |
| `5cb91cf` | docs: reconcile registers, mark backlog items and archive historical docs | `CLAIMS_REGISTER.md`, `POSTPONED_BACKLOG.md`, `PRODUCT_BASELINE.md`, `EXTRACTION_REPORT.md` |
| — | (this report) | `SPRINT_7_REPORT.md` |

## 4. Fact table re-verification (F1–F9, at sprint end)

| # | Fact | Status | Evidence re-checked |
|---|---|---|---|
| F1 | 15 disbursement states (14-state lifecycle + `preflight_check` entry gate) | VERIFIED | `src/services/bos/types.js:22-38`; headers `types.js:3`, `stateMachine.js:2` say "15 states" |
| F2 | 48 registered transitions (24 explicit + 24 generic; `manual_review→manual_review` self-loop included) | VERIFIED | `stateMachine.js:40-209`; runtime `getAllTransitions().length === 48` (re-run this session) |
| F3 | `BOS_PIPELINE_BATCH_SIZE` default = 25 | VERIFIED | `pipelineWorker.js:19`; README §9 + `.env.example:27` now both say `25` |
| F4 | Deterministic idempotency implemented (`disbursement:<sha256(source_reference\|source_application\|amount_usdcx\|recipient_bank_account)>`) | VERIFIED | `disbursementService.js:53-63`; `UNIQUE(idempotency_key)` in `migrations/006_*`; C-04 marked fulfilled |
| F5 | `preflight_check` is a real enum state; linear lifecycle has 14 progression states | VERIFIED | `types.js:9-14` (canonical flow), `types.js:22-38` (enum) |
| F6 | Yellow Card auth = `YcHmacV1 {apiKey}:{signature}` + `X-YC-Timestamp`, signature base64; webhook HMAC hex/base64/base64url | VERIFIED | `docs/yellowcard-api-reference.md`; `test/unit/yellowcard-*.test.js` (28 wire-contract tests, all pass) |
| F7 | Live/sandbox provider verification = UNVERIFIED (no credentials; G-20 blocks permanently) | VERIFIED | `scripts/demo-payout-ngn.js` sandbox matrix exits 2 on missing creds; `GAP_REGISTER.md` G-20 |
| F8 | Release destination is observed, never fabricated (G-08 model) | VERIFIED | `types.js:40-45`; Sprint 2 amendment in `PRODUCT_BASELINE.md` kept as history |
| F9 | `npm test` = 184/183/0/1 | VERIFIED (unchanged) | re-run this session |

## 5. Verification gates (plan §8 step 7)

- `npm test` → **184 tests, 183 pass, 0 fail, 1 skip** (Postgres-gated), unchanged.
- `git diff --stat` over `src/ | migrations/ | scripts/ | test/` → **zero changes**.
- README link check → all 11 doc links resolve (`docs/*.md` + root `ATTRIBUTION.md`).
- Maturity statement → **byte-identical** between `README.md` §4 and `docs/SECURITY.md` §6
  (verified by comparison, not eyeball).

## 6. Blockers / deviations

- **None blocking.** Planned deviations (plan §7) all followed as written:
  canonical counts 15/48 (F1/F2); `CLAIMS_REGISTER.md` refresh in scope without touching
  per-row evidence format; `.env.example` corrected as comment-only doc artifact; archive via
  banner rather than `docs/archive/` move (preserves `ATTRIBUTION.md` and
  `migrations/001_bos_schema.sql` links); single maturity label "Prototype — sandbox-ready
  interfaces"; sprint reports stay put and README no longer cites them as current.
- **Deliberately not done:** no mdcp shard config, no mainnet enablement, no claim upgrades —
  G-01/G-02 remain open P0s, documented in `GAP_REGISTER.md`, `SECURITY.md`, `DEVELOPMENT.md`
  as known limitations and in-scope contribution targets.

## 7. Stop point

Sprint 7 complete. Per the sprint prompt's working method, work stops here;
Sprint 7.5 (external integrator example) would follow only on explicit instruction.

---

Provenance: sprint plan reviewed and committed `0dd5447`; changes limited to `docs/`, `README.md`,
and a comment-only `.env.example` correction. No code, no runtime dependencies, no network calls.