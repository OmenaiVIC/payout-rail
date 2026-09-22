# Yellow Card API Reference (provider wire model)

Vetted-from-public-docs baseline for the BOS Yellow Card bridge adapter
(`src/services/bos/yellowcardAdapter.js`) and the webhook verifier
(`src/services/bos/webhookVerifier.js`). This file is the acceptance baseline
the Sprint 3 auth/payload rework is measured against (see GAP_REGISTER G-07/G-18).

> **Verification status:** every statement below was read from public
> docs.yellowcard.engineering references (URLs listed inline). **No live
> sandbox verification has been performed** — no Yellow Card credentials exist
> in this environment. Anything marked **[UNVERIFIED]** is a modeled
> assumption carried by the adapter, not a claim that it works against the API.

Source documents (retrieved Sprint 3):

- Auth: `https://docs.yellowcard.engineering/docs/authentication-api`
- Submit payment: `https://docs.yellowcard.engineering/reference/submit-payment`
- Webhooks: `https://docs.yellowcard.engineering/docs/webhooks-api`
- Lookup payment: `https://docs.yellowcard.engineering/reference/lookup-payment`
- Lookup by sequence ID: `https://docs.yellowcard.engineering/reference/lookup-payment-by-sequenceid`
- Recipes: `https://docs.yellowcard.engineering/recipes/submit-your-first-payment-request`
- `https://docs.yellowcard.engineering/llms.txt` (llms.txt renders the whole docs tree)

---

## 1. Authentication (YcHmacV1)

The public auth reference describes an `YcHmacV1` HMAC scheme, **not** a Bearer
or basic token:

- Authorization header shape: `YcHmacV1 {apiKey}:{signature}` (apiKey and
  signature separated by a colon — **not** a JSON envelope).
- A separate request header carries the signing timestamp:
  `X-YC-Timestamp`.
- The signing message is `timestamp + path + method`; for POST/PUT requests a
  body digest is appended: `timestamp + path + method + bodyHash` where
  `bodyHash` is **base64(SHA256(body))**.
- `signature` is base64 HMAC-SHA256 over that message, keyed by the secret.
- Timestamp is full-ISO-8601 UTC (milliseconds), matching the
  `YcHmacV1 {apiKey}:{signature}` docs example which shows a
  `...424Z/paymentPOSTuisbibf/sadf+==` style message. **[UNVERIFIED]**
- The path includes the `/business` prefix for API requests (e.g.
  `/business/send`). Whether the query string is included in the signed path and
  the trailing-slash handling are **[UNVERIFIED]**; the adapter signs
  `new URL(url).pathname`, which excludes the query string.

Adapter implementation: `_computeAuth` / `_headers` in
`yellowcardAdapter.js`, `docs/SPRINT_3_REPORT.md` §Wire model. Contract tests:
`test/unit/yellowcard-auth.test.js`.

## 2. Base URLs / environments

| Env        | Base URL                                     |
| ---------- | -------------------------------------------- |
| Production | `https://api.yellowcard.io/business`         |
| Sandbox    | `https://sandbox.api.yellowcard.io/business` |

Config via `YELLOW_CARD_API_URL`; `YELLOW_CARD_ENV` is read but
**[DEAD — unused]** (deferred to the G-20 sandbox loop). **[UNVERIFIED]**
base URL set — no sandbox credentials.

## 3. Submit send — `POST /business/send`

The current docs use Sends terminology/fields. The adapter sends the documented
subset:

```jsonc
{
  "sequenceId": "unique-idempotency-key",   // documented idempotency key
  "channelType": "bank" | "momo",
  "country": "NG",
  "currency": "NGN",
  "localAmount": "4125000",                  // string, widest unit (kobo) [UNVERIFIED unit]
  "forceAccept": true,
  "destination": {
    "accountNumber": "0123456789",
    "accountType": "bank",                   // 'bank' | 'momo'
    "networkId": "044",                      // momo network / bank code [UNVERIFIED mapping]
    "accountName": "ALIYAH NAUSCH"           // optional
  }
}
```

Notable decisions:

- `sequenceId` is the documented idempotency key (from the caller's
  `idempotency_key`). The legacy `X-Idempotency-Key` header was removed because
  the Sends model carries it in the body.
- `sender` is documented as required but is **omitted** — no sender KYC exists
  in the caller. This is a deliberate capability gap, flagged, not fabricated.
- `amount` (USD) is omitted; only `localAmount` is sent ("amount OR localAmount,
  not both").
- `channelType` + `country` + `currency` select the channel; the alternative
  documented `channelId` selector and the `reason` field are **[UNVERIFIED]** and
  not sent.
- `callbackUrl` has no documented Sends field; the caller's `callback_url` is
  accepted but not placed on the wire **[UNVERIFIED]**.

Response normalization (`submitSend`): `send_id` = `data.id || data.paymentId ||
data.sendId`; `status` through `normalizeStatus` (`successful` → `completed`).
**[UNVERIFIED]** canonical id field + status vocabulary.

### Known limitation: `sender` field omitted

The Yellow Card docs mark the `sender` object as **required** on `POST /business/send`. The adapter currently **omits** `sender` because the BOS has no sender KYC model — there is no field on `disbursements` that corresponds to a sender identity.

**Consequence:** the first `submitSend` call against the sandbox will likely be **rejected** by Yellow Card with a validation error. This is a correct, understood consequence of the missing sender model, not a bug in the adapter.

**Prerequisite for sandbox verification:** a `sender` source must be added (either a per-disbursement sender field, a configured default sender, or a caller-supplied sender object) before sandbox verification can succeed.

## 4. Lookup — `GET /business/send/{sendId}`

Matches the documented lookup reference. Lookup by `sequenceId`
(`/business/send/sequence-id/{sequenceId}`) is **not** exposed as a separate
adapter method; the worker polls by send id. The lookup-by-sequence-id doc page
still shows a legacy `/payments/sequence-id/{id}` URL — **docs internally
inconsistent**; flagged, not resolved.

## 5. Webhooks

Yellow Card signs webhook payloads with an HMAC-SHA256 digest; the documented
header is `X-YC-Signature` and the digest is **base64** (docs example signature
`fakno+9epoa/obe=`, message
`2022-01-11T15:48:37.424Z/paymentPOSTuisbibf/sadf+==`).

- `webhookVerifier.verifyYellowCardWebhook` checks headers in order:
  `x-yc-signature`, then `x-signature`, `x-yellowcard-signature`,
  `x-hub-signature-256`.
- `verifyHmac` accepts hex, base64, and base64url signatures and the
  `sha256=` / `hmac-sha256,` prefixes, compared constant-time against a single
  expected digest (see `test/unit/yellowcard-webhook.test.js`).
- `signWebhook` (adapter) now emits base64 to match.
- Secret source: webhooks are signed with the API key's secret; the adapter
  verifies with `YELLOW_CARD_WEBHOOK_SECRET`. Whether that equals
  `YELLOW_CARD_SECRET_KEY` is **[UNVERIFIED]** — kept as separate config.

## 6. UNVERIFIED items (as of Sprint 3)

Modeled, not proven. Blocking **any** "SANDBOX VERIFIED" / production claim
(GAP G-20):

- Signature message edge cases: query-string inclusion, trailing slash.
- `localAmount` unit (kobo) and string encoding accepted by the API.
- `networkId` ← bank code mapping for bank destinations.
- `channelType`/`country`/`currency` vs `channelId` selection semantics.
- `forceAccept` behavior for bank (bank-transfer) payouts.
- `sender` requirement and its KYC shape.
- Canonical send id field + status vocabulary in responses.
- Webhook secret == API secret; timestamp tolerance applied by YC.
- Sandbox URL/envelope acceptance (requires credentials).
