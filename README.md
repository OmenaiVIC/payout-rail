# payout-rail

BOS (Bridge Orchestration Service) payout subsystem — extracted from the CineX backend
and made standalone.

Canonical burn → xReserve attestation → destination release → Yellow Card payout → NGN,
tracked as a 14-state (`PREFLIGHT_CHECK` → `settled`) state machine over Postgres, with
workers advancing every non-terminal disbursement one step per tick.

## Requirements

- Node.js >= 18 (ESM project)
- PostgreSQL (or Neon serverless)

## Install & run

```bash
npm install
cp .env.example .env   # edit values
npm start              # or: npm run dev (node --watch)
```

The app listens on `PORT` (default **3001**). On Vercel (`VERCEL=1`) it exports an
Express app for `@vercel/node` instead of calling `listen()`.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Postgres/Neon connection string |
| `NEON_DRIVER` | | `pg` | `serverless` → use `@neondatabase/serverless` driver |
| `VERCEL` | | — | `1` → skip `listen()`, skip `process.exit` on shutdown |
| `PAYOUT_NETWORK` | | `testnet` | `mainnet` / `testnet` for Stacks adapter + contract |
| `PAYOUT_HIRO_API_URL` | | per network | Hiro API base |
| `PAYOUT_USDCX_CONTRACT` | | per network | SIP-010 USDCx burn contract id |
| `PAYOUT_TX_SIGNING_KEY` | | — | Private key that signs the burn transaction |
| `PAYOUT_API_BASE_URL` | | `http://localhost:3001` | Public callback base for webhooks/pollers |
| `BRIDGE_ADAPTER_ENV` | | `xreserve` | `xreserve` / `mock` adapter selection |
| `XRESERVE_PROTOCOL_CONTRACT` | | — | Optional override for xReserve contract |
| `XRESERVE_WEBHOOK_SECRET` | | — | Webhook signature secret (xReserve) |
| `YELLOW_CARD_API_URL` | | — | Yellow Card REST base URL |
| `YELLOW_CARD_API_KEY` | | — | Yellow Card API key |
| `YELLOW_CARD_SECRET_KEY` | | — | Yellow Card secret key |
| `YELLOW_CARD_ENV` | | — | Yellow Card environment |
| `YELLOW_CARD_WEBHOOK_SECRET` | | — | Yellow Card webhook signature secret |
| `BOS_RECIPIENT_REGISTRY` | | `null` | `permissive` → permissive registry; anything else → null registry |
| `BOS_PIPELINE_INTERVAL_MS` | | `30000` | Pipeline worker tick (ms) |
| `BOS_PIPELINE_BATCH_SIZE` | | `50` | Max disbursements advanced per tick |
| `BOS_DAILY_PAYOUT_CAP_USD` | | `10000` | Daily payout cap (USD) |
| `BOS_MAX_PER_DISBURSEMENT_USD` | | `1000` | Per-disbursement cap (USD) |
| `DEFAULT_USDCX_NGN_RATE` | | `1650` | Seed exchange rate when table is empty |
| `BOS_API_TOKEN` | | — | Bearer token required for the disbursement API. Unset → all requests rejected unless the dev flag is on |
| `BOS_ALLOW_UNAUTHENTICATED_DEV` | | — | `true` → skip token checks (dev escape hatch; fails closed otherwise) |
| `SMTP_USER` / `SMTP_PASS` | | — | Nodemailer creds for alert emails |
| `BOS_ALERT_EMAIL_RECIPIENTS` | | — | Comma-separated alert recipients |
| `SLACK_BOS_WEBHOOK_URL` | | — | Slack webhook for bos_alerts |
| `CRON_SECRET` | | — | Auth for monitoring/ops endpoints |
| `CORS_ORIGIN` | | `*` | CORS allowed origin |
| `NODE_ENV` | | `development` | Runtime environment |

## State machine

15 states, 28+ transitions (see `src/services/bos/stateMachine.js` and `types.js`).

```
disbursement_initiated
  → burn_submitted → burn_confirmed
  → attestation_requested → attestation_confirmed
  → destination_release_unobserved → destination_release_observed → destination_release_confirmed
  → yellowcard_payout_submitted → yellowcard_payout_confirmed
  → settled
```

Failure paths (with retry budget) funnel through `failed`, with `manual_review_queue`
as the human-in-the-loop escape hatch and a circuit breaker guarding the payout leg.

## Workers

| Worker | Interval | Advance |
|---|---|---|
| `monitorJob` | start | alerting / webhook timeouts |
| `stuckStateReaper` | 60s | stuck disbursements → `manual_review`/`failed` |
| `reconciliationWorker` | 5 min | drift detection |
| `pipelineWorker` | 30s | one state step per disbursement per tick |

## Idempotency & concurrency

Duplicate financial actions are prevented at three independent layers:

1. **Deterministic idempotency key (create).** Each disbursement's
   `idempotency_key` is derived from stable inputs only — never a timestamp:
   `disbursement:<sha256(source_reference | source_application | amount_usdcx | recipient_bank_account)>`.
   Retrying a create with the same inputs returns the existing row instead of
   inserting a second payout. Enforcement is a named UNIQUE index
   (`idx_disbursements_idempotency_unique`, migration 006).
2. **Per-leg adapter keys.** Provider-side keys are already disbursement-scoped
   and stable across retries: `burn:${disbursement.id}`, `release:${disbursement.id}`,
   `payout:${disbursement.id}`.
3. **Optimistic concurrency on every state transition.** `executeTransition`
   claims the row with `UPDATE ... WHERE id = $N AND status = $fromState`
   **before** running the transition's side-effect. The `status` predicate is a
   compare-and-swap, not an accidental condition: a concurrent advance that
   already moved the row affects 0 rows, so it bails as a benign
   `already advanced` no-op and the side-effect never runs twice.

Coverage for duplicate webhook deliveries, worker ticks/restarts, retries, and
concurrent advances lives in `test/unit/duplicate-handling.test.js`.

## Module dispositions

Sprint 1.5 (see `docs/SPRINT_1_5_REPORT.md`):

- **`fallbackPoller.js` — deleted (G-14).** Had zero importers; its polling job is
  covered by the confirmation guards + `stuckStateReaper` + `reconciliationWorker`.
  Removed with it: the two documented-but-dead env vars
  `BOS_POLL_INTERVAL_MS` / `BOS_MAX_POLL_ATTEMPTS` (see `docs/POSTPONED_BACKLOG.md`
  C-07 for resurrection conditions).
- **`auditTimeline.js` — converted to ESM (G-14).** Now `export`s and imports
  cleanly; snapshot join fixed to the real `external_status_snapshots` columns
  (`source` / `captured_at`). Route wiring is deferred to Sprint 4 when the
  evidence-chain contract is set.
- **`webhookVerifier.js` — converted to ESM (Sprint 0.5, G-06).** The single
  verifier for Yellow Card signatures; fail-open removed.

## Evidence model (Sprint 4)

Every evidence record in `disbursement_evidence` is a versioned envelope —
`{ v, event_type, source, external_ref, observed_at, status, payload_hash,
verification, details }` — with a `crypto.randomUUID` id and a deterministic
`sha256` over the **stable canonical form** of the payload. **Raw PII and
sensitive financial payloads are never stored** (hashes + sanitized summaries
only); sensitive keys (`account_number`, `recipient`, `phone`, `email`, `bvn`,
… ) are stripped before anything is persisted.

- `executeTransition` writes **exactly one `transition` record per successful
  transition**, after the audit row, linking the leg's external id
  (`payout_id` > `attestation_id` > `external_tx_id`).
- External-observation recorders (`recordApiResponse`, `recordTxHash`,
  `recordWebhookPayload`, `recordPollResult`) also append a point-in-time
  `external_status_snapshots` row.
- The webhook path **awaits** the evidence write and journals a sanitized
  summary into `yellow_card_webhook_events` (derived, redelivery-stable event
  id; body never stored). A failed evidence/journal write is logged at ERROR —
  never silent (approved Sprint 4 interpretation).
- The write-dead tables are gone/closed (G-16): `on_chain_events`,
  `external_status_snapshots`, `yellow_card_webhook_events`, and
  `manual_review_queue` are written by their flows; `relay_wallet_activity`
  and `config_snapshots` were dropped in `migrations/008_sprint_4.sql`.

## Routes

- `GET /health`, `GET /warmup`
- `GET|POST /api/disbursements`, `GET|POST /api/disbursements/:id` — see [Disbursement API](#disbursement-api) (Sprint 0.5 router, **deprecated** — kept for backward compatibility)
- `GET|POST /api/v1/disbursements/*` — versioned public disbursement API for external integrations — see [Disbursement API v1](#disbursement-api-v1)
- `GET|POST /api/bos/monitoring/*` — dashboard, workers, manual run, manual review (gated by `CRON_SECRET`)
- `POST /api/bos/webhooks/yellowcard`, `POST /api/bos/webhooks/yellowcard/test` — see [Webhooks](#webhooks)

## Disbursement API

All `/api/disbursements` routes require `Authorization: Bearer <BOS_API_TOKEN>`.
With `BOS_API_TOKEN` unset, every request is rejected with `401` unless
`BOS_ALLOW_UNAUTHENTICATED_DEV=true` (loud, non-production escape hatch). Tokens
are compared in constant time.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/disbursements` | Create a disbursement (status `preflight_check`), runs safety gates first |
| `GET` | `/api/disbursements/:id` | Fetch a disbursement with its `external_refs` and `audit_log` |
| `POST` | `/api/disbursements/:id/advance` | Advance one state step (the same step workers run) |
| `GET` | `/api/disbursements` | List disbursements (bounded; optional `status` / `source_reference` filters) |
| `POST` | `/api/disbursements/:id/retry` | Retry a `failed` disbursement from its last good state (within retry budget) |
| `POST` | `/api/disbursements/:id/recover` | Move a stuck disbursement to `manual_review` |

Create body:

```jsonc
{
  "source_reference": "campaign-001",
  "amount_usd": 50,
  "amount_usdcx": 50000000,          // USDCx base units (6 decimals) — 50 USDCx
  "creator_address": "SP2J6ZY48...", // recipient Stacks address
  "creator_btc_address": "bc1q...",  // BTC address for the xReserve release
  "recipient_bank_account": "0123456789",
  "recipient_bank_code": "044",
  "ngn_recipient": { "account_number": "0123456789", "bank_code": "044" }
}
```

Creation resolves the current `USDCx/NGN` rate from `exchange_rates`
(`DEFAULT_USDCX_NGN_RATE` seeds it) and stores `exchange_rate` plus
`amount_ngn_expected` (kobo, rounded) on the row. If no valid rate is on file,
creation is **rejected** (fail closed) rather than inserting a row that can never
pay out.

Caveat: this legacy router is **deprecated** — new integrations must target
[Disbursement API v1](#disbursement-api-v1), which adds the operator actions
(`approve`, `resolve`) and the settlement receipt, all behind the same shared
token. The legacy error bodies below are what v0 still returns; v1 normalizes them
(see the next section). Two-person approval engages only at `amount_usd >= 1000`.

## Disbursement API v1

The versioned public surface for external Stacks applications — **mount** on
`/api/v1/disbursements/*`. `v0` (`/api/disbursements/*`) is deprecated but stays
functional and unchanged.

### Authentication

Identical to v0 — fail-closed, constant-time bearer check:

```bash
curl -H "Authorization: Bearer $BOS_API_TOKEN" \
     https://host/api/v1/disbursements/... 
```

With `BOS_API_TOKEN` unset, every request is rejected with `401` unless
`BOS_ALLOW_UNAUTHENTICATED_DEV=true` (non-production escape hatch).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/disbursements` | Create a disbursement (idempotent; runs safety gates → `preflight_check`) |
| `GET` | `/api/v1/disbursements` | List disbursements (bounded; `limit` 1–200, `offset`; `status`/`source_reference`/`source_application` filters) |
| `GET` | `/api/v1/disbursements/:id` | Fetch one disbursement with its `external_refs` and `audit_log` |
| `GET` | `/api/v1/disbursements/:id/receipt` | Settlement receipt reconstructable from stored evidence (read-only) |
| `POST` | `/api/v1/disbursements/:id/advance` | Advance one (or `?steps=n`, max 25) state step(s) |
| `POST` | `/api/v1/disbursements/:id/retry` | Retry a `failed` disbursement (within retry budget) |
| `POST` | `/api/v1/disbursements/:id/recover` | Move a stuck disbursement to `manual_review` |
| `POST` | `/api/v1/disbursements/:id/approve` | Record a two-person approval contribution (`approver` label) |
| `POST` | `/api/v1/disbursements/:id/resolve` | Resolve `manual_review` → `settled` / `failed` / `cancelled` (`reviewer`, `note`) |

The create body is the same shape as v0 (see [Disbursement API](#disbursement-api)).

```bash
# create → 201 { disbursement }
curl -X POST -H "Authorization: Bearer $BOS_API_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"source_reference":"campaign-001","amount_usd":50,"amount_usdcx":50000000,
          "creator_address":"SP2J6ZY48...","recipient_bank_account":"0123456789","recipient_bank_code":"044"}' \
     https://host/api/v1/disbursements

# approve → contribution recorded (2 distinct approvers flip approved: true)
curl -X POST -H "Authorization: Bearer $BOS_API_TOKEN" -H 'content-type: application/json' \
     -d '{"approver":"ops-1"}' https://host/api/v1/disbursements/:id/approve

# resolve a manual_review row to a terminal state
curl -X POST -H "Authorization: Bearer $BOS_API_TOKEN" -H 'content-type: application/json' \
     -d '{"resolution":"settled","reviewer":"ops-1","note":"payout confirmed off-chain"}' \
     https://host/api/v1/disbursements/:id/resolve

# settlement receipt (read-only)
curl -H "Authorization: Bearer $BOS_API_TOKEN" https://host/api/v1/disbursements/:id/receipt
```

### Example client

A zero-dependency (Node 18+ `fetch`) create → advance → receipt → error-path
walkthrough lives in [`examples/simple-payout-client/`](examples/simple-payout-client/).
It runs against a real deployment or the repo's mocked test harness — no
credentials or external network calls beyond the configured base URL.
Transcript captured from the mocked run:

```
create       {"id":"2fecff56-…","status":"preflight_check"}
idempotency_key disbursement:7f13ec69…
advance      {"success":true,"new_state":"manual_review"}
receipt      {"final_status":"manual_review","gaps":4}

error path: GET receipt for an unknown id
  -> 404 not_found — Disbursement not found: 00000000-0000-0000-0000-000000000000
error path: request with a wrong token
  -> 401 unauthorized — unauthorized
```

### Error contract

v1 returns a **normalized ErrorResponse** body on every failure path:

```jsonc
{ "error": "human readable message", "error_code": "machine_code", "details": { } }
```

| HTTP | `error_code` | When |
|------|--------------|------|
| `401` | `unauthorized` | Missing/wrong bearer, or no token configured (fail closed) |
| `400` | `missing_recipient_bank_details` / `missing_exchange_rate` | Create rejected (fail closed) |
| `400` | `invalid_body` | `approve` without `approver`; `resolve` with an unknown `resolution` |
| `404` | `not_found` | Unknown disbursement (including `receipt` — never a 500) |
| `409` | `retry_conflict` | Retry from a non-`failed` state |
| `409` | `advance_conflict` / `recover_conflict` | Guard/eligibility rejection during advance/recover |
| `409` | `wrong_state` | Resolve a disbursement not in `manual_review` |

When a transition guard rejects, the specific guard `error_code` (e.g. `u8211`)
is surfaced instead of the generic fallback. `409` responses still include the
`error` message.

The **legacy v0** shapes are unchanged and differ as follows (for parity with
existing callers of `/api/disbursements/*`):

| | v0 (legacy) | v1 (normalized) |
|---|---|---|
| auth denial | `401 { "error": "unauthorized" }` | `401 { "error": "unauthorized", "error_code": "unauthorized" }` |
| unknown id | `404 { "error": "not found" }` | `404 { "error": "not found", "error_code": "not_found" }` |
| conflict | `409 { "result", "disbursement" }` (plain result) | `409 { "error", "error_code", … }` (normalized) |

### Idempotency

- **Create**: the `idempotency_key` is derived from stable inputs only
  (`disbursement:<sha256(source_reference | source_application | amount_usdcx |
  recipient_bank_account)>`). Retrying a create with identical inputs returns the
  **existing** disbursement (same `id`) and inserts no second row — callers can
  retry `POST /` safely. Distinct inputs produce distinct disbursements.
- **Approve**: idempotent per `(disbursement_id, approver)` — repeating the same
  `approver` never double-counts; two **distinct** labels reach 2/2 and set
  `approved: true`.
- **Transitions**: every state change is claimed with an optimistic
  compare-and-swap (`UPDATE … WHERE id = $N AND status = $fromState`), so
  overlapping advances/webhooks/retries never double-execute a side-effect.

### Actors

`approver` (on approve) and `reviewer` (on resolve) are **caller-supplied
recorded labels**, not authenticated identities: they are persisted as
`approver_address` on the approval row and `resolved_by` on the
`manual_review_queue` row. Shared-token gating is intentional for this surface;
role-based access control is deferred (see `docs/POSTPONED_BACKLOG.md`, **RBAC-1**).

### Receipt

`GET /:id/receipt` returns the Sprint 4 settlement receipt reconstructed **from
stored evidence only** — the route performs reads only, never fabricates a leg,
and missing evidence surfaces explicit `gaps` entries. An unknown disbursement is
a `404`, never a `500`.

## Webhooks

- `POST /api/bos/webhooks/yellowcard` — Yellow Card payout callbacks. The HMAC is
  verified over the **raw** body (`x-signature`, `x-yellowcard-signature`, or
  `x-hub-signature-256`; `sha256=`/`hmac-sha256,` prefixes accepted) using
  `YELLOW_CARD_WEBHOOK_SECRET`. Unsigned/invalid payloads are rejected with `401`
  before any state is touched; when no secret is configured the endpoint fails
  **closed** (reject, never trust). Duplicate valid deliveries are acknowledged
  but do not double-advance, and each verified payload is recorded in the evidence
  chain.
- `POST /api/bos/webhooks/yellowcard/test` — manual webhook injection, gated by
  the same `BOS_API_TOKEN` bearer token as the disbursement API.

## Tests

```bash
npm test              # full suite (node --test, in-memory FakeDb — no Postgres needed)
npm run test:unit     # unit + route tests
npm run test:e2e      # mock full lifecycle (create → settled, and the failed-preflight path)
npm run test:integration  # Postgres-gated (requires TEST_DATABASE_URL; skips otherwise)
```

The default suite runs against an in-repo `FakeDb` with mock Stacks/xReserve/
Yellow Card adapters — zero infra, zero credentials. The only skip is the
real-Postgres integration test, which runs when `TEST_DATABASE_URL` is set.
The E2E proves orchestration completes in mock mode; it does not prove an
external release is true (see `docs/SPRINT_0_5_REPORT.md`, GAP-08).

## Attribution

Extracted from the CineX project (MIT, © 2026 Victor Omenai). See `ATTRIBUTION.md`
and `EXTRACTION_REPORT.md` for provenance and all extraction-time deviations.