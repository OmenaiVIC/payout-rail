# SPRINT 12 — Flutterwave USDC-to-wallet Disbursement Adapter — Report

> Task source: `docs/prompts/2026-slot-0-28-flutterwave-payout.md` (sprint prompt)
> Plan: `docs/SPRINT_FLUTTERWAVE_PLAN.md` (reviewed and approved before implementation; approval added
> P-7 to the backlog and an explicit no-network-call confirmation).
> Mode: implementation with tests. Standing constraints honored: one commit per logical change, red→green
> for steps 2→3 and 5, no pushes, no external network, no new runtime deps, no CineX edits.

---

## 1. Outcome summary

| Deliverable | Result |
|---|---|
| `flutterwaveAdapter.js` (second payout adapter) | **Done.** Same 4-method + `classifyError` interface as Yellow Card. 22 wire-contract tests, stubbed `fetch`. |
| Documented v3 wire body | **Done.** `POST /v3/transfers` sends exactly the 8 documented fields; auth `Bearer {FLW_SECRET_KEY}`; `reference` carries the idempotency key. Amount passed **verbatim** (no kobo conversion, D-4/§7.4). |
| `currency` / `debit_currency` inversion (D-4) | **Done and loudly documented.** `currency` param → wire `debit_currency`; wire `currency` is constant `USDC`. Inverted relative to Yellow Card; deliberate, tested, and documented in code + reference + claims register. |
| `verif-hash` webhook verification | **Done.** New non-HMAC branch in `webhookVerifier.js`, fail-closed on missing secret, timing-safe compare. Separate route `POST /api/bos/webhooks/flutterwave`. 24 webhook tests. |
| Fail-closed destination (D-5) | **Done.** `destination` = `recipient.walletAddress \|\| recipient.address \|\| recipient.destination`; throws `MissingRecipientDestinationError` when all absent. No schema change this sprint. |
| Provider selection (D-1) | **Done — config layer only.** `PAYOUT_PROVIDER` (default `yellowcard`) selects via `getPayoutAdapter()`; pipeline untouched. Full routing → backlog **P-1**. 8 config tests. |
| `.env.example` | **Done.** Six FLW vars; `FLW_PUBLIC_KEY` / `FLW_ENCRYPTION_KEY` marked reserved (D-3). |
| Documentation | **Done.** Reference stub, provider/architecture/commercial/claims docs, sprint report, backlog P-1..P-7. |
| Report | This file. §9 UNVERIFIED reproduced verbatim. D-1..D-5 recorded. |

All acceptance criteria in the plan §16 are met; see §16 mapping below.

---

## 2. Commits (one per logical change, per table §15)

| # | Hash | Subject | Files |
|---|------|---------|-------|
| 1 | `921475d0fe421ffaa0f2b73b96f61e6035072523` | `docs: add Flutterwave API reference stub` | `docs/flutterwave-api-reference.md` |
| 2 | `ab67e956f150bcd63e64f6be6978871e730e5b0a` | `test: add failing Flutterwave wire-contract tests (RED)` | `test/unit/flutterwave-contract.test.js` |
| 3 | `f442fedb0c505d113a5253c52aa88470c6f4e211` | `feat: add FlutterwaveAdapter (GREEN)` | `src/services/bos/flutterwaveAdapter.js` |
| 4 | `d912ea346999b881bb78cf66aae4c72c6a8fb37c` | `feat: add Flutterwave webhook verification` | `src/services/bos/webhookVerifier.js` |
| 5 | `8351b5fab36031cf6c10bab26c7d318d99e1cfc5` | `test: add Flutterwave webhook contract tests (RED, 10 green / 14 red)` | `test/unit/flutterwave-webhook.test.js` |
| 6 | `c3f8fa44d82a7c146569a5ad68fdc6791e9a1fea` | `feat: add Flutterwave webhook route and handler (GREEN, 24/24)` | `src/routes/webhooks.js`, `src/services/bos/disbursementService.js` |
| 7 | `98c06f6e347631a80dcd545edd52c9af05779233` | `feat: register Flutterwave adapter in factory and ctx (additive only)` | `src/services/bos/bridgeAdapterFactory.js`, `src/index.js` |
| 8 | `eab483c5d692b654f3278e49bd8a81d7e91b107d` | `test: add corridor provider-selection config test` | `test/unit/flutterwave-provider-config.test.js` |
| 9 | `e84eee0de6186b55aa9a7c651e15270948dc5ec2` | `docs: document six FLW env vars and PAYOUT_PROVIDER` | `.env.example` |
| 10 | `430744d69e9b23027fbb1c6ccb4350eb2d6d93cc` | `docs: update provider, architecture, commercial, claims docs` | `docs/PROVIDER_ADAPTERS.md`, `docs/ARCHITECTURE.md`, `docs/COMMERCIAL_MODEL.md`, `docs/CLAIMS_REGISTER.md`, `README.md` |
| 11 | _(this commit)_ | `docs: add Flutterwave sprint report and backlog entries (P-1..P-7)` | `docs/SPRINT_FLUTTERWAVE_REPORT.md`, `docs/POSTPONED_BACKLOG.md` |

The `docs/SPRINT_FLUTTERWAVE_PLAN.md` plan file was reviewed before implementation and remains **untracked**
(deliberately not committed — it is the reviewer's input, not a repo deliverable).

---

## 3. What changed

### 3.1 `flutterwaveAdapter.js` — new file

- Module-header constants (§5.1): `FLW_BASE_URL` (default `https://api.flutterwave.com/v3`),
  `FLW_DEFAULT_CURRENCY = 'USDC'`, `FLW_DEFAULT_NETWORK = 'POLYGON'`, `FLW_MERCHANT_ID`. The `$0.24` fee is
  **not** asserted (unverifiable; dropped).
- Surface (`submitSend`, `lookupSend`, `healthCheck`, `verifyWebhookSignature`, `classifyError`) with no
  `initiatePayout`/`getPayoutStatus` aliases and no `signWebhook`.
- `submitSend` body: `{ account_bank, account_number, debit_currency, amount, currency, network,
  destination, reference, callback_url? }`. `callback_url` accepted but **not** sent (interface parity,
  documented). `reference` = idempotency key (echoed back). `amount` passed verbatim.
- `_normalizeStatus` maps `NEW → pending` (D-6, not `processing`), `SUCCESSFUL → completed`,
  `FAILED → failed`; `_normalizeAmount` returns a numeric reference amount.
- `_fetch` with 10s `AbortSignal.timeout`; network error → `transient`.
- `MissingRecipientDestinationError` thrown when no destination token is present (D-5).
- `classifyError` mirrors the existing taxonomy: `400/401/404/409/425` → `permanent`,
  `500/502/503` → `transient`, `429` → `transient`, abort/network → `transient`, fallback `-32010`

### 3.2 `webhookVerifier.js` — additive branch

- `realVerifHashMatches(rawBody, signature, secret)` — lazy secret read (D-2), `timingSafeEqual` (D-3),
  no phantom HMAC.
- `verifyFlutterwaveWebhook(rawBody, signature, secretOverride)` and `verifyWebhook('flutterwave', …)`
  case. `'yellowcard'` branch unchanged. Cross-acceptance tested both directions.

### 3.3 `webhooks.js` + `disbursementService.js` — route and handler

- `POST /api/bos/webhooks/flutterwave` verifies first, then `handleFlutterwaveWebhook`. Fail-closed on
  `missing_signature` / `invalid_signature` / `no_secret_configured`.
- Handler resolves the target from `data.reference` and returns `{ processed: true, advanced: false }` —
  it verifies but does **not** advance the state machine and writes **no evidence** (nullable/optional
  DB `WEBHOOK_EVENTS` path). This is the honest result: the confirmation edge is Yellow-Card-wired and
  the evidence helper hardcodes `hmac-sha256`, which would falsify a non-HMAC record. See
  `docs/PROVIDER_ADAPTERS.md` §3.1.
- Unhandled events, `data.status` `NEW`/unknown, and replay copies are ignored — no state change, tests assert.

### 3.4 `bridgeAdapterFactory.js` + `src/index.js` — additive only

- Added `getPayoutProvider()`, `getPayoutAdapter()`, `getYellowCardAdapter()`, `getFlutterwaveAdapter()`.
  `getPayoutAdapter` falls back to Yellow Card on an unknown provider (fail-safe, no init throw).
- `index.js` gained an import and `adapters: { …, flutterwave }`. No call site touched; `yellowcard` key
  and all 14 `ctx.adapters.yellowcard` references unchanged. Verified bit-identical by the config tests.

### 3.5 `.env.example`

Six FLW vars (D-3): `FLW_SECRET_KEY`, `FLW_PUBLIC_KEY` (reserved), `FLW_ENCRYPTION_KEY` (reserved),
`FLW_SECRET_HASH` (fail-closed), `FLW_MERCHANT_ID`, `FLW_BASE_URL`. Plus `PAYOUT_PROVIDER` (config only,
P-1). No secret has a working default.

### 3.6 Documentation

- `docs/flutterwave-api-reference.md` (commit 1) — stub from sprint prompt only (P-4).
- `docs/PROVIDER_ADAPTERS.md`, `docs/ARCHITECTURE.md`, `docs/COMMERCIAL_MODEL.md`, `docs/CLAIMS_REGISTER.md`,
  `README.md` (commit 10) — second provider, non-HMAC branch, config-layer-only routing, honest claims.
- `docs/POSTPONED_BACKLOG.md` + this report (commit 11) — P-1..P-7.

---

## 4. Test evidence

### 4.1 Baseline → final (`npm test`)

| Stage | tests | pass | fail | skip | note |
|---|---|---|---|---|---|
| Baseline (plan §1) | 189 | 188 | 0 | 1 | Postgres-gated (skip) |
| After commit 3 (adapter green) | 211 | 210 | 0 | 1 | +22 wire-contract |
| After commit 6 (webhook green) | 235 | 234 | 0 | 1 | +24 webhook |
| **After commit 8** | **243** | **242** | **0** | **1** | +8 config |

Test count exceeded the ~215 estimate because the full §10.2/§10.3 coverage (22 contract + 24 webhook +
8 config = 54 new) was added, per the approved "may exceed target" note. No existing test edited, weakened,
or deleted; no `--no-verify`.

### 4.2 Final suite lines

```
ℹ tests 243 │ suites 12 │ pass 242 │ fail 0 │ cancelled 0 │ skipped 1 │ todo 0
```

The single skip is the `TEST_DATABASE_URL`-gated Postgres integration test (unchanged; no credentials).

---

## 5. Decisions recorded (plan §8)

| ID | Decision | Outcome |
|---|---|---|
| **D-1** | Provider selection depth | **Config/factory layer only.** Pipeline + evidence chain untouched (both Scope Out). Sets `PAYOUT_PROVIDER`; the payout leg still resolves `ctx.adapters.yellowcard`. Full routing logged as **P-1**. |
| **D-2** | Is a USDC-to-wallet disbursement an acceptable second provider? | **Approved by user as a documented deviation.** The wire body is a USDC-to-wallet disbursement, **not** an NGN bank payout. Yellow Card remains the primary NGN payout provider; documented loudly in code, reference, and claims register. |
| **D-3** | Reserved env vars | `FLW_PUBLIC_KEY` / `FLW_ENCRYPTION_KEY` documented in `.env.example` as **RESERVED — not read by flutterwaveAdapter.js**. Prevents the `YELLOW_CARD_ENV` doc-drift repeat. |
| **D-4** | `currency`/`debit_currency` inversion | **Adopted** the recommended mapping (`currency` param → wire `debit_currency`, wire `currency` = `USDC`); documented in code JSDoc, reference §3.3, and claims register. |
| **D-5** | Recipient shape (no wallet field in `ngn_recipient`) | Adapter reads `recipient.walletAddress \|\| recipient.address \|\| recipient.destination` and throws `MissingRecipientDestinationError` if all absent — fail closed. No schema change; recipient-extension logged as **P-2**. |

Implementation-also decisions D-6..D-11 from the plan were followed as written (NEW→pending; `classifyError`
duplicated → P-3; no `signWebhook`; no list/fee/channels/rates; no deprecated aliases; `_safeEqual` in
verifier). D-2's user-approved framing (USDC-to-wallet, not NGN payout) is the single substantive deviation
from the prompt's "second payout provider" phrasing, and it is recorded as such — see B-1 in the plan.

---

## 6. UNVERIFIED list — reproduced verbatim from plan §9

These are **platform limitations, not adapter defects** (`prompt:175`). Each is carried in the code,
reference, claims register, and this report.

### 6.1 From the sprint (verbatim, `prompt:163-171`)

1. **Live webhook delivery is UNVERIFIED** — Flutterwave's sandbox does not finalize stablecoin
   transfers, so webhooks are never fired.
2. **The webhook payload shape is documented but not captured from a live webhook** — the
   `event`/`data.status` handling in §6.5 is built from documentation, never from a real payload.
3. **Live transfer finalization is UNVERIFIED** — the sandbox transfer remained in `NEW` state.

### 6.2 Additional UNVERIFIED items found during inspection

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

### 6.3 What the evidence *does* support

Per the sprint's confirmed list (`prompt:23-33`), stated as **sandbox-confirmed by the operator
before this sprint** — recorded as reported, not independently reproduced here (no network
calls were made):

- `POST /v3/transfers` with `account_bank: "flutterwave"` queues a stablecoin transfer
- Response includes `id`, `status` (`NEW`), `amount`, `currency`, `debit_currency`, `fee`,
  `reference`, `meta.debit_currency_amount`
- `GET /v3/transfers/{id}` returns current transfer status
- Auth is `Authorization: Bearer {FLW_SECRET_KEY}`
- Base URL is `https://api.flutterwave.com/v3`

**Claim classification (CLAIMS_REGISTER.md §5 / §5.1):**
`IMPLEMENTED + TESTED (wire-level, stubbed fetch)` — **sandbox/live UNVERIFIED** by this repository.

---

## 7. Open items (Sprint 13+)

- **P-1** Full corridor provider routing (the prove-record flow must reach the evidence chain).
- **P-2** Recipient shape extension for wallet destinations.
- **P-3** Extract shared `classifyError` taxonomy.
- **P-4** Complete `docs/flutterwave-api-reference.md` from live v3 docs.
- **P-5** Provider-agnostic webhook route (revisit at three providers).
- **P-6** Live sandbox verification loop (auth → submit → poll → webhook) — currently blocked by the
  sandbox never firing webhooks; also gated on credentials (G-20).
- **P-7** Flutterwave off-ramp (USDC → NGN bank payout) — endpoint not verified offline, deferred to a
  future sprint.

---

## 8. Standing-constraints confirmations

- **No CineX files modified.** All changes are in this repo (`src/`, `test/`, `docs/`, `.env.example`).
- **No new runtime npm dependencies.** `package.json` unchanged (`node:crypto` + global `fetch` only).
- **No pushes to any remote.** Work is local-commit only.
- **No external network calls.** Provider tests stub `globalThis.fetch`; webhook tests use ephemeral
  localhost Express listeners. The reference doc was written from the sprint prompt with **no**
  documentation fetched.
- **No existing tests weakened.** Only two new Flutterwave test files were added/fixed; no pre-existing
  test file was edited. The single skip (Postgres-gated) is unchanged.
- **`src/index.js` and `bridgeAdapterFactory.js` are behaviorally additive.** Default `PAYOUT_PROVIDER` is
  `yellowcard`; the runtime behavior is bit-identical (verified by the full suite green at every commit).
- **Fail-closed preserved and strengthened.** `verif-hash` fails closed on missing secret; destination
  resolution fails closed on missing wallet address; the handler verifies but never advances without the
  re-authorized P-1 work.