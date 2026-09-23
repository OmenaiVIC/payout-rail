# external-integrator

A reference **external integration**: a Stacks marketplace paying each seller's
winnings out to their NGN bank account through Payout Rail's public API
(`POST/GET /api/v1/disbursements/*`).

Five-minute walkthrough, no credentials, no standing infrastructure, **no real
money moves**. Everything here runs against in-repo mocks (`FakeDb` + mock
chain/bank adapters) over an ephemeral loopback listener.

## 1. Run it

Node.js 18+.

```sh
cd examples/external-integrator
npm start
```

That is the whole demo. You should see:

```
marketplace-seller payout demo
base          http://127.0.0.1:49312

create        order-2042 -> preflight_check
payout        705aad86-9d0c-4a36-96af-18826510450d
advance       preflight_check -> burn_submitted -> burn_confirmed -> attestation_requested -> attestation_confirmed -> destination_release_unobserved -> destination_release_observed -> destination_release_confirmed -> yellowcard_payout_submitted -> yellowcard_payout_confirmed -> settled
receipt       final_status=settled ngn_kobo=4125000 provider=yc-mock-1 gaps=0
idempotency   re-created order-2042 -> SAME disbursement (settled)
error          missing bank fields -> 400 missing_recipient_bank_details
error          bad bearer token -> 401 unauthorized

demo complete
```

What just happened, one line at a time:

- **create** — one order (`order-2042`, 25 USDC, 25,000,000 USDCx) is submitted
  and a Payout Rail disbursement is created at `preflight_check`. The id is a
  server-side UUID.
- **advance** — the whole state machine, one hop at a time: burn USDCx on-chain
  → confirm the burn → request + confirm the xReserve attestation → enter the
  destination-release leg (observe → confirm) → submit the Yellowcard bank
  payout → confirm it → **settled**.
- **receipt** — the settlement receipt for the settled payout: `final_status`,
  amount in NGN kobo (25 USDCx × 1650 = 41,250 NGN), provider payout id, and
  `gaps=0` (the receipt reconstructs fully from persisted evidence).
- **idempotency** — submitting the exact same order body again returns the
  *same* disbursement instead of creating a second payout. Money never double-moves.
- **error** — two failure surfaces shown as the API ships them: missing recipient
  bank fields → `400 missing_recipient_bank_details`, and a bad bearer token →
  `401 unauthorized`.

The exit code is `0` only if every one of those steps verified.

## 2. What "demo" means here

`npm start` with `PAYOUT_API_BASE_URL` unset boots `harness.js`, which mounts the
**real** v1 route handler over a random 127.0.0.1 port, backed by the repo's test
doubles:

- `FakeDb` — records SQL, answers registered handlers; no database.
- mock Stacks/xReserve/Yellowcard adapters — no network calls.
- a mock settlement surface whose release evidence follows the row's own progress.

It is demo scaffolding, not an API contract — a real deployment uses the same
`client.js` against a real instance. Nothing in the example touches `src/`,
`migrations/`, or the root `package.json`.

## 3. Pointing it at your own deployment

`client.js` is a plain `fetch` client (Node 18+ `fetch`, zero npm deps).

```sh
export PAYOUT_API_BASE_URL="https://payouts.example.com"
export BOS_API_TOKEN="<your shared bearer token>"
npm start          # same demo, against your instance
```

The functions you'd actually call from your marketplace backend are:

| function | HTTP | notes |
| --- | --- | --- |
| `createPayout(order)` | `POST /api/v1/disbursements` | idempotent per `source_reference` + `source_application` + `amount_usdcx` + `recipient_bank_account` |
| `advancePayout(id, steps)` | `POST /api/v1/disbursements/:id/advance?steps=n` | step the state machine forward |
| `getReceipt(id)` | `GET /api/v1/disbursements/:id/receipt` | settlement receipt after `settled` |
| `paySeller(order)` | above, composed | create → settle → receipt, with a 15-hop safety cap |

Errors throw `ApiError` with `status`, `error_code`, and `details`, matching the
API's normalized `{ error, error_code, details? }` body.

## 4. Integration checklist

- [ ] Read `docs/INTEGRATION.md` and the v1 contract in `docs/SPRINT_5_PLAN.md`.
- [ ] Persist the returned disbursement id; poll `advance` until a terminal
      status (`settled` | `failed` | `cancelled` | `manual_review`).
- [ ] Treat `createPayout` as idempotent — a duplicate order body returns the
      existing disbursement.
- [ ] Handle 400/401/404/409 from `ApiError.error_code`.
- [ ] On `settled`, record the receipt for your books (and reconcile later
      against provider records).