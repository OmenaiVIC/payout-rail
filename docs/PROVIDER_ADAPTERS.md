# PROVIDER_ADAPTERS.md — Provider Adapters Reference

> Generated: 2026-09-23 · Sprint 7 · Cross-references: `docs/GAP_REGISTER.md` (G-08, G-09, G-20), `docs/CLAIMS_REGISTER.md` (§4–§5), `docs/yellowcard-api-reference.md`, `docs/ARCHITECTURE.md` (§5 adapter boundary)

---

## 1. The adapter interface

Every external provider integration in Payout Rail is a small ES module under
`src/services/bos/*Adapter.js` (Stacks, xReserve, Yellow Card; plus the unit-test
`mock` factory). The pipeline never calls provider SDKs, cryptocurrencies or HTTP
clients directly — it calls adapter functions. The contract an adapter must satisfy:

1. **Methods** — one function per external operation the pipeline needs
   (e.g. `submitSend`, `getPayoutStatus`, `observeDestinationRelease`). Adapters are
   stateless: all inputs arrive as function parameters, all outputs are plain JSON.
2. **Error classification** — every adapter returns errors through
   `classifyError(error)` (`yellowcardAdapter.js:36`), which tags each failure
   `permanent` (non-transient: wrong credentials, rejected payload, invalid state)
   or `transient` (network timeout, 5xx, rate limit). The pipeline treats
   `permanent` as terminal-worthy (route to `failed` / `manual_review`) and
   `transient` as retryable under the retry budget.
3. **Signing / verifying** — provider auth lives inside the adapter:
   `_computeAuth(method, body, path)` builds the outgoing `YcHmacV1` request
   signature (`yellowcardAdapter.js:70-93`); `verifyWebhookSignature(payload,
   signature, secret)` validates inbound payloads (`yellowcardAdapter.js:146`).
   Verification helpers (`webhookVerifier.js`) accept hex, base64 and base64url
   encodings and compare in constant time.
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

## 3. What is UNVERIFIED and why

There are **no provider credentials in this environment**, so **no adapter has
SANDBOX-VERIFIED status**. "Wire-contract tested" proves the request/response shapes
match the provider's published reference; it cannot prove the provider accepts them.

| Adapter | Claimed surface | Evidence in repo | Live / sandbox evidence | Blocker |
|---|---|---|---|---|
| Stacks | Burn USDCx via `usdcx` token contract (`burn`) | `StacksAdapter.js:222-255`; `getBurnTarget()` seam (`chainConfig.js:91`) | None — burn entrypoint UNVERIFIED vs current contract docs (G-09) | No testnet/ABI verification performed; entrypoint may target the wrong contract |
| xReserve | Attestation (burn tx is trigger) + destination-release observation | Release model corrected (G-08); `observeDestinationRelease` fail-closed stub (`xreserveAdapter.js:217-238`) | None — external settlement surface UNVERIFIED | No credentials / sandbox access; surface returns `xreserve.unverified` by design |
| Yellow Card | Sends submit / payout-status / lookup / webhook; `YcHmacV1` auth | `yellowcardAdapter.js`; 28 wire-contract tests; `docs/yellowcard-api-reference.md` | None — live/sandbox UNVERIFIED | No credentials (G-20); field precision (kobo vs decimal, `networkId`) unproven live |

Any adapter movement to SANDBOX-VERIFIED requires credentials, a repeatable
auth → submit → status → webhook loop (G-20), and a claim update in
`docs/CLAIMS_REGISTER.md` — never a silent claim upgrade.

## 4. Adding a new adapter

1. Create `src/services/bos/<name>Adapter.js` implementing the interface in §1
   (methods, `classifyError`, sign/verify, evidence-returning).
2. Write the reference doc first (one per provider, mirroring
   `docs/yellowcard-api-reference.md`): auth scheme, base URLs, endpoints, payloads,
   webhook notes, and an explicit UNVERIFIED list.
3. Write wire-contract tests (`test/unit/<name>-*.test.js`) that lock the request/
   response shapes to that reference without network.
4. Wire corridor configuration (rate pair, recipient registry, gates, breaker —
   see §5) and register the resulting claim in `docs/CLAIMS_REGISTER.md` at the
   classification it can actually prove (IMPLEMENTED + TESTED, never VERIFIED).

## 5. Configuring a new corridor

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
- `src/services/bos/yellowcardAdapter.js` — auth (`:70-93`), webhook verify (`:146`),
  error classification (`:36`), Sends body (`:180-194`).
- `src/services/bos/StacksAdapter.js:222-255` + `src/config/chainConfig.js:79-93` — GAP-09 burn seam.
- `src/services/bos/xreserveAdapter.js:217-238` — fail-closed release observation (G-08).
- `src/services/bos/webhookVerifier.js` — HMAC verification, hex/base64/base64url.
- `test/unit/yellowcard-*.test.js` — 28 wire-contract tests.
- Registers: `docs/GAP_REGISTER.md` (G-08, G-09, G-20), `docs/CLAIMS_REGISTER.md` (§4–§5).