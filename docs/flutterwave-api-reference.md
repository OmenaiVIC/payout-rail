# Flutterwave API Reference (provider wire model)

Vetted-from-sprint-prompt baseline for the BOS Flutterwave bridge adapter
(`src/services/bos/flutterwaveAdapter.js`) and the webhook verifier
(`src/services/bos/webhookVerifier.js`). This file is the acceptance baseline the
adapter's wire-contract tests are measured against, mirroring
`docs/yellowcard-api-reference.md`.

> **Verification status: STUB — weakest tier in this repository.**
> This document was written **from the sprint prompt only**
> (`docs/prompts/12_SPRINT_FLUTTERWAVE_ADAPTER.md:23-45`). **No Flutterwave
> documentation was fetched and no sandbox call was made while writing it** — the
> sprint forbids network calls. It is therefore *narrower and less trustworthy* than
> `yellowcard-api-reference.md`, which was built from retrieved public docs.
> Completing it requires fetching current Flutterwave v3 documentation; that work is
> logged as **P-4** in `docs/POSTPONED_BACKLOG.md`.
> Anything marked **[UNVERIFIED]** is a modeled assumption carried by the adapter, not
> a claim that it works against the API. The claims-register tier for this provider is
> **IMPLEMENTED + TESTED (wire-level, stubbed fetch) — sandbox/live UNVERIFIED**.

---

## 0. WHAT THIS PROVIDER ACTUALLY DISBURSES — read before anything else

**The Flutterwave v3 transfer body implemented here is a USDC-to-wallet
disbursement, not an NGN bank payout.**

Under the semantics this repository is working from (§3), the documented body:

```json
{
  "account_bank": "flutterwave",
  "account_number": "<merchant_id>",
  "debit_currency": "NGN",
  "amount": 100,
  "currency": "USDC",
  "network": "POLYGON",
  "destination": "<recipient_wallet_address>",
  "reference": "<idempotency_key>"
}
```

means:

> Debit **NGN** from the Flutterwave merchant balance → deliver **USDC** to a
> **Polygon wallet address**.

Four consequences, each load-bearing for how this adapter may be described:

1. **It does not serve the Nigeria / NGN local-fiat payout leg.** The product thesis
   rests on local fiat payouts (`docs/prompts/00_MASTER.md:31`); this body sits next
   to the *bridge* leg that `xreserveAdapter.js` already owns.
2. **`destination` is a wallet address.** The repo's recipient shape is bank/momo —
   `deriveRecipientType` (`transitionActions.js:562-568`) reads `type`, `bankCode`,
   `accountNumber`, `mobile_number`, `provider`. **There is no wallet-address field**,
   so a Flutterwave transfer cannot be populated from `disbursements.ngn_recipient` as
   it exists today. The adapter therefore reads
   `recipient.walletAddress || recipient.address || recipient.destination` and
   **throws a named error** if all are absent — it never sends an empty `destination`.
3. **`network: "POLYGON"` hard-codes a non-Stacks network** into a Stacks product's
   local rail.
4. **Yellow Card remains the primary NGN payout provider.** This adapter does not
   replace it, is not wired to it, and does not change the default payout path.
   Routing the pipeline to Flutterwave is **not implemented** (P-1).

**The genuine Flutterwave off-ramp — USDC → NGN bank payout — is a different product
and is NOT implemented here.** It is logged as **P-7** in
`docs/POSTPONED_BACKLOG.md**: the endpoint was not verified offline, so it is deferred
to a future sprint rather than guessed at.

This section exists to prevent a future reader from taking the word "provider" in
this file to mean "second NGN payout provider". It does not.

---

## 1. Authentication

Bearer token. Every request carries:

```
Authorization: Bearer {FLW_SECRET_KEY}
```

Server-side only. Never committed, never logged. Blank default: with no
`FLW_SECRET_KEY` the adapter sends no `Authorization` header and the provider rejects
the call — there is no working default to leak.

**Not read by this adapter:** `FLW_PUBLIC_KEY` and `FLW_ENCRYPTION_KEY`. They are
documented in `.env.example` as **RESERVED** so that their presence creates no
doc-drift claim (decision D-3 of `docs/SPRINT_FLUTTERWAVE_PLAN.md`). This mirrors the
`YELLOW_CARD_ENV` drift already recorded in `docs/CLAIMS_REGISTER.md`.

## 2. Base URL

| Purpose  | URL                                 | Config                  |
| -------- | ----------------------------------- | ----------------------- |
| Default  | `https://api.flutterwave.com/v3`    | `FLW_BASE_URL`          |

**[UNVERIFIED]** that this is the only endpoint; no docs were retrieved (§0). No
sandbox URL is recorded in this repository.

## 3. Submit transfer — `POST /v3/transfers`

Confirmed by the operator against the sandbox before this sprint — recorded **as
reported**, not independently reproduced here (no network calls were made):

- `POST /v3/transfers` with `account_bank: "flutterwave"` queues a stablecoin transfer.
- The response shape includes `id`, `status` (`NEW`), `amount`, `currency`,
  `debit_currency`, `fee`, `reference`, `meta.debit_currency_amount`.

### 3.1 The body, byte-for-byte

```json
{
  "account_bank": "flutterwave",
  "account_number": "<FLW_MERCHANT_ID>",
  "debit_currency": "NGN",
  "amount": 100,
  "currency": "USDC",
  "network": "POLYGON",
  "destination": "<recipient_wallet_address>",
  "reference": "<idempotency_key>"
}
```

Locked by `test/unit/flutterwave-contract.test.js` — the test asserts
`Object.keys(body).sort()` deep-equals exactly these eight keys, and that no legacy
or invented key leaks onto the wire.

### 3.2 Field mapping

| Wire field     | Source                                        | Notes |
|----------------|-----------------------------------------------|-------|
| `account_bank` | constant `"flutterwave"`                     | Confirmed |
| `account_number` | `FLW_MERCHANT_ID`                          | **The merchant's own id — not the recipient's.** Differs from Yellow Card, where `destination.accountNumber` is the recipient. |
| `debit_currency` | `currency` param, else `"NGN"`             | **INVERTED vs Yellow Card** — see §3.3 |
| `amount`       | `amount` param, **verbatim**                 | **NOT kobo** — see §3.4 |
| `currency`     | constant `"USDC"`                            | **INVERTED vs Yellow Card** — see §3.3 |
| `network`      | `recipient.network` else `"POLYGON"`         | See §0 consequence 3 |
| `destination`  | `recipient.walletAddress \|\| recipient.address \|\| recipient.destination` | Wallet address; **throws** if all three absent (fail closed) |
| `reference`    | `idempotency_key`                            | Idempotency carrier — see §3.5 |

`callback_url` is **accepted and ignored**. Flutterwave registers webhook targets in
dashboard settings, not per transfer, so there is no wire field for it. The parameter
is kept for interface parity with `yellowcardAdapter.js:180`; a test asserts it does
not appear in the body.

### 3.3 The `currency` / `debit_currency` inversion — READ THIS

**The `currency` parameter of `submitSend` lands in the wire field
`debit_currency`, and the wire field `currency` is the constant `"USDC"`. This is
inverted relative to Yellow Card.**

| | Yellow Card | Flutterwave |
|---|---|---|
| `currency` param means | what the recipient receives | **what is debited from the merchant balance** |
| lands in wire field | `currency` | **`debit_currency`** |
| recipient receives | `localAmount` (kobo) | `amount` + `currency: "USDC"` |

The pipeline calls `submitSend({ currency: 'NGN' })` (`transitionActions.js:362`).
A literal pass-through would emit `currency: "NGN"` alongside `debit_currency: "NGN"`
— which is **not** the documented body. The adapter therefore inverts the two:
`debit_currency` ← `currency` param (default `"NGN"`), body `currency` ← constant
`"USDC"`. This reproduces the documented body exactly from the pipeline's real call
shape.

**Do not "fix" this by passing the parameter through literally.** That was evaluated
and rejected (decision D-4, `docs/SPRINT_FLUTTERWAVE_PLAN.md` §7.3). The inversion
exists because the two fields mean opposite things. It is also a second, independent
symptom of §0: no field mapping makes a USDC-to-wallet disbursement into an NGN
bank payout.

### 3.4 Units — explicit non-conversion

Yellow Card's `amount` is **NGN kobo** (widest minor unit), derived at
`disbursementService.js:40-44` and asserted at `test/unit/ngn-amount.test.js:122`.
The Flutterwave body's `amount` pairs with `currency: "USDC"`, so it is USDC base
units.

**The adapter passes `amount` through verbatim and performs NO conversion, and the
kobo convention does not apply to this adapter.** A silent conversion is exactly the
class of defect that loses money, and this sprint has no verified FX or unit
convention for this leg. Locked by a test. The unit convention is **[UNVERIFIED]**
(§6 item 5).

### 3.5 Idempotency — `reference`

`reference` carries the `idempotency_key`. Local intent is recorded **before** the
external call (`upsertExternalRef` + `recordApiResponse`, `transitionActions.js:368-375`),
so a timeout after a successful provider call is recoverable rather than a
double-payout.

**What is NOT claimed:** whether Flutterwave *enforces* `reference` uniqueness. It is
a merchant-supplied string; duplicate-rejection behaviour is **[UNVERIFIED]** (§6
item 6). The load-bearing control is the **local** durable constraint
`idempotency_key TEXT UNIQUE NOT NULL` (`migrations/001_bos_schema.sql:43`, re-affirmed
`migrations/006_sprint_1_5.sql:4-18`). A `reference` that comes back not echoing the
key we sent is **logged**, not silently accepted.

### 3.6 Response normalization

`submitSend` returns `{ send_id, status, reference }`:

- `send_id` ← `data.id`
- `status` ← `_normalizeStatus(data.status)` → `'pending'` for the confirmed `NEW`
- `reference` ← `data.reference`

`lookupSend` returns `{ status, data }` — `data` is the full response, so
`recordApiResponse` evidence capture is byte-identical to Yellow Card's.

## 4. Status vocabulary → canonical BOS

Consumers of `lookupSend` read `pending | processing | completed | failed`
(`yellowcardAdapter.js:222-226`).

| Flutterwave `status` | Canonical | Reasoning |
|---|---|---|
| `NEW` | `pending` | The confirmed sandbox state. **Not** `processing` — the sandbox never leaves `NEW`, and `processing` would assert forward motion that does not exist. |
| `SUCCESSFUL` | `completed` | Only input that maps to `completed`. |
| `FAILED` | `failed` | Terminal. |
| `CANCELLED` / `REVERSED` | `failed` | **[UNVERIFIED]** that these states exist; mapped defensively. |
| absent / unrecognised | `pending` | Fail-safe default; **never** `completed`. |

**Fail-closed guarantee:** no input path returns `completed` unless the provider
explicitly said `SUCCESSFUL`.

## 5. Webhooks — `verif-hash`

Flutterwave's scheme is **not** an HMAC. There is no body digest anywhere in it.

- Header: `verif-hash`.
- Verification: **plain string comparison** against `FLW_SECRET_HASH`. The value is a
  static shared secret — it is *not* a function of the request body.
- Event: `transfer.completed`; outcome in `data.status`.

This is why the repo's single canonical HMAC verifier could not be reused and a
separate branch was added: `verifyHmac` computes `HMAC-SHA256(secret, body)`, and no
`verif-hash` value is ever such a digest, so routing Flutterwave through it would
silently reject **every** real Flutterwave webhook.

Implementation: `verifyFlutterwaveWebhook` in `webhookVerifier.js`; the route is
`POST /api/bos/webhooks/flutterwave`. Fails **closed** on an unset `FLW_SECRET_HASH`
(`{ valid: false, reason: 'no_secret_configured' }`) — an unconfigured secret
rejects, it never skips verification.

### 5.1 ⚠ SECURITY WARNING — `verif-hash` is weaker than Yellow Card's HMAC

Compared to Yellow Card's per-body HMAC, `verif-hash`:

- **Authenticates the sender only** (knowledge of the secret). It provides **no
  payload integrity** — a forged body with a valid hash verifies exactly as well as
  a genuine one.
- **Anyone who obtains `FLW_SECRET_HASH` can forge an arbitrary
  `transfer.completed` payload**, including a `SUCCESSFUL` outcome for a transfer
  that never happened.
- **Provides no replay protection.** A captured, valid request is replayable
  forever. This is a property of the scheme, not of this implementation — the
  adapter adds a timestamp/nonce check nowhere because the scheme has nowhere to put
  one.

**The load-bearing compensating control is NOT the signature. It is the local
`idempotency_key` UNIQUE constraint** (`migrations/001_bos_schema.sql:43`). A replayed
webhook derives its disbursement from `data.reference` (which carries the idempotency
key), collides on that constraint, and cannot advance a second payout. The handler
additionally models duplicate suppression, so a repeat delivery is acknowledged
without a state change. **If `FLW_SECRET_HASH` is rotated or the local uniqueness
constraint is ever relaxed, the replay risk becomes real** — those two are the control.

Operational guidance: treat `FLW_SECRET_HASH` as a credential — never committed, never
logged, rotated on a schedule. **Do not log the hash or the `verif-hash` header value.**

### 5.2 Event handling — fail closed

```
event === 'transfer.completed'  AND data.status === 'SUCCESSFUL'  -> completed
event === 'transfer.completed'  AND data.status === 'FAILED'      -> failed
data.status anything else                                       -> IGNORED (no state change)
event !== 'transfer.completed'                                  -> IGNORED (no state change)
```

Only an explicit terminal `SUCCESSFUL`/`FAILED` advances the state machine. Anything
else is acknowledged `200` — so the provider stops retrying — but changes **no** state.

## 6. Health check — `GET /v3/balances`

**[UNVERIFIED].** The sprint prompt hedged ("`GET /v3/balances` or equivalent") and
this endpoint is **not** in its confirmed list. `healthCheck()` returns
`{ healthy, latencyMs, data?, error? }` with a 5 s timeout and never throws. If it
404s against a real sandbox, only this one method needs correcting; it is isolated
behind the same four-method interface as the rest.

## 7. UNVERIFIED items

Platform limitations and modeled assumptions. **Modeled, not proven.** Each blocks any
"SANDBOX-VERIFIED" / production claim. Restated in
`docs/SPRINT_FLUTTERWAVE_REPORT.md` §UNVERIFIED and `docs/CLAIMS_REGISTER.md` §5.

1. **Live webhook delivery** — Flutterwave's sandbox does not finalize stablecoin
   transfers, so webhooks are never fired.
2. **The webhook payload shape** — `event` / `data.status` handling is built from
   documentation, never from a captured live payload.
3. **Live transfer finalization** — the sandbox transfer remained in `NEW` state.
4. **Field semantics of `amount` / `currency` / `debit_currency`** — the
   recipient-receives vs merchant-debited reading (§0, §3.3) is *inferred*, not
   verified.
5. **Unit convention for `amount`** — kobo does not apply; the USDC base-unit
   convention is assumed (§3.4).
6. **Whether Flutterwave enforces `reference` uniqueness** (§3.5).
7. **`GET /v3/balances`** for `healthCheck()` (§6).
8. **`CANCELLED` / `REVERSED` status values** — mapped defensively; existence
   unconfirmed (§4).
9. **`verif-hash` carries no payload integrity and no replay protection** — static
   shared secret (§5.1). The compensating control is local DB idempotency, not the
   signature.
10. **Webhook registration** — the adapter cannot register its own webhook target;
    that is a dashboard-side manual step and is **not implemented**.
11. **The Flutterwave off-ramp (USDC → NGN bank payout)** — not implemented at all;
    endpoint not verified offline, deferred to **P-7**.

## 8. References

- `src/services/bos/flutterwaveAdapter.js` — the adapter.
- `src/services/bos/webhookVerifier.js` — `verifyFlutterwaveWebhook`, `verifyWebhook('flutterwave', …)`.
- `src/routes/webhooks.js` — `POST /flutterwave`.
- `test/unit/flutterwave-contract.test.js`, `test/unit/flutterwave-webhook.test.js` — wire-contract tests, stubbed `fetch`, no network.
- `docs/PROVIDER_ADAPTERS.md` §2 — the Flutterwave adapter entry.
- `docs/SPRINT_FLUTTERWAVE_PLAN.md` — the reviewed plan (decisions D-1…D-5).
- `docs/POSTPONED_BACKLOG.md` — P-1 (provider routing), P-4 (this doc's breadth), P-7 (the off-ramp).
