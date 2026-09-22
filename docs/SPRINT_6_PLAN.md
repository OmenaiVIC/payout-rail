# Sprint 6 Plan — Reproducible Nigeria Payout Demonstration

> Task: `docs/prompts/08_SPRINT_6_DEMO.md` (plan-first).
> Status: **PLAN ONLY — awaiting review. No implementation performed.**
> Baseline (verified this session): `npm test` → **181 tests, 180 pass, 0 fail, 1 skip**
> (1 skip = the Postgres-gated integration test `test/integration/disbursement-create.pg.test.js`).
> Constraints honored so far: no source changes, no commits, no network calls, no new deps.

---

## 0. What this sprint ships

A single reproducible command — `npm run demo:payout:ngn` — that runs the full
NGN payout lifecycle end-to-end through the **Sprint 5 v1 public API** and produces:
(a) a human-readable transaction timeline on stdout, (b) a machine-readable
settlement receipt written to `demo-output/receipt-<id>.json`, and (c) an honest
statement of what is and is not proven. It runs in two modes:

- **DEMO_MODE** (default): every external dependency (Stacks, xReserve, Yellow
  Card) is simulated inside the process; every simulated event is labelled `DEMO`;
  the run is deterministic and fully offline (loopback listener only).
- **SANDBOX_MODE** (`--mode=sandbox`): uses real sandbox services **only if every
  credential is present**. With no credentials (our reality — G-20 blocks live
  Yellow Card verification permanently), it reports the missing verification per
  leg and exits non-zero. It never fabricates success and never mixes modes.

Scope out (unchanged from prompt): live sandbox calls, any adapter/API/state
machine/evidence-chain change, multi-corridor, any new runtime npm dependency,
any change to `examples/` or `src/`.

---

## 1. Design decision: how the runner works (the important part)

The runner is `scripts/demo-payout-ngn.js` — a self-contained ESM script with
**zero new dependencies** (Node 18+ global `fetch`, `express` and the app's own
modules, all already installed).

```
npm run demo:payout:ngn [--mode=demo|sandbox] [--output-dir=<dir>]
```

Flow in DEMO_MODE:

1. **Build a simulated `ctx`** exactly like `src/index.js:ensureInit()` does
   (`{ getDb, adapters, recipientRegistry, emitEvent, getLogger }`), but with:
   - `db` = an in-memory ledger built inside the script (same SQL surface the v1
     flow touches — create/get/advance/audit/external_refs/receipt reads, the
     `PERSISTED_ACTION_FIELDS` writes, `circuit_breaker_state` → `closed`,
     `exchange_rates` → 1650, `payout_gates` probe queries → 0). It is a
     simulated ledger, visibly demo-owned, **not** imported from `test/helpers/`.
   - `adapters` = deterministic happy-path doubles mirroring
     `test/helpers/mockAdapters.js` (simulated burn txid `0x…01`, attestation
     `att-mock-1`, Yellow Card send `yc-mock-1`), plus a latched witness-evidence
     source so the destination release observation returns `released` (the
     G-08-faithful pattern from `test/helpers/mockExternalEvidence.js`: evidence
     is "emitted" by the simulated settlement surface, never fabricated by the app).
   - `recipientRegistry` = `createRecipientRegistry('permissive')` (the app's own
     permissive mode).
2. **`await disbursementService.init(ctx)`** — the same init the production
   server runs. The runner then mounts the **real v1 router** (`src/routes/
   disbursementsV1.js`) on its own tiny Express app and listens on
   `127.0.0.1:0` (ephemeral, loopback only — no external sockets).
   `process.env.BOS_API_TOKEN` is set to a fixed demo token; the dev escape hatch
   is deleted, so the demo exercises the **fail-closed auth path**.
3. **Drive the API with the real Sprint 5 client**
   (`examples/simple-payout-client/client.js` exports `createPayout`,
   `advancePayout`, `getReceipt`) pointed at the loopback URL. This is the same
   artifact an integrator runs (`PAYOUT_API_BASE_URL` = the loopback base). The
   demo therefore *is* a scripted operator, not a backdoor into services.
4. **Run the lifecycle**: create → stepwise `advance(id, 1)` until terminal or
   25 steps → `GET /:id` for the enriched row + audit log → `GET /:id/receipt`.
   Deterministic happy path expects terminal **`settled`**.
5. **Publish**: write the receipt JSON to `<output-dir>/receipt-<id>.json`,
   print the timeline + receipt summary + the honest no-claims statement, exit 0.

Steps 1–3 are replicated in ~80 lines inside the script — deliberately, not by
importing test helpers (rationale in §8, deviation D2). The business rules stay
100% the app's real code: the real state machine, real guards, real actions, real
evidence recorders, real receipt generator. Only the *ledger* and *external
world* are simulated — and every trace of that simulation is labelled `DEMO`.

**Why this is honest:** the preflight gates are still executed by the real
`runPreflight`/`runAllGates`, the transitions by the real `stateMachine` +
`transitionActions`, and evidence by the real `recordTxHash`/`recordApiResponse`
recorders. The demo supplies only the *inputs* those real components read
(gate state, rates, health, witness evidence) — the exact kind of input the
production controllers would supply. Nothing is fabricated downstream of the API
boundary; `settled` with `gaps: []` is only reachable when the simulated evidence
for every leg lands in the ledger, and the runner prints whatever gaps exist,
verbatim (never flattens them).

The stepwise advance keeps the timeline faithful: each `advance(id, 1)` returns
one `result.new_state`, giving a real `from → to` per HTTP call. `MAX_ADVANCE_STEPS =
25` comfortably covers the NGN lifecycle (≈12 transitions).

---

## 2. Transaction timeline (exact format)

Printed to stdout, after a mode banner. Layout:

```
===============================================================================
 PAYOUT RAIL — NIGERIA (NGN) PAYOUT DEMONSTRATION
 mode                 : DEMO_MODE — all external events are simulated
 corridor             : NGN
 amount               : 25.00 USD → 25,000,000 USDCx → 41,250,000 NGN (minor units)
 disbursement id      : <uuid>
 idempotency key      : disbursement:<sha256 summary>
 settle target        : settled
===============================================================================
```

An event line per transition, one per API step (this is the mandated
`timestamp · transition · source · evidence ref`):

```
#   timestamp                    transition                    source   evidence ref
01  2026-09-22T10:00:00.000Z     initiated → preflight_check    DEMO     bos.preflight (simulated)
02  2026-09-22T10:00:01.000Z     preflight_check → burn_submitted   DEMO  stacks tx 0x..01 (simulated)
03  ...                                                        DEMO     xreserve att-mock-1 (simulated)
...
NN  2026-09-22T10:00:NN.NNNZ     <penultimate> → settled        DEMO     yc send yc-mock-1 (simulated)
```

Only DEMO/sandbox-safe sources appear; in DEMO_MODE the `source` column is
literally `DEMO` on every row, each transition's external leg carries a
`(simulated)` suffix, and the banner states the required sentence verbatim
(§3). The receipt section follows:

```
===============================================================================
 SETTLEMENT RECEIPT
 file        : demo-output/receipt-<id>.json
 final_status: settled
 gaps        : []            ← printed exactly as the generator returned them
 conclusions : <one line per receipt section>
 NOTE        : DEMO_MODE — all external events are simulated. This is not a live
              settlement; no external service was contacted for this run.
===============================================================================
```

The `NOTE` line is the acceptance-10 guarantee — the demo never claims live
settlement or production readiness.

---

## 3. DEMO vs SANDBOX labelling scheme

- **DEMO_MODE**: header banner + required verbatim line
  `DEMO_MODE — all external events are simulated` (prompt's exact sentence),
  every timeline row `source=DEMO`, every external leg suffixed `(simulated)`,
  and the closing note above. A DEMO-generated receipt is only ever written by a
  DEMO run.
- **SANDBOX_MODE**: each event line carries `source=SANDBOX` **and** the leg's
  provider; a SANDBOX run never carries a `(simulated)` label and never reuses a
  DEMO receipt or DEMO evidence.
- **Mixing is impossible by construction**: the mode is fixed before the ctx is
  built; DEMO uses simulated adapters + in-memory ledger, SANDBOX uses the real
  factory adapters + real DB wiring; there is one exit path per mode and no code
  path that swaps an adapter mid-run.

### SANDBOX_MODE behavior (our reality: no credentials)

On startup the runner evaluates the per-leg credential matrix (exact env var
names from the code, verified by grep):

| Leg | Required variables | Source |
|-----|--------------------|--------|
| Stacks (burn) | `PAYOUT_TX_SIGNING_KEY` | `StacksAdapter.js:43` |
| xReserve | `XRESERVE_PROTOCOL_CONTRACT` | `xreserveAdapter.js:30` |
| Yellow Card | `YELLOW_CARD_API_KEY`, `YELLOW_CARD_SECRET_KEY`, `YELLOW_CARD_ENV` | `yellowcardAdapter.js:24-28` |

Additional guard: if `YELLOW_CARD_ENV` resolves to `production`, SANDBOX_MODE
**refuses outright** — the demo must never send a payout through the production
Yellow Card API. `YELLOW_CARD_ENV` must be a sandbox value or absent.

If **any** leg is missing/illegible, the runner prints a matrix table
(`leg | credential | present?`), a `verification cannot be reported for:`
list, states `SANDBOX_MODE requires sandbox credentials that are not present —
nothing was run; success was not fabricated`, and exits **2** (non-zero, fail
closed) **before starting the lifecycle**. It never proceeds with whatever
subset is present (that would mix real and simulated legs). This is the exact
behavior acceptance criterion 5 and the prompt's SANDBOX bullet describe.

Exit codes: `0` = DEMO success (or SANDBOX full success); `2` = SANDBOX
incomplete (missing credentials / production-leg refusal); `1` = any other
unexpected error.

---

## 4. Receipt retrieval flow

1. After the final `advance`, call `getReceipt(id)` → `GET /api/v1/
   disbursements/:id/receipt` (unchanged Sprint 5 route → unchanged Sprint 4
   generator). **The generator is not modified** (scope-out: evidence chain).
2. Validate the envelope minimally (object present, has `final_status` and
   `receipt_version`) so a broken receipt can never be silently published.
3. Write the raw JSON to `<output-dir>/receipt-<id>.json`.
   - Default `<output-dir>` = `demo-output/` (gitignored — §7).
   - Tests pass `--output-dir=<tempdir>` for hermetics; the runner takes the
     same flag so a review run and a test run never collide.
4. Print the receipt section (§2), including **`gaps` exactly as returned** —
   the demo shows gaps when a leg has no evidence; it never fabricates
   completeness.

---

## 5. The DEMO lifecycle (deterministic happy path) and why the gates pass

The demo body (fixed, deterministic — no randomness, no wall-clock in inputs):
`source_reference: "demo-ngn-001"`, `source_application: "demo-runner"`,
`amount_usd: 25`, `amount_usdcx: 25_000_000`, fixed `creator_address`,
fixed `creator_btc_address`, `recipient_bank_account: "0123456789"`,
`recipient_bank_code: "044"`, `ngn_recipient` mirror. 25 USD keeps the
two-person-approval requirement off (`TwoPersonApproval.isRequired` thresholds
at `amountThresholdUsd || 1000` — `twoPersonApproval.js:3-10`), so the real
`check()` returns `ok:true` without the ledger needing seeded approvers.

The simulated ledger + adapters supply the standard controller inputs the real
gates read, so the **real** gates pass deterministically:
- circuit breaker: ledger reports `circuit_breaker_state` = `closed`
  (`circuitBreaker.check` returns `ok:true`).
- payout gates (`payoutGates.runAllGates`): recipient-registry gate passes via
  `permissive` registry; amount-cap gates pass by raising
  `BOS_MAX_PER_DISBURSEMENT_USD` / `BOS_DAILY_PAYOUT_CAP_USD` in the runner's
  own process env (same knobs the app documents); exchange-rate gate reads the
  ledger's `exchange_rates` row (1650) / `DEFAULT_USDCX_NGN_RATE`.
- health: simulated adapters report `healthy: true`.

From there the real machine runs, in order (per `stateMachine.js` maps +
`transitionActions.js`): `disbursement_initiated → preflight_check →
burn_submitted → <attestation/release legs> → <Yellow Card submit/confirm>
→ settled`, with `recordTxHash`, `recordApiResponse`, `recordPollResult`,
`recordGateResult`, `recordStatusSnapshot` persisting evidence each leg, and the
destination-release observation latched to `released` before the release
transition guard runs (the G-08-faithful witness pattern). Expected terminal:
**`settled` with `gaps: []`** — achieved only because every simulated leg's
evidence is on the ledger.

Implementation will confirm the exact transition ordering by booting the app
offline first; if a leg's guard defaults differ from this expectation, that gets
resolved inside the *demo's* simulated inputs (never by editing `src/`).

---

## 6. Test files to create

All offline; the runner is spawned as a child process with `node:child_process`
(`spawn`) so the tests exercise the **actual command**, not a harness. Env is
snapshot/restored like `test/helpers/v1Api.js` does.

`test/unit/demo-runner.test.js`:

| Test | Asserts |
|------|---------|
| DEMO_MODE full lifecycle | spawn `node scripts/demo-payout-ngn.js --mode=demo --output-dir=<mkdtemp>`; exit code **0**; banner + verbatim `DEMO_MODE — all external events are simulated`; receipt file exists under the temp dir and parses as JSON with `receipt_version: 1` and `final_status: 'settled'`; timeline rows cover the expected transitions incl. terminal `→ settled`; **every** timeline row labelled `DEMO`; no row labelled `SANDBOX`; text `This is not a live settlement` present; fail-closed auth exercised (client passes the token). |
| SANDBOX_MODE honest failure (no creds) | spawn with `--mode=sandbox` and the credential env vars deleted (`YELLOW_CARD_API_KEY`, `YELLOW_CARD_SECRET_KEY`, `YELLOW_CARD_ENV`, `XRESERVE_PROTOCOL_CONTRACT`, `PAYOUT_TX_SIGNING_KEY`); exit code **non-zero**; stdout lists each missing leg; states it did not run; does **not** print `settled`, a success receipt, or any fabricated-completion line; did not write a receipt file. |
| SANDBOX_MODE refuses production leg (optional but cheap) | spawn sandbox with `YELLOW_CARD_API_KEY`/`YELLOW_CARD_SECRET_KEY` set but `YELLOW_CARD_ENV='production'` and others missing; exit **2**; refusal line referencing the production guard. |

"No external network calls in DEMO_MODE" (acceptance 8): guaranteed by design —
the only socket the runner opens is `127.0.0.1:0`, the adapters are simulated,
and the runner imports no HTTP client beyond the client's `fetch` against the
loopback URL. The DEMO test additionally asserts no `(simulated)`-free external
refs appear and that stdout references only the loopback origin.

---

## 7. Files to add / touch

**New files**
- `scripts/demo-payout-ngn.js` — the runner (§1–§5), ESM, self-contained,
  zero new deps.
- `docs/DEMO.md` — how to run both modes, the credential matrix, what the demo
  proves / does **not** prove, how to read the timeline and receipt, how to
  interpret `gaps`, the DEMO-vs-SANDBOX rule ("never mix", and how the code
  enforces it).
- `test/unit/demo-runner.test.js` — §6.
- `docs/SPRINT_6_REPORT.md` — written in the evidence phase (§9), containing the
  captured real run output.

**Modified files**
- `package.json` — one `demo:payout:ngn` script (`node scripts/demo-payout-ngn.js`).
  String only; no new `dependencies`/`devDependencies`.
- `.gitignore` — append `demo-output/` (acceptance 11).
- `README.md` — a "Demo" section pointing to `docs/DEMO.md` (acceptance-gate 4).

**Never touched:** `src/**`, `examples/**`, CineX, `docs/prompts/**`.
Zero modifications to the state machine, guards, actions, evidence chain,
adapters, or receipt generator (all sprint-owner scope-out).

---

## 8. Deviations from current repo state, with reasons

- **D1 — new `scripts/` directory + one package.json script.** The repo currently
  has no runtime scripts directory. The prompt mandates the exact file path and
  the exact npm command, so this is the prompt, not a judgment call.
- **D2 — the runner is self-contained and does not import `test/helpers/*`.**
  Reusing `createV1Store`/`createMockAdapters`/`makeV1App` would be the cheap
  route, but runtime/demo code must not depend on test files; the ~80 lines of
  simulated ledger + adapter + listener wiring are intentionally demo-owned so
  the simulation is visible, reviewable, and labelled as part of the demo.
- **D3 — the runner drives the API through `examples/simple-payout-client/
  client.js` (the Sprint 5 client) rather than calling service functions.**
  This is what "uses the v1 public API from Sprint 5 (not internal services)"
  literally requires, and it means the demo exercises the exact public surface +
  auth an integrator would hit. The runner's own Express mount is the *same*
  router object the app uses — no API change anywhere.
- **D4 — transitions are driven synchronously via `advance`, not by the pipeline
  worker timers.** The v1 `advance` endpoint runs the state machine directly (it
  is the operator-equivalent path). Workers are background/restart machinery;
  the demo must be one deterministic command, so it steps the machine itself.
- **D5 — SANDBOX_MODE aborts before any lifecycle when any credential is
  missing (exit 2), and refuses a `production` Yellow Card leg outright.**
  "Never mix" + "fail closed" taken to their logical end: a partial-credential
  run would have to simulate the missing legs, which is exactly what the prompt
  forbids.
- **D6 — the demo's preflight inputs (pb breaker state, gates/caps, rates,
  witness evidence) are supplied by the simulated ledger + adapters, not by
  editing gate code.** The real gates, actions, recorders, and receipt generator
  run unmodified; only the *inputs those components read* are simulated and
  labelled. This is the crux of "honest about DEMO vs live" and is why the demo
  needs no src changes and reaches `settled` only with full evidence on the
  ledger.

---

## 9. Commit split (one commit per logical fix)

1. `feat: reproducible NGN payout demo runner (DEMO_MODE + SANDBOX_MODE)` —
   `scripts/demo-payout-ngn.js`, `package.json` script, `.gitignore`
   `demo-output/`.
2. `test: demo runner DEMO_MODE completion + SANDBOX_MODE honest failure` —
   `test/unit/demo-runner.test.js`.
3. `docs: demo documentation (docs/DEMO.md) + README Demo section`.
4. `docs: sprint 6 report with captured demo run output` —
   `docs/SPRINT_6_REPORT.md` (after running the real command; run output is
   evidence).

Whole-sprint estimate 4 commits < 10 guidance; no split needed.

---

## 10. Acceptance-criteria → deliverable map

| Acceptance | Where |
|---|---|
| 1. `demo:payout:ngn` runs DEMO_MODE, exits 0 | §1, §5; test (commit 2); report (commit 4) |
| 2. Timeline on stdout, every event labelled DEMO | §2, §3; test asserts rows labelled DEMO |
| 3. Receipt written to `demo-output/`, valid JSON | §4; test parses + validates it |
| 4. `docs/DEMO.md` explains proved vs not-proved | commit 3 |
| 5. `--mode=sandbox` no-creds reports missing verification, no fabrication | §3; test exits non-zero, lists legs, no success |
| 6. Tests cover DEMO completion + SANDBOX honesty | §6 (commit 2) |
| 7. All existing tests still pass (181 baseline) | suite gate after every commit |
| 8. No external network in DEMO_MODE | by construction (§1) + loopback-only assertion |
| 9. No new runtime npm deps | none added; runner uses Node fetch + installed deps |
| 10. Never claims live settlement/production readiness | banner + NOTE line (§2, §3), asserted |
| 11. `demo-output/` gitignored | commit 1 |

**Blockers pre-checked (prompt's list — none triggered):**
- Can DEMO_MODE complete without an adapter change? **Yes** — simulated
  adapters are supplied at the ctx seam; no adapter source change needed.
- Does the v1 API support every step? **Yes** — create, `advance?steps=` (≤25,
  ≈12 needed), `GET /:id`, `GET /:id/receipt`.
- Is the receipt retrievable from v1? **Yes** — Sprint 5 endpoint, unchanged
  generator.
- Can tests be written without credentials? **Yes** — spawn-based, credential
  vars deleted in the child env.
- Would the demo need mixed evidence? **No** — mode chosen before ctx build.

---

## 11. Stop gate

Per the sprint prompt's Step 3 gate: **this plan is awaiting review.**
No implementation, no commits, no source modifications, no network calls were
made after the baseline `181/180/0/1` was confirmed. Do not implement until the
plan is approved.