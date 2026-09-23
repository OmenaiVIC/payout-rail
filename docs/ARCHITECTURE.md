# Payout Rail — Architecture

> Generated: 2026-09-23 · Sprint 7 (Plan: `docs/SPRINT_7_PLAN.md` §3.2) · Scope: documentation only.
> This document describes **what the repository actually is and does**, with `file:line` evidence.
> Cross-references: `docs/INTEGRATION.md` (API schemas), `docs/GAP_REGISTER.md` (known gaps),
> `docs/CLAIMS_REGISTER.md` (claims/evidence ledger).
> Status: draft — matches code at HEAD (commit `1d8f4dd` + `0dd5447`).

---

## 1. System context & boundaries

```
                                  payout-rail (BOS layer)
┌───────────────┐  v1 API       ┌───────────────────────────────────────────────────────────────┐
│  Another      │──────────────▶│ Public API  /api/v1/disbursements/*   (Bearer BOS_API_TOKEN) │
│  Stacks       │               │   create · list · get · receipt · advance · retry · recover  │
│  application  │◀──────────────│   approve · resolve                                          │
└───────────────┘               │ Webhooks     /api/bos/webhooks/*      (verify-first, HMAC)   │
                                │ Monitoring   /api/bos/monitoring/*    (cron token)           │
                                └───────────────┬──────────────────────────────────────────────┘
                                                ▼
                                ┌───────────────────────────────────────────────────────────────┐
                                │ Disbursement service           src/services/bos/disbursement… │
                                │   idempotent create · computeAmountNgnExpected · wiring      │
                                └───────────────┬──────────────────────────────────────────────┘
                                                ▼  executeTransition (guard → claim → action)
                                ┌───────────────────────────────────────────────────────────────┐
                                │ State machine  src/services/bos/stateMachine.js              │
                                │   15 states · 48 transitions (24 explicit + 24 generic)      │
                                │   guards/actions per transition · CAS claim on status         │
                                └───────┬───────────────────────────────────┬───────────────────┘
                                        │ record (best-effort)              │ emitEvent (audit)
                                        ▼                                  ▼
                          ┌──────────────────────────────┐   ┌─────────────────────────────────┐
                          │ Evidence chain (8 types)     │   │ Audit log  disbursement_audit  │
                          │  evidence_records            │   │  index.js:51-56 (append-only)  │
                          │  external_status_snapshots  │   └─────────────────────────────────┘
                          └──────────────────────────────┘
                                        ▲
                    adapters (external boundary — see §5)
        ┌─────────────────┬───────────────────────┬──────────────────────────┐
        ▼                 ▼                       ▼                          ▼
   Stacks burn      xReserve bridge          Yellow Card Sends          Recipient registry
   (observeBurn)    (release observation)   (submit/lookup/status/webhook)  (permissive)
```

- **Inbound surface:** the v1 API (`src/routes/disbursementsV1.js`), webhook receivers
  (`src/routes/webhooks.js`, mounted at `/api/bos/webhooks`), and the monitoring router
  (`src/routes/bosMonitoring.js`, mounted at `/api/bos/monitoring`). Mounts are in
  `src/index.js:98-101`.
- **Core loop (worker-per-tick):** each worker tick picks candidate transitions and calls
  `executeTransition` one step per disbursement per tick:
  - `pipelineWorker` — 30s interval, batch 25, non-terminal rows only.
  - `stuckStateReaper` — 60s, SLA-per-state escalation to `manual_review`
    (`stateMachine` SLA map: 10m/5m/15m/5m/30m/60m/5m/30m).
  - `reconciliationWorker` — 5m, re-checks internal evidence vs stored `external_refs`
    (see §4).
  - `monitorJob` — 5m, alert key `stuck_in_state:<status>:<id>`.
- **Adapters live at the external boundary** (§5): the core never fabricates external
  outcome — release states are observed, never app-controlled (G-08, `types.js:16-17`).

## 2. The state machine

### 2.1 States (F1) — `src/services/bos/types.js:22-38`

Canonical order (`types.js:8-14`):

```
disbursement_initiated → preflight_check → burn_submitted → burn_confirmed →
attestation_requested → attestation_confirmed → destination_release_unobserved →
destination_release_observed → destination_release_confirmed →
yellowcard_payout_submitted → yellowcard_payout_confirmed → settled | failed | cancelled
                                                                  manual_review (holding state)
```

15 states total. **Terminal states** (`TERMINAL_STATES`, code-authoritative):
`settled`, `failed`, `cancelled`. `manual_review` is a **non-terminal holding state**
(it has explicit exits; the generic loop registers a `manual_review→manual_review`
self-loop precisely because it is not in `TERMINAL_STATES`, see §2.3).

### 2.2 Explicit transitions (F2) — `src/services/bos/stateMachine.js:40-185`

24 explicit transitions. Table rendered from `stateMachine.js` (from → to | trigger | guard | action):

| From                             | To                               | Trigger                              | Guard                            | Action                        |
| -------------------------------- | -------------------------------- | ------------------------------------ | -------------------------------- | ----------------------------- |
| `disbursement_initiated`         | `preflight_check`                | record created                       | `preflightRequested`             | `runPreflightCheck`           |
| `preflight_check`                | `burn_submitted`                 | preflight passed                     | `preflightPassed`                | `submitBurn`                  |
| `preflight_check`                | `manual_review`                  | preflight couldn't complete          | `disbursementExists`             | `moveToManualReview`          |
| `preflight_check`                | `failed`                         | preflight terminal failure           | `disbursementExists`             | `markFailed`                  |
| `burn_submitted`                 | `burn_confirmed`                 | burn confirmed on-chain              | `isBurnConfirmed`                | `recordBurnConfirmation`      |
| `burn_submitted`                 | `failed`                         | burn failed (retry budget)           | `withinRetryBudget`              | `markFailed`                  |
| `burn_confirmed`                 | `attestation_requested`          | burn confirmed — call attestation    | `burnConfirmedForAttestation`    | `requestAttestation`          |
| `burn_confirmed`                 | `failed`                         | attestation request failed           | `withinRetryBudget`              | `markFailed`                  |
| `attestation_requested`          | `attestation_confirmed`          | attestation accepted                 | `isAttestationConfirmed`         | `confirmAttestation`          |
| `attestation_requested`          | `failed`                         | attestation failed                   | `withinRetryBudget`              | `markFailed`                  |
| `attestation_confirmed`          | `destination_release_unobserved` | attestation placed — begin observing | `attestationConfirmedForRelease` | `beginReleaseObservation`     |
| `attestation_confirmed`          | `failed`                         | observation setup failed             | `withinRetryBudget`              | `markFailed`                  |
| `destination_release_unobserved` | `destination_release_observed`   | release observed                     | `isReleaseObserved`              | `recordReleaseObservation`    |
| `destination_release_unobserved` | `failed`                         | release observed failed              | `isReleaseObservedFailed`        | `recordReleaseObservedFailed` |
| `destination_release_observed`   | `destination_release_confirmed`  | observed → confirmed                 | `isReleaseObservedConfirmed`     | `confirmDestinationRelease`   |
| `destination_release_observed`   | `failed`                         | observed failed                      | `isReleaseObservedFailed`        | `recordReleaseObservedFailed` |
| `destination_release_confirmed`  | `yellowcard_payout_submitted`    | release confirmed — submit Yc payout | `destinationReleasedForPayout`   | `submitYellowCardPayout`      |
| `destination_release_confirmed`  | `failed`                         | payout submission failed             | `withinRetryBudget`              | `markFailed`                  |
| `yellowcard_payout_submitted`    | `yellowcard_payout_confirmed`    | payout confirmed (Yc status/webhook) | `isPayoutConfirmed`              | `confirmYellowCardPayout`     |
| `yellowcard_payout_submitted`    | `failed`                         | payout failed                        | `withinRetryBudget`              | `markFailed`                  |
| `yellowcard_payout_confirmed`    | `settled`                        | payout confirmed → settled           | `disbursementExists`             | `markSettled`                 |
| `manual_review`                  | `failed`                         | operator decided                     | `disbursementExists`             | `markFailed`                  |
| `manual_review`                  | `settled`                        | operator decided                     | `disbursementExists`             | `markSettled`                 |
| `manual_review`                  | `cancelled`                      | operator cancelled                   | `disbursementExists`             | `markCancelled`               |

### 2.3 Generic transitions (F2) — `stateMachine.js:193-209`

The generic loop adds the three safety exits **to every non-terminal state that does not
already have them**: `→failed` (guard `disbursementExists`, action `markFailed`),
`→cancelled` (guard `disbursementExists`, action `markCancelled`), and `→manual_review`
(guard `disbursementExists`, action `moveToManualReview`).

Accounting (code-verified):

- `→failed` added for **2** states missing it (`disbursement_initiated`,
  `yellowcard_payout_confirmed`); the other 10 already had explicit `→failed`.
- `→cancelled` added for **11** states (all except `manual_review`, which has it explicitly).
- `→manual_review` added for **11** states (all except `preflight_check`, which has it
  explicitly). This set **includes the `manual_review→manual_review` self-loop**, because
  `manual_review` is not in `TERMINAL_STATES`.

Total generic = 2 + 11 + 11 = **24**. Explicit (24) + generic (24) = **48**.
`stateMachine.js:437-442` health check enforces `getAllTransitions().length === 48`.

### 2.4 Execution semantics — `stateMachine.js:255-417`

1. **Lookup** the transition definition; invalid pair → error, no side effect.
2. **Guard**: any `ok:false` is logged. **Fail-closed escalation**: a guard that returns
   `action === 'MANUAL_REVIEW_REQUIRED'` routes the row to `manual_review` instead of
   stalling (`stateMachine.js:277-288`) — verified behavior.
3. **Claim (compare-and-swap):** `UPDATE … SET status=$1 WHERE id=$3 AND status=$2`
   (`stateMachine.js:306-315`). A concurrent tick that already moved the row affects 0 rows
   → benign no-op `already_advanced` (`u8293`) **before** any side effect runs. This is what
   prevents double-burn under overlapping workers.
4. **Action** runs only on a successful claim; a thrown action rolls the claim back
   (row restored to `fromState` + error message, `u8290`).
5. **DB update** writes `PERSISTED_ACTION_FIELDS` when the action supplies them.
   `release_id` is **never** persisted (release identity comes from observation, not app control).
6. **Audit**: `emitEvent` → `disbursement_audit` (old_status, new_status, action,
   details, triggered_by).
7. **Canonical transition evidence** is recorded best-effort **after** the state flip
   (Sprint 4 interpretation #2). A failure is logged at ERROR, never silent, and is
   detectable by the reconciliation job later.

## 3. The evidence chain

- **`gate_result` records** — each preflight gate writes a row to `payout_gates`
  (`disbursement_id, gate_name, passed, error_code, reason, warning, details, created_at`)
  in `runPreflightCheck` (`transitionActions.js:25-52`).
- **Canonical `transition` record** — exactly one per successful state change
  (`evidenceCollector.js:380-388`), source `bos.state_machine`, written best-effort after
  the audit row.
- **Audit log** — `src/index.js:51-56` creates `disbursement_audit`; every non-self
  transition appends one row; the `manual_review→manual_review` self-loop increments
  `retry_count` on the disbursement row.
- **6 evidence recorders** (`evidenceCollector.js`):
  `webhook_payload` (source `webhook:<source>`), `poll_result` (source `poll:<adapter>.<method>`),
  `manual_note` (source `operator.manual_review`), `api_response` (source `api:<adapter>.<method>`),
  `tx_hash` (source `chain:<chain>`), `gate_result` (source `bos.preflight`).
  External-observer recorders also append to **`external_status_snapshots`**.
- **`reconciliation_detection`** — source `bos.reconciliation`, recorded when the
  reconciliation worker finds a mismatch (§4).
- **Envelope** — `{ v:1, event_type, source, external_ref, observed_at, status,
payload_hash, verification, details }`; `payload_hash` is `sha256:` over a stable
  canonical form; `SENSITIVE_KEYS` redaction caps large fields.
- **Settlement receipts** — `GET /api/v1/disbursements/:id/receipt` assembles the
  evidence trail into a receipt (`final_status`, ngn amount).
- **Event types** — `api_response, tx_hash, webhook_payload, manual_note, gate_result,
poll_result, transition, reconciliation_detection` (8 types; the "6 recorders" are the
  evidence-type recorders; `transition` and `reconciliation_detection` are canonical
  additions).

The evidence chain is the **security/audit property** of the layer (fail-closed defaults,
append-only audit, deterministic payload hashes, HMAC-verified webhook payloads). Expanded
in `docs/SECURITY.md` (Sprint 7).

## 4. The reconciliation layer

- **Workers** (`reconciliationWorker.js`, source `bos.reconciliation`): 5m cadence; for each
  non-terminal disbursement it re-reads the evidence trail and compares internal state and
  amounts against the provider `external_refs` stored on the row (`payout_id` →
  Yellow Card, `attestation_id` → xReserve, `external_tx_id` → Stacks).
- On mismatch it records a `reconciliation_detection` evidence row and routes the row via
  the transition table to `yellowcard_payout_confirmed`, `failed`, or `manual_review`.
- **Sprint 6 demo result `{ gaps: [] }`** — what it proves: within the loopback demo, the
  internally-recorded evidence (burns, webhook completions, payout refs, inbound states) is
  **self-consistent** — the mock and the recorder agree, end to end. What it does **not**
  prove: anything about a live provider. The loopback mock emits self-consistent refs by
  construction, so `gaps: []` is a consistency check of the layer's own bookkeeping, not a
  correctness proof of any adapter contract.

## 5. The adapter boundary

- **Interface shape** — adapters expose method groups per external system; each method emits
  evidence via the recorder set above and returns the canonical result shape the guards
  consume (`transitionActions.js`, `evidenceCollector.js`).
- **Error taxonomy** — `classifyError` splits **permanent** (no retry will help → fail path)
  from **transient** (retry within budget → retry path). Guards `withinRetryBudget` gate the
  retry loop.
- **Signature helpers** — symmetric-key HMAC request signing and verification using
  `YcHmacV1` for Yellow Card (`webhookVerifier.js`), with hex/base64/base64url encodings,
  all wire-contract tested.

**What lives inside vs outside the layer (F7 honesty per adapter):**

| Adapter         | Outside (provider claims)                      | Inside (this layer, tested)                                                                                                                             |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stacks**      | Burn wire format, attestation service contract | `observeBurn` → records `tx_hash`; burn + attestation are **mock-only** (GAP-09 says UNVERIFIED burn)                                                   |
| **xReserve**    | USDC bridge release semantics                  | release **observation** surface only (G-08/F8); **UNVERIFIED** stub, fail-closed                                                                        |
| **Yellow Card** | Sends API submit/lookup/payout-status/webhook  | `YcHmacV1` signing + webhook verify, error mapping, submit/payout/status wiring — 28 wire-contract tests; sandbox **UNVERIFIED** (no credentials, G-20) |

The layer takes no custody, does not hold keys (it reads a signing key from the integrator's environment), and never guesses an external outcome.

## 6. Public API surface (summary)

Full JSON schemas, error codes, and `POST` condition notes: `docs/INTEGRATION.md`.

- **v1** (`/api/v1/disbursements`, Bearer `BOS_API_TOKEN`): `POST /` (create, idempotent),
  `GET /` (list), `GET /:id`, `GET /:id/receipt`, `POST /:id/advance?steps=`,
  `POST /:id/retry`, `POST /:id/recover`, `POST /:id/approve`, `POST /:id/resolve`.
- **Webhooks** (`/api/bos/webhooks`): `POST /yellowcard` (verify-first HMAC, **no** Bearer),
  `POST /yellowcard/test` (`requireApiToken`).
- **Monitoring** (`/api/bos/monitoring`, cron token): health, pipeline, active, alerts,
  manual-review, run, workers, cron routes.
- Error envelope: `{ error, error_code }` (`404 not_found`, `400 invalid_body`,
  `401 unauthorized`, `409 *_conflict`).

## 7. In the system / not in the system

**In the system:** the idempotent disbursement lifecycle (F4); the 15-state machine with
48 transitions and per-state SLAs; the evidence chain (gate results, canonical transitions,
audit log, 6 recorders, reconciliation detections); preflight financial gates
(per-disbursement cap, daily cap, amount tolerance, attributable funds, beneficiary payload,
whitelist, circuit breaker, two-person approval — §see `payoutGates.js:261-268`,
`preflight.js`); the reconciliation layer; the public v1 API; the monitoring workers; the
NGN corridor (rate pair `USDCx/NGN`, seed `DEFAULT_USDCX_NGN_RATE`, `computeAmountNgnExpected`).

**Not in the system (explicitly):**

- **Custody** — this layer holds no funds. It does not custody signing keys, but it requires one: the `StacksAdapter` reads `PAYOUT_TX_SIGNING_KEY` from the integrator's deployment environment to sign and broadcast the USDCx burn. Whoever operates the deployment holds the key.
- **Key management** — the integrator keeps secrets (API tokens, HMAC keys, and the `PAYOUT_TX_SIGNING_KEY` for the Stacks burn). The layer reads them from the deployment environment and never transmits them to a third party. Milestone 1 of the Stacks Endowment grant also tightens the burn's `PostConditionMode` from `Allow` to `Deny` to bound the transaction to the exact expected amount and recipient.
- **Ledger ownership** — disbursement records live in this Postgres schema; this is not a
  ledger or a double-entry accounting system.
- **A scheduling SLA** — worker cadences are best-effort crate timers, not a delivery SLA.
- **Auth for the integrator's own end users** — the bearer token authenticates this API to
  one caller (the orchestrating application), not their users.
- **Mainnet execution** — no mainnet path exists; the demo is loopback-only and the sandbox
  is gated on credentials that do not exist in this environment (G-20).

## 8. Known limitations

Recorded-but-open P0s, un-claimed in this document (this doc is not a re-audit):

- **G-01 — preflight failure does NOT block the burn (fail-open).** The guard that routes
  failed preflights to `manual_review` exists and is verified at
  `stateMachine.js:277-288`, but G-01 remains an open P0 in the register; the fix direction
  (guard `preflight_result` on `PREFLIGHT_CHECK→BURN_SUBMITTED`) is tracked there.
  Pointer: `docs/GAP_REGISTER.md#g-01`.
- **G-02 — disbursements cannot be created as shipped (schema/code mismatch).** Open P0,
  tracked in the register with its fix direction.
  Pointer: `docs/GAP_REGISTER.md#g-02`.

Both are P0 and must be fixed (via the change control process) before any real-money use.
This document makes no claim that they are resolved.
