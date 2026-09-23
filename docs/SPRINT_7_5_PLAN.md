# Sprint 7.5 Plan — External Integrator Example

> Task: `docs/prompts/00_MASTER.md` sprint brief "SPRINT 7.5 — EXTERNAL INTEGRATOR EXAMPLE".
> Status: **PLAN ONLY — awaiting review. No implementation performed.**
> Baseline (verified this session): `npm test` → **184 tests, 183 pass, 0 fail, 1 skip**
> (1 skip = the Postgres-gated integration test `test/integration/disbursement-create.pg.test.js`).
> Working tree: clean (`git status --porcelain` empty; HEAD `e950c98`).
> Constraints honored so far: plan-first, no code, no commits, no network, no deps, no `src/` changes.

---

## 0. What this sprint ships

A small marketplace-seller integration example that shows how another Stacks application
uses the v1 public disbursement API. It ships three things:

1. `examples/external-integrator/client.js` — a marketplace-style client that pays a seller:
   happy path (create → advance to settled → receipt), idempotent re-create, and the two error
   paths (missing bank field → 400; unauthorized → 401). Zero-dependency, Node ≥18 global `fetch`.
2. `examples/external-integrator/README.md` — a five-minute walkthrough for an external developer.
3. A test, `test/unit/examples-external-integrator.test.js`, that runs the example end-to-end
   against mocked infrastructure (FakeDb + mock adapters), no network — the established pattern
   of `examples-client.test.js`.

Scope out (unchanged from brief): any change to `src/`, `migrations/`, the root `package.json`,
the v1 API, any new runtime dependency, any documentation outside
`examples/external-integrator/` (the mandated `docs/SPRINT_7_5_PLAN.md` is explicitly
authorized by the brief itself), and any modification of the existing test suite.

Change-control classification: **A** (required for current sprint).

---

## 1. Inspection findings (verified, not assumed)

### 1.1 The integration surface (what the example consumes)

| Fact | Verified source |
|---|---|
| v1 router = `POST /api/v1/disbursements`, `POST /:id/advance?steps=n`, `GET /:id/receipt`, bearer-auth fail-closed via `requireApiToken(…, { normalize: true })` | `src/routes/disbursementsV1.js` |
| Create runs preflight at request time (`initiated → preflight_check`); row starts at `preflight_check` | e2e lifecycle test `assertFullLifecycle` + `createV1Store` |
| 10 advances carry `preflight_check → … → settled` (11 canonical transition records incl. the create hop) | `test/e2e/mock-lifecycle.e2e.test.js` `TRANSITION_HOPS = 11` |
| Idempotency: deterministic key over `source_reference·source_application·amount_usdcx·recipient_bank_account`; duplicate create returns the existing row, no second INSERT | `disbursementService.js:53-63,177-206`; `test/unit/public-api-idempotency.test.js` |
| Missing `recipient_bank_account`/`recipient_bank_code` → 400, `error_code = missing_recipient_bank_details`, `details.missing[]` | `disbursementService.js:150`; `examples-client.test.js` |
| Wrong/missing token → 401 `unauthorized` (fail-closed, no default token) | `docs/INTEGRATION.md §2-3` |
| ATM/attestation/payout chain must all resolve before `settled`; receipt reconstructable from persisted refs+evidence | e2e `assertFullLifecycle` receipt block |

### 1.2 The release-leg honesty model (the tricky bit for "advance to settled")

G-08 is enforced in production code — the layer must **observe**, never fabricate a release:

- `destination_release_unobserved → observed` guard accepts `observed_pending` / `observed_confirmed` /
  `observed_failed` from a **fresh** observation (`transitionGuards.js:88-98`).
- `observed → confirmed` guard and the payout re-affirmation require a **fresh** `observed_confirmed`
  at transition time; the persisted `release_status` alone can never unlock them
  (`transitionGuards.js:105-122,142-151`).
- The default mock adapter returns `unobserved` fail-closed (`mockAdapters.js:75-79`); the approved
  way to inject evidence in a test is a **latched mock settlement surface** wired into
  `observeDestinationRelease`, scripted with `emit(id, status)` (`test/helpers/mockExternalEvidence.js`,
  used by the e2e lifecycle test).

Consequence: "advance to settled" cannot come from a single mock that always says *confirmed*. The
harness must emulate the settlement surface reporting **pending** while the row is on the release
leg and **confirmed** once it progresses — matching the e2e's scripted `emit('observed_pending') →
advance → emit('observed_confirmed') → advance` sequence in a stateful, deterministic way.

### 1.3 Why the existing `createV1Store` alone cannot reach `settled`

`createV1Store` (`test/helpers/v1Api.js`) only ever drives to `manual_review` — its FakeDb misses
the **payout-gate seeds** (escrow sufficiency, `total_disbursed`, `total_funded`) that make preflight
pass, the **attestation `confirmed`** override, the **latched release evidence**, and the
**receipt reconstruction** handlers. The full seed set is proven in
`test/e2e/mock-lifecycle.e2e.test.js:buildHarness()` and will be mirrored (not duplicated blindly —
composed against the HTTP seam).

### 1.4 Precedents this sprint follows

- `test/unit/examples-client.test.js` — boots the real v1 router on an ephemeral loopback listener
  (`listen(0)`, no external network), points the example client at it via `PAYOUT_API_BASE_URL` /
  `BOS_API_TOKEN`, drives the example's **exports** and its `main()`, captures the transcript.
- `examples/simple-payout-client/` — package.json shape: `type: module`, zero dependencies,
  `"start": "node client.js"`.

---

## 2. Design decisions

### D1 — The example client is two layers: a pure client + a demo driver

`client.js` exports fetch-only functions (what an integrator copies) and a demo `main()`:

- `createPayout(body)` → `POST /api/v1/disbursements` (idempotent)
- `advancePayout(id, steps)` → `POST /:id/advance?steps=n`
- `getReceipt(id)` → `GET /:id/receipt`
- `getPayout(id)` → `GET /:id` (single row read; used to show the row view)
- `paySeller({ orderRef, amountUsd, amountUsdcx, sellerAccount, sellerBankCode, creatorAddress })`
  → create → advance one step at a time until terminal (cap 15) → receipt; returns
  `{ disbursement, states, receipt }`. To a real integrator, "waiting for release evidence"
  arrives asynchronously (provider webhook / observation); here the demo harness emulates that.
- `main()` demo sequence (must exit `0`):
  1. **Happy path** — `paySeller(...)` → print payout id, each landed state, receipt
     (`final_status === "settled"`, NGN amount, `gaps`).
  2. **Idempotency** — re-`createPayout` with the identical body → print that the returned
     `disbursement.id` equals the first (same disbursement, no second row).
  3. **Missing bank field** — create with empty `recipient_bank_account`/`recipient_bank_code` →
     catch `ApiError`, print `400 missing_recipient_bank_details`.
  4. **Unauthorized** — same call with a wrong token → print `401 unauthorized`.
  - Non-zero exit on any unexpected failure or if the payout never reaches `settled`.

`ApiError` carries `.status`, `.error_code`, `.details` (same shape as `simple-payout-client/client.js`).

### D2 — Single-command runnability: `npm start` in the example directory

The example must be runnable via a single command with zero external standing state. So `main()`
boots an **in-process loopback demo harness** when `PAYOUT_API_BASE_URL` is not set, then runs the
demo against it, then closes it. When `PAYOUT_API_BASE_URL` **is** set, `main()` skips the harness
entirely and behaves exactly like the real-world integration path (plain HTTP to your instance).

> **Open decision for review (D2a):** bootstrapping the harness needs a fourth file,
> `examples/external-integrator/harness.js` (repo-only, demo-only, clearly labeled in the README;
> never copied into a real app). Files would then be `client.js`, `harness.js`, `README.md`,
> `package.json`. The alternative is the **strict-3-file** option where `client.js` contains the
> same bootstrap inline (or where `npm start` requires a separately-started server). **Recommended:
> the 4-file variant** — it keeps the copy-paste client pure and makes "one command" literally true.

### D3 — Harness composition (FakeDb + mock adapters; mirrors e2e seeds)

`harness.js` builds, in this order (FakeDb dispatches first-match-wins):

1. **Receipt-reconstruction handlers first** — materialize `external_refs` (INSERT replay with
   JSONB-merge) and `disbursement_evidence` from `db.calls`; snapshots/on-chain/webhook tables →
   `[]`. Must be registered **before** the guard-prefix handlers so the receipt's `ORDER BY` variant
   wins (same ordering note as `mock-lifecycle.e2e.test.js:161-166`).
2. **Guard/action ref mirror** — deterministic mock ids (`xreserve|attestation_id` →
   `att-mock-1`, `yellowcard|payout_id` → `yc-mock-1`) for the `SELECT * FROM external_refs WHERE
   disbursement_id = $1` guard lookups (e2e precedent `mock-lifecycle.e2e.test.js:175-180`).
3. **Payout-gate seeds** — escrow `SELECT d.id …` → `{ id: 'd-escrow' }`, `total_disbursed` → 0,
   `total_funded` → the demo `amount_usdcx`; amount uses **25 USD** (below the 2-of-N USD 1,000
   threshold → no approval gate). Recipient registry: `permissive` (default ctx).
4. **`createV1Store(db)`** — create/read/status/idempotency/list handling (unchanged helper).
5. **Adapter overrides on mocked adapters** — `xreserve.getAttestationStatus` → `status:
   'confirmed'`; `xreserve.observeDestinationRelease` → a **stateful evidence simulator**:
   reads the live row via the store and returns `observed_pending` while the row is still on the
   release leg, `observed_confirmed` once it has progressed past
   `destination_release_unobserved`. This emulates a settlement surface reporting pending → confirmed
   deterministically (no fabricated row writes; the guard still demands fresh `observed_confirmed`).
6. `init(ctx)` (service init against the harness ctx), `makeV1App()` + `listen(0)`.

The **test** imports `bootDemoHarness()` from `harness.js` so the e2e-style test shares the exact
infrastructure the demo prints; the test keeps its own assertions (INSERT counts, receipt contents).

### D4 — Test seams (TDD: pre-agreed)

- **Seam 1 — HTTP client-boundary (primary):** the example's exported functions (`createPayout`,
  `advancePayout`, `getReceipt`, `paySeller`) exercised against the real v1 router mounted on an
  ephemeral loopback listener with FakeDb + mock adapters. This is the identical seam established
  (and already agreed) by `examples-client.test.js`.
- **Seam 2 — demo driver (transcript):** `main()` returns exit code `0` and a captured console
  transcript matches expected markers (payout id, `settled`, receipt fields, idempotent same-id,
  `400 missing_recipient_bank_details`, `401 unauthorized`).

No test reaches into private internals; assertions are on HTTP responses / return values /
FakeDb recorded calls (a public seam of FakeDb, already used repo-wide).

---

## 3. Files to create

```
examples/external-integrator/
  client.js          — pure zero-dep client + marketplace demo main() (D1; D2 dynamic harness import)
  harness.js         — in-process mocked demo server: FakeDb + mock adapters + gate seeds + receipt
                       reconstruction + evidence simulator → { base, close, store, db } (D3)
  README.md          — five-minute walkthrough (D5)
  package.json       — { name, type: module, private, engines: node>=18, scripts: { start } }, NO deps
test/unit/examples-external-integrator.test.js
                       — e2e-style test over the example exports + main() transcript (D4)
docs/SPRINT_7_5_PLAN.md  — this plan (authorized by the brief)
```

No changes to: `src/`, `migrations/`, root `package.json`, any existing test/helper, any other doc,
`.env.example`, scripts.

### D5 — README structure (five-minute, stranger-followable)

1. What this is — a marketplace that pays a seller through Payout Rail's v1 API; what the demo
   proves (happy path, idempotency, error handling).
2. Prerequisites — Node ≥18; one-time `npm install` at the repo root (so `express` is resolvable
   from the example); nothing else.
3. **One command — `cd examples/external-integrator && npm start`** → boots the loopback mock,
   prints the transcript, exits 0. No network, no live credentials, no real funds (explicitly
   labeled demo/mock posture — no production/sandbox claims).
4. Pointing at your own instance — `PAYOUT_API_BASE_URL` + `BOS_API_TOKEN` env vars; then
   `npm start` uses the real HTTP path (harness skipped).
5. Translating the transcript to your app — the three API calls, the advance loop, the receipt,
   plus the release-evidence note (in production, evidence arrives from your own settlement
   surface/webhook; the demo emulates it).
6. Idempotency & error handling contract summary (same table as `docs/INTEGRATION.md §2`, kept
   local so the example is self-contained).
7. Sample transcript (stable markers only; captured from the mocked test at report time).

---

## 4. Test plan (TDD order — vertical slices, one test → one implementation)

Implementation follows red→green, one slice at a time. Expected `npm test` trajectory stays
**non-red on the existing 183**; only the new file adds tests.

| # | Slice (red first) | What "green" requires |
|---|---|---|
| 1 | `createPayout` returns 201 + `status preflight_check` over the harness | minimal client + harness boot path |
| 2 | `paySeller` reaches `settled` after the advance loop | gate seeds + attestation `confirmed` + evidence simulator (D3) |
| 3 | `getReceipt` → `final_status "settled"`, complete receipt (`gaps: []`) | receipt-reconstruction handlers ordered (D3.1) |
| 4 | idempotent re-create returns the **same** `disbursement.id`; **exactly one** `INSERT INTO disbursements` recorded | client re-POST identical body; assert via `db.countMatching(/^INSERT INTO disbursements/) === 1` |
| 5 | missing bank fields → `ApiError` 400 `missing_recipient_bank_details`; unauthorized → `ApiError` 401 `unauthorized` | error plumbing in client |
| 6 | `main()` returns `0`, transcript matches settled/idempotent/400/401 markers | demo driver + harness auto-boot |
| 7 | Regression gate: full `npm test` → 183 existing pass, 0 fail, 1 skip; new subtests pass | — |
| 8 | README + sample transcript finalized; `npm start` from the example dir exits 0 (single command) | documentation phase |

Baseline expectation post-sprint: **184 + (new subtest count) tests, 0 fail, 1 skip** — the brief's
`184/183/0/1` remains the untouched baseline, count only grows inside the new file's `t.test`s.

---

## 5. Acceptance criteria (testable)

1. `examples/external-integrator/` exists with `client.js`, `README.md`, `package.json` (+
   `harness.js` under decision D2a); `src/`, `migrations/`, root `package.json`, and every existing
   test/helper/doc are byte-identical to HEAD (verified via `git status`/`git diff`).
2. The new test drives the example to `settled` and a receipt with `final_status === "settled"`
   (and, per slice 3, `gaps: []`) — through the example's own exports, over the loopback listener.
3. Idempotency: identical second `createPayout` returns the same id; FakeDb records **exactly
   one** disbursement INSERT for the whole happy+idempotency run.
4. Missing bank fields → `ApiError` with `status 400`, `error_code
   'missing_recipient_bank_details'`, `details.missing[]` non-empty; bad token → `ApiError`
   `status 401`, `error_code 'unauthorized'`.
5. `main()` returns `0` and the transcript shows: landed states ending at `settled`, receipt
   summary, idempotent same-id note, both normalized error paths, `demo complete`.
6. Single command: `cd examples/external-integrator && npm start` runs the demo to exit 0 with
   no env vars set (loopback harness auto-boot); no external network beyond the ephemeral
   `listen(0)` listener (harness binds `127.0.0.1:0`).
7. No new runtime dependencies anywhere (root `package.json` untouched; example `package.json`
   declares zero dependencies).
8. README is self-contained for a stranger: prereqs → one command → expected output → real
   deployment path, and labels itself demo/mock (no production/sandbox/provider claims — masters
   principles #4, #15, #16).
9. Full regression: `npm test` → 183 existing pass unchanged, 0 fail, 1 skip (baseline preserved);
   new subtests pass.

---

## 6. Evidence to record (in the sprint report, post-implementation)

- Baseline and post `npm test` summary lines verbatim.
- The captured demo transcript (`console.log` of the mocked main() run) for the README sample.
- `git diff`/`git status` proof that `src/`, `migrations/`, root `package.json` were untouched.
- FakeDb recorded-call counts backing AC3 (single disbursement INSERT) and the receipt gaps.

---

## 7. Risks / open items for review

- **R1 (decision D2a):** harness.js as a 4th example file. Recommended; 3-file alternative
  documented. Approaches to error-handle if "with:" list is read as exhaustive: fold bootstrap into
  `client.js`.
- **R2:** the stateful evidence simulator (D3.5) is the one bespoke piece of mock logic. It is
  derived 1:1 from the guard requirements (`transitionGuards.js:92-151`) and the e2e's scripted
  emit sequence; if red→green reveals a different guard sequencing, this slice is adjusted **in the
  test file only**, never in `src/`.
- **R3:** guard/action external-ref lookups may consult refs with deterministic mock ids
  (`att-mock-1`, `yc-mock-1`). Mirrored statically per the e2e precedent; any divergence surfaces in
  slice 2 and is fixed at the harness layer only.
- **R4:** the example's README must stay within `examples/external-integrator/`; `docs/INTEGRATION.md`
  and the root README are **not** updated this sprint (explicit scope-out). Flagged in case the
  reviewer wants a follow-up doc cross-link.

---

## 8. Commit strategy

Per the brief's "one commit per logical fix", proposed (only after review approval):

1. `examples/external-integrator/` (client.js + harness.js + README.md + package.json) — one commit.
2. `test/unit/examples-external-integrator.test.js` + `docs/SPRINT_7_5_PLAN.md` — one commit.

No push to any remote. Alternative (single commit for the whole example+test unit) available on
request.

---

## 9. What happens next

**STOP — awaiting review.** On approval: implement slices 1→8 in TDD order, run the full regression
gate, capture evidence, update only `examples/external-integrator/` docs, then report per masters
PHASE 7. No implementation has been performed; the working tree is clean at `e950c98`.