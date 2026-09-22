# SPRINT 3 REPORT — YELLOW CARD MODEL CORRECTION

> Task: `docs/prompts/06_SPRINT_3_YELLOWCARD.md` · Plan: `docs/SPRINT_3_PLAN.md` (IMPLEMENTED)
> Scope: wire-level correction of the Yellow Card adapter/auth/webhook surface against the current
> public provider docs (docs.yellowcard.engineering). **No live sandbox credentials** were available,
> so every change was verified by wire-contract tests against a stubbed fetch and stays UNVERIFIED live.
> `npm test` result after this sprint: **180 pass / 1 skip** (the pre-existing real-Postgres integration
> skip) out of 181 tests.

---

## 1. What was wrong (baseline)

G-07 / CLAIMS_REGISTER:53, :82 captured the adapter drifting from the provider's public scheme:

- `_computeAuth` built a JSON-envelope `Authorization` (`YcHmacV1 {timestamp, apiKey, bodyHash, signature}`),
  sent no `X-YC-Timestamp` header, and signed `timestamp + apiKey + hex(sha256(body))` — **no path, no
  method, hex body hash**. Provider docs specify `Authorization: YcHmacV1 {apiKey}:{signature}` plus an
  `X-YC-Timestamp` header, signing `timestamp + path + method (+ base64(SHA256(body)))` for POST/PUT.
- `submitSend` sent a legacy body (`{amount, currency, recipientType, recipient, callbackUrl}`) plus an
  `X-Idempotency-Key` header; docs reference the 2025+ **Sends** terminology (`sequenceId`, `channelType`,
  `destination`, `localAmount`).
- Webhook verification accepted only hex signatures on non-primary headers; the provider's canonical
  `x-yc-signature` is base64 and was checked after or not at all.
- CLAIMS_REGISTER:54 / G-18: the reference file the adapter header cites did not exist.

## 2. Changes made (wire level only)

### 2.1 Authentication — `src/services/bos/yellowcardAdapter.js`
- `_computeAuth` now emits `Authorization: YcHmacV1 {apiKey}:{signature}` where `signature` is the
  **base64** HMAC-SHA256 over `timestamp + signedPath + method` (GET/DELETE) or
  `timestamp + signedPath + method + base64(sha256(body))` (POST/PUT).
- `X-YC-Timestamp` header added (full ISO with milliseconds).
- Signed path = `new URL(url).pathname` — includes `/business`, excludes the host and the query string
  (verified by test: `?status=...`/`?amount=...` never enters the message).
- Fail-closed: when `YELLOW_CARD_API_KEY` or `YELLOW_CARD_API_SECRET` is missing, **no** Authorization or
  X-YC-Timestamp header is sent.
- All 8 `_headers` call sites (mint/lookup/send/fee and the poll paths) pass the resolved URL object and
  the raw body string so auth binds the real request target and payload.

### 2.2 Submit Send — `yellowcardAdapter.submitSend`
Rewritten to the documented Sends body:

```json
{
  "sequenceId": "<uuid>",
  "channelType": "bank" | "momo",
  "country": "NG",
  "currency": "NGN",
  "localAmount": "125000",
  "forceAccept": true,
  "destination": { "accountNumber": "...", "accountName": "...", "bankCode": "...", "accountType": "momo"? }
}
```

- `channelType` derived from recipient type (`bank`), or `mobile_money` → `momo` + `accountType: 'momo'`.
- `localAmount: String(amount)` (wire contract — amount is a string on the docs; kobo/decimals UNVERIFIED).
- `forceAccept: true` retained from the plan.
- `sender` remains **omitted** (doc-marked required; no sender-KYC available) — tracked as UNVERIFIED.
- Dropped: `amount`, `currency`, `recipientType`, `recipient`, `callbackUrl` (legacy) and the
  `X-Idempotency-Key` header. Sequence is the idempotency key.

### 2.3 Webhooks — `src/services/bos/webhookVerifier.js` + `src/routes/webhooks.js`
- `verifyYellowCardWebhook` checks **`x-yc-signature` first**, then the legacy `x-signature`,
  `x-yellowcard-signature`, `x-hub-signature-256`.
- `verifyHmac` accepts hex, base64, and base64url encodings plus `sha256=` / `hmac-sha256,` prefixes,
  with a length-guarded `timingSafeEqual`; unpadded base64url rejected cleanly, no decrypt-style errors.
- Route `webhooks.js` already verifies the **raw** body (`req.rawBody`) and fails closed with `401` when
  no secret is configured or the signature is invalid; unchanged this sprint.
- `adapter.signWebhook` emits `digest('base64')` so the sender and verifier round-trip on the provider's
  canonical encoding.

### 2.4 Reference + registers
- `docs/yellowcard-api-reference.md` **created** (G-18, CLAIMS_REGISTER:54 resolved): auth scheme, base-URL
  table (prod `https://api.yellowcard.io/business`, sandbox `https://sandbox.api.yellowcard.io/business`),
  submit/lookup payloads, webhook verification, and an explicit **UNVERIFIED** list.
- README Webhooks now documents `x-yc-signature` (base64) first + hex/base64/base64url acceptance.
- CLAIMS_REGISTER rows :53/:54/:58/:64/:82/:83 → RESOLVED/IMPLEMENTED (wire level). GAP_REGISTER G-07,
  G-18 → RESOLVED-IN-MODEL / RESOLVED; G-20 notes the new mock fixtures.

## 3. Tests added (28, all wire-contract, no network)

| File | Covers |
|---|---|
| `test/unit/yellowcard-auth.test.js` | message shape (path+method, no body on GET, body hash on POST), base64 (44-char) signature, timestamp header, fail-closed on missing key/secret, query excluded |
| `test/unit/yellowcard-submit-send-contract.test.js` | bank body, momo mapping, `accountName` omitted, default currency NGN, permanent 4xx classification |
| `test/unit/yellowcard-lookup-contract.test.js` | GET `/business/send/{id}` + signed path, status normalization, `listSends`/`getSendFee` signed-path-without-query, `getPayoutStatus` alias, 4xx permanent |
| `test/unit/yellowcard-webhook.test.js` | `x-yc-signature` base64 + `sha256=` prefix, legacy hex candidates, base64-vs-hex rejection, tamper/wrong-secret/missing/unconfigured, sign/verify round-trip, hex+base64+base64url encodings |

Harness: per-file `globalThis.fetch` stub capturing `{url, options}`, env set at load,
cache-busted dynamic imports (`?case=N`), expected signature recomputed locally from the captured
`X-YC-Timestamp` + `new URL(url).pathname` + method [+ body hash]. The pre-existing
`test/unit/webhook-verify.test.js` (hex, G-06) remains green.

## 4. Not changed
- No schema, route contract, or caller changes; `classifyError`, `YELLOW_CARD_ENV`, and all env var names
  unchanged; `.env.example` untouched; the E2E and harness tests still use the mock adapter.

## 5. UNVERIFIED (needs a live sandbox / credentials — G-20)
- `localAmount` unit/precision (kobo vs USD amounts) and whether `amount` must be absent when present.
- `networkId` mapping and any country/currency allowlist (`NG`/`NGN` assumed for our use case).
- `forceAccept: true` semantics and `channelType` vs `channelId` equivalence.
- Whether `sender` is truly required at submit time (omitted).
- Webhook header casing and the exact live base64/hex variants Yellow Card actually sends.

## 6. Result
- Full suite: **180 pass, 1 skip** (181 tests). Baseline 152 pass / 1 skip + 28 new = 180 / 1.
- All provider-facing deltas now match `docs/yellowcard-api-reference.md`, which becomes the acceptance
  baseline for the G-20 sandbox loop.