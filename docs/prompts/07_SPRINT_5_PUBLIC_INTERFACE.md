# 07 — SPRINT 5: PUBLIC INTEGRATION INTERFACE

> Task: define and implement the minimum developer-facing interface for another Stacks application to integrate Payout Rail.
> Mode: plan-first, implementation-with-tests, no external network calls.
> Outputs: versioned public API, request/response/error schemas, example client, documented idempotency behavior, README section for external developers, actor model deferred (Option C).

---

## Why This Sprint Exists

Sprint 4 completed the evidence chain and reconciliation layer. The system now records everything internally. But no external application can use it cleanly.

The current routes (`src/routes/disbursements.js`) are a Sprint 0.5 minimal surface. They work, but they lack:

- Versioning (`/api/v1/...`)
- Approve and manual-review resolution endpoints
- Settlement receipt endpoint
- Documented request/response/error schemas
- A working example client
- Idempotency-key behavior documented for external callers
- A README section a stranger can follow

Sprint 5 makes the system integratable. It is the surface a grant reviewer, an external developer, or a future CineX integration would actually use.

---

## Actor Model Decision (Option C)

Authentication for this sprint uses a **single shared `BOS_API_TOKEN`**, fail-closed if unset, with `BOS_ALLOW_UNAUTHENTICATED_DEV=true` as an explicit non-production escape hatch.

Role-based access control (distinct approver / operator / admin identities, two-person approval across distinct users) is **explicitly deferred** to a future sprint, pending real operator requirements. It must be:

- Logged in `docs/POSTPONED_BACKLOG.md` as a P2 entry with reason and complexity estimate
- Documented in the README as "planned future capability"
- Not implemented in this sprint

Two-person approval continues to work at the application layer (the `twoPersonApproval.check` guard). It is gated by the same shared token, not by roles.

---

## Scope (In)

### 1. API versioning

- New routes under `/api/v1/disbursements/*`
- Old routes under `/api/disbursements/*` remain functional for backward compatibility during this sprint, marked deprecated in code comments
- Do not delete the old routes in this sprint

### 2. Public endpoints

Minimum surface:

- `POST   /api/v1/disbursements` — create
- `GET    /api/v1/disbursements/:id` — get
- `GET    /api/v1/disbursements` — list (bounded, paginated)
- `POST   /api/v1/disbursements/:id/advance` — advance one step (optional `?steps=n`)
- `POST   /api/v1/disbursements/:id/retry` — retry eligible
- `POST   /api/v1/disbursements/:id/recover` — recover stuck
- `POST   /api/v1/disbursements/:id/approve` — two-person approval contribution (gated by shared token)
- `POST   /api/v1/disbursements/:id/resolve` — resolve manual review (gated by shared token)
- `GET    /api/v1/disbursements/:id/receipt` — settlement receipt (from Sprint 4)

### 3. Schemas

For every endpoint, define and document:

- Request body schema (with required/optional fields)
- Response schema (success)
- Error schema (all error codes, with meaning)
- Idempotency-key behavior

### 4. Authentication boundary

- Single shared bearer token from `BOS_API_TOKEN`
- Constant-time comparison (already implemented in Sprint 0.5)
- Fail-closed if token unset and dev escape hatch not enabled
- Documented in README with a sample curl

### 5. Idempotency-key behavior (external contract)

- Documented for external callers: how to provide an idempotency key, what happens on duplicate, what the response looks like
- Tied to the deterministic idempotency key from Sprint 1.5 (`disbursement:<sha256>`)
- Documented in README and in the example client

### 6. Example client

New directory: `examples/simple-payout-client/`

Contents:

- `README.md` — what the example does, how to run it
- `package.json` — self-contained, uses only the repo's dependencies
- `client.js` — runs against mocked infrastructure (no external calls)
- Sample requests and responses in the README

The example must demonstrate:

- Creating a payout
- Advancing it
- Retrieving the settlement receipt
- Handling an error (e.g., failed authentication or missing field)

### 7. Tests

- Every endpoint has a deterministic mocked test
- Every error schema is exercised
- The example client runs successfully (can be run as a test or as a script)
- Authentication boundary tested (reject unauthorized, accept authorized)
- The settlement receipt endpoint returns a valid receipt (from Sprint 4)
- The manual-review resolution endpoint resolves a queued row

## Scope (Out)

- Role-based access control (deferred, Option C)
- Real external services
- Sprint 3 (Yellow Card)
- Sprint 6 (demo)
- Multi-corridor support
- Any change to the state machine
- Any change to the evidence chain (Sprint 4 owns it)

---

## Constraints

- Do not modify CineX.
- No external network calls.
- No new runtime npm dependencies.
- Fail closed: authentication and idempotency behavior must default to rejecting, not allowing.
- Backward compatibility: old `/api/disbursements/*` routes must keep working.
- One commit per logical fix.
- All tests run via `npm test` with no credentials.

---

## Acceptance Criteria

1. All nine endpoints exist under `/api/v1/disbursements/*` and are tested.
2. Request, response, and error schemas are documented for every endpoint.
3. Authentication boundary is documented, tested, and fails closed.
4. Idempotency-key behavior is documented for external callers and tested.
5. The example client runs successfully and demonstrates create, advance, receipt, and error handling.
6. A developer unfamiliar with CineX can read `examples/simple-payout-client/README.md` and understand how to integrate.
7. Role-based access control is logged in `docs/POSTPONED_BACKLOG.md` as a P2 entry, with reason and complexity estimate.
8. The README documents the actor model decision (shared token, roles deferred).
9. All Sprint 0.5, 1.5, 2, and 4 tests still pass.
10. The old `/api/disbursements/*` routes still work.
11. No external network calls in any test or production path.
12. No new runtime npm dependencies.

---

## Working Method (per Master Prompt §WORKING METHOD)

1. **Inspect** — read `src/routes/disbursements.js`, `src/routes/bosMonitoring.js`, `src/services/bos/disbursementService.js`, the settlement receipt module, and existing tests.
2. **Baseline** — run `npm test`; confirm Sprint 4 state (112/111/0/1).
3. **Plan** — produce `docs/SPRINT_5_PLAN.md` with:
   - The exact endpoint list with paths and methods
   - Every schema (request, response, error) as a named type
   - The authentication boundary description
   - The idempotency-key contract for external callers
   - The example client structure and files
   - Test files to create
   - Deviations from the Sprint 4 state, with reason
   - **Scope check:** if the plan exceeds ~10 commits, propose a split into 5a / 5b and recommend which half to do first
   - **Wait for review before implementing.**

4. **Implement** — one commit per fix.
5. **Test** — full suite must pass.
6. **Evidence** — capture test output; run the example client end-to-end against the mocked infrastructure and capture its output.
7. **Document** — update README with the external developer section; add `docs/SPRINT_5_REPORT.md`.

---

## Deliverables

- `docs/SPRINT_5_PLAN.md` — plan (reviewed before implementation)
- Versioned public API (`/api/v1/disbursements/*`)
- Request/response/error schemas documented
- Authentication boundary documented and tested
- Idempotency-key behavior documented and tested
- Example client in `examples/simple-payout-client/`
- README section for external developers
- POSTPONED_BACKLOG entry for role-based access control
- Tests for every endpoint
- `docs/SPRINT_5_REPORT.md`
- No CineX changes
- No new runtime npm dependencies
- No external network calls

---

## Blockers to Report (Do Not Silently Resolve)

If any of the following are true during implementation, STOP and report:

- A schema cannot be defined because the underlying service behavior is ambiguous
- The example client cannot run against mocked infrastructure without external credentials
- The settlement receipt endpoint requires a change to the Sprint 4 receipt generator
- The approve or manual-review resolve endpoints require state that does not exist
- The plan's scope exceeds what one sprint can deliver safely (recommend split)
- A backward-compatible route cannot be maintained

Report blockers with: what was found, what was expected, options, and recommended option.

---

## Gate

Do NOT proceed to Sprint 3 or Sprint 6 until:

1. All nine endpoints exist under `/api/v1/*` and are tested
2. Schemas are documented
3. Authentication boundary is documented and tested
4. Idempotency-key behavior is documented and tested
5. The example client runs successfully
6. Role-based access is logged in POSTPONED_BACKLOG
7. All existing tests still pass
8. The old routes still work
9. `SPRINT_5_REPORT.md` exists with evidence
10. No CineX files were modified
11. No new runtime npm dependencies were added
12. No external network calls were made

Stop after Step 3 (Plan). Produce `SPRINT_5_PLAN.md` and wait for review.
