# Breet API Reference

> Provider adapter reference for Breet (v1). All wire shapes documented here are from Breet API reference. The three remaining UNVERIFIED items are explicitly listed.

## Authentication & Headers

- Base URL: `https://api.breet.io/v1` (default)
- Required headers:
  - `x-app-id`: Application ID
  - `x-app-secret`: Application secret
  - `X-Breet-Env`: `sandbox` or `production` (note: sandbox uses `sandbox`, not `development`)
- Content-Type: `application/json`

## Fetch Bank List

- Method: GET
- Path: `/payments/banks`
- Query: `currency` (optional, `ngn` or `ghs`)
- Response includes array of banks with `id` (Breet internal bank ID, string), `name`, `slug`, `country`, `currency`, `type`, `avatar`.
- **Note:** No NIBSS/code field is present in the documented response.

## Bank ID Mapping

- Since no NIBSS/code field exists in bank list, mapping uses `config/breet-banks.json`.
- Location: `config/breet-banks.json`
- Shape:
```json
{
  "ngn": { "044": "15", ... },
  "ghs": { ... }
}
```
- Keys are NIBSS codes (strings), values are Breet internal bank IDs (strings).
- In-memory cache with TTL 5 minutes (300000ms). Cache key includes currency and env.

## Add Bank (Save Bank Account)

- Method: POST
- Path: `/payments/banks/add`
- Body: `{ "id": "<Breet internal bank id>", "accountNumber": "...", "currency": "ngn" (optional), "narration": "..." (optional) }`
- Success returns saved bank account `data.id` (used in withdrawal path).

## Withdrawal (NGN | GHS)

- Method: POST
- Path: `/payments/withdraw/bank/{savedBankId}` (saved bank account ID from Add Bank)
- Body: `{ "amount": number, "pin": string, "narration": string?, "externalId": string? }`
- PIN is sent per request; sourced from `BREET_WITHDRAWAL_PIN` env var.

## Fetch Withdrawal By ID (Status)

- Method: GET
- Path: `/payments/withdrawal/{id}` (withdrawal ID or externalId)
- Returns withdrawal with `data.status` in {pending, processing, completed, reversed, rejected}.

## Generate Wallet Address

- Method: POST
- Path: `/trades/sell/assets/{id}/generate-address`
- Body includes `label` (required) and optional bank fields for auto-settlement.

## Mock Trade (Sandbox only)

- Method: POST
- Path: `/trades/sell/mock-trade`
- Requires `X-Breet-Env: sandbox`. Body includes walletAddress, asset, amountInUSD, cryptoReceived, reference, txHash.

## Health Check

- Method: GET
- Path: `/trades/wallets?page=1&size=1` (lightweight auth check)

## Webhook Verification

- Header: `x-webhook-secret` compared against `BREET_WEBHOOK_SECRET` using timing-safe comparison. Fail closed if unset.

## Error Taxonomy

- 5xx, 429, timeouts → transient (retryable)
- 4xx except 429 → permanent (not retryable)
- Other → unknown

## UNVERIFIED (Remaining)

1. End-to-end sandbox flows (deposit → webhook → withdrawal) - not tested live in this environment
2. Webhook payload shapes for all 9 events - documented conceptually but not captured from live events
3. Off-ramp behavior under real conditions (positioning confirmed, not verified in live sandbox)
