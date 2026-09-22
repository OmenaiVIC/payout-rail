# Sprint 5 Report

Public disbursement API (`/api/v1/disbursements/*`) + runnable example client.

Planned: `docs/SPRINT_5_PLAN.md` (committed in `1ec6166`).

## Commits

All commits from `76b6c32` (5a-1) through `69d6143` (5b-4), on `main`, in order:

| # | Hash (short) | Message |
|---|---|---|
| 1 | `76b6c3268a` | feat: versioned v1 disbursements router + auth normalization |
| 2 | `e27f582bd4` | feat: public service functions (approve / resolve / receipt) + resolvedBy param |
| 3 | `87fc2788d7` | test: v1 routes (create/get/list/advance/retry/recover) |
| 4 | `0f144fd60d` | test: v1 approve + resolve route contract (manual review) |
| 5 | `d363dacf7c` | test: v1 receipt route (generator unmodified, 404 not 500, reads only, fact not fabrication) |
| 6 | `2d0f6afb60` | test: v1 fail-closed auth + idempotent create contract |
| 7 | `1ec6166752` | docs: commit Sprint 5 plan, RBAC P2 backlog entry, and v1 external-dev README (v0 + v1 error shapes) |
| 8 | `590d601f2f` | feat: example client (zero-deps create / advance / receipt / error demo) |
| 9 | `8739b22f29` | fix: example client reads base URL per call and guards main() with pathToFileURL |
| 10 | `7e74aa9dce` | test: example client end-to-end against mocked infra (create / advance / receipt / errors) |
| 11 | `69d6143ca3` | docs: capture mocked-run transcript into example client and v1 README sections |

Relevant files landed by this sprint:

- `src/routes/disbursementsV1.js` — v1 router (9 endpoints: create, list, get,
  receipt, advance, retry, recover, approve, resolve)
- `src/middleware/requireApiToken.js` — fail-closed constant-time bearer check
  (`normalize: true`, means v1 error bodies lack their pre-normalized `details`)
- `src/services/bos/disbursementService.js` — `approveDisbursement`,
  `resolveDisbursement`, `getSettlementReceipt`, `RESOLUTION_TARGETS`,
  `notFoundError` (service untouched otherwise)
- `src/services/bos/transitionActions.js` — `resolveManualReview({ … resolvedBy = 'workflow' })`
- `src/services/bos/settlementReceipt.js` — untouched (receipt "fact not fabrication")
- `src/routes/index.js`, `src/app.js` — mount v1 before v0
- Scaffold + test suite for the versioned surface (see *Tests*)
- `examples/simple-payout-client/` — `README.md`, `package.json`, `client.js` (zero deps)
- `test/unit/examples-client.test.js`
- `README.md` — v1 section: auth, endpoint table, curls, normalized error table,
  v0-vs-v1 shape table, idempotency contract, actor-model note, v0 deprecation
  caveat, example-client pointer
- `docs/POSTPONED_BACKLOG.md` — RBAC-1 (P2) operator-identity backlog entry

## Tests

Final run of the full suite (after 5b):

```
ℹ tests 153
ℹ suites 12
ℹ pass 152
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 14497.1275
```

1 skip = Postgres integration store, gated on `TEST_DATABASE_URL`
(`test/integration/*`). Baseline before Sprint 5 was `112/111/0/1`. The suite was
green after **every** commit; `npm test` = `node --test --test-concurrency=1 "test/**/*.test.js"`.

New test files: `.unit-public-api` covers routes / auth / idempotency / receipt via
`test/helpers/v1Api.js` (create → get → list → advance → retry → recover → approve → resolve → receipt,
fail-closed auth, idempotency contract) — 37 subtests; plus the example-client E2E (4 subtests).

## Example client — actual run output

The example client (`examples/simple-payout-client/`) was run by
`test/unit/examples-client.test.js` against the **mocked** infrastructure
(FakeDb + mock adapters + in-process v1 router on an ephemeral listener). It
makes no external network calls and uses no credentials. Transcript (verbatim;
volatile values elided here with `…`):

```
simple-payout-client demo
base: http://127.0.0.1:63903

create       {"id":"2fecff56-…","status":"preflight_check"}
idempotency_key disbursement:7f13ec69…
advance      {"success":true,"new_state":"manual_review"}
receipt      {"final_status":"manual_review","gaps":4}

error path: GET receipt for an unknown id
  -> 404 not_found — Disbursement not found: 00000000-0000-0000-0000-000000000000
error path: request with a wrong token
  -> 401 unauthorized — unauthorized

demo complete
```

`gaps: 4` is the honest receipts behavior: a freshly created row has no burn /
attestation / release / payout evidence, so the receipt lists those gaps rather
than fabricating completion.

## Deviations from the plan

1. **Approve/resolve/receipt routes folded into commit 2 (`e27f582bd4`).** The
   plan staged them as a later commit; ESM named imports of `approveDisbursement`
   / `resolveDisbursement` / `getSettlementReceipt` would have broken commit 1's
   green state, so they rode in with the service functions. **Accepted by the
   user** at the end of 5a.
2. **Example client `test` script is `node --check client.js`**, not
   `node --test`: no test files live in `examples/simple-payout-client/` (the
   E2E coverage is repo-level `test/unit/examples-client.test.js`), and bare
   `node --test` would exit 1 with "no test files found". `--check` is a syntax
   smoke so `npm test` in the example dir is not broken.
3. **401 error path demonstrated by `main()`'s internal wrong-token request,**
   not an exported call. The client reads `BOS_API_TOKEN` from the same env var
   the server enforces, both in one process, so a mismatched-token call through
   the exported functions was not producible; route-level 401 stays covered by
   `public-api-auth.test.js`, and the client transcript proves its own ApiError
   rendering of a 401 end-to-end.
4. **Three 5b commits instead of four.** The plan's step 10 (README transcript)
   and step 8's client README were completed together in `69d6143ca3` (the
   transcript depends on the test harness from steps 9-10); a separate
   intermediate docs commit would have contained a fabricated transcript that
   contradicted the later real one. Steps 8, 9, 10, 11 from the plan covered by
   commits 8, 9, 10, 11 above.

## Confirmations

- **CineX untouched.** No diff touching any "CineX"-prefixed path; `npm start`
  and all core-service behavior unchanged.
- **No new runtime dependencies.** `package.json` is byte-identical across all
  11 commits (`git diff 76b6c32^ HEAD -- package.json` is empty). The example
  client uses Node ≥18 global `fetch` — zero deps.
- **No external network calls, no pushes.** All tests run against mocked
  adapters / FakeDb / an ephemeral loopback listener (the only "network" is
  client ↔ in-process server on 127.0.0.1). No commit was pushed to any remote.

## Backlog honored

- RBAC/operator identity recorded as **RBAC-1 (P2)** in
  `docs/POSTPONED_BACKLOG.md` ("Sprint 5 additions"); the README actor-model note
  documents the single-shared-token state so integrations are not surprised.
- TDD sweep, Sprint 2 retry/recovery, and Sprint 3 remain untouched and future.

## How to reproduce

```bash
npm test                                   # full suite (153/152/0/1)
node --test test/unit/examples-client.test.js && node --check examples/simple-payout-client/client.js
BOS_API_TOKEN=<token> npm start             # real server
cd examples/simple-payout-client && BOS_API_TOKEN=<token> npm start   # example against it
```