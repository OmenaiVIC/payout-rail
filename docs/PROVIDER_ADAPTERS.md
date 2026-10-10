# PROVIDER_ADAPTERS.md — Provider Adapters Reference

> Generated: 2026-09-23 · Sprint 7 · Cross-references: `docs/GAP_REGISTER.md` (G-08, G-09, G-20), `docs/CLAIMS_REGISTER.md` (§4–§5), `docs/yellowcard-api-reference.md`, `docs/ARCHITECTURE.md` (§5 adapter boundary)

---

## 1. The adapter interface

Every external provider integration in Payout Rail is a small ES module under
`src/services/bos/*Adapter.js` (Stacks, xReserve, Yellow Card, Flutterwave, Breet; plus
the unit-test `mock` factory). The pipeline never calls provider SDKs,
cryptocurrencies or HTTP clients directly — it calls adapter functions. The
contract an adapter must satisfy:

1. **Methods** — one function per external operation the pipeline needs
   (e.g. `submitSend`, `getPayoutStatus`, `observeDestinationRelease`). Adapters are
   stateless: all inputs arrive as function parameters, all outputs are plain JSON.
2. **Error classification** — every adapter returns errors through its own
   `classifyError(error)` (one per adapter; e.g. `yellowcardAdapter.js:36`,
   `breetAdapter.js:47`), which tags each failure
   `permanent` (non-transient: wrong credentials, rejected payload, invalid state)
   or `transient` (network timeout, 5xx, rate limit). The pipeline treats
   `permanent` as terminal-worthy (route to `failed` / `manual_review`) and
   `transient` as retryable under the retry budget.
3. **Signing / verifying** — provider auth lives inside the adapter:
   `_computeAuth(method, body, path)` builds the outgoing `YcHmacV1` request
   signature (`yellowcardAdapter.js:70-93`); `verifyWebhookSignature(payload,
   signature, secret)` validates inbound payloads (`yellowcardAdapter.js:146`).
   Verification lives in the single canonical `webhookVerifier.js`. For xReserve
   and Yellow Card it is HMAC-SHA256 over the body, accepting hex, base64 and
   base64url encodings compared in constant time. **Flutterwave is a different
   scheme** — see §2.
4. **Evidence emission** — an adapter returns *observed facts* (tx ids, statuses,
   attestation ids) as return values; it never writes state directly. The pipeline
   persists those facts as evidence records (see `docs/ARCHITECTURE.md` §3) and
   lets the state machine decide what they mean. An adapter that cannot observe
   must return a fail-closed result, never a fabricated confirmation (G-08).

## 2. Current adapters

### Stacks — burn + attestation observation

- **Surface:** `burnUsdcx({ amount, memo, idempotencyKey })` (`StacksAdapter.js:235`)
  and Read-only Stacks calls used for burn/attestation reads.
- **Status (claims table):** IMPLEMENTED + TESTED (mocked) — **no live/sandbox
  evidence**.
- **GAP-09:** the burn entrypoint is **UNVERIFIED**. `burnUsdcx` resolves its
  `contract.function` through `chainConfig.getBurnTarget()` (`chainConfig.js:91`),
  today an assumed SIP-010-style `burn` on `USDCX_CONTRACT`. The seam exists so a
  one-site correction (target/function/arg encoding) replaces a redesign when the
  real ABI is verified. See `docs/GAP_REGISTER.md` G-09.

### xReserve — USDC bridge; release *observation*

- **Surface:** `requestAttestationFromBurn` / `getAttestationStatus` (attestation id
  is the burn tx id — the burn transaction is the attestation trigger) and
  `observeDestinationRelease({ disbursement_id, external_tx_id, attestation_id })`
  (`xreserveAdapter.js:232`).
- **Status (claims table):** MODEL CORRECTED (G-08) / UNVERIFIED EXTERNAL.
- **Fail-closed by design:** the real observation surface has no credentials in this
  repository, so `observeDestinationRelease` returns
  `{ release_status: 'unobserved', source: 'xreserve.unverified' }` — the row is
  routed to `manual_review` rather than ever claiming an unverified release
  (`xreserveAdapter.js:217-238`). The fabricated `releaseDestination()`/`getReleaseStatus()`
  pair was removed in Sprint 2; release is now a 4-value observation
  (`unobserved | observed_pending | observed_confirmed | observed_failed`), never a
  self-asserted confirmation.

### Yellow Card — Sends API

- **Surface:** `submitSend({ idempotency_key, amount, currency, recipient_type,
  recipient, callback_url })` (`yellowcardAdapter.js:180`), `getPayoutStatus(payoutId)`
  (`:446`), lookup + webhook verification (`verifyWebhookSignature`, `:146`), and
  `classifyError` (`:36`).
- **Auth (F6):** `YcHmacV1` — `Authorization: YcHmacV1 {apiKey}:{signature}` plus an
  `X-YC-Timestamp` header; signature = base64 HMAC-SHA256 over timestamp + signed
  path (query excluded) + method (+ base64(SHA256(body)) for POST/PUT). Matches the
  documented scheme; reference baseline in `docs/yellowcard-api-reference.md`.
- **Status (claims table):** IMPLEMENTED + TESTED (wire-level vs documented
  reference, 28 wire-contract tests) — **sandbox UNVERIFIED** (no credentials, G-20).
- **Sandbox base URL:** `https://sandbox.api.yellowcard.io/business`
  (`yellowcardAdapter.js:15`).

### Flutterwave — v3 Transfers (USDC-to-wallet disbursement, NOT an NGN payout)

> **⚠ READ THIS BEFORE THE SURFACE LIST.** The documented v3 body —
> `{ account_bank, account_number, debit_currency: 'NGN', amount, currency: 'USDC',
> network: 'POLYGON', destination, reference }` — means **debit NGN from the
> merchant balance and deliver USDC to a POLYGON wallet address**. It does **not**
> serve the NGN local-fiat payout leg; it sits next to the bridge leg that
> `xreserveAdapter.js` already owns. **Yellow Card remains the primary NGN payout
> provider.** See `docs/flutterwave-api-reference.md` §0 for the full argument, and
> the `currency`/`debit_currency` inversion below.

- **Surface:** `submitSend({ idempotency_key, amount, currency, recipient_type,
  recipient, callback_url })` (`flutterwaveAdapter.js`), `lookupSend(sendId)`,
  `healthCheck()`, `verifyWebhookSignature(rawBody, signature, secret)` and
  `classifyError(error)`. Same five members as Yellow Card; **no interface
  changes**. Not implemented, by design: `listSends`, `getSendFee`,
  `getChannels`, `getRates`, `signWebhook`, and the `initiatePayout`/
  `getPayoutStatus` deprecated aliases (Yellow Card conveniences, not interface).
- **Auth:** `Authorization: Bearer {FLW_SECRET_KEY}`. Base URL `FLW_BASE_URL`,
  default `https://api.flutterwave.com/v3`.
- **Endpoints:** `POST /v3/transfers` (submit), `GET /v3/transfers/{id}` (lookup),
  `GET /v3/balances` (health — **UNVERIFIED**, not in the confirmed list).
- **Currency inversion:** the `currency` **parameter** lands in the wire field
  `debit_currency`, and the wire field `currency` is the constant `"USDC"`. This
  is **inverted relative to Yellow Card**, where `currency` means what the
  recipient receives. Deliberate and tested — do not "fix" it to a literal
  pass-through (decision D-4).
- **Units:** `amount` is passed through **verbatim**; the NGN kobo convention does
  **not** apply. The adapter performs no conversion.
- **Webhook verification — a different scheme, not a config change.** Flutterwave
  uses `verif-hash`, a **static shared secret** compared as a plain string. It is
  not a function of the body, so it **cannot** be expressed through `verifyHmac` —
  no `verif-hash` value is ever an HMAC digest, and routing Flutterwave through
  it would silently reject every genuine Flutterwave webhook. Hence
  `verifyFlutterwaveWebhook` in `webhookVerifier.js` and the
  `verifyWebhook('flutterwave', …)` case. Route: `POST /api/bos/webhooks/flutterwave`.
  Fails **closed** on an unset `FLW_SECRET_HASH`.
- **⚠ Security:** `verif-hash` authenticates the **sender only** — it has **no
  payload integrity** (a forged body with a valid hash verifies) and **no replay
  protection** (a captured request replays forever). The **load-bearing control is
  the local `idempotency_key` UNIQUE constraint**
  (`migrations/001_bos_schema.sql:43`), not the signature. Treat
  `FLW_SECRET_HASH` as a rotating credential; never log it or the header.
- **Recipient shape:** `destination` is a **wallet address**
  (`recipient.walletAddress || recipient.address || recipient.destination`). The
  pipeline's `ngn_recipient` has no wallet field, so a real disbursement cannot
  populate it today; the adapter throws `MissingRecipientDestinationError` rather
  than sending an empty destination (fail closed).
- **Not wired to the pipeline.** The adapter is published on `ctx.adapters` but
  unused: the payout leg reads `ctx.adapters.yellowcard` at 14 hard-coded sites.
  A verified Flutterwave webhook therefore does **not** advance the state machine
  and does **not** write an evidence record — see §4 below.
- **Status (claims table):** IMPLEMENTED + TESTED (wire-level, stubbed fetch) —
  **sandbox/live UNVERIFIED**.
- **Reference:** `docs/flutterwave-api-reference.md` — a **stub**, written from the
  sprint prompt only with no documentation fetched and no network call made.
  Completing it is backlog **P-4**; it is the weakest reference doc in the repo and
  narrower than `yellowcard-api-reference.md`.

### Breet — NGN local-fiat payout (third provider)

- **Surface:** `src/services/bos/breetAdapter.js` — implemented, wire-contract tested.
  Bank-ID mapping lives in `config/breet-banks.json` (NIBSS-to-Breet-ID).
- **Status (claims table):** IMPLEMENTED + TESTED (wire-level) — **sandbox/live UNVERIFIED**.
  No credentials in this environment.
- **Environment contract:** the adapter reads `BREET_*` environment variables at
  **call time**, not at module load. The accessor functions (`envBaseUrl()`,
  `envAppId()`, `envAppSecret()`, `envWebhookSecret()`, `envEnv()`,
  `envWithdrawalPin()`, `envMerchantRef()`) resolve `process.env` on each call.
  This matters for tests and for any host that populates `process.env` after import.
- **Error classification:** `classifyError` maps `AbortError` and any error whose
  message contains `fetch` to `transient`, 429 / 5xx to `transient`, other 4xx to
  `permanent`, and anything else to `unknown`. The fetch check matches on the
  message alone (not on `error.name === 'TypeError'`), so a plain
  `new Error('fetch failed')` classifies as `transient`.
- **Webhook verification:** **DEFERRED.** Breet has **no** verifier branch and
  **no** route today. A prior attempt to add a Breet webhook verifier broke the
  existing Flutterwave and Yellow Card webhook routes and was reverted. A future
  focused sprint must add it as **isolated, additive code only** — no modification
  to existing functions or routes in `webhooks.js` or `webhookVerifier.js`.
  The canonical `verifyWebhook` dispatcher continues to serve
  `yellowcard`, `flutterwave`, and `xreserve` unchanged.
- **Repairs (2026-10-09):** the Sprint 13 commit `3903653` ("feat: add Breet
  webhook verification, route, env vars, tests, and sprint report") introduced
  three regressions, all repaired in a follow-up commit:
  1. `src/routes/webhooks.js` imported a nonexistent `webhookHandlers.js`; the
     import was restored to `disbursementService.js`, which is where
     `handleYellowCardWebhook` and `handleFlutterwaveWebhook` actually live.
  2. `src/services/bos/breetAdapter.js` captured `BREET_*` env at module load,
     so tests that set env after import saw stale values; the adapter now reads
     env at call time (see Environment contract above).
  3. `test/unit/breet-webhook.test.js` asserted that Yellow Card uses a plain
     shared-secret signature, which is false — Yellow Card signs an HMAC over
     the body. The regression guard now asserts dispatcher routing only.
  Post-repair suite: 259 tests, 258 pass, 0 fail, 1 skip.
- **Docs:** the reference docs for this adapter are `docs/breet-api-reference.md`,
  `docs/SPRINT_BREET_REPORT.md`, and `docs/MULTI_CORRIDOR_PLAN.md` (updated with Breet).

## 3. What is UNVERIFIED and why

There are **no provider credentials in this environment**, so **no adapter has
SANDBOX-VERIFIED status**. "Wire-contract tested" proves the request/response shapes
match the provider's published reference; it cannot prove the provider accepts them.

| Adapter | Claimed surface | Evidence in repo | Live / sandbox evidence | Blocker |
|---|---|---|---|---|
| Stacks | Burn USDCx via `usdcx` token contract (`burn`) | `StacksAdapter.js:222-255`; `getBurnTarget()` seam (`chainConfig.js:91`) | None — burn entrypoint UNVERIFIED vs current contract docs (G-09) | No testnet/ABI verification performed; entrypoint may target the wrong contract |
| xReserve | Attestation (burn tx is trigger) + destination-release observation | Release model corrected (G-08); `observeDestinationRelease` fail-closed stub (`xreserveAdapter.js:217-238`) | None — external settlement surface UNVERIFIED | No credentials / sandbox access; surface returns `xreserve.unverified` by design |
| Yellow Card | Sends submit / payout-status / lookup / webhook; `YcHmacV1` auth | `yellowcardAdapter.js`; 28 wire-contract tests; `docs/yellowcard-api-reference.md` | None — live/sandbox UNVERIFIED | No credentials (G-20); field precision (kobo vs decimal, `networkId`) unproven live |
| **Flutterwave** | **v3 Transfers submit / lookup / health; `verif-hash` webhook. USDC→wallet, NOT an NGN payout** | `flutterwaveAdapter.js`; 22 wire-contract + 24 webhook tests; `docs/flutterwave-api-reference.md` (stub) | **None — live/sandbox UNVERIFIED** | No credentials; reference doc is a prompt-derived stub (P-4); field semantics inferred (recipient-receives vs merchant-debited); `GET /v3/balances` unconfirmed; `verif-hash` has no integrity or replay protection |
| **Breet** | **NGN local-fiat payout adapter; wire-contract tested. Webhook verifier DEFERRED** | `src/services/bos/breetAdapter.js`; `config/breet-banks.json`; 8 wire-contract + 2 provider-config tests | **None — live/sandbox UNVERIFIED** | No credentials; webhook verifier abandoned after breaking existing Flutterwave/Yellow Card routes — must be re-attempted as isolated, additive-only code |

Any adapter movement to SANDBOX-VERIFIED requires credentials, a repeatable
auth → submit → status → webhook loop (G-20), and a claim update in
`docs/CLAIMS_REGISTER.md` — never a silent claim upgrade.

### 3.1 Why the Flutterwave webhook handler does not advance anything

A verified Flutterwave webhook resolves its target and reports
`{ processed: true, advanced: false }`. That is the honest result, and it is
asserted by tests rather than left implicit:

1. **The state machine's payout-confirmation edge is wired to Yellow Card.** The
   only transition into `yellowcard_payout_confirmed` is guarded by
   `isPayoutConfirmed` and actioned by `confirmYellowCardPayout`
   (`stateMachine.js:151-155`), and both call `ctx.adapters.yellowcard`
   (`transitionGuards.js:178-183`). A Flutterwave-driven advance would fail that
   guard — or issue a Yellow Card API call in response to a Flutterwave event.
2. **The evidence helper would record a false verification method.**
   `recordWebhookPayload` hardcodes `verification: { method: 'hmac-sha256' }`
   (`evidenceCollector.js:279`). `verif-hash` is not an HMAC, so recording through
   it would write a factually wrong method into the evidence chain — the exact
   drift `docs/CLAIMS_REGISTER.md` exists to catch. Parameterizing the helper is a
   change to the evidence chain, which is Scope (Out).

Both are consequences of **P-1** (provider routing) being deferred. When P-1
lands, the handler must also gain a truthful verification method on the evidence
record, and duplicate suppression must come from the `idempotency_key` UNIQUE
constraint — that guarantee belongs in `test/integration/`, not in a FakeDb test.

## 4. Adding a new adapter

1. Create `src/services/bos/<name>Adapter.js` implementing the interface in §1
   (methods, `classifyError`, sign/verify, evidence-returning).
2. Write the reference doc first (one per provider, mirroring
   `docs/yellowcard-api-reference.md`): auth scheme, base URLs, endpoints, payloads,
   webhook notes, and an explicit UNVERIFIED list. **Sourced from the provider's
   own documentation, retrieved — not from a prompt.** The Flutterwave reference
   was written from the sprint prompt alone because network access was forbidden
   (P-4); that is why most of its fields carry UNVERIFIED markers, and why it is
   the weakest reference doc here. Do not repeat that shortcut.
3. Write wire-contract tests (`test/unit/<name>-*.test.js`) that lock the request/
   response shapes to that reference without network.
4. Wire corridor configuration (rate pair, recipient registry, gates, breaker —
   see §5) and register the resulting claim in `docs/CLAIMS_REGISTER.md` at the
   classification it can actually prove (IMPLEMENTED + TESTED, never VERIFIED).
5. **If the provider's verification scheme is not the repo's HMAC**, add a
   verifier branch and its own route rather than bending `verifyHmac` to fit, and
   document the security delta explicitly. Check first whether the provider's
   webhook can reach the state machine at all — the Flutterwave handler cannot,
   for the reasons in §3.1.

## 5. Configuring a new corridor

- **Provider selection — config layer only.** `PAYOUT_PROVIDER` (default
  `yellowcard`) names the adapter published on `ctx.adapters` via
  `getPayoutAdapter()` (`bridgeAdapterFactory.js`). It does **not** route the
  payout leg: that is still hard-wired to `ctx.adapters.yellowcard` at 14 sites.
  Runtime per-corridor routing is backlog **P-1** and needs re-authorization
  because it touches the state machine's action layer and the evidence chain.
- **Rate pair** — corridor conversion is configured by rate, e.g. `USDCx/NGN` via
  `DEFAULT_USDCX_NGN_RATE`. The NGN amounts derive from
  `computeAmountNgnExpected` (`disbursementService.js:40-44`):
  `round((amount_usdcx / 1e6) × rate × 100)` → kobo (widest minor unit).
- **Minor-unit convention** — payout amounts travel in the currency's widest minor
  unit (NGN kobo; 100 kobo = 1 naira). USD-facing fields stay in USDCx base units
  (6 decimals).
- **Recipient registry mode** — `BOS_RECIPIENT_REGISTRY` selects the registry
  (default `null` → `NullRecipientRegistry`, which rejects by default: eligible =
  false). See `docs/ARCHITECTURE.md` §5.
- **Gates** — financial gates (2-person approval, amount tolerance, caps, breaker,
  whitelist, attributable funds, beneficiary payload) run as a pre-flight smoke gate;
  failure routes to `manual_review` (see `docs/ARCHITECTURE.md` §2; escalation at
  `stateMachine.js:277-288`; G-01 in `docs/GAP_REGISTER.md`).
- **Status by corridor (per COMMERCIAL_HYPOTHESIS):** **NGN = validated**;
  **KES / ZAR = configuration-proven**, sandbox-verification-pending.

## 6. References

- `docs/yellowcard-api-reference.md` — Yellow Card auth scheme, base URLs, send/
  lookup payloads, webhooks, UNVERIFIED list (G-18 acceptance baseline).
- `docs/flutterwave-api-reference.md` — Flutterwave v3 transfers body, Bearer auth,
  the USDC-to-wallet framing (§0), the currency inversion (§3.3), `verif-hash`
  and its security delta (§5.1), UNVERIFIED list. **Prompt-derived stub (P-4).**
- `src/services/bos/yellowcardAdapter.js` — auth (`:70-93`), webhook verify (`:146`),
  error classification (`:36`), Sends body (`:180-194`).
- `src/services/bos/flutterwaveAdapter.js` — transfers body, status normalization,
  fail-closed destination, `verif-hash` compare.
- `src/services/bos/StacksAdapter.js:222-255` + `src/config/chainConfig.js:79-93` — GAP-09 burn seam.
- `src/services/bos/xreserveAdapter.js:217-238` — fail-closed release observation (G-08).
- `src/services/bos/webhookVerifier.js` — HMAC verification (hex/base64/base64url) + the Flutterwave `verif-hash` branch.
- `test/unit/yellowcard-*.test.js` — 28 wire-contract tests.
- `test/unit/flutterwave-*.test.js` — 22 wire-contract + 24 webhook + 8 provider-config tests.
- Registers: `docs/GAP_REGISTER.md` (G-08, G-09, G-20), `docs/CLAIMS_REGISTER.md` (§4–§5), `docs/POSTPONED_BACKLOG.md` (P-1, P-4, P-7).