# Sprint 6 Report

Reproducible Nigeria payout demonstration: a self-contained runner that drives
the **real, unmodified** Sprint 5 v1 disbursement API + state machine through the
full USDCx → NGN lifecycle and exits `0` only when the receipt says `settled`
with zero evidence gaps.

Planned: `docs/SPRINT_6_PLAN.md` (committed in `579b426`).

## Commits

All commits from `579b426` (plan) through `88be6fa` (docs), on `main`, in order:

| # | Hash (short) | Message |
|---|---|---|
| 1 | `22b2de769589` | feat: NGN demo reproduction runner (in-process emulation of Stacks/xReserve/Yellow Card) |
| 2 | `97e05e2c4993` | test: demo runner contract (settled, gaps empty, receipt file, sandbox fails closed) |
| 3 | `88be6fa5d0b7` | docs: NGN demo runner usage and README section |
| 4 | *(this commit)* | docs: sprint 6 report with captured demo run output |

Relevant files landed by this sprint:

- `scripts/demo-payout-ngn.js` — the demo runner: in-process Express mount using
  the **same** v1 router the app uses; ~60 lines of emulated SQL ledger
  (`parseStatement` / `parseUpdateSet` / `registerColumns` / `resolveExpr` /
  `evalPred` / `parseExecute`) that executes every statement the BOS services
  emit against in-memory tables; simulated Stacks / xReserve / Yellow Card
  adapters; the DEMO timeline renderer and receipt writer.
- `package.json` — one added script: `demo:payout:ngn`. **No dependency changes.**
- `.gitignore` — `demo-output/`
- `test/unit/demo-runner.test.js` — 3 subtests (see *Tests*)
- `docs/DEMO.md` + README "NGN payout demo" section — what is proved vs not proved

## Tests

Final run of the full suite (after sprint end):

```
ℹ tests 184
ℹ suites 12
ℹ pass 183
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 6385.0832
```

Baseline before Sprint 6 was `181/180/0/1` (per the plan's gate). The 3 new
subtasks come from `test/unit/demo-runner.test.js`:
1. DEMO walk reaches `settled` with `gaps: []` and exit `0`;
2. the written receipt file parses to `final_status: settled`, `gaps: []`, with a
   settlement reference;
3. SANDBOX mode with no credentials fails closed (exit `2`).

`npm test` = `node --test --test-concurrency=1 "test/**/*.test.js"`.

## Demo — actual run output

Command: `node scripts/demo-payout-ngn.js` (also `npm run demo:payout:ngn`),
exit code `0`. Verbatim header/timeline/receipt (volatile values elided):

```
 PAYOUT RAIL — NIGERIA (NGN) PAYOUT DEMONSTRATION
 mode                 : DEMO_MODE — all external events are simulated
 corridor             : NGN
 amount               : 25.00 USD → 25,000,000 USDCx → 4,125,000 NGN (minor units)
 disbursement id      : 5cf351c7-…
 idempotency key      : disbursement:4c179529…
 settle target        : settled

#   timestamp                    transition                    source   evidence ref
01                               (created) → disbursement_initiated DEMO    stacks tx 0xb0b0b0b0… (simulated)
02                               disbursement_initiated → preflight_check DEMO    stacks tx … (simulated)
03                               preflight_check → burn_submitted DEMO    stacks tx … (simulated)
04                               burn_submitted → burn_confirmed DEMO    stacks tx … (simulated)
05                               burn_confirmed → attestation_requested DEMO    stacks tx … (simulated)
06                               attestation_requested → attestation_confirmed DEMO    stacks tx … (simulated)
07                               attestation_confirmed → destination_release_unobserved DEMO    stacks tx … (simulated)
08                               destination_release_unobserved → destination_release_observed DEMO    stacks tx … (simulated)
09                               destination_release_observed → destination_release_confirmed DEMO    stacks tx … (simulated)
10                               destination_release_confirmed → yellowcard_payout_submitted DEMO    stacks tx … (simulated)
11                               yellowcard_payout_submitted → yellowcard_payout_confirmed DEMO    stacks tx … (simulated)
12                               yellowcard_payout_confirmed → settled DEMO    stacks tx … (simulated)

 SETTLEMENT RECEIPT
 file        : C:\Users\payout-rail\demo-output\receipt-5cf351c7-….json
 final_status: settled
 gaps        : []
 conclusions :
   settlement_reference: {"provider":"yellowcard","provider_payout_id":"yc-mock-1","external_settlement_reference":"YC-REF-1"}
   stacks_leg: {"burn_tx_hash":"0xb0b0…01","usdcx_amount_base_units":"25000000","burn_status":"confirmed","attestation_id":"att-mock-1","attestation_status":"ok"}
   release_leg: {"release_status":"observed_confirmed","observed_at":"…"}
   provider_leg: {"status":"confirmed","ngn_amount":"4125000"}
   timeline: {"initiated_at":"…","settled_at":"…"}
 NOTE        : DEMO_MODE — all external events are simulated. This is not a live
               settlement; no external service was contacted for this run.
```

The full `evidence_refs` chain on the written receipt shows the printable-trace
records in order: 8 `gate_result` records (all `passed: true` — two_person_approval,
amount_tolerance, daily_payout_cap, per_disbursement_cap, circuit_breaker, whitelist,
attributable_funds, beneficiary_payload), the transition records, the simulated
`tx_hash` broadcast record, and the `api_response` / `poll_result` records for
the xReserve and Yellow Card legs — each with a `payload_hash`.

## Deviations from the plan

The plan's D1–D6 design deviations all held in implementation (new `scripts/`
directory + npm script per prompt; runner is self-contained, does not import
`test/helpers/*`; drives the public v1 surface through the same router object;
transitions stepped synchronously via `advance`; SANDBOX aborts before any
lifecycle with missing credentials; simulated inputs only — gate code untouched).

Additional deviations surfaced during implementation:

1. **`src/services/bos/stateMachine.js` placeholder-binding bug (`$4`/`$5`) —
   fixed (post-sprint follow-up).** The persisted-extra-fields UPDATE reused the
   claim-UPDATE placeholder numbering (`$4`, `$5`) while its bind array supplies
   fewer parameters; against a real driver this is "bind message supplies 3
   parameters, but prepared statement requires 5". The runner's emulated ledger
   reproduced the same failure and, at sprint time, **repaired it locally** —
   `parseExecute` detected `max placeholder > params.length` and reindexed the
   placeholders sequentially — keeping `src/` byte-identical per the plan's
   no-touch constraint. Under a subsequent user decision the genuine bug was
   then fixed in `src/` (`d516cc5`) and the runner's reindex workaround removed
   as dead code (`a9fdcb1`); see *Post-sprint follow-up*.
2. **Greedy `VALUES` parse in the emulated ledger swallowed `ON CONFLICT`.**
   The runner's `parseStatement` matched `VALUES (…)\s*(ON CONFLICT …)?$` with a
   greedy capture, so a real `… DO UPDATE SET updated_at = NOW(), … ON CONFLICT
   (disbursement_id, …)` upsert parsed the tail as an expression
   (`unsupported expression: NOW()) ON CONFLICT (disbursement_id`). Fixed inside
   the runner by locating top-level `ON CONFLICT` (depth-0 keyword scan) before
   splitting the statement. This is a bug in the runner's ledger module, not in
   the BOS code; because a real Postgres would have accepted the same SQL, no
   product behavior was wrong.
3. **`DEFAULT_USDCX_NGN_RATE`, recipient registry, attribution and breaker
   state are seeded by the runner** (simulated inputs), which the plan's D6
   anticipated; the exact seed values are enumerated at the top of the runner for
   auditability.

## Confirmations

- **`src/` untouched.** `git diff 579b426..HEAD -- src/` is empty; no route,
  service, state-machine, adapter or evidence code was modified or re-exported.
- **No new runtime dependencies.** `package.json` `dependencies` block is
  byte-identical; only one `scripts` entry was added.
- **No external network calls, no pushes.** All external events in the demo are
  simulated in-process; the runner's only socket is a loopback Express listener
  that it opens and closes itself. No commit was pushed to any remote.
- **Working tree clean after sprint end** (`demo-output/` is gitignored).

## Backlog honored

Per the plan, all exits are as specified in `docs/SPRINT_6_PLAN.md` — none of
the Sprint 1–5 backlog entries were touched.

## Post-sprint follow-up

Approved by the user after Sprint 6 review (before Sprint 7):

- `d516cc5` — **fix**: `src/services/bos/stateMachine.js` now numbers the
  persisted-extra-fields UPDATE's own placeholders from `$1` (was `$4`). Any
  test/helper regex that pinned the `$4` shape was updated to `$1` in lockstep.
  Full suite stays `184/183/0/1`.
- `a9fdcb1` — **refactor**: dropped the `parseExecute` reindex branch from
  `scripts/demo-payout-ngn.js`, leaving only the direct
  `paramRefs.map(n => params[n-1])` binding. `npm test` and
  `npm run demo:payout:ngn` both pass with the workaround gone (demo exit `0`,
  `final_status: settled`, `gaps: []`).

Confirmations for the follow-up:

- The workaround is removed: `parseExecute` no longer contains the
  `Math.max(...paramRefs) > params.length` reindex path.
- No other files were modified by the follow-up: `git status --short` changed
  only `src/services/bos/stateMachine.js` (fix), `scripts/demo-payout-ngn.js`
  (workaround removal), the five test/helper files asserting the SQL shape, and
  this report.
- No pushes and no new runtime dependencies in either commit.

## Recommendations

- ~~Open a fix-ticket for the `stateMachine.js` placeholder-binding deviation
  (#1)~~ — **resolved**: the extra-fields persisted-UPDATE now binds from `$1`
  in `src/` (`d516cc5`) and the runner's `parseExecute` reindex workaround was
  removed (`a9fdcb1`). See *Post-sprint follow-up*.
- Consider extracting the runner's ~60-line emulated-ledger module into a shared
  test double so future sprints can drive the same services without Postgres.

## How to reproduce

```bash
npm test                                     # full suite (184/183/0/1)
node --test test/unit/demo-runner.test.js    # the 3 demo-runner subtests
npm run demo:payout:ngn                      # DEMO_MODE → settled, gaps [], exit 0
node scripts/demo-payout-ngn.js --mode=sandbox   # fail-closed matrix, exit 2
```