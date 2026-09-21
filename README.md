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

## Routes

- `GET /health`, `GET /warmup`
- `GET|POST /api/disbursements`, `GET|POST /api/disbursements/:id` — see [Disbursement API](#disbursement-api)
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

Caveat: the operator/approval routes (`approve`, manual-review resolution) are
**not** exposed yet — they depend on an actor model that is still undecided
(see `docs/SPRINT_0_5_REPORT.md`). Two-person approval engages only at
`amount_usd >= 1000`.

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