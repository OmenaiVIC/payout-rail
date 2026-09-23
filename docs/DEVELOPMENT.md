# DEVELOPMENT.md — Developer Guide

> Generated: 2026-09-23 · Sprint 7 · Cross-references: `docs/ARCHITECTURE.md` (design), `docs/INTEGRATION.md` (API), `docs/GAP_REGISTER.md` (open gaps), `docs/PRODUCT_CHANGE_CONTROL.md` (classification)

---

## 1. Prerequisites

- **Node 18+** (the test suite and demo run on the current LTS line).
- **npm** (any current version).
- **No Postgres required** for the default test suite. The `FakeDb` layer
  validates orchestration, guards and SQL shape; database-produced behavior
  (real `NOT NULL` / `UNIQUE` execution) is covered by an **opt-in** integration
  suite that runs only when `TEST_DATABASE_URL` is set and otherwise skips.
- No provider credentials, no external network, and no API keys are needed to
  build, test, or run the demo.

## 2. Run the tests

```bash
npm ci
npm test
```

- **Expect `184 / 183 / 0 / 1`** — 184 total, 183 passing, 0 failing, 1 skipped.
- The single skip is the opt-in Postgres integration test (it reports
  `# TEST_DATABASE_URL not set — skipping` and is expected to stay skipped in a
  default environment).
- For reproducible output use `--test-concurrency=1` (the unit suite is
  concurrency-safe, but a serial run makes counts and ordering deterministic).

This suite must remain **unchanged** across documentation-only sprints — the
counts are a compatibility contract between code and docs.

## 3. Run the demo

```bash
npm run demo:payout:ngn
```

Flags:

- `--mode=sandbox` — operate in sandbox mode against in-process mocks
  (loopback only; no external calls, no credentials needed).
- `--output-dir <dir>` — where the demo writes its output (receipt, evidence,
  reconciliation result).
- The demo drives the real v1 router and pipeline: create → stepwise advance
  through the 15-state lifecycle → receipt with `final_status: settled`.

The demo **exits non-zero** when it cannot operate safely (e.g. missing required
secrets on a fail-closed path) rather than silently degrading.

## 4. Repository layout

| Path | What lives there |
|---|---|
| `src/services/bos/**` | The pipeline core: `stateMachine.js`, `transitionGuards.js`, `transitionActions.js`, `types.js`, `disbursementService.js`, adapters (`StacksAdapter`, `xreserveAdapter`, `yellowcardAdapter`), workers (`pipelineWorker`, `stuckStateReaper`, `reconciliationWorker`), gates, circuit breaker, evidence collectors, monitoring |
| `src/routes/disbursementsV1.js` | The v1 public API (create/advance/get/receipt/retry/recover/approve/resolve, webhook receivers) |
| `src/routes/` (other) | `webhooks.js`, `bosMonitoring.js`, error envelope, `requireApiToken` auth |
| `src/config/` | `chainConfig.js` (network principals, burn seam), env-driven defaults |
| `scripts/` | Demo runner (`demo-payout-ngn.js`), operational scripts |
| `examples/simple-payout-client/` | The Sprint 5 example integrator client (used by the doc walkthroughs and its own test) |
| `migrations/` | SQL schema (001 base, through 006 with `UNIQUE(idempotency_key)`) |
| `test/` | `unit/` (state machine, transitions, guards, adapters — incl. 28 Yellow Card wire-contract tests), `e2e/` (`mock-lifecycle.e2e.test.js`), `integration/` (opt-in, Postgres-gated), the example-client test |
| `docs/` | The documentation set (see index in `README.md`) |

## 5. Contributing

**In scope** (evidence-backed, via the change-control process):

- Fixes to the **open P0s** — G-01 (fail-open preflight gate; fix direction in
  `docs/GAP_REGISTER.md` G-01) and G-02 (create path vs schema mismatch). Any
  fix ships with tests that prove the behavior and a register status update.
- **New adapters** — follow `docs/PROVIDER_ADAPTERS.md` §4 (reference doc first,
  wire-contract tests, claim only what is provable).
- **New corridor configs** — rate pairs, registry mode, gates, breaker
  (`docs/PROVIDER_ADAPTERS.md` §5); NGN is validated, KES/ZAR are
  configuration-proven, sandbox-verification-pending.
- **Documentation corrections** — where docs drift from code, correct the doc
  and update the relevant register.

**Out of scope:**

- **Mainnet enablement** — no mainnet path, no real funds, no production
  deployment under this grant's strategy.
- **Campaign / escrow / verification modules** — the attributable-funds and
  beneficiary-verification surfaces stay as modeled; building the full CineX
  campaign flow is not this repo's scope.
- **Unverified provider claims** — nothing may be marked VERIFIED /
  SANDBOX-VERIFIED without credentials and live evidence (G-20).
- **Silent claim upgrades** — every claim change goes through
  `docs/CLAIMS_REGISTER.md`.

## 6. Sprint discipline

- **Plan-first.** Any body of work starts with a `docs/SPRINT_N_PLAN.md`
  that is reviewed before implementation begins.
- **Evidence per sprint.** Each sprint ends with a `docs/SPRINT_N_REPORT.md`
  recording what shipped, the test counts, and honest blockers.
- **Registers.** `CLAIMS_REGISTER.md` (claim status), `GAP_REGISTER.md` (open
  gaps), `POSTPONED_BACKLOG.md` (deferred, classified D/E items) are updated in
  the same committed change that the claim describes.
- **Change control.** Classification is A–E per
  `docs/PRODUCT_CHANGE_CONTROL.md`; D/E-classified changes go to
  `POSTPONED_BACKLOG.md`, not straight into code.
- **Scope conflict → STOP.** If a requested change conflicts with this guide,
  the strategy, or an acceptance criterion, stop and report rather than
  improvise.