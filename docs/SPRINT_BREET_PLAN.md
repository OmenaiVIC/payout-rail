# Sprint Breet Adapter - PLAN (Final)

> Mode: PLAN-FIRST only. No implementation, no source modifications, no external network calls, no commits, no .env read/write (only .env.example). This plan awaits review.

---

## 1. Executive Summary

This plan covers adding Breet as a third provider adapter behind the existing provider-agnostic interface for the NGN off-ramp direction.

**Key flags:** X-Breet-Env uses `sandbox` for sandbox. Off-ramp has two distinct steps (deposit detection + withdrawal initiation).

**Baseline:** npm test reports 243 tests, 242 pass, 0 fail, 1 skip.

---

## 2. Bank List API & Mapping

**Fetch Bank List:**
- Method: GET
- Path: `/payments/banks`
- URL: `https://api.breet.io/v1/payments/banks`
- Auth: x-app-id, x-app-secret, X-Breet-Env
- Query: `currency` (ngn/ghs)

**Response structure:** Each bank object includes `id` (Breet internal bank ID, string), `name`, `slug`, `country`, `currency`, `type`, `avatar`. **No NIBSS/code field is present in the documented response.**

**Mapping strategy:** Since no NIBSS/code field exists, the adapter uses a configuration file `config/breet-banks.json` mapping NIBSS bank codes to Breet internal bank IDs.

**Config file location:** `config/breet-banks.json` (at repo root/config).  
**Shape:**
```json
{
  "ngn": {
    "044": "15",
    "057": "11",
    ...
  },
  "ghs": { ... }
}
```
Keys are NIBSS bank codes (as strings), values are Breet internal bank IDs (as strings).

**Seeding:** File must be created with initial mapping for commonly used NGN banks (or populated from known mappings). If a code is missing, adapter throws `BankNotFoundError` (fail closed). File is configuration, not a secret.

**Caching:** In-memory cache of bank list with TTL 5 minutes (300000ms). Cache key includes currency and env. On error, no stale fallback beyond TTL (fail closed). This avoids repeated API calls.

---

## 3. Bank Flow

1. Resolve recipient's bank code → look up Breet ID in `config/breet-banks.json` for currency
2. Add Bank via `POST /payments/banks/add` with `{ id: <Breet bank id>, accountNumber, currency?, narration? }` → get saved bank account ID from response
3. Withdraw via `POST /payments/withdraw/bank/{savedBankId}` with amount, pin, optional narration/externalId

---

## 4. PIN, Health Check, Webhooks, Env

- **PIN:** `BREET_WITHDRAWAL_PIN` from env (added to `.env.example`); fail closed if unset
- **Health check:** `GET /trades/wallets?page=1&size=1` (lightweight auth)
- **Webhook:** verify `x-webhook-secret` against `BREET_WEBHOOK_SECRET` (timing-safe), fail closed if unset, route `POST /breet`
- **Env vars:** BREET_APP_ID, BREET_APP_SECRET, BREET_MERCHANT_REF, BREET_WEBHOOK_SECRET, BREET_BASE_URL (default https://api.breet.io/v1), BREET_ENV (sandbox/production), BREET_WITHDRAWAL_PIN

---

## 5. Remaining UNVERIFIED

1. End-to-end sandbox flows (deposit → webhook → withdrawal)
2. Webhook payload shapes for all 9 events  
3. Off-ramp behavior under real conditions

All wire shapes confirmed. Plan complete.

Baseline: 243 tests, 242 pass, 0 fail, 1 skip. Ready for implementation.