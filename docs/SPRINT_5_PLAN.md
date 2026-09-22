# Sprint 5 Plan — Public Integration Interface

> Task: `docs/prompts/07_SPRINT_5_PUBLIC_INTERFACE.md` (plan-first)
> Status: **PLAN ONLY — awaiting review. No implementation performed.**
> Baseline: Sprint 4 state, suite `112/111/0/1` (1 skip = Postgres-gated integration test).
> Constraints honored: no source changes yet, no commits, no network, no new runtime deps, no CineX edits.

---

## 1. Overview

Sprint 5 turns the system into something another Stacks application can integrate
against. It adds a versioned public API under `/api/v1/disbursements/*` (the Sprint
0.5 routes under `/api/disbursements/*` stay intact and keep working), documents
request/response/error schemas for every endpoint, formalizes the authentication
boundary (Option C: single shared `BOS_API_TOKEN`, fail-closed), documents the
idempotency-key contract for external callers, adds three new endpoints
(`approve`, `resolve`, `receipt`), ships a runnable example client, and documents
everything in the README.

Scope out (per prompt): RBAC (deferred to backlog P2), real external services,
Sprint 3 Yellow Card work, Sprint 6 demo, multi-corridor, any state-machine change,
any evidence-chain (Sprint 4) change.

---

## 2. Endpoint list (exact)

All under base path `/api/v1/disbursements`. Every route requires
`Authorization: Bearer <BOS_API_TOKEN>`.

| # | Method | Path | Purpose | Status codes |
|---|--------|------|---------|--------------|
| 1 | `POST` | `/api/v1/disbursements` | Create a disbursement (runs first transition to `preflight_check`) | 201, 400, 401 |
| 2 | `GET` | `/api/v1/disbursements/:id` | Fetch one disbursement with `external_refs` + `audit_log` | 200, 404, 401 |
| 3 | `GET` | `/api/v1/disbursements` | List (bounded, paginated; filters `status`, `source_reference`, `source_application`) | 200, 401 |
| 4 | `POST` | `/api/v1/disbursements/:id/advance?steps=n` | Advance one step (`n` optional, 1–25, default 1) | 200, 404, 409, 401 |
| 5 | `POST` | `/api/v1/disbursements/:id/retry` | Retry a `failed` disbursement within budget | 200, 404, 409, 401 |
| 6 | `POST` | `/api/v1/disbursements/:id/recover` | Escalate a stuck disbursement to `manual_review` | 200, 404, 409, 401 |
| 7 | `POST` | `/api/v1/disbursements/:id/approve` | Two-person approval contribution (gated by shared token) | 200, 400, 404, 401 |
| 8 | `POST` | `/api/v1/disbursements/:id/resolve` | Resolve a `manual_review` disbursement to a terminal state | 200, 400, 404, 409, 401 |
| 9 | `GET` | `/api/v1/disbursements/:id/receipt` | Settlement receipt (Sprint 4 generator) | 200, 404, 401 |

Routing note: `GET /:id/receipt` is a distinct path-depth from `GET /:id` — no
ordering hazard in Express. The v1 router is mounted in `src/index.js` at
`/api/v1/disbursements` (a one-line addition beside the existing mounts).

Success payloads for `advance` / `retry` / `recover` return
`{ result, disbursement }` mirroring the Sprint 0.5 routes (deviation 4 explains
the normalized 409 body).

---

## 3. Schemas (named types)

The public type vocabulary. JSON over HTTPS. All monetary amounts are integers in
base units (USDCx 6 decimals; NGN minor units) or NUMERIC decimals as marked.

### 3.1 Common types

```ts
type ErrorCode =
  | 'unauthorized'                      // 401 — bad/missing token, or token unset & dev hatch off
  | 'not_found'                         // 404 — no such disbursement
  | 'missing_recipient_bank_details'    // 400 — create without pay-out destination
  | 'missing_exchange_rate'             // 400 — create rejected, no USDCx/NGN rate on file
  | 'invalid_body'                      // 400 — required field missing / unknown enum value
  | 'advance_conflict'                  // 409 — cannot advance (terminal / guard rejects)
  | 'retry_conflict'                    // 409 — not `failed` or retry budget exhausted
  | 'recover_conflict'                  // 409 — not recoverable
  | 'wrong_state'                       // 409 — resolve called on a non-`manual_review` row
  | 'internal'                          // 500 — unhandled

type ErrorResponse = {
  error: string;        // human-readable message
  error_code: ErrorCode;
  details?: object;     // optional machine-readable context (e.g. { missing: string[] })
};

type ExternalRef = {
  external_system: 'stacks' | 'xreserve' | 'yellowcard';
  identifier_type: string;   // 'tx_id' | 'attestation_id' | 'release_id' | 'payout_id'
  identifier_value: string;
  metadata: object;
  created_at: string;        // ISO-8601
  updated_at: string;        // ISO-8601
};

type AuditEvent = {
  action: string;            // e.g. 'disbursement_created', state transition names
  old_status: string | null;
  new_status: string | null;
  triggered_by: string;      // 'worker' | 'api' | 'webhook' | 'operator'
  reason?: string;
  details?: object;
  metadata?: object;
  created_at: string;
};

type Disbursement = {
  id: string;                        // UUID
  idempotency_key: string;           // deterministic (see §7)
  source_reference: string;
  source_application: string;
  amount_usd: number | null;         // NUMERIC(12,6)
  amount_usdcx: number;              // base units (integer)
  amount_ngn_expected: number | null;
  exchange_rate: number | null;
  creator_address: string;
  creator_btc_address: string | null;
  recipient_bank_account: string;
  recipient_bank_code: string;
  status: string;                    // one of the 15 state names (e.g. 'preflight_check')
  external_tx_id: string | null;
  error_message: string | null;
  last_error: string | null;
  retry_count: number;
  max_retries: number;
  release_status: string | null;     // gated observation field (G-08)
  metadata: object;
  settled_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  manual_review_at: string | null;
  created_at: string;
  updated_at: string;
};

type EnrichedDisbursement = Disbursement & {
  external_refs: ExternalRef[];
  audit_log: AuditEvent[];
};

type TransitionResult = {
  success: boolean;
  new_state: string | null;
  error?: string;
  error_code?: string;
  details?: object;
};
```

### 3.2 POST `/api/v1/disbursements` (create)

```ts
// Request body
type CreateDisbursementRequest = {
  source_reference: string;          // REQUIRED — originating payout reference
  source_application?: string;       // default 'campaign'
  amount_usd?: number;               // stable USD value
  amount_usdcx: number;              // REQUIRED — base units (6 dp)
  creator_address: string;           // REQUIRED — recipient Stacks address
  creator_btc_address?: string;      // BTC address for xReserve release
  recipient_bank_account: string;    // REQUIRED — NGN pay-out account number
  recipient_bank_code: string;       // REQUIRED — NGN bank code
  ngn_recipient?: {                  // Yellow Card recipient details
    account_number?: string;
    bank_code?: string;
    [k: string]: unknown;
  };
  metadata?: object;                 // arbitrary JSONB
};

// 201 — created, OR idempotent replay returning the existing row (§7)
type CreateDisbursementResponse = { disbursement: Disbursement };

// 400 — invalid_body / missing_recipient_bank_details / missing_exchange_rate
type CreateDisbursementErrors =
  | ErrorResponse  // error_code: 'missing_recipient_bank_details', details: { missing: string[] }
  | ErrorResponse  // error_code: 'missing_exchange_rate',     details: { rate, pair }
  | ErrorResponse  // error_code: 'invalid_body'
  | ErrorResponse; // error_code: 'unauthorized'
```

Behaviors mirrored from `initiateDisbursement` (`src/services/bos/disbursementService.js:113`):
rejects missing `recipient_bank_account`/`recipient_bank_code` (fail closed),
rejects when no valid `USDCx/NGN` exchange rate is on file (fail closed), inserts,
emits `disbursement_created` audit event, executes the first transition
`disbursement_initiated → preflight_check`. Response carries the resulting row.

### 3.3 GET `/api/v1/disbursements/:id` (get)

```ts
// 200
type GetDisbursementResponse = { disbursement: EnrichedDisbursement };

// 404 / 401
type GetDisbursementErrors = ErrorResponse;  // error_code: 'not_found' | 'unauthorized'
```

### 3.4 GET `/api/v1/disbursements` (list)

```ts
// Query params (all optional): status, source_reference, source_application,
// limit (int, default 50, clamped 1..200), offset (int, default 0)

// 200
type ListDisbursementsResponse = {
  disbursements: Disbursement[];   // bounded — never unbounded
  total: number;                   // total rows matching filters
};

// 401
type ListDisbursementsErrors = ErrorResponse;
```

Mirrors `listDisbursements` (`disbursementService.js:397` → `{ disbursements, total }`).

### 3.5 POST `/api/v1/disbursements/:id/advance?steps=n` (advance)

```ts
// Query: steps — int, default 1, clamped 1..MAX_ADVANCE_STEPS (25). No body.
// The route pre-checks existence (404), then advances up to N steps, stopping on
// the first failed step exactly like the Sprint 0.5 route.

// 200
type AdvanceResponse = { result: TransitionResult; disbursement: Disbursement };

// 409 — a step could not run (terminal state / guard rejected). Body is a
// normalized ErrorResponse (§4 deviations); error_code from
// result.error_code ?? 'advance_conflict'.
type AdvanceErrors = ErrorResponse;  // 'not_found' | 'advance_conflict' | 'unauthorized'
```

### 3.6 POST `/api/v1/disbursements/:id/retry` (retry)

```ts
// 200
type RetryResponse = { result: TransitionResult; disbursement: Disbursement };

// 409 — result.success === false (not `failed`, or retry budget exhausted)
type RetryErrors = ErrorResponse;    // 'not_found' | 'retry_conflict' | 'unauthorized'
```

### 3.7 POST `/api/v1/disbursements/:id/recover` (recover)

```ts
// Request body
type RecoverRequest = { reason?: string };   // default 'stuck'

// 200
type RecoverResponse = { result: TransitionResult; disbursement: Disbursement };

// 409 — result.success === false (not stuck / not recoverable)
type RecoverErrors = ErrorResponse;   // 'not_found' | 'recover_conflict' | 'unauthorized'
```

### 3.8 POST `/api/v1/disbursements/:id/approve` (NEW — approval contribution)

State needed exists: `two_person_approvals` table (migration 003),
`TwoPersonApproval.approve()` (`src/services/bos/twoPersonApproval.js:43`). RBAC is
deferred — the shared token is the gate; `approver` is a recorded label only.

```ts
// Request body
type ApproveRequest = { approver: string };  // REQUIRED — caller-supplied approver label

// 200 — idempotent per approver (ON CONFLICT (disbursement_id, approver_address) DO NOTHING).
// Re-submitting the same approver returns the current counts, never a duplicate row.
type ApproveResponse = {
  disbursement_id: string;
  approver: string;
  approved: boolean;            // approvals_received >= 2
  approvals_received: number;
  approvals_needed: 2;
};

// 400 — missing/empty `approver` (invalid_body)   •  404 — no such disbursement
type ApproveErrors = ErrorResponse;   // 'invalid_body' | 'not_found' | 'unauthorized'
```

### 3.9 POST `/api/v1/disbursements/:id/resolve` (NEW — manual-review resolution)

State needed exists: state machine already defines the three exit transitions
`manual_review → settled | failed | cancelled` (`src/services/bos/stateMachine.js:170-184`),
and the terminal actions already call `resolveManualReview` to clear the open queue
row. Resolution therefore maps 1:1 onto existing transitions — no new state.

```ts
// Request body
type ResolveRequest = {
  resolution: 'settled' | 'failed' | 'cancelled';  // REQUIRED — terminal target
  reviewer?: string;                                // recorded on resolved_at attribution
  note?: string;                                    // recorded in audit details
};

// 200
type ResolveResponse = { result: TransitionResult; disbursement: Disbursement };

// 400 — unknown `resolution` value (invalid_body, enum restricted to the 3 terminals)
// 404 — no such disbursement
// 409 — status !== 'manual_review' (wrong_state)
type ResolveErrors = ErrorResponse;  // 'invalid_body' | 'not_found' | 'wrong_state' | 'unauthorized'
```

### 3.10 GET `/api/v1/disbursements/:id/receipt` (receipt — Sprint 4 generator)

The Sprint 4 generator (`src/services/bos/settlementReceipt.js`,
`generateSettlementReceipt({ db, disbursementId })`) is **not modified**
(see §6 blocker-avoidance). A thin service wrapper pre-checks existence via
`getDisbursement` and returns 404 before the generator is called, so the
not-found case never has to be sniffed from a thrown message.

```ts
// 200 — valid receipt for any state (the generator returns the evidence trail /
// gap description, not only for `settled`).
type ReceiptResponse = { receipt: object };   // Sprint 4 SettlementReceipt envelope

// 404 / 401
type ReceiptErrors = ErrorResponse;           // 'not_found' | 'unauthorized'
```

---

## 4. Authentication boundary

- Every `/api/v1/disbursements/*` route sits behind `requireApiToken`
  (`src/routes/disbursements.js:32`, re-exported). Single shared bearer token from
  `BOS_API_TOKEN`.
- Constant-time comparison via SHA-256 + `crypto.timingSafeEqual` (already the
  Sprint 0.5 implementation — reused, not rewritten).
- Fail-closed: `BOS_API_TOKEN` unset → all requests rejected with `401` unless
  `BOS_ALLOW_UNAUTHENTICATED_DEV=true` (explicit non-production escape hatch).
- v1 returns the normalized scheme: `401 { error: 'unauthorized', error_code: 'unauthorized' }`
  — a superset of the Sprint 0.5 body `{ error: 'unauthorized' }` (deviation 5).
- Webhook routes are *not* part of this surface: they keep their HMAC paths.
- Documented in the README with a sample curl (deliverable §9).

---

## 5. Idempotency-key contract (external callers)

Contract, as documented and enforced (no code change needed — the behavior exists;
Sprint 5 formalizes, tests, and documents it):

1. **No `Idempotency-Key` header.** The scheme is deterministic-input based, not
   caller-generated (`src/services/bos/disbursementService.js:165`). Adding a header
   would be noise; the create body already *is* the key.
2. **Key derivation:**
   `idempotency_key = disbursement:<sha256(source_reference | source_application | amount_usdcx | recipient_bank_account)>`
   — stable inputs only, never a timestamp (Sprint 1.5 / G-04 fix).
3. **Duplicate behavior:** retrying `POST /api/v1/disbursements` with an identical
   body returns **`201` with the existing `disbursement` row** — no second row, no
   second payout. Enforcement is the lookup-first check plus the named UNIQUE index
   `idx_disbursements_idempotency_unique` (migration 006) and hashed comparison.
4. **Post-create operations are idempotent by construction, not by key:** every
   state transition is a compare-and-swap (`UPDATE ... WHERE id AND status = old`)
   so concurrent/replayed `advance`/`retry`/`recover`/`resolve` calls are benign
   no-ops. `approve` is idempotent per `(disbursement_id, approver_address)`.
5. **Correlation:** the created row's `idempotency_key` is returned to the caller;
   callers should persist it to recognize retries and correlate across systems.

---

## 6. New service-layer additions

Small, additive, backward-compatible additions to `src/services/bos/disbursementService.js`:

| Function | Backing | Semantics |
|---|---|---|
| `approveDisbursement({ disbursementId, approver })` | `new TwoPersonApproval()` + `approve()` | Record approval, return `{ disbursement_id, approver, approved, approvals_received, approvals_needed }`. Throws `not_found` when row missing. |
| `resolveDisbursement({ disbursementId, resolution, reviewer, note })` | `getDisbursement` + `executeTransition` to `settled|failed|cancelled` | Guard: row must be `manual_review` (else throws `wrong_state`); otherwise executes the existing terminal transition, which clears the open `manual_review_queue` row via `resolveManualReview` (`transitionActions.js:514`). |
| `getSettlementReceipt({ disbursementId })` | `getDisbursement` (existence → 404) + `generateSettlementReceipt` | Sprint 4 generator untouched — wrapper only adds the 404 pre-check. |

One minimal, backward-compatible signature change to a Sprint 4 helper:
`resolveManualReview({ db, disbursementId, resolution, resolvedBy = 'workflow' })`
— the new `resolvedBy` param defaults to the current literal `'workflow'`, so all
existing callers are byte-for-byte unchanged; the operator path passes the
`reviewer` label (deviation 3).

---

## 7. Example client structure and files

New directory `examples/simple-payout-client/` (self-contained, **zero deps** —
Node 18+ global `fetch`):

| File | Contents |
|---|---|
| `README.md` | What it does; prerequisites; env vars (`PAYOUT_API_BASE_URL`, `BOS_API_TOKEN`); run instructions (`npm start`); a sample create→advance→receipt→error transcript; notes on idempotency and the error schema. |
| `package.json` | `name`, `type: "module"`, `scripts: { start: "node client.js", test: "node --test" }`, **no dependencies**. |
| `client.js` | ESM. Reads env; exports `createPayout(body)`, `advancePayout(id, steps)`, `getReceipt(id)`, and a `main()` demo that runs the full sequence against `PAYOUT_API_BASE_URL` and prints the `ErrorResponse` on failure. No external calls beyond the configured base URL. |

The "runs against mocked infrastructure" requirement is satisfied by the repo test
harness (test/unit/examples-client.test.js, §8): it boots the real v1 router over an
HTTP listener with the in-repo `FakeDb` + mock adapters (the same pattern as
`test/unit/disbursements-routes.test.js`) and drives the actual `client.js` functions
against it — create → advance → receipt → error handling, deterministically, offline.

The example demonstrates (acceptance criteria 5): creating a payout, advancing it,
retrieving the settlement receipt, and handling an error (failed authentication).

---

## 8. Test files to create

All deterministic, mocked, in-memory (`FakeDb`), zero credentials — matching the
existing `test/unit/disbursements-routes.test.js` pattern (real Express over an HTTP
listener + router + typed stubs).

| File | Covers |
|---|---|
| `test/unit/public-api-routes.test.js` | Endpoints 1–6 (create/get/list/advance/retry/recover): happy paths, 404s, 400s (`missing_recipient_bank_details`, `missing_exchange_rate`), 409 normalization, steps clamping (1..25). |
| `test/unit/public-api-approve-resolve.test.js` | Endpoint 7: approve (happy, duplicate approver idempotent, missing/empty `approver` → 400, missing row → 404). Endpoint 8: resolve each of `settled`/`failed`/`cancelled` (asserts queue row resolved), unknown `resolution` → 400, non-`manual_review` → 409. |
| `test/unit/public-api-receipt.test.js` | Endpoint 9: 200 with a valid Sprint 4 receipt envelope; 404 for unknown id; asserts the generator was **not** changed (fixture reuse from `test/unit/settlement-receipt.test.js`). |
| `test/unit/public-api-auth.test.js` | Boundary: authorized accepted; bad/missing token → 401; token unset + dev hatch off → 401; token unset + `BOS_ALLOW_UNAUTHENTICATED_DEV=true` → accepted (loud path). |
| `test/unit/public-api-idempotency.test.js` | Contract §5: byte-identical create body → same `id` returned (201), no second row; single-input change → different key; `approve` same approver twice → count stays 1. |
| `test/unit/examples-client.test.js` | Boots v1 router over HTTP listener with FakeDb + mock adapters, drives the real `examples/simple-payout-client/client.js` functions: create → advance → receipt → error (401). Doubles as the "example client runs" acceptance, and its captured transcript feeds the README sample. |

Full suite after: every endpoint tested, every error schema exercised, auth boundary
proven, receipt from Sprint 4 validated, manual-review resolution proven,
no credentials anywhere.

---

## 9. Documentation updates

| Deliverable | Change |
|---|---|
| `docs/POSTPONED_BACKLOG.md` | New **P2** entry — RBAC / actor model. Reason: Sprint 5 explicitly defers distinct approver/operator/admin identities; two-person approval continues at the application layer behind the shared token until real operator requirements exist. Complexity estimate: MEDIUM — new `operators` table + route-scoped middleware + per-route role checks; requires a product decision on identity source (Stacks principal vs. external auth). |
| `README.md` | New "External developers" section: versioned API pointer, full endpoint table for `/api/v1/disbursements/*`, auth boundary + sample curl, idempotency-key contract, error-code table, actor-model note ("single shared token today; RBAC is a planned future capability — see POSTPONED_BACKLOG"), and a pointer to `examples/simple-payout-client/`. Old-route deprecation note. |
| `docs/SPRINT_5_REPORT.md` | Evidence report (written in 5b, per working method step 6–7) with test output and the client transcript. |

---

## 10. Deviations from the Sprint 4 state, with reasons

1. **New v1 router file + mount; old routes only annotated.** `src/routes/disbursements.js`
   keeps its behavior unchanged (required back-compat, acceptance 10) and gains a
   `@deprecated — use /api/v1/disbursements/*` comment. New file
   `src/routes/disbursementsV1.js`, one new mount line in `src/index.js`. Reason:
   versioning must be additive; removing/editing old routes risks regressions with
   zero integration value this sprint.
2. **New service functions** `approveDisbursement` / `resolveDisbursement` /
   `getSettlementReceipt` in `disbursementService.js`. Reason: the new routes need
   deterministic service entries that reuse `TwoPersonApproval` + the state machine
   rather than reaching into transition internals from a route handler.
3. **`resolveManualReview` gains an optional `resolvedBy` param (default `'workflow'`).**
   Reason: operator resolution should attribute `resolved_by` correctly while every
   Sprint 4 caller stays byte-identical. Backward-compatible by construction.
4. **v1 failure bodies are normalized to `ErrorResponse`.** The Sprint 0.5 routes
   return raw `{ result, disbursement }` with HTTP 409 (no `error_code`). The v1
   contract maps a failed `result` to `{ error, error_code, details }`, with
   `error_code = result.error_code ?? '<endpoint>_conflict'`. Reason: an external
   caller needs a machine-readable error schema (prompt §3); the old routes keep
   their legacy shape.
5. **v1 auth failure adds `error_code: 'unauthorized'`.** Superset of the legacy
   `{ error: 'unauthorized' }`. Reason: uniform `ErrorResponse` for the public
   surface without breaking the legacy body's shape.
6. **Receipt endpoint does NOT modify the Sprint 4 generator.** The prompt lists
   "settlement receipt endpoint requires a change to the Sprint 4 receipt generator"
   as a report-blocker. Design avoids the trigger entirely: existence is guarded at
   the service layer (`getDisbursement` → 404) and `generateSettlementReceipt` is
   called only for a known row. Sprint 4's module and tests stay untouched.
7. **Idempotency is formalized, not reimplemented.** The derivation, UNIQUE index,
   and CAS transitions already exist (Sprint 1.5/G-04 + Sprint 0.5); Sprint 5 adds
   the documented external contract and the tests that pin it. No behavioral change.
8. **No state-machine / evidence-chain / migration changes.** Explicitly out of
   scope (prompt §Scope Out); the three new endpoints reuse existing transitions and
   tables.

---

## 11. Scope check — commit estimate and 5a / 5b split

Whole-sprint estimate is **11 commits**, which exceeds the ~10 guidance → proposed split:

### Phase 5a — Public surface (recommended FIRST — 7 commits)

1. `feat: versioned v1 disbursements router + auth normalization` — new
   `src/routes/disbursementsV1.js`, endpoints 1–6, mount in `src/index.js`,
   `@deprecated` comment on the old router.
2. `feat: public service functions (approve / resolve / receipt)` —
   `approveDisbursement`, `resolveDisbursement`, `getSettlementReceipt` +
   `resolvedBy` param on `resolveManualReview`.
3. `test: v1 routes (create/get/list/advance/retry/recover)` —
   `test/unit/public-api-routes.test.js`.
4. `test: v1 approve + resolve endpoints` — `test/unit/public-api-approve-resolve.test.js`.
5. `test: v1 receipt endpoint uses Sprint 4 generator unmodified` —
   `test/unit/public-api-receipt.test.js`.
6. `test: v1 auth boundary + idempotency contract` —
   `test/unit/public-api-auth.test.js` + `test/unit/public-api-idempotency.test.js`.
7. `docs: RBAC P2 backlog entry + README external-developer section + curl` —
   POSTPONED_BACKLOG entry, README auth/idempotency/actor-model/endpoint-table.

### Phase 5b — Proof and report (4 commits)

8. `feat: example client (examples/simple-payout-client/)` — README, package.json,
   client.js.
9. `test: example client end-to-end against mocked infra` —
   `test/unit/examples-client.test.js`.
10. `docs: run example client, capture transcript into README` — client output
    integrated into the external-developer README section (sample request/response).
11. `docs: sprint 5 report` — `docs/SPRINT_5_REPORT.md` with suite output and the
    client transcript.

### Recommendation

**Do 5a first.** It delivers the entire integratable surface (all nine endpoints,
every schema, the auth boundary, the idempotency contract, all endpoint tests, and
the RBAC/README governance docs) and satisfies acceptance criteria 1–4, 6–10, 12 by
itself. 5b is one focused demonstration (the runnable client) plus the evidence
report — a natural second half whose only dependency is 5a being green.

---

## 12. Deliverable checklist (maps to acceptance criteria)

| Acceptance | Where |
|---|---|
| 1. Nine endpoints under `/api/v1/disbursements/*`, tested | §2, §8 (commits 1, 3–6) |
| 2. Request/response/error schemas documented | §3 (README, 5a-7) |
| 3. Auth boundary documented, tested, fail-closed | §4, §8, README (5a-6, 5a-7) |
| 4. Idempotency-key behavior documented + tested | §5, §8, README (5a-6, 5a-7) |
| 5. Example client runs: create/advance/receipt/error | §7, §8 (5b-8 → 5b-10) |
| 6. New developer understands from client README | §7, §9 |
| 7. RBAC logged as P2 with reason + estimate | §9 (5a-7) |
| 8. README documents actor model decision | §9 (5a-7) |
| 9. All prior tests still pass | suite gate after every commit (112 + new) |
| 10. Old `/api/disbursements/*` still work | deviation 1; unchanged router |
| 11. No network in tests/production paths | design — all mocked; client targets local base URL |
| 12. No new runtime npm deps | §7 zero-deps client; nothing imported into `src/` |

**Stop point: this plan is awaiting review. No implementation, no commits, no
source modifications, no network calls were made.**