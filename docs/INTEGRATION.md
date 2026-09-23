# Payout Rail — Integration Guide

> Generated: 2026-09-23 · Sprint 7 (Plan: `docs/SPRINT_7_PLAN.md` §3.3) · Scope: documentation only.
> For another Stacks application that wants to move USDCx → NGN through the BOS layer.
> Cross-references: `docs/ARCHITECTURE.md` (system context), `docs/GAP_REGISTER.md` (G-01, G-02),
> `examples/simple-payout-client/` (reference client), `docs/SPRINT_5_PLAN.md` §3 (schemas).
> Status: draft — matches code at HEAD (commit `1d8f4dd` + `0dd5447`).

---

## 1. Integration summary

The contract in one screen.

| Item | Value |
|---|---|
| Base URL (web) | `http://localhost:3001` (default; override `PORT`) |
| v1 endpoint prefix | `/api/v1/disbursements` |
| Auth | `Authorization: Bearer BOS_API_TOKEN` on every v1 call. **Fail-closed**: no default or backdoor token. |
| What you must run | The Express server (`src/index.js`) against the Postgres schema (`migrations/**`) |
| What you must provide | `BOS_API_TOKEN`; your own recipient bank details; a USDCx/NGN rate (seeded default 1650) |
| Create body (required) | `source_reference`, `amount_usd`, `amount_usdcx`, `creator_address`, `recipient_bank_account`, `recipient_bank_code` |
| Idempotency | Deterministic key over `source_reference · source_application · amount_usdcx · recipient_bank_account` — duplicate creates collide on `UNIQUE(idempotency_key)` and return the existing disbursement |
| Lifecycle | `preflight_check (gates) → burn → attestation → release observation → Yellow Card payout → settled`; alternative exits `failed` / `cancelled` / `manual_review` |
| Demo truth | Loopback-only, fully offline. **No mainnet path exists.** |

**The one screen:**

```
POST /api/v1/disbursements            → 201 { disbursement }        (idempotent)
POST /api/v1/disbursements/:id/advance?steps=n → { result, disbursement } (n ≤ 25)
GET  /api/v1/disbursements/:id        → { disbursement }
GET  /api/v1/disbursements/:id/receipt → { receipt }                (final_status)
POST /api/v1/disbursements/:id/retry  → retry a failed row
POST /api/v1/disbursements/:id/recover → escalate a stuck row to manual_review
```

Your application is the **orchestrator**: it supplies identity and destination data; the layer
runs the state machine, collects evidence, and produces a receipt. You hold the keys; this
layer holds none.

## 2. v1 API reference

Error envelope (normalized, always the same shape on failure).

```json
{ "error": "<message>", "error_code": "<code>"[, "details": { ... }] }
```

| `error_code` | HTTP | Meaning |
|---|---|---|
| `not_found` | 404 | unknown disbursement id (`{ error: "not found", error_code: "not_found" }`) |
| `unauthorized` | 401 | missing / wrong `BOS_API_TOKEN` |
| `invalid_body` | 400 | missing `approver`, or invalid `resolution` on resolve |
| `advance_conflict` | 409 | the state machine refused the requested move |
| `retry_conflict` | 409 | row is not in a retryable (failed) state |
| `recover_conflict` | 409 | row is not stuck-ish; nothing to escalate |
| (service error) | 400 | any error carrying `error_code` from the service layer |

### POST `/api/v1/disbursements` — create (idempotent) → `201`

Request body:

```json
{
  "source_reference": "demo-001",
  "source_application": "example-client",
  "amount_usd": 25,
  "amount_usdcx": 25000000,
  "creator_address": "SP…",
  "creator_btc_address": "bc1…",
  "recipient_bank_account": "0123456789",
  "recipient_bank_code": "058",
  "ngn_recipient": { "account_number": "0123456789", "bank_code": "058", "name": "Adekunle O." },
  "metadata": { "corridor": "NGN" }
}
```

- `amount_usdcx` is in **base units (6 dp)** — `25000000` = 25 USDCx.
- `recipient_bank_account` + `recipient_bank_code` are **required** (fail-closed; missing →
  400).
- Response: `201 { "disbursement": { id, status, idempotency_key, … } }`.
- **Duplicate create:** same tuple → same `idempotency_key` → `UNIQUE` collision → the
  service returns the **existing** record to the caller (no duplicate row is created).

### GET `/api/v1/disbursements` — list

Query: `status`, `source_reference`, `source_application`, `limit` (default 50, max 200),
`offset` (default 0). Response is the raw service result object.

### GET `/api/v1/disbursements/:id` — read one

`200 { disbursement }` (includes external refs + audit trail) · `404 not_found`.

### GET `/api/v1/disbursements/:id/receipt` — settlement receipt

`200 { receipt }`. For a settled payout, `receipt.final_status === "settled"`. Missing
disbursement → normalized error.

### POST `/api/v1/disbursements/:id/advance?steps=n` — advance

`steps` default 1, hard-capped at **25** (`MAX_ADVANCE_STEPS`, `disbursementsV1.js:30,35-39`).
Advances up to `n` state-machine transitions; stops early on the first failed move.
Response: `{ result, disbursement }` · `409 advance_conflict` if a move was refused.

> **POST conditions note:** this API is **bearer-authenticated only**. There are no signed
> bounties/custodial post-conditions here — the network/chain action (any on-chain burn) is
> the orchestrator's job, and the layer's only guarantee is the CAS-protected state machine
> (compare-and-swap on `status` in `stateMachine.js:306-315`) so concurrent advance/retry/
> webhook delivery can never double-execute a transition.

### POST `/api/v1/disbursements/:id/retry`

For a `failed` row, re-route it onto its next valid transition. `409 retry_conflict` when
not retryable.

### POST `/api/v1/disbursements/:id/recover`

Escalate a stuck row to `manual_review`. Body `{ "reason": "…" }` optional (default `"stuck"`).
`409 recover_conflict` when nothing to escalate.

### POST `/api/v1/disbursements/:id/approve`

Two-person approval contribution toward the preflight `two_person_approval` gate.
Body requires `{ "approver": "<label>" }` (`invalid_body` if empty). Idempotent per
`(disbursement_id, approver)`. The shared bearer token is the authorization here —
RBAC is deferred (see `docs/POSTPONED_BACKLOG.md`).

### POST `/api/v1/disbursements/:id/resolve`

Resolve a `manual_review` row to a terminal state. Body:

```json
{ "resolution": "settled", "reviewer": "ops-1", "note": "audit confirmed" }
```

`resolution` ∈ `settled | failed | cancelled` (else `invalid_body` with `allowed` list).
Response: `{ result, disbursement }`.

### Webhook receivers (not bearer-authenticated)

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/bos/webhooks/yellowcard` | **verify-first** `YcHmacV1` HMAC over the raw body (`req.rawBody`); no bearer token | Yellow Card Sends webhook delivery → `handleYellowCardWebhook` |
| `POST /api/bos/webhooks/yellowcard/test` | `requireApiToken` | Local testing without provider signing |

Webhook verification is **fail-closed**: unconfigured secret or bad `x-yc-signature` →
reject before any processing. Clean consumers should register their payout webhook URL with
Yellow Card and store the returned secret in `YELLOW_CARD_WEBHOOK_SECRET`.

## 3. Authentication boundary

- **Bearer token, fail-closed.** `requireApiToken` (`disbursements.js`) accepts a valid
  `BOS_API_TOKEN`; normalization for v1 (`{ normalize: true }`, `disbursementsV1.js:33`)
  produces the machine-readable `{ error, error_code }` envelope.
- **No default or backdoor tokens.** A dev escape hatch
  (`BOS_ALLOW_UNAUTHENTICATED_DEV=true` with **no token configured**) existed only for the
  loopback demo run; the demo script deletes it (`scripts/demo-payout-ngn.js:978`) and then
  exercises the **fail-closed** path on the next unprotected call — proving rejects work.
  Nothing ships with a built-in token.
- **Unconfigured secret ⇒ reject.** If `BOS_API_TOKEN` is not set, requests are rejected —
  there is no "any token works" fallback mode in this layer.

## 4. Idempotency contract

Deterministic key (F4): `deriveDisbursementIdempotencyKey` (`disbursementService.js:53-63`)

```
sha256( join( [source_reference, source_application, amount_usdcx, recipient_bank_account]
             .map(s => s.trim()) , "|" ) )   →  prefix "disbursement:"
```

- **Why duplicates collide:** the key is a digest of fixed inputs only — never a timestamp —
  so identical tuples always produce the identical key and hit
  `UNIQUE(idempotency_key)` (`migrations/006`).
- **What the caller must reuse:** `source_reference` is the natural business key; the create
  tuple must be byte-stable across retries (same amount, same bank account, same app).
- **Retry semantics:** re-POST of an identical create returns the existing disbursement
  (no second row); a failed disbursement is retried with `POST /:id/retry`, not by re-creating
  a new source_reference.

## 5. Observation obligations (G-08)

The layer observes; it never fabricates an external outcome. The destination release is
**OBSERVED, not app-controlled** (`types.js:16-17`). For each leg, the orchestrator (or the
provider webhook) must supply real external evidence:

| Leg | Evidence type (recorder) | What the app must provide |
|---|---|---|
| Burn | `tx_hash` (recordTxHash) | a real on-chain burn txid via `observeBurn` — **mock-only today** (GAP-09; UNVERIFIED burn) |
| Attestation | `api_response` / `poll_result` | the attestation's on-chain id via the bridge adapter |
| Release | `poll_result` (release observation) | the observed `release_status` from `observeDestinationRelease` — **UNVERIFIED stub today** |
| Yellow Card payout | `webhook_payload` (`x-yc-signature` verified) + `api_response` | a YcSends `payment_id` from submit/lookup/payout-status/webhook |

Webhook harvesting: Yellow Card posts to `/api/bos/webhooks/yellowcard`; verification is
HMAC-first, the verified payload is stored as evidence, and the row advances when the payout
is confirmed. `event_id` ties the payload to the disbursement.

Pluralize nothing: no fabricated values, no mocked outcomes in the evidence chain for a real
disbursement. Where an adapter is UNVERIFIED, the layer stays fail-closed (see
`docs/PROVIDER_ADAPTERS.md`, Sprint 7).

## 6. Worked walkthrough — 25 USD → NGN (loopback demo)

Reference client: `examples/simple-payout-client/` (zero-dependency, Node ≥18). How it works
and what you should see.

**Setup**

```bash
export BOS_API_TOKEN='demo-token'            # any non-empty value
export PAYOUT_API_BASE_URL='http://localhost:3001'
npm ci && npm run demo:payout:ngn            # starts the loopback demo server + runner
```

**Step 1 — create** (`POST /api/v1/disbursements`, body from `client.js` `DEMO_BODY`):

```json
{ "source_reference": "demo-001", "source_application": "example-client",
  "amount_usd": 25, "amount_usdcx": 25000000,
  "creator_address": "SP…", "recipient_bank_account": "0123456789", "recipient_bank_code": "058" }
```

The layer computes the expected NGN payout from the seeded rate:

```
computeAmountNgnExpected({ amount_usdcx_base_units: 25_000_000, rate: 1650 })
  = round( 25.0 USDCx × 1650 × 100 kobo/NGN ) = 4,125,000 kobo = NGN 41,250.00
```

(`disbursementService.js:40-44`, `NGN_MINOR_UNITS_PER_NAIRA = 100`, `USDCX_DECIMALS = 6`).

**Step 2 — stepwise advance:** the client calls
`POST /api/v1/disbursements/:id/advance?steps=<n>` repeatedly. Each tick moves the row one
safe transition (`preflight_check → burn_submitted → burn_confirmed → attestation_requested →
attestation_confirmed → destination_release_unobserved → destination_release_observed →
destination_release_confirmed → yellowcard_payout_submitted → yellowcard_payout_confirmed →
settled`). The loopback demo runs one tick per request, so you watch each state land.

**Step 3 — receipt:** `GET /api/v1/disbursements/:id/receipt` →

```json
{ "receipt": { "final_status": "settled", "nigerian_amount": 4125000,
               "evidence": [ …gate_result, transition, webhook_payload, … ] } }
```

Expected: `receipt.final_status = "settled"` and the NGN amount above, with the full evidence
trail behind it. The reference client then deliberately hits a **404** and a **401** to
demonstrate the normalized error envelope and fail-closed auth (exit code 0 on success).

## 7. Sandbox vs demo vs production posture

| Mode | Exists today? | What it is | Evidence gate |
|---|---|---|---|
| **Demo** | ✅ yes | Loopback-only, fully offline; mock adapters; the worked walkthrough above | Self-consistent internal evidence (`gaps: []`) — proves layer bookkeeping, **not** provider contracts |
| **Sandbox** | ⚠️ gated | Yellow Card sandbox endpoint wired (`YcHmacV1`, sandbox base URL); xReserve/Stacks observation stubs | **No provider credentials exist in this environment (G-20), so no adapter is sandbox-verified.** With credentials + a webhook recorder, the runner operates in sandbox mode; without them the demo exits non-zero (fail-closed). |
| **Production** | ❌ no | No mainnet path, no custody, no funds | Requires the open P0s (G-01, G-02) to be fixed first; do not use for real funds/beneficiary data |

Three hard rules for integration:

1. **Never** create a disbursement against a real provider with this build — every external
   adapter is UNVERIFIED (G-20) and burn/observation are mocks.
2. **Never** ship `BOS_ALLOW_UNAUTHENTICATED_DEV`; a configured `BOS_API_TOKEN` must be
   present in any non-demo deployment.
3. **Never** treat `gaps: []` in the loopback demo as provider verification — read
   `docs/PROVIDER_ADAPTERS.md` and `docs/GAP_REGISTER.md` before trusting an adapter.