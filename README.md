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
| `BOS_POLL_INTERVAL_MS` | | `30000` | Fallback poller interval (ms) |
| `BOS_MAX_POLL_ATTEMPTS` | | `10` | Max fallback poll attempts |
| `BOS_DAILY_PAYOUT_CAP_USD` | | `10000` | Daily payout cap (USD) |
| `BOS_MAX_PER_DISBURSEMENT_USD` | | `1000` | Per-disbursement cap (USD) |
| `DEFAULT_USDCX_NGN_RATE` | | `1650` | Seed exchange rate when table is empty |
| `SMTP_USER` / `SMTP_PASS` | | — | Nodemailer creds for alert emails |
| `BOS_ALERT_EMAIL_RECIPIENTS` | | — | Comma-separated alert recipients |
| `SLACK_BOS_WEBHOOK_URL` | | — | Slack webhook for bos_alerts |
| `CRON_SECRET` | | — | Auth for monitoring/ops endpoints |
| `CORS_ORIGIN` | | `*` | CORS allowed origin |
| `NODE_ENV` | | `development` | Runtime environment |

## State machine

14 states, 28+ transitions (see `src/services/bos/stateMachine.js` and `types.js`).

```
disbursement_initiated
  → burn_submitted → burn_confirmed
  → attestation_requested → attestation_confirmed
  → destination_release_submitted → destination_release_confirmed
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

## Routes

- `GET /health`, `GET /warmup`
- `GET|POST /api/bos/monitoring/*` — dashboard, workers, manual run, manual review (gated by `CRON_SECRET`)
- `POST /api/bos/webhooks/yellowcard`, `POST /api/bos/webhooks/yellowcard/test` (non-production)

## Attribution

Extracted from the CineX project (MIT, © 2026 Victor Omenai). See `ATTRIBUTION.md`
and `EXTRACTION_REPORT.md` for provenance and all extraction-time deviations.