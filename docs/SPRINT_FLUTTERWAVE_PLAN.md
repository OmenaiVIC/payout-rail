# SPRINT_FLUTTERWAVE_PLAN.md — Flutterwave Provider Adapter (Plan)

> **Status:** PLAN ONLY — awaiting review. Nothing implemented.
> Sprint source: `docs/prompts/12_SPRINT_FLUTTERWAVE_ADAPTER.md`
> Constraints: `docs/prompts/00_MASTER.md`, `docs/PRODUCT_CHANGE_CONTROL.md`
> Repo: `payout-rail` (standalone). **No CineX changes. No source files modified. No commits. No network calls.**

---

## 0. Executive summary

The adapter itself is straightforward and fits the existing pattern well. **Three findings
block or reshape parts of the sprint as written**, and one is a product-scope conflict that
`docs/PRODUCT_CHANGE_CONTROL.md` requires me to report *before* implementing:

| # | Finding | Severity |
|---|---|---|
| **B-1** | The documented Flutterwave wire body is **not an NGN local fiat payout**. It debits NGN and delivers **USDC to a Polygon wallet address**. This does not serve the product's local-payout leg. | **BLOCKER — needs decision** |
| **B-2** | **No corridor config object exists** in the codebase. Provider selection is not a config-field edit; the pipeline hard-codes `ctx.adapters.yellowcard` in **14 call sites**, 2 of which are in the **evidence chain**. | **BLOCKER — scope conflict** |
| **B-3** | Webhook verification needs a new branch in `webhookVerifier.js` + a new route in `webhooks.js`. Neither file is in the sprint's deliverable list. | In-scope but **undeclared** |
| B-4 | `FLW_PUBLIC_KEY` / `FLW_ENCRYPTION_KEY` are mandated but read by nothing → new doc-drift claim. | Decision needed |
| B-5 | `GET /v3/balances` for `healthCheck()` is **not** in the sprint's confirmed list (the prompt hedges: "or equivalent"). | Marked UNVERIFIED |

Everything else is Class **A** (required for this sprint) and proceeds as specified.

---

## 1. Phase 1 — Baseline (recorded)

Command: `npm test`

```
ℹ tests 189
ℹ suites 12
ℹ pass 188
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ duration_ms 17219.2303
```

Matches the sprint's expected `189/188/0/1` baseline exactly. **No environmental failures.**
This is the regression floor — implementation must finish at `189+N` tests, `0` failures.

---

## 2. Phase 0 — Inspection findings (what actually exists)

### 2.1 Adapter inventory

| File | Role |
|---|---|
| `src/services/bos/yellowcardAdapter.js` (484 L) | NGN payout REST client — **the pattern to mirror** |
| `src/services/bos/xreserveAdapter.js` (291 L) | On-chain observation (Hiro RPC) |
| `src/services/bos/StacksAdapter.js` | Stacks burn leg |
| `src/services/bos/webhookVerifier.js` (163 L) | **Single canonical HMAC verifier** |
| `src/services/bos/bridgeAdapterFactory.js` (87 L) | Adapter selection by env |
| `src/routes/webhooks.js` (69 L) | Yellow Card webhook receiver |

> **Naming note (not a blocker):** the sprint says `yellowCardAdapter.js`; the actual file is
> `yellowcardAdapter.js` (all lowercase). I will mirror the repo's lowercase style and name the
> new file `flutterwaveAdapter.js` exactly as the sprint specifies.

### 2.2 The real adapter interface (as *consumed*, not as documented)

`docs/PROVIDER_ADAPTERS.md` §1 describes the contract. The concrete consumption contract,
verified in code:

- `transitionActions.js:359` — `ctx.adapters.yellowcard.submitSend({...})` → reads `payout.send_id`, `payout.status`
- `transitionActions.js:391`, `transitionGuards.js:183` — `ctx.adapters.yellowcard.lookupSend(id)` → reads `.status`
- `yellowcardAdapter.js:36` — `classifyError(error)` → `'transient' | 'permanent' | 'unknown'`
- `yellowcardAdapter.js:146` — `verifyWebhookSignature(payload, signature, secret)`
- `yellowcardAdapter.js:321` — `healthCheck()` → `{ healthy, latencyMs, data?, error? }`
- `test/helpers/mockAdapters.js:13` — the documented test-double surface:
  `submitSend, lookupSend, healthCheck, verifyWebhookSignature`

**Interface parity target = the four methods above + `classifyError`.** The extra Yellow Card
methods (`listSends`, `getSendFee`, `resolveBankAccount`, `getChannels`, `getRates`) are
Yellow Card–specific conveniences, **not** interface, and are not required here.

### 2.3 There is no corridor config

`corridor` appears **exactly once** in `src/`: a display string at `scripts/demo-payout-ngn.js:1084`.

Corridor configuration in this repo is **distributed**, per `docs/PROVIDER_ADAPTERS.md` §5:

| Concern | Mechanism | Location |
|---|---|---|
| Rate pair | `DEFAULT_USDCX_NGN_RATE` | `disbursementService.js:40-44` |
| Minor-unit convention | hard-coded kobo derivation | `disbursementService.js:40-44` |
| Recipient registry | `BOS_RECIPIENT_REGISTRY` | `RecipientRegistry.js:21-25` |
| Gates / 2PA / breaker | env + `payoutGates.js` | `payoutGates.js` |
| Network | `PAYOUT_NETWORK` | `chainConfig.js:24` |

There is **no corridor object to add a `provider` field to.** This is finding **B-2**.

### 2.4 Provider selection is not a config edit

`ctx.adapters.yellowcard` is hard-coded at **14 sites**:

| File | Lines | Nature |
|---|---|---|
| `src/index.js` | 42 | adapter map construction |
| `src/services/bos/transitionActions.js` | 359, 391 | adapter calls |
| `src/services/bos/transitionActions.js` | 368, 390, 393 | `upsertExternalRef(..., 'yellowcard', 'payout_id', ...)` — **evidence** |
| `src/services/bos/transitionActions.js` | 375, 399 | `recordApiResponse({ adapter: 'yellowcard' })` — **evidence** |
| `src/services/bos/transitionGuards.js` | 183 | adapter call |
| `src/services/bos/reconciliationWorker.js` | 241, 487 | adapter calls |
| `src/services/bos/reconciliationWorker.js` | 246, 257, 268, 282 | `recordApiResponse({ adapter: 'yellowcard' })` — **evidence** |
| `src/services/bos/settlementReceipt.js` | 111, 204 | regex `/yellowcard\|lookupSend/i` over evidence `source` — **evidence chain** |

Making the provider genuinely selectable at runtime means changing all of them. The sprint's
**Scope (Out)** forbids *"Any change to the state machine"* and *"Any change to the evidence
chain."* `transitionActions.js` **is** the state machine's action layer; `settlementReceipt.js`
**is** the evidence chain. → **Direct scope conflict. See §8, Decision D-1.**

---

## 3. Product-scope contradiction (B-1) — READ BEFORE APPROVING

The sprint's documented body (`docs/prompts/12_SPRINT_FLUTTERWAVE_ADAPTER.md:67-78`):

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

**Under Flutterwave's documented Transfers semantics** — which I **cannot verify**, because
network calls are forbidden this sprint — `amount`/`currency` describe what the **recipient
receives**, and `debit_currency` describes what is **debited from the merchant balance**. If
that reading is right, this body means:

> Debit **NGN** from the Flutterwave merchant balance → deliver **USDC** to a **Polygon wallet address**.

That is a **stablecoin disbursement to a wallet**, not an NGN bank/momo payout. Consequences:

1. It does **not** serve the "Nigeria / NGN local payout rail" leg that the entire product
   thesis rests on (`00_MASTER.md:31`). It sits next to the *bridge* leg that `xreserveAdapter`
   already owns.
2. `destination` is a **wallet address**. The repo's recipient shape is **bank/momo** —
   `deriveRecipientType` (`transitionActions.js:562-568`) reads `type`, `bankCode`,
   `accountNumber`, `mobile_number`, `provider`. **There is no wallet-address field.** A
   Flutterwave payout cannot be populated from `disbursement.ngn_recipient` as it exists.
3. `network: "POLYGON"` hard-codes a non-Stacks settlement network into a Stacks product's
   local rail.

**I am not asserting the body is wrong** — the sprint states the sandbox accepted it. I am
asserting that **"this is a second NGN payout provider" is not yet a supportable claim**, and
that per `00_MASTER.md:95` (evidence over claims) and
`docs/PRODUCT_CHANGE_CONTROL.md:55` (stop and report scope conflicts) this must be resolved
before implementation. See §8, Decision D-2.

---

## 4. Change classification (`docs/PRODUCT_CHANGE_CONTROL.md`)

| Change | Class | Note |
|---|---|---|
| `flutterwaveAdapter.js` | **A** | Sprint scope 1 |
| `test/unit/flutterwave-contract.test.js` | **A** | Sprint scope 4 |
| `.env.example` — six FLW vars | **A** | Sprint scope 3 |
| `docs/PROVIDER_ADAPTERS.md`, `ARCHITECTURE.md`, `README.md`, `COMMERCIAL_MODEL.md`, `CLAIMS_REGISTER.md` | **A** | Sprint scope 5 |
| `docs/SPRINT_FLUTTERWAVE_REPORT.md` | **A** | Sprint scope 5 |
| `docs/flutterwave-api-reference.md` | **B** | Required by this repo's own documented adapter process (`PROVIDER_ADAPTERS.md` §4.2: *"Write the reference doc first... one per provider"*). Missing from the sprint's list. |
| `webhookVerifier.js` — new `verifyFlutterwaveWebhook` + `verifyWebhook` case | **A** | Unavoidable; see §6 |
| `routes/webhooks.js` — `POST /api/bos/webhooks/flutterwave` | **A** | Unavoidable; see §6 |
| `bridgeAdapterFactory.js` — `getFlutterwaveAdapter()` | **A** | Sprint scope 2 (minimal reading) |
| `src/index.js` — add `flutterwave` key to adapter map | **A** | Additive; default path unchanged |
| Pipeline provider **routing** (14 sites) | **D** | **NOT in this sprint** → `docs/POSTPONED_BACKLOG.md` |
| Extracting shared `classifyError` to a common module | **D** | Would touch the Yellow Card adapter = Scope (Out) |
| KES/ZAR corridor entries | **E** | Out of scope |

---

## 5. The adapter — exact structure

**File:** `src/services/bos/flutterwaveAdapter.js` (new)
**Pattern source:** `src/services/bos/yellowcardAdapter.js`

### 5.1 Module header constants

```js
const FLW_BASE_URL       = process.env.FLW_BASE_URL || 'https://api.flutterwave.com/v3';
const FLW_SECRET_KEY     = process.env.FLW_SECRET_KEY || '';
const FLW_MERCHANT_ID    = process.env.FLW_MERCHANT_ID || '';

// Documented-wire constants. NOT env-configurable in this sprint — the sprint
// fixes exactly six FLW_* variables. Overridable per-call via the recipient
// object so a future corridor can retarget without a new env var.
const FLW_ACCOUNT_BANK   = 'flutterwave';
const FLW_NETWORK        = 'POLYGON';
const FLW_DEBIT_CURRENCY = 'NGN';   // fallback; `currency` param wins when supplied
const FLW_SETTLE_CURRENCY = 'USDC';
```

> `FLW_SECRET_HASH` is deliberately **not** a module constant — see §6.2 (lazy read for
> fail-closed testability).

### 5.2 Exported surface

```js
export function classifyError(error)                                  // identical taxonomy
export async function submitSend({ idempotency_key, amount, currency,
                                   recipient_type, recipient, callback_url })
export async function lookupSend(sendId)
export async function healthCheck()
export async function verifyFlutterwaveWebhook(rawBody, headers)      // NEW (see §6)
export function verifyWebhookSignature(rawBody, signature,
                                       secret = process.env.FLW_SECRET_HASH || '')
export default { submitSend, lookupSend, healthCheck,
                 verifyWebhookSignature, classifyError }
```

### 5.3 Internal helpers (mirroring Yellow Card)

| Helper | Purpose | Mirrors |
|---|---|---|
| `_headers(extra)` | `Content-Type: application/json` + `Authorization: Bearer {FLW_SECRET_KEY}` | `yellowcardAdapter.js:87` |
| `_fetch(url, options, {timeoutMs})` | `AbortController` timeout, stamps `err._classification` | `yellowcardAdapter.js:101` |
| `_normalizeStatus(raw)` | Flutterwave → canonical BOS status | `yellowcardAdapter.js:459` |
| `_safeEqual(a, b)` | timing-safe string compare for `verif-hash` | new (§6.2) |

### 5.4 `classifyError` — unchanged taxonomy

Identical to `yellowcardAdapter.js:36-46` and `xreserveAdapter.js:41-51`:

| Input | Class |
|---|---|
| `error.name === 'AbortError'` (timeout) | `transient` |
| `TypeError` mentioning `fetch` | `transient` |
| `status === 429` | `transient` |
| `status >= 500` | `transient` |
| `400 <= status < 500` | `permanent` |
| anything else | `unknown` |

**No interface change.** Duplicating the taxonomy matches the existing repo state (it is already
duplicated in two adapters). Extracting it is logged **D-class** in §12.

### 5.5 `_normalizeStatus` — Flutterwave → canonical BOS

Canonical vocabulary in use by `lookupSend` consumers is
`pending | processing | completed | failed` (`yellowcardAdapter.js:222-226`).

| Flutterwave `status` | Canonical | Reasoning |
|---|---|---|
| `NEW` | `pending` | The confirmed sandbox state. **Not** `processing` — the sandbox never leaves `NEW`, and `processing` would assert forward motion that does not exist. `pending` is the honest mapping. |
| `SUCCESSFUL` | `completed` | Matches `yellowcardAdapter.js:461` (`successful` → `completed`). |
| `FAILED` | `failed` | Terminal. |
| `CANCELLED` / `REVERSED` | `failed` | **UNVERIFIED** that these states exist; mapped defensively, flagged. |
| absent / unrecognised | `pending` | Fail-safe default; never `completed`. |

**Fail-closed guarantee:** no input path returns `completed` unless the provider explicitly said
`SUCCESSFUL`.

---

## 6. Webhook verification logic

### 6.1 Why this is new code, not a config change

The repo has **one canonical verifier**, `webhookVerifier.js`, and it is **HMAC-only**:
`verifyHmac` computes `HMAC-SHA256(secret, body)` and compares. `webhooks.js:26` calls
`verifyYellowCardWebhook(rawBody, req.headers)` over the raw body.

Flutterwave uses a **different scheme entirely**: a static shared-secret **plain string
comparison** of the `verif-hash` header against `FLW_SECRET_HASH`. It is not a function of the
body at all. It therefore **cannot** be expressed through `verifyHmac`, and reusing
`verifyYellowCardWebhook` would silently reject every real Flutterwave webhook.

Required, additive, and non-breaking:
1. `webhookVerifier.js` → add `verifyFlutterwaveWebhook(rawBody, headers)`
2. `webhookVerifier.js` → add `case 'flutterwave':` to `verifyWebhook` (`webhookVerifier.js:147-156`)
3. `routes/webhooks.js` → add `POST /api/bos/webhooks/flutterwave`
4. `bridgeAdapterFactory.js` → export `getFlutterwaveAdapter()`
5. `src/index.js:39-43` → add `flutterwave: getFlutterwaveAdapter()` to the adapters map

The existing Yellow Card path is **not touched** — pure addition.

### 6.2 Verification logic (exact)

```
verifyFlutterwaveWebhook(rawBody, headers):
    secret = process.env.FLW_SECRET_HASH            # lazy read, see below
    if (!secret)          -> { valid: false, reason: 'no_secret_configured' }   # FAIL CLOSED
    signature = headers['verif-hash'] || ''
    if (!signature)       -> { valid: false, reason: 'missing_signature' }
    return _safeEqual(signature, secret)
        ? { valid: true }
        : { valid: false, reason: 'invalid_signature' }
```

**Four properties, each load-bearing:**

1. **Fail closed on unset secret** — `00_MASTER.md:137`. A missing `FLW_SECRET_HASH` rejects
   **every** webhook. Never skips verification. Mirrors the existing
   `no_secret_configured` contract (`webhookVerifier.js:92-94`, `webhookVerifier.js:121-123`)
   and is directly testable (sprint test #7).
2. **Lazy env read** — `secret` is read *inside* the function, not at module load. The Yellow
   Card adapter binds its default at module scope (`yellowcardAdapter.js:28`), which forces tests
   to use cache-busted re-imports (`?case=`, `test/unit/yellowcard-auth.test.js:44`). A default
   *parameter* (`secret = process.env.FLW_SECRET_HASH || ''`) is evaluated per call, so the
   unset case is testable directly. **Deviation D-2** (§11).
3. **Timing-safe comparison** — `crypto.timingSafeEqual` on equal-length buffers, matching the
   repo's existing posture (`webhookVerifier.js:70`). Flutterwave documents a plain `===`;
   timing-safe is a strict improvement with identical observable behaviour. **Deviation D-3** (§11).
4. **`rawBody` is accepted but deliberately unused for the comparison.** It is kept in the
   signature for interface parity with `verifyYellowCardWebhook` and so the route can log a
   body digest. It provides **no** integrity guarantee — see the warning below.

### 6.3 Security warning that MUST appear in code and docs

`verif-hash` is a **static shared secret**. Compared to Yellow Card's per-body HMAC:

- It authenticates the *sender* (knowledge of the secret) but provides **no payload integrity**.
- Anyone who obtains `FLW_SECRET_HASH` can forge an arbitrary `transfer.completed` payload.
- It provides **no replay protection** — a captured valid request is replayable forever.

**Mitigations that make this safe enough to ship:**

- The BOS already enforces **durable local idempotency**: `idempotency_key TEXT UNIQUE NOT NULL`
  (`migrations/001_bos_schema.sql:43`, re-affirmed `migrations/006_sprint_1_5.sql:4-18`), with
  deterministic keys from `disbursementService.js`. A replayed webhook collides on that
  constraint and cannot advance a second payout. This is the load-bearing control, exactly as
  the `idempotent-financial-workflows` skill requires ("prefer durable DB constraints over
  in-memory dedupe", "do not hide duplicate/conflict behavior").
- `handleYellowCardWebhook` already models duplicate suppression; the Flutterwave handler
  reuses that pattern.

**Recommendation for the reviewer:** rotate `FLW_SECRET_HASH` on a schedule and treat it as a
credential in `.env.example` (never committed, never logged). **Do not** log the hash or the
`verif-hash` header value.

### 6.4 Route (mirrors `webhooks.js:35-48`)

```
POST /api/bos/webhooks/flutterwave
  1. require Buffer.isBuffer(req.rawBody)  -> 401 raw_body_unavailable
  2. verifyFlutterwaveWebhook(req.rawBody, req.headers)
       invalid -> 401 { processed: false, reason }
  3. handleFlutterwaveWebhook(req.body, { signatureValid: true })
       -> 200 result | 500 on throw
```

Verify-first / parse-second / handle-idempotently-third, per the `webhook-handler-patterns`
skill. `express.json({ verify })` at `src/index.js:22` already captures `req.rawBody`.

### 6.5 Event handling (documented, not captured)

Per the sprint: `event: "transfer.completed"`, outcome in `data.status`.

```
event === 'transfer.completed'          -> process
data.status === 'SUCCESSFUL'            -> completed
data.status === 'FAILED'                -> failed
data.status === anything else           -> IGNORED (no state change)   # fail closed
event !== 'transfer.completed'          -> IGNORED (no state change)   # fail closed
```

**Fail-closed:** only an explicit terminal `SUCCESSFUL`/`FAILED` advances the state machine.
Anything else is acknowledged `200` (so the provider stops retrying) but changes **no** state.
This directly implements `00_MASTER.md:137`.

**Handler name:** `handleFlutterwaveWebhook` in `disbursementService.js`, delegating to the
same idempotent core as `handleYellowCardWebhook`. The handler must derive the disbursement from
`data.reference` (which carries the idempotency key) — **not** from a provider transfer id,
because the repo's durable uniqueness is on `idempotency_key`.

---

## 7. The exact wire body for `submitSend`

### 7.1 Target body — byte-for-byte the sprint's documented shape

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

### 7.2 Field mapping

| Wire field | Source | Notes |
|---|---|---|
| `account_bank` | constant `"flutterwave"` | Confirmed (`prompt:25`) |
| `account_number` | `process.env.FLW_MERCHANT_ID` | **The merchant's own id — not the recipient's.** Differs from Yellow Card, where `destination.accountNumber` is the recipient. |
| `debit_currency` | `currency` param, else `"NGN"` | See §7.3 — **inverted vs Yellow Card** |
| `amount` | `amount` param, **verbatim** | See §7.4 — **NOT kobo** |
| `currency` | constant `"USDC"` | See §7.3 |
| `network` | `recipient?.network` else `"POLYGON"` | Hard-codes a non-Stacks network — see §3 |
| `destination` | `recipient?.walletAddress \|\| recipient?.address \|\| recipient?.destination \|\| ''` | **Wallet address — see §3.2** |
| `reference` | `idempotency_key` param | Idempotency carrier — see §7.5 |

`callback_url` is **accepted and ignored**: Flutterwave registers webhook targets in dashboard
settings, not per transfer. Documented in the JSDoc as such (same treatment as
`yellowcardAdapter.js:177`).

### 7.3 Decision D-4 — the `currency` / `debit_currency` inversion

The pipeline calls `submitSend({ currency: 'NGN' })` (`transitionActions.js:362`).

- **Literal pass-through** (`currency` → body `currency`) would emit `currency: "NGN"`,
  `debit_currency: "NGN"` — **not** the documented body. **Fails AC #2.**
- **Recommended mapping** (inverts the two): `debit_currency` ← `currency` param,
  body `currency` ← `"USDC"` constant. This **reproduces the documented body exactly** while
  keeping interface parity with the real call site.

**I recommend the recommended mapping** — it is the only option that satisfies AC #2 with the
pipeline's actual call shape. But it means the parameter named `currency` lands in a field whose
meaning is the *opposite* of Yellow Card's. That will confuse every future reader.

**This is a strong second symptom of B-1.** If the wire body is a USDC-to-wallet disbursement,
it is not the local payout leg, and no amount of field-mapping will make it one. Flagged for
Decision **D-2**; the mapping choice is Decision **D-4**.

### 7.4 Units — explicit non-conversion

Yellow Card's `amount` is **NGN kobo** (widest minor unit), derived at
`disbursementService.js:40-44` and asserted at `test/unit/ngn-amount.test.js:122`.

The Flutterwave body's `amount` pairs with `currency: "USDC"`, so it is **USDC base units**.

**The adapter passes `amount` through verbatim and performs NO conversion.** Rationale: a
silent conversion is exactly the class of defect that loses money, and this sprint has no
verified FX or unit convention for the Flutterwave leg. The unit convention is recorded as
**UNVERIFIED** (§9). The JSDoc and `docs/flutterwave-api-reference.md` must both state loudly:
**the kobo convention does not apply to this adapter.**

### 7.5 Idempotency — `reference`

`reference` carries `idempotency_key`. Per the `idempotent-financial-workflows` skill, local
intent is recorded **before** the external call (the pipeline's `upsertExternalRef` +
`recordApiResponse` at `transitionActions.js:368-375` already do this), so a timeout after a
successful provider call is recoverable, not a double-payout.

**What is NOT claimed:** whether Flutterwave *enforces* `reference` uniqueness. It is a
merchant-supplied string; duplicate-rejection behaviour is **UNVERIFIED** (§9). Local durable
protection (`migrations/001_bos_schema.sql:43`) is the control that actually holds. Per the
skill's guardrail — *"do not hide duplicate/conflict behavior; log it in metrics or stored
state"* — a returned `reference` that does not echo the key is logged, not silently accepted.

### 7.6 `submitSend` return value

```js
{ send_id, status, reference }
```

- `send_id` ← `data.id` (confirmed present, `prompt:27`)
- `status` ← `_normalizeStatus(data.status)` → `'pending'` for the confirmed `NEW`
- `reference` ← `data.reference` (idempotency evidence; logged if it ≠ the key we sent)

### 7.7 `lookupSend(sendId)`

```
GET {FLW_BASE_URL}/transfers/{sendId}
Authorization: Bearer {FLW_SECRET_KEY}
```

Confirmed endpoint (`prompt:29`). Returns `{ status, data }` — `data` is the full response,
mirroring `yellowcardAdapter.js:234-237` so `recordApiResponse` evidence capture is unchanged.

### 7.8 `healthCheck()`

```
GET {FLW_BASE_URL}/balances
```

Returns `{ healthy, latencyMs, data?, error? }`; 5 s timeout, mirroring
`yellowcardAdapter.js:321-334`. Never throws.

**Marked UNVERIFIED** — the sprint hedges ("or equivalent", `prompt:61`) and
`GET /v3/balances` is **not** in the confirmed list (`prompt:23-33`). If it 404s in a real
sandbox, only this one method needs correcting; it is isolated behind the same four-method
interface.

---

## 8. Decisions required before implementation

| ID | Decision | Recommendation |
|---|---|---|
| **D-1** | **Provider selection depth.** (a) Config/factory layer only, pipeline untouched. (b) Full runtime routing across all 14 sites. | **(a).** (b) requires changing the state machine's action layer and the evidence chain — both explicitly Scope (Out) (`prompt:183,185`) — and would need explicit re-authorization. Logs the delta to `POSTPONED_BACKLOG.md`. |
| **D-2** | **Is a USDC-to-wallet disbursement an acceptable second provider** for a product whose thesis is NGN *local fiat* payouts? (§3) | **Escalate to product owner.** Do not let the sprint's framing ("second payout provider", `prompt:13-17`) stand unexamined. If the answer is no, the wire body needs a bank/momo destination and the sprint is re-specified. |
| **D-3** | `FLW_PUBLIC_KEY` / `FLW_ENCRYPTION_KEY` are mandated but read by nothing. | **Document them in `.env.example` explicitly as "reserved — not read by this adapter."** Prevents a repeat of the `YELLOW_CARD_ENV` doc-drift claim already recorded at `CLAIMS_REGISTER.md:55`. Alternatively defer both to the backlog. |
| **D-4** | `currency`/`debit_currency` inversion (§7.3). | Adopt the recommended mapping; loud documentation. Revisit if D-2 changes the wire body. |
| **D-5** | Recipient shape: pipeline `ngn_recipient` has **no wallet-address field** (§3.2). | Adapter reads `recipient.walletAddress \|\| recipient.address \|\| recipient.destination`, and **throws a named error** if all are absent — fail closed, never send an empty `destination`. No schema change in this sprint. |

---

## 9. UNVERIFIED list (carried verbatim into the sprint report)

These are **platform limitations, not adapter defects** (`prompt:175`). They must appear in
`docs/SPRINT_FLUTTERWAVE_REPORT.md` and as a `CLAIMS_REGISTER.md` §5 row.

### 9.1 From the sprint (verbatim, `prompt:163-171`)

1. **Live webhook delivery is UNVERIFIED** — Flutterwave's sandbox does not finalize stablecoin
   transfers, so webhooks are never fired.
2. **The webhook payload shape is documented but not captured from a live webhook** — the
   `event`/`data.status` handling in §6.5 is built from documentation, never from a real payload.
3. **Live transfer finalization is UNVERIFIED** — the sandbox transfer remained in `NEW` state.

### 9.2 Additional UNVERIFIED items found during inspection

4. **Field semantics of `amount` / `currency` / `debit_currency`** — the recipient-receives vs
   merchant-debited reading (§3) is inferred, not verified. Drives D-2/D-4.
5. **Unit convention for `amount`** — kobo does not apply; the USDC base-unit convention is
   assumed (§7.4).
6. **Whether Flutterwave enforces `reference` uniqueness** as an idempotency key (§7.5).
7. **`GET /v3/balances` for `healthCheck()`** — endpoint not in the confirmed list (§7.8).
8. **`CANCELLED` / `REVERSED` status values** — mapped defensively; existence unconfirmed (§5.5).
9. **`verif-hash` carries no payload integrity and no replay protection** — static shared
   secret (§6.3). Compensating control is local DB idempotency, not the signature.
10. **Flutterwave webhook registration** — the adapter cannot register its own webhook target;
    that is a dashboard-side manual step and is not implemented.

### 9.3 What the evidence *does* support

Per the sprint's confirmed list (`prompt:23-33`), stated as **sandbox-confirmed by the operator
before this sprint** — recorded as reported, not independently reproduced here (no network
calls were made):

- `POST /v3/transfers` with `account_bank: "flutterwave"` queues a stablecoin transfer
- Response includes `id`, `status` (`NEW`), `amount`, `currency`, `debit_currency`, `fee`,
  `reference`, `meta.debit_currency_amount`
- `GET /v3/transfers/{id}` returns current transfer status
- Auth is `Authorization: Bearer {FLW_SECRET_KEY}`
- Base URL is `https://api.flutterwave.com/v3`

**Claim classification for `docs/CLAIMS_REGISTER.md` §5:**
`IMPLEMENTED + TESTED (wire-level, stubbed fetch)` — **sandbox/live UNVERIFIED** by this
repository. This exactly matches the Yellow Card row's honesty tier
(`CLAIMS_REGISTER.md:82-84`) and `PROVIDER_ADAPTERS.md` §3.

---

## 10. Test files to create

### 10.1 `test/unit/flutterwave-contract.test.js` (new) — the 8 mandated tests

Harness: stub `globalThis.fetch`, capture calls, restore in `test.after`. No network. Mirrors
`test/unit/yellowcard-submit-send-contract.test.js:22-64`.

| # | Test | Asserts |
|---|---|---|
| 1 | `submitSend` sends the documented body shape | `Object.keys(body).sort()` deep-equals the 8 documented keys; each value correct; **no legacy keys leak** (mirrors `:105-107`) |
| 2 | Auth header is `Bearer {FLW_SECRET_KEY}` | `options.headers.Authorization === 'Bearer flw_secret_test'` |
| 3 | `reference` carries the idempotency key | `body.reference === idempotency_key`; echoed `data.reference` returned |
| 4 | `lookupSend` calls the correct endpoint | `url === ${FLW_BASE_URL}/transfers/flw-1`, method `GET` |
| 5 | `verifyWebhookSignature` accepts a matching hash | `true` |
| 6 | `verifyWebhookSignature` rejects a mismatched hash | `false` |
| 7 | `verifyWebhookSignature` **fails closed** when `FLW_SECRET_HASH` unset | `false` (lazy read makes this a direct assertion) |
| 8 | `classifyError` taxonomy | `400`→`permanent`, `500`→`transient`, `429`→`transient`, `AbortError`→`transient`, `{}`→`unknown` |

### 10.2 Additional tests in the same file (Class A — required for the code actually added)

| # | Test | Why |
|---|---|---|
| 9 | `submitSend` normalizes `NEW` → `pending` (not `processing`) | Locks §5.5's honesty guarantee |
| 10 | `submitSend` normalizes `SUCCESSFUL` → `completed`, `FAILED` → `failed` | Status vocabulary contract |
| 11 | `submitSend` throws a named error when no wallet address is present | **Fail-closed**, D-5 |
| 12 | `submitSend` 4xx → permanent / 5xx → transient via `classifyError` | Mirrors `yellowcard-submit-send-contract.test.js:152-160` |
| 13 | `amount` passed through **verbatim**, no kobo conversion | Locks §7.4 |
| 14 | `healthCheck()` returns `healthy: false` without throwing on network error | Never throws |
| 15 | `callback_url` accepted and **not** sent in the body | Interface parity, documented |
| 16 | Request timeout aborts and classifies `transient` | `_fetch` path |

### 10.3 `test/unit/flutterwave-webhook.test.js` (new) — route/verifier logic

Required because §6 adds a real verification branch and a real route. Without these, the
fail-closed path is untested.

| # | Test | Why |
|---|---|---|
| 1 | `verifyFlutterwaveWebhook` accepts matching `verif-hash` | positive path |
| 2 | rejects mismatched hash → `invalid_signature` | |
| 3 | missing header → `missing_signature` | |
| 4 | unset `FLW_SECRET_HASH` → `no_secret_configured` (**fail closed**) | `00_MASTER.md:137` |
| 5 | `verifyWebhook('flutterwave', ...)` dispatches to it | switch case |
| 6 | `verifyWebhook('yellowcard', ...)` **still** works — **regression guard** | the additive claim |
| 7 | non-`transfer.completed` event → ignored, no state change | fail closed |
| 8 | `data.status` `NEW`/unknown → ignored, no state change | fail closed |
| 9 | **duplicate** `transfer.completed` for the same `reference` → no second advance | idempotency, per the `idempotent-financial-workflows` skill |
| 10 | **replayed** identical request (same hash) → still no double-advance | §6.3 replay warning |

### 10.4 Regression requirement

Full suite must finish at **189 + ~26 new = ~215 tests, 0 failures.** The skipped test stays
skipped. No existing test may be edited, weakened, or deleted
(`00_MASTER.md:411-413`).

---

## 11. Deviations from the existing adapter pattern

| ID | Deviation | Reason | Risk |
|---|---|---|---|
| **D-2** | `FLW_SECRET_HASH` read **lazily inside** the function, not bound at module load like `yellowcardAdapter.js:28`. | Makes the mandated fail-closed test (#7) directly assertable without cache-busted re-imports. Default *parameters* are per-call, so the public signature is unchanged. | None — strictly more testable. |
| **D-3** | `crypto.timingSafeEqual` instead of Flutterwave's documented plain `===`. | Matches the repo's existing security posture (`webhookVerifier.js:70`). Identical observable behaviour. | None. |
| **D-4** | `currency` param → `debit_currency`; body `currency` ← constant `"USDC"`. | Only mapping that reproduces the documented body from the pipeline's real call shape (§7.3). | **High — see B-1/D-2.** Inverted semantics; must be loudly documented. |
| **D-5** | `destination` reads a **wallet address**; throws if absent. | Pipeline recipient shape has no wallet field (§3.2). Fail closed beats sending an empty destination. | Medium — blocks real NGN-payout use until the recipient shape is extended (→ backlog). |
| **D-6** | `NEW` → `pending`, **not** `processing`. | The sandbox never leaves `NEW`. `processing` would assert motion that does not exist (`00_MASTER.md:95`). | None. |
| **D-7** | `classifyError` **duplicated** rather than extracted to a shared module. | Extraction would modify `yellowcardAdapter.js` = Scope (Out) (`prompt:189`). Matches the repo's current state (already duplicated twice). | Low — third copy. Logged **D-class** in §12. |
| **D-8** | No `signWebhook` export. | Flutterwave has no HMAC signing mode; there is nothing to sign with. Yellow Card's exists only because YC signs with a shared secret. | None. |
| **D-9** | `listSends` / `getSendFee` / `getChannels` / `getRates` **not** implemented. | Yellow Card conveniences, not interface. `docs/PROVIDER_ADAPTERS.md` §1 defines the contract as "one function per external operation **the pipeline needs**". | None. |
| **D-10** | `initiatePayout` / `getPayoutStatus` deprecated aliases **not** added. | New adapter — no legacy callers to keep compatible. Adding them would imply a deprecation history that does not exist. | None. |
| **D-11** | Network-level `_safeEqual` in `webhookVerifier.js`, not in the adapter. | Keeps verification in the single canonical verifier, per `PROVIDER_ADAPTERS.md` §1.3. | None. |

---

## 12. Postponed backlog entries to add (`docs/POSTPONED_BACKLOG.md`)

Per `docs/PRODUCT_CHANGE_CONTROL.md:35-52`. **Not implemented.**

| ID | Item | Class | Why deferred |
|---|---|---|---|
| **P-1** | **Pipeline provider routing** — resolve the payout adapter per corridor at all 14 hard-coded `ctx.adapters.yellowcard` sites (`transitionActions.js:359,368,375,390,391,393,399`; `transitionGuards.js:183`; `reconciliationWorker.js:241,246,257,268,282,487`; `settlementReceipt.js:111,204`); parameterise `upsertExternalRef`/`recordApiResponse` provider keys and the `settlementReceipt` evidence regex. | **D** | Requires changing the state machine's action layer and the **evidence chain** — both Scope (Out) (`prompt:183,185`). Needs explicit re-authorization. Blocks any real non-default-provider routing (D-1). |
| **P-2** | **Recipient shape extension** for wallet-address destinations, so `ngn_recipient` can populate `destination`. | **D** | Requires a schema/migration change (a sprint "Blocker to Report" item, `prompt:345`) and depends on D-2. |
| **P-3** | **Extract shared `classifyError` taxonomy** into a common module (currently duplicated in `yellowcardAdapter.js` and `xreserveAdapter.js`). | **D** | Would modify the Yellow Card adapter = Scope (Out) (`prompt:189`). |
| **P-4** | **`docs/flutterwave-api-reference.md` breadth** — a full reference mirroring `yellowcard-api-reference.md`. This sprint writes a **stub** version sourced **only** from the sprint prompt (no network calls permitted), so most fields carry UNVERIFIED markers. | **D** | Completing it requires fetching current Flutterwave v3 documentation — forbidden this sprint. |
| **P-5** | **Provider-agnostic route** (`POST /api/bos/webhooks/:provider`) replacing per-provider routes. | **D** | Two routes is duplication, but a generic route weakens the verify-first explicitness. Revisit at three providers. |
| **P-6** | **Live sandbox verification loop** (auth → submit → poll → webhook) for Flutterwave, mirroring G-20. | **D** | Blocked by the platform limitation in §9.1 #1/#3 — sandbox stablecoin transfers never finalize, so webhooks are never fired. Not an adapter defect. |

---

## 13. Environment variables — names and defaults

Added to `.env.example` under the existing `# Adapters` block (after line 22):

```bash
# Flutterwave — second payout provider (Sprint 12)
# v3 bearer secret key. Server-side only. Never commit, never log.
FLW_SECRET_KEY=
# v3 public key. RESERVED — not read by flutterwaveAdapter.js (see SPRINT_FLUTTERWAVE_PLAN D-3)
FLW_PUBLIC_KEY=
# v3 encryption key. RESERVED — not read by flutterwaveAdapter.js (see SPRINT_FLUTTERWAVE_PLAN D-3)
FLW_ENCRYPTION_KEY=
# Webhook verification hash for the `verif-hash` header.
# FAIL CLOSED: if unset, every Flutterwave webhook is rejected with 401.
FLW_SECRET_HASH=
# Merchant ID sent as `account_number` on POST /v3/transfers
FLW_MERCHANT_ID=
FLW_BASE_URL=https://api.flutterwave.com/v3
```

| Variable | Default | Read at | Purpose | Read by code? |
|---|---|---|---|---|
| `FLW_SECRET_KEY` | `''` | module load | `Authorization: Bearer …` | ✅ |
| `FLW_PUBLIC_KEY` | `''` | — | — | ❌ **reserved (D-3)** |
| `FLW_ENCRYPTION_KEY` | `''` | — | — | ❌ **reserved (D-3)** |
| `FLW_SECRET_HASH` | `''` | **call time** | `verif-hash` compare; fail closed | ✅ (lazily, D-2) |
| `FLW_MERCHANT_ID` | `''` | module load | body `account_number` | ✅ |
| `FLW_BASE_URL` | `https://api.flutterwave.com/v3` | module load | base for `/transfers`, `/balances` | ✅ |

All six are blank-by-default; **no secret has a working default.** `FLW_BASE_URL` is the only
one with a non-empty default, matching `YELLOW_CARD_API_URL`'s pattern
(`yellowcardAdapter.js:24`).

`FLW_SECRET_HASH` is documented with an explicit fail-closed warning so an operator cannot
silently deploy a receiver that rejects every webhook.

---

## 14. Documentation updates (exact)

| File | Change | Class |
|---|---|---|
| `docs/PROVIDER_ADAPTERS.md` | §2 new "Flutterwave" subsection (surface, `Bearer` auth, endpoints, `verif-hash` verification, `healthCheck` caveat); §3 UNVERIFIED table row; §1 interface note on the non-HMAC scheme; §4 note that step 2's reference doc was written from the sprint prompt only | A |
| `docs/ARCHITECTURE.md` | §5 adapter boundary — document the second provider, the non-HMAC verification branch, and that provider *routing* is not yet implemented (P-1) | A |
| `README.md` | Line 63 corridor-configuration line — name two providers, and state that selection is available at the config layer while pipeline routing is pending (P-1) | A |
| `docs/COMMERCIAL_MODEL.md` | §Key Partners table (line 255-261) — add Flutterwave row, role "second payout provider adapter (wire-level tested)", **no** licence/regulatory claim (`00_MASTER.md:191`) | A |
| `docs/CLAIMS_REGISTER.md` | §5 row: IMPLEMENTED + TESTED (wire-level, stubbed fetch) / sandbox-live UNVERIFIED, listing §9.1-§9.2; update the §6 summary bullet to include Flutterwave | A |
| `docs/flutterwave-api-reference.md` | **New.** Stub reference built only from the sprint prompt. Every unconfirmed field carries an explicit UNVERIFIED marker. Sourced from `prompt:23-45` only. | B |
| `docs/SPRINT_FLUTTERWAVE_REPORT.md` | **New.** Sprint report; §9 UNVERIFIED list reproduced verbatim; D-1..D-5 decisions recorded | A |
| `docs/POSTPONED_BACKLOG.md` | P-1 … P-6 (§12) | A |

**Language rules applied to every file** (`00_MASTER.md:95,191,196`):
- "wire-contract tested" / "stubbed fetch" — **never** "integrated", "live", "production-ready".
- "sandbox-confirmed by the operator" attributed, not independently reproduced.
- No regulatory, licensing, or KYC/AML claim for Flutterwave.
- No production-readiness claim.

---

## 15. Implementation sequence (post-approval)

One commit per logical change, per `refactoring` skill. No `--no-verify`.

| # | Commit | Contents |
|---|---|---|
| 1 | `docs: add Flutterwave API reference stub` | `flutterwave-api-reference.md` (reference-first, per `PROVIDER_ADAPTERS.md` §4.2) |
| 2 | `test: add failing Flutterwave wire-contract tests` | **Red.** All 8 mandated + 8 additional |
| 3 | `feat: add FlutterwaveAdapter` | **Green.** `flutterwaveAdapter.js` |
| 4 | `feat: add Flutterwave webhook verification` | `webhookVerifier.js` branch + `verifyWebhook` case |
| 5 | `test: add Flutterwave webhook contract tests` | Red → green for §10.3 |
| 6 | `feat: add Flutterwave webhook route` | `webhooks.js` + `disbursementService.js` handler |
| 7 | `feat: register Flutterwave adapter in factory and ctx` | `bridgeAdapterFactory.js` + `index.js` (**additive only**) |
| 8 | `test: add corridor provider-selection config test` | Asserts default is `yellowcard`, no behaviour change |
| 9 | `docs: document six FLW env vars` | `.env.example` |
| 10 | `docs: update provider, architecture, commercial, claims docs` | 4 files |
| 11 | `docs: add Flutterwave sprint report and backlog entries` | Report + P-1..P-6 |

Steps 2→3 and 5 are strict red→green. Steps 4 and 6 are separate so the verification branch is
reviewable independently of the route.

**Refactoring discipline:** steps 7 and 8 are the only steps touching existing runtime code, and
both are **purely additive** — the `yellowcard` key and every `ctx.adapters.yellowcard` call site
are untouched, so with `PAYOUT_PROVIDER` defaulting to `yellowcard` the runtime behaviour is
bit-identical. Verified by the full suite staying green at every commit.

---

## 16. Acceptance criteria → plan mapping

| AC (`prompt:229-253`) | Where satisfied | Status |
|---|---|---|
| 1. Adapter exists, same interface | §5.2 — 4 methods + `classifyError` | planned |
| 2. `submitSend` sends documented v3 body | §7.1-§7.2, test #1 | planned, **depends on D-4** |
| 3. `lookupSend` correct endpoint | §7.7, test #4 | planned |
| 4. `verif-hash` vs `FLW_SECRET_HASH`, fail closed | §6.2, tests #5-#7, §10.3 #1-#4 | planned |
| 5. Corridor config supports provider selection | **§8 D-1** — config/factory layer only | **blocked on D-1** |
| 6. `.env.example` documents all six FLW vars | §13 | planned, **D-3** on the two reserved |
| 7. Wire-contract tests pass | §10.1, §10.2 | planned |
| 8. All existing tests pass (189 baseline) | §1 baseline, §10.4 | planned |
| 9. Six documentation files updated | §14 | planned (+1 new reference doc) |
| 10. Report exists, states UNVERIFIED | §9, §14 | planned |
| 11. No external network calls in the suite | §10.1 harness — stubbed `fetch` | planned |
| 12. No new runtime npm dependencies | §17 — `node:crypto` + global `fetch` only | planned |
| 13. No CineX changes | This repo is standalone; no CineX path touched | planned |

---

## 17. Constraint compliance

| Constraint | Compliance |
|---|---|
| No new runtime npm dependencies | `node:crypto` + global `fetch` (Node ≥18). `package.json` untouched. |
| No external network calls in the default suite | Every test stubs `globalThis.fetch`. `healthCheck`/timeout tests stub rejections. |
| No interface changes | §5.2 mirrors the four consumed methods; `classifyError` taxonomy identical. |
| Fail closed on missing `FLW_SECRET_HASH` | §6.2 step 1; tests §10.1 #7, §10.3 #4. |
| One commit per logical fix | §15, 11 commits. |
| All existing tests still pass | §1 baseline 189/188/0/1 recorded; §10.4 target ~215/0 fail. |
| Do not modify CineX | No CineX path in this repo. |
| No source files modified **yet** | This document is the only file written. |
| No commits **yet** | Working tree change is this plan only. |

---

## 18. What I need from you

1. **Answer D-1** (provider-selection depth) — a or b.
2. **Answer D-2** (USDC-to-wallet vs NGN fiat payout) — this is the product question, and it may
   change the wire body.
3. **Answer D-3** (two reserved env vars) — document as reserved, or defer.
4. **Confirm D-4** (currency inversion) and **D-5** (wallet-address recipient + fail-closed throw).
5. Confirm the plan is approved and I should proceed to Step 4 (Implement).

**I am stopped here and will not write any source file until you respond.**
