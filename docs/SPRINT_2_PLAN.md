# Sprint 2 Plan — Stacks/USDCx Withdrawal Lifecycle (Model Correction)

> Prompt: `docs/prompts/04b_SPRINT_2_STACKS_USDCX.md`
> Mode: plan-first. **This document is the Plan (Step 3). No source file is modified yet; no test is run
> beyond the baseline; no external network call; nothing committed.**
> Standing constraints (Master Prompt + `docs/PRODUCT_CHANGE_CONTROL.md`): only A/B/explicitly-authorized
> C work may be implemented; D/E → `docs/POSTPONED_BACKLOG.md`; conflicts → STOP and report.

---

## 1. Sprint purpose (read from the prompt)

The Sprint 0 baseline (`docs/PRODUCT_BASELINE.md` §6, G-08) found the release leg fabricated: the app calls
`releaseDestination()` which returns `{ release_id: attestation_id, status: 'confirmed' }` with **no external
assurance** (`xreserveAdapter.js:220-229`), and `getReleaseStatus` is only a Hiro tx-status proxy
(`xreserveAdapter.js:242-255`). The state machine then treats `destination_release_confirmed` as truth and
unlocks the payout leg. In the canonical Stacks/USDCx model the app cannot do this: after the burn triggers
attestation, an external service releases USDC to the destination wallet **outside the app's control**;
the app's job is to **observe and record**, never to fabricate confirmation.

Sprint 2 corrects the model **inside this repo**. It does not touch testnet, xReserve, or Yellow Card;
every real external step stays `UNVERIFIED`.

Baseline collected from inspection (before any change):

| Aspect | Finding |
|---|---|
| Test suite (`npm test`) | **69 tests / 68 pass / 0 fail / 1 skip** (the skip is the `TEST_DATABASE_URL`-gated Postgres integration test). Matches the Sprint 1.5 report. |
| Release leg today | `attestation_confirmed → destination_release_submitted → destination_release_confirmed`; entry action `submitDestinationRelease` calls the no-op `releaseDestination` (`transitionActions.js:161-183`); confirm guard/action poll `getReleaseStatus` (`transitionGuards.js:81-95`). |
| Payout gate | `destinationReleasedForPayout` re-polls `getReleaseStatus` and requires `status==='confirmed'` (`transitionGuards.js:101-118`). |
| Burn target | `StacksAdapter.burnUsdcx` broadcasts `burn` on `USDCX_CONTRACT` (the `usdcx` token) — G-09 `usdcx-v1` discrepancy. |
| States | 14 states; the only release-leg states are `destination_release_submitted` + `destination_release_confirmed`. 45 registered transitions (23 explicit + 22 generic). |

---

## 2. Corrected model (what the app may and may not claim)

Canonical flow (as documented in `docs/PRODUCT_BASELINE.md` §6 and the prompt):

1. App broadcasts a USDCx **burn** on Stacks (the attestation trigger).
2. Stacks attestation service signs the burn intent.
3. xReserve verifies and releases **USDC to the destination wallet** — an external, off-chain process.
4. The app **observes** a status surface / evidence record, records it, and only then confirms.

Correction principle for this sprint:

- The app **does not** call a "release" operation it controls; there is no `releaseDestination` client call.
- The app **does not** conclude "release confirmed" from a Hiro tx-status proxy or a stored string.
- The app **records a release_status observation** (`unobserved | observed_pending | observed_confirmed |
  observed_failed`) and only advances to `destination_release_confirmed` on `observed_confirmed`.
- `unobserved` is an explicit parked state with a timeout that routes to `manual_review`.
- Fail closed: `unobserved`/`observed_pending`/any ambiguous record can never unlock the Yellow Card leg.

---

## 3. Exact state set (new / renamed / kept) — with justification

| State | Action | Justification |
|---|---|---|
| `destination_release_unobserved` | **NEW** | Required by AC2/AC4: a distinct state meaning "waiting for external evidence, none exists yet". Cannot reach payout. Timed out by the reaper → `manual_review`. |
| `destination_release_submitted` | **RENAMED → `destination_release_observed`** | The name asserts an app-controlled submission, but the application submission action is removed (it was the fabricated `releaseDestination` call). The corrected meaning of the state is "evidence exists and says in progress (`observed_pending`)". Renaming an existing **string value** in the enum is safe for the schema (status is `TEXT`, no Postgres enum); it is NOT a removal — the functional spot between "no evidence" and "confirmed" is preserved. |
| `destination_release_confirmed` | KEPT | Now reachable **only** from `unobserved`/`observed` when the observation is `observed_confirmed`, and the payout guard additionally requires the persisted `release_status='observed_confirmed'`. |
| `failed` / `cancelled` / `manual_review` | KEPT | Terminal/escape routes; observed_failed maps to `failed`, no-evidence timeout maps to `manual_review`. |

New total: **15 states** (14 − `submitted` + `unobserved` + `observed`).

Changed canonical order (for docs/README/comments):
`… attestation_confirmed → destination_release_unobserved → destination_release_observed → destination_release_confirmed …`

---

## 4. Exact transitions (added / removed / modified)

All guard/action names are proposed; final names follow the repo's naming style.

### 4.1 Removed (explicit transitions)

| Transition | Reason |
|---|---|
| `attestation_confirmed → destination_release_submitted` | Entry action `submitDestinationRelease` called the fabricated `releaseDestination`; replaced by `→ destination_release_unobserved`. |
| `destination_release_submitted → destination_release_confirmed` | The submission state and its confirm poll (`getReleaseStatus`) are replaced by observation transitions. |
| `destination_release_submitted → failed` | Replaced by observation-failure transitions from `unobserved`/`observed`. |

### 4.2 Added (explicit transitions)

| Transition | Guard | Action | Semantics |
|---|---|---|---|
| `attestation_confirmed → destination_release_unobserved` | `attestationConfirmedForRelease` (existing) | `beginReleaseObservation` | Records `release_status='unobserved'`, upserts the observation external_ref (subject = burn tx / attestation id), writes evidence. **No adapter call** (nothing to observe yet). |
| `destination_release_unobserved → destination_release_observed` | `isReleaseObservedPending` | `recordReleaseObservedPending` | Evidence now exists and says in-progress → park as `observed_pending` (the "still waiting" advance). |
| `destination_release_unobserved → destination_release_confirmed` | `isReleaseObservedConfirmed` | `confirmDestinationRelease` (rebuilt) | First evidence already `observed_confirmed` → advance. |
| `destination_release_unobserved → failed` | `isReleaseObservedFailed` | `recordReleaseObservedFailed` | First evidence `observed_failed` → fail path. Replaces the generic `failed` entry for this state. |
| `destination_release_observed → destination_release_confirmed` | `isReleaseObservedConfirmed` | `confirmDestinationRelease` (rebuilt) | Pending → evidence `observed_confirmed` → advance. |
| `destination_release_observed → failed` | `isReleaseObservedFailed` | `recordReleaseObservedFailed` | Pending → evidence `observed_failed` → fail path. |

Generic transitions for the two new states (`→ cancelled`, `→ manual_review`) are auto-registered by the
existing loop (`stateMachine.js:165-183`); the explicit `→ failed` entries preempt the generic one
(`unobserved→manual_review` also remains available to the reaper, which is the **timeout** mechanism).

**Routing without a structural redesign.** `advanceDisbursement` still picks `nextStates[0]` and the guards
are mutually exclusive per observed value, so exactly one transition passes per tick:

- from `unobserved`, Map order is `observed → confirmed → failed` (confirmed first for a happy path, one poll);
- a row whose evidence is still `unobserved` gets guard-rejected by all three → parked → reaper timeout.

Each observation guard polls once; each observation action re-observes once to capture the recorded payload —
the same guard-then-poll pattern the burn/attestation legs already use. Because polls are **idempotent reads**
of a latched status (see §6 mock design), extra polls cannot manufacture evidence or advance a script.

### 4.3 Modified

| Transition | Change |
|---|---|
| `destination_release_confirmed → yellowcard_payout_submitted` | Guard `destinationReleasedForPayout` now re-observes the external surface **and** requires the **persisted** row `release_status === 'observed_confirmed'` (fail-closed, AC3 — even a hand-edited state can't unlock payout). Payout gates + 2-of-N approval unchanged. |
| `PERSISTED_ACTION_FIELDS` (`stateMachine.js:17-27`) | Add `release_status: (v) => v` so observation actions persist the enum onto the row. |

Remote edges unchanged: `attestation_confirmed → failed` (observation-start failure), the burn leg, the
Yellow Card leg, manual-review resolution, `markSettled/markFailed/markCancelled`.

---

## 5. Observation interface shape (release_status enum)

New enum in `src/services/bos/types.js`:

```js
export const ReleaseStatus = {
  UNOBSERVED:        'unobserved',
  OBSERVED_PENDING:  'observed_pending',
  OBSERVED_CONFIRMED:'observed_confirmed',
  OBSERVED_FAILED:   'observed_failed',
};
```

Replaces the fabricated `releaseDestination()` + `getReleaseStatus()` pair with one observation method on the
**xReserve adapter seam** (the "status surface"):

```js
/**
 * Observe the external destination-release outcome for a disbursement.
 * Returns the CURRENT observation only — never manufactures a status.
 * Real adapter is UNVERIFIED (see §8): returns { release_status:'unobserved', source:'xreserve.unverified', evidence:null }.
 */
observeDestinationRelease({ disbursement_id, external_tx_id, attestation_id })
  => Promise<{ release_status: ReleaseStatus, source: string, evidence: Object|null, observed_at: string }>
```

Persistence: `migrations/007_sprint_2.sql` adds

```sql
ALTER TABLE disbursements
  ADD COLUMN IF NOT EXISTS release_status TEXT;
ALTER TABLE disbursements
  ADD CONSTRAINT disbursements_release_status_check
  CHECK (release_status IS NULL OR release_status IN
    ('unobserved','observed_pending','observed_confirmed','observed_failed'));
```

`release_status` is written by the observation actions and double-checked by the payout guard. (Column is a
deliberate, minimal audit trace; full evidence-chain storage stays in Sprint 4 scope.)

---

## 6. Mocked external-evidence source (test-only)

New file `test/helpers/mockExternalEvidence.js` — a **scripted-by-test, latched** double of the external
settlement process. Deterministic by construction: no randomness, no wall-clock, no consumption race.

```js
createMockEvidenceSource({ initial = 'unobserved' } = {})
  => {
    emit(disbursementId, release_status, evidence = null), // TEST pushes evidence; models "external settlement emitting evidence"
    observe({ disbursement_id }) => Promise<{ release_status, source, evidence, observed_at }>, // reads the latched value, records the call
    calls: { observe: [] },
  }
```

- `emit()` explicitly sets the current evidence per disbursement; `observe()` is a pure read that records
  the call. Repeated guards/actions reading the same value cannot advance or consume the script, so the
  "three guards + one action re-observe" pattern stays one deterministic outcome per tick.
- Default (never emitted) = `unobserved` → models "no external evidence yet" fail-closed.
- Wired into harness ctx as `adapters.xreserve.observeDestinationRelease` (replacing
  `releaseDestination`/`getReleaseStatus` in `createMockXReserve`, `test/helpers/mockAdapters.js`).
- Optionally `failOn(disbursementId, error)` for the "poll throws → stays parked" guard-rejection case.

The E2E lifecycle (`test/e2e/mock-lifecycle.e2e.test.js`) drives the corrected full lifecycle by emitting
`unobserved → observed_pending → observed_confirmed` and asserting `release_status` flips with the states,
`release_id` stays `null` (nothing fabricated), and `releaseDestination` is **never** called.

---

## 7. Per-file changes (implementation map)

| File | Change |
|---|---|
| `src/services/bos/types.js` | Add `ReleaseStatus`; add `DESTINATION_RELEASE_UNOBSERVED`; rename `DESTINATION_RELEASE_SUBMITTED` → `DESTINATION_RELEASE_OBSERVED`; fix header comment (15 states). |
| `src/services/bos/stateMachine.js` | New/renamed transitions per §4; add `release_status` to `PERSISTED_ACTION_FIELDS`; update header counts. |
| `src/services/bos/transitionActions.js` | Remove `submitDestinationRelease`; add `beginReleaseObservation`, `recordReleaseObservedPending`, `recordReleaseObservedFailed`, rebuilt `confirmDestinationRelease` (observes, writes `release_status`); keep `upsertExternalRef`/`getExternalRef` helpers. |
| `src/services/bos/transitionGuards.js` | Replace `isDestinationReleased` with `isReleaseObservedPending/Confirmed/Failed`; rebuild `destinationReleasedForPayout` to require fresh `observed_confirmed` **and** persisted `release_status='observed_confirmed'`. |
| `src/services/bos/xreserveAdapter.js` | Remove `releaseDestination` + `getReleaseStatus`; add `observeDestinationRelease` returning `{ release_status:'unobserved', source:'xreserve.unverified', evidence:null }` with an explicit `UNVERIFIED` comment. Update header. |
| `src/services/bos/bridgeAdapterFactory.js` | `_mockAdapter()` mirrors the new seam (`observeDestinationRelease`), no fabricated `confirmed`. |
| `src/services/bos/StacksAdapter.js` + `src/config/chainConfig.js` | G-09: add `// UNVERIFIED:` marker on the burn entrypoint; extract the burn target (`usdcx` token contract principal + `burn` function) into one small seam (`getBurnTarget()`) so a later `usdcx-v1` swap is a one-site change, not a redesign. |
| `src/services/bos/stuckStateReaper.js` | Add `destination_release_unobserved` to `STATE_SLA_MS` (proposal: 1_800_000 / 30 min — no evidence within SLA is an alarm) and rename the `destination_release_submitted` key → `destination_release_observed` (3_600_000 / 60 min, the old value). This is the **timeout → manual_review** mechanism (AC4). |
| `src/services/bos/monitoring/monitorJob.js` | `checkDestinationReleaseFailures` currently watches `status='attestation_confirmed'` (a state the corrected model no longer parks release-waiting rows in). Target the observation states (`IN ('destination_release_unobserved','destination_release_observed')`). **Flagged collateral — see §11.** |
| `src/services/bos/auditTimeline.js` | `STATE_LABELS`: rename the `destination_release_submitted` key, add `destination_release_unobserved` + `destination_release_observed` labels. |
| `src/services/bos/pipelineWorker.js` | Update the Step-3 comment block only. |
| `migrations/007_sprint_2.sql` | `release_status` column + CHECK (§5). |
| `README.md` | Lifecycle order + state count + release-status note. |
| `docs/PRODUCT_BASELINE.md` | §6 rewrite (observation model), §4 trace rows 6–7, claims. |
| `docs/CLAIMS_REGISTER.md` | Reclassify release claims SIMULATED → MODEL CORRECTED / UNVERIFIED EXTERNAL; drop the fabricated-release rows. |
| `docs/GAP_REGISTER.md` | G-08 → RESOLVED-IN-MODEL (external verification still UNVERIFIED); G-09 updated with named open item + status. |

---

## 8. G-09 burn entrypoint — documentation + seamless swap (no contract change)

- `StacksAdapter.burnUsdcx` gets the annotation `/* UNVERIFIED: burn broadcast targets the 'usdcx' token contract
  (USDCX_CONTRACT). Canonical docs describe the 'usdcx-v1' protocol entrypoint. Do not treat as verified without a
  testnet ABI check (G-09). */` and `chainConfig` marks `USDCX_CONTRACT` usage the same way.
- `getBurnTarget()` (in `StacksAdapter.js`) centralizes `{ contractAddress, contractName, functionName }` for the
  burn call so the corrected entrypoint drops in as a one-function change.
- `docs/GAP_REGISTER.md` G-09 gains a **named open item** (e.g. `G-09-OW-1: verify burn ABI on 'usdcx-v1', then swap
  via getBurnTarget()`) and stays UNVERIFIED-sprint-2.

---

## 9. Test files (create / update) and coverage

### New

| File | Cases |
|---|---|
| `test/helpers/mockExternalEvidence.js` | The evidence-source double (§6) + its 2 helper sanity tests (latched emit/observe; default unobserved; call recording). |
| `test/unit/release-observation.test.js` | Deterministic mocked tests for **every new transition**: `attestation_confirmed → unobserved` writes `release_status='unobserved'` and calls nothing; `observed_pending → still waiting` (advance rejected, state + status unchanged); `unobserved → observed` on pending; `unobserved → confirmed` on first evidence confirmed; `observed → confirmed`; `unobserved → failed` and `observed → failed` on observed_failed; fail-closed — `getValidNextStates`/guard never expose `yellowcard_payout_*` from `unobserved`/`observed`; payout guard rejects `destination_release_confirmed` rows whose persisted `release_status != observed_confirmed`. |
| `test/unit/release-observation-timeout.test.js` (or folded into the above) | **no-evidence timeout → manual_review**: seed a row in `destination_release_unobserved` with an old `last_heartbeat_at`, run `stuckStateReaper.reapOnce()` against FakeDb, assert the row moves to `manual_review` with `stuck_in_destination_release_unobserved_beyond_sla`. (Test-only reaper drive; deterministic, offline.) |

### Updated

| File | Change |
|---|---|
| `test/helpers/mockAdapters.js` | Replace `releaseDestination`/`getReleaseStatus` with `observeDestinationRelease`; wire a default `createMockEvidenceSource`; keep call recording. |
| `test/unit/harness.test.js` | "mock adapters: expose the exact methods…" — replace the `releaseDestination` assertion with `observeDestinationRelease` (unobserved default). |
| `test/unit/tx-id-persistence.test.js` | Release leg: rename/replace the `submitDestinationRelease persists release_id` subtest → observation actions persist `release_status`; the payout subtest seeds the evidence source `observed_confirmed` + row `release_status='observed_confirmed'`. |
| `test/e2e/mock-lifecycle.e2e.test.js` | Path becomes `… attestation_confirmed → unobserved → observed → confirmed → …`; drive evidence via `emit`; assert `release_status` persistence, `release_id` stays null, `releaseDestination` never called; existing G-01/G-04/G-05/G-06 assertions preserved. |
| `test/unit/duplicate-handling.test.js` | **Must still pass unchanged.** Verification: its legs (burn/attestation/payout) don't touch the release observations; case 7 concurrency is release-leg-agnostic. The harness row gains a `release_status` field (no behavioral change) only if an assertion needs it. |

Evidence in the Sprint 2 report: full suite output recorded; the **new** count reported (expect ≈ 69 + ~9–11 new
cases − 1 removed subtest; final number taken from the run, never invented).

---

## 10. Commit plan (one commit per logical fix, no pushes)

1. **`fix(g-08): observation-based destination release`** — types/stateMachine/guards/actions/adapters/migration
   (model correction: new + renamed states, transitions, adapter seam, `release_status` column).
2. **`fix(g-08): observe-unobservable timeout + monitoring/ops alignment`** — stuckStateReaper SLA keys, monitorJob
   query, auditTimeline labels, pipelineWorker/README comments (ops collateral keep the app consistent).
3. **`test(g-08): mocked external-evidence source + deterministic observation tests`** — helper + new unit tests +
   updated harness/e2e/tx-id-persistence tests.
4. **`chore(g-09): mark burn entrypoint UNVERIFIED + extract getBurnTarget seam`** — code markers + config seam.
5. **`docs: sprint 2 corrected settlement model`** — PRODUCT_BASELINE §6, CLAIMS_REGISTER, GAP_REGISTER,
   `docs/SPRINT_2_REPORT.md`.

Each commit keeps `npm test` green (69/68/0/1 baseline until commit 3 lands its additions).

---

## 11. Deviations from the Sprint 1.5 state, with reason

| # | Deviation | Reason |
|---|---|---|
| D1 | `destination_release_submitted` **renamed** to `destination_release_observed`; new state `destination_release_unobserved` added (15 states total). | The name asserted an app-controlled "submit release" action that is removed; the corrected model has two observation facts (no evidence / evidence-in-progress). Rename is requested/allowed by the prompt's "renamed or removed — justify" clause and is safe for TEXT status storage. |
| D2 | `releaseDestination()` and `getReleaseStatus()` **removed** from all adapters; replaced by `observeDestinationRelease` returning the 4-value `release_status`. | AC1: the fabricated `confirmed` return must go; a single observation method replaces the fiction without leaving a dead confirmed-returning path (no hint of it anywhere, including `BRIDGE_ADAPTER_ENV=mock`). |
| D3 | `release_id` is **no longer written** (stays NULL) and `submitDestinationRelease` disappears; `release_status` column records the observation instead. | `release_id` was the synthetic id of a removed fabricated call; persisting it would entrench the fiction. The tx-id-persistence test leg moves to `release_status` assertions (G-12 note updated). |
| D4 | Payout guard now re-observes **and** checks the persisted `release_status='observed_confirmed'`. | AC3 + fail-closed: state alone must not unlock money movement; the duck test is evidence-grounded. |
| D5 | **Reaper SLA map + monitorJob query** retarget the new observation states. | The old reaper key (`destination_release_submitted`) and the monitor query on `attestation_confirmed` describe a model that no longer exists; leaving them would silently monitor nothing. MonitorJob change is **flagged for reviewer** (defensible to defer to a monitoring sprint, but cheap to land now). |
| D6 | Test suite grows; the Sprint 1.5 duplicate-handling cases are preserved **unchanged** (only the shared harness row gains `release_status`). | Their legs (burn/attestation/payout/webhook) are untouched by this model correction. |

No D/E-classified work is implemented: evidence chain (Sprint 4), public API (Sprint 5), Yellow Card (Sprint 3),
real testnet/xReserve, and any provider-side adapter-key refactor remain out of scope.

---

## 12. What remains UNVERIFIED — explicit statement

- **The real external settlement surface (xReserve attestation service → off-chain USDC release to the
  destination EVM wallet).** No credentials, no testnet access; this sprint is a model correction only. The real
  `observeDestinationRelease` therefore returns `{ release_status: 'unobserved', source: 'xreserve.unverified',
  evidence: null }` — a fail-closed stub — and every downstream claim about release stays `UNVERIFIED` until a
  later, explicitly authorized verification-only sprint. **That is why** a real deployment's disbursements parked
  in `unobserved` will time out to `manual_review` by design.
- **The burn entrypoint (G-09):** `usdcx` token vs `usdcx-v1` protocol principal stays unverified; marked
  `UNVERIFIED` in code and GAP_REGISTER; the contract is **not** changed this sprint (needs a testnet ABI check).
- **The attestation leg** (`requestAttestation`/`getAttestationStatus` Hiro proxy): unchanged and still
  SIMULATED — outside Sprint 2 scope; not re-verified. This is explicit: the corrected model still **observes**
  release as an extension of the burn/attestation subject, but the release evidence surface itself exists only as
  the mock in tests.
- **Yellow Card leg:** untouched (Sprint 3). No change in its verification posture.
- **Whether `observed_failed` is even detectable on the real surface**: unknown; there is no verified endpoint or
  event that distinguishes "release failed" from "no information". The enum models it; the real adapter cannot yet
  produce it.
- **Timeout magnitudes** (`unobserved` 30 min, `observed` 60 min): placeholder SLA values, not measured from a real
  corridor. Re-tuned in the verification sprint from observed timing data.
- **The E2E mock lifecycle proves the state machine coerces evidence, not that external settlement behaves as the
  mock does.** Claimed as `MODEL CORRECTED / SIMULATED`; never `VERIFIED` or `SANDBOX VERIFIED`.

---

## 13. Gate checklist before Sprint 3 (map to prompt AC)

1. ✅ (planned) `releaseDestination()` no longer returns a fabricated `confirmed` — it no longer exists.
2. ✅ (planned) explicit `unobserved` state between attestation confirmation and release confirmation.
3. ✅ (planned) `destination_release_confirmed` reachable only on `observed_confirmed` (guard + persisted column).
4. ✅ (planned) timeout routes `unobserved` → `manual_review` via the reaper SLA map (tested via `reapOnce`).
5. ✅ (planned) G-09 documented + `UNVERIFIED` markers + `getBurnTarget()` seam; GAP open item.
6. ✅ (planned) deterministic mocked tests for every new state/transition (`release-observation.test.js`).
7. ✅ (planned) E2E mock lifecycle demonstrates the corrected model end-to-end.
8. ✅ (planned) all Sprint 0.5/1.5 tests still pass (target: 69/68/0/1 baseline + new additions, run via `npm test`).
9. ✅ (planned) three baseline docs updated.
10. ✅ (planned) no external network calls anywhere affected by this sprint (all tests offline; real adapter is a stub).
11. ✅ (planned) no new runtime npm dependencies (`package.json` untouched).
12. ✅ (planned) no CineX files modified; no pushes.

**STOP — plan ends here. Produced for review; nothing has been implemented, no source file was modified, and
the baseline suite (69/68/0/1) was merely observed. No external network call was made. No commit was created.**