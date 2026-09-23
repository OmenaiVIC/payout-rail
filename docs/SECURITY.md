# SECURITY.md — Security and Trust Model

> Generated: 2026-09-23 · Sprint 7 · Cross-references: `docs/GAP_REGISTER.md` (G-01, G-02, G-06, G-20), `docs/CLAIMS_REGISTER.md` (§3–§5), `docs/ARCHITECTURE.md` (evidence chain), `docs/INTEGRATION.md` (auth boundary)

---

## 1. What the layer does and does not custody

Payout Rail **never holds the trust-critical material** of the integrator:

- **Signing key required, never held.** The pipeline reads `PAYOUT_TX_SIGNING_KEY` from the integrator's deployment environment to sign and broadcast the USDCx burn transaction. The layer does not generate, store, or transmit the key. Whoever operates the deployment holds the key — the integrator in a self-hosted setup, or the hosting operator in a future hosted setup. There is no scenario in which a third party holds the key on the integrator's behalf. The current implementation uses `PostConditionMode.Allow`, which is overly permissive; Milestone 1 of the Stacks Endowment grant corrects this to `PostConditionMode.Deny` with explicit post-conditions bounding the burn to exactly the expected amount and recipient, verified on testnet.

- **No funds.** No balance is held, no wallet is controlled, no custody paths
  exist. The USD/NGN conversion is a configured rate, not a ledger position.
- **No directly-identifying PII.** Evidence records reference beneficiary
  information only through processed fields and hashes; there is no dataset of
  names, addresses, or account numbers retained verbatim as a compliance record
  (PESTLE privacy posture). The integrator remains the data controller for any
  beneficiary data they supply in API payloads.

This split is intentional: `docs/ARCHITECTURE.md` §7 lists custody, key
management and ledger ownership as explicitly **not in the system**.

## 2. Authentication model

- **Bearer token, fail-closed.** All operator-facing v1 API routes require
  `Authorization: Bearer <BOS_API_TOKEN>` (`requireApiToken`, normalized). With
  no valid token the caller gets a 401 and no state is touched.
- **No backdoor.** There is no default, documented, or baked-in token. The old
  dev escape hatch (`BOS_ALLOW_UNAUTHENTICATED_DEV`) is deleted; the demo runs
  the fail-closed path by design (`scripts/demo-payout-ngn.js:978`).
- **Secrets are environment-only.** Tokens and provider secrets are read from the
  environment (`.env` / process env), never from code, config files, or the
  repository.

## 3. Fail-closed behavior

The pipeline is built to refuse when it cannot prove something — and it is
tested to do so:

- **Unconfigured secrets reject.** Webhook handling with no configured secret
  fails CLOSED (401, nothing handled). See `src/routes/webhooks.js:35,55`.
- **Missing/invalid signatures reject.** Unsigned, wrong-signature, and
  wrong-encoding webhook payloads are rejected before any state is touched
  (verified by tests; `webhookVerifier.js` compares in constant time across
  hex/base64/base64url).
- **The sandbox runner exits non-zero** when it cannot operate safely
  (e.g. missing credentials), rather than silently proceeding.
- **Known fail-open gap (disclosed, not hidden):** G-01 — the **preflight gate
  audit does not block the burn** in the shipped state machine. `runPreflightCheck`
  records `gate_result` rows and logs, but `advanceDisbursement` still advances
  `preflight_check → burn_submitted` guarded only by `disbursementExists`
  (`GAP_REGISTER.md` G-01 evidence: `transitionActions.js:41-52`,
  `disbursementService.js:174-178`, `stateMachine.js:24-27`). The fail-closed
  escalation _route_ exists and is verified (`stateMachine.js:277-288` guards
  `MANUAL_REVIEW_REQUIRED`, and the `preflight` smoke gate reports `ok:false` on
  breaker/gate/2PA failure — `preflight.js:22-48`), but **nothing acts on that
  result today**, so a failed gate does not stop the burn. This is a recorded,
  open P0 — **do not assume gating is enforced**. Fix direction in the register.

## 4. The evidence chain as a security property

The audit record is itself the control surface:

- **Append-only audit.** Every successful transition writes a canonical
  `transition` evidence record; six recorders (gate, api, webhook, poll,
  manual-note, tx-hash) plus reconciliation detections append to a common
  evidence store (`transition_evidence`). Best-effort emission after the state
  flip — the audit trail is the transaction record.
- **`gate_result` pre-flight checks.** Each of the eight financial gates records
  its own `passed: true|false` result, so gate decisions are auditable even when
  (per G-01) they are not yet enforced.
- **Idempotency against double-spend.** Create is keyed by a deterministic hash
  over `[source_reference, source_application, amount_usdcx,
recipient_bank_account]` with a DB `UNIQUE(idempotency_key)`
  (`disbursementService.js:53-63`; `migrations/006`). Duplicate submissions
  return the existing record and cannot mint a second payout for the same
  request.
- **Webhook HMAC verification (both directions).** Outbound requests are signed
  `YcHmacV1` (request auth); inbound webhook payloads are verified against
  `x-yc-signature` over the **raw** body (with legacy `x-signature` /
  `x-yellowcard-signature` / `x-hub-signature-256` fallbacks). The HMAC checker
  accepts hex/base64/base64url encodings and compares in constant time
  (`webhookVerifier.js`) — all tested.

## 5. Network posture

- **Tests are offline.** The suite makes no outbound calls; provider behavior is
  mocked/stubbed (the single skipped test is a Postgres-gated integration case,
  not a network case).
- **The demo is loopback-only.** The Sprint 6 demo drives the real v1 router over
  localhost against in-process mocks; no external service is contacted.
- **No inbound exposure assumptions.** The docs assume the operator exposes the
  HTTP API only behind their own boundary (reverse proxy / VPN / authz). No
  claim is made that the API is safe to expose directly on the public internet.

## 6. Maturity statement

> **Maturity: Prototype — sandbox-ready interfaces.**

> Payout Rail is **prototype** software. The pipeline, the 15-state machine, the
> evidence chain, the v1 public API, and the Nigeria (NGN) corridor are
> implemented and covered by 183 passing automated tests, but no external adapter
> has been verified against a live or sandbox provider (no provider credentials
> exist in this environment — G-20), and no external application has used the
> layer. **Do not use Payout Rail to move real funds or handle real beneficiary
> data.**

This statement is byte-consistent with `README.md` §6. Explicit non-claims:

- **No compliance certification** — no PCI-DSS, SOC, AML/CTF, or data-protection
  attestation is asserted.
- **No production security certification** — no audit, pentest, or independent
  security review has been performed.
- **Not for real funds / real beneficiary data** — the open P0s (G-01, G-02) and
  unverified provider leg (G-20) prohibit production use.

## 7. Known limitations

- **G-01** — preflight gate audit is fail-open (see §3; P0, recorded).
- **G-02** — the shipped create path and schema disagree (NOT NULL recipient
  columns), so disbursements cannot actually be created as shipped (P0, recorded;
  evidence at `GAP_REGISTER.md` G-02).
- **G-07 / U** — Yellow Card live sandbox verification is unperformed; blocked on
  credentials (G-20). Auth scheme and payloads are correct against the published
  reference but unproven against the provider.
- **G-06** addressed (webhook verify wired) but the historical gap and its fix are
  recorded in `docs/GAP_REGISTER.md` G-06.

Full register: `docs/GAP_REGISTER.md`. Claim status: `docs/CLAIMS_REGISTER.md`.
