# Sprint 4 Plan — Settlement Evidence, Reconciliation & Receipts

> Prompt: `docs/prompts/05_SPRINT_4_EVIDENCE.md`
> Mode: plan-first. **This document is the Plan (Step 3). No source file is modified yet; no test is run
> beyond the baseline; no external network call; nothing committed.**
> Standing constraints (Master Prompt + `docs/PRODUCT_CHANGE_CONTROL.md`): only A/B/explicitly-authorized
> C work may be implemented; D/E → `docs/POSTPONED_BACKLOG.md`; conflicts → STOP and report.

Baseline (verified, `npm test`): **78 tests / 77 pass / 0 fail / 1 skip** (the skip is the
`TEST_DATABASE_URL`-gated Postgres integration test). Git tree clean at `8e802ff`.

---

## 1. Sprint purpose (read from the prompt)

The Sprint 2 report evidenced the corrected settlement model with **per-leg artifacts but no complete,
immutable evidence chain and no way to reconstruct a settlement after the fact**:

- Only 3 of the 6 recorders in `src/services/bos/evidenceCollector.js` are called today
  (`recordApiResponse`, `recordTxHash`, `recordGateResult`). `recordWebhookPayload` fires and forgets;
  `recordManualNote`, `recordPollResult`, and `getEvidence` are never used (G-17).
- Six tables exist in the schema but are **never written**: `yellow_card_webhook_events`,
  `on_chain_events`, `relay_wallet_activity`, `external_status_snapshots`, `config_snapshots`,
  `manual_review_queue` (G-16). Grep proof: in `src/` only `auditTimeline.js:58` reads `FROM
  external_status_snapshots`; nothing reads the other five.
- There is no reconciliation worker for inconsistent states, no duplicate-event or missing-webhook
  detection, and **no settlement receipt** — an operator cannot re-derive "did this payout settle, and on
  what evidence" from stored data alone.
- `manual_review` is reached today only via `stuckStateReaper` (SLA timeout) with no persistent queue row
  and no evidence describing why the row was flagged.

This sprint makes the evidence model complete **inside this repo** (deterministic, offline, mock-tested);
it does not touch testnet, xReserve, Yellow Card, or any live corridor.

---

## 2. Evidence record shape (exact)

### 2.1 Table — unchanged

`disbursement_evidence` (created in `migrations/004`) stays as-is: `id, evidence_type, evidence_data,
recorded_by, created_at`. No schema change to the evidence table is required.

### 2.2 Evidence id

`crypto.randomUUID()` (replaces the `ev-<ts>-<rand>` clock suffix — deterministic-safe, collision-proof,
test-friendly). Ordering for `getEvidence` becomes `ORDER BY created_at ASC, id ASC`.

### 2.3 Standardized envelope in `evidence_data` (every recorder)

```jsonc
{
  "v": 1,                                        // envelope schema version
  "event_type": "<see 2.4>",
  "source": "<system>.<component>",              // e.g. "bos.state_machine", "yellowcard.webhook", "stacks.chain"
  "external_ref": { "system": "yellowcard", "type": "payout_id", "value": "sing_...", "ok": true } | null,
  "observed_at": "<ISO-8601, injected clock>",   // never wall-clock at the call site
  "status": { "<type-specific>": "..." },        // transition → {from,to}; observation → the observed status
  "payload_hash": "sha256:<hex>",                // hash of the full canonical payload — NEVER the payload
  "verification": { "ok": true, "method": "hmac-sha256" | "gate_check" | "guard" | null },
  "details": { "triggered_by": "...", "action": "...", /* PII-free context only */ }
}
```

### 2.4 Evidence types

| `event_type` | Written by | Notes |
|---|---|---|
| `api_response` | existing recorders (attestation/observation/payout legs) | gains envelope; appends snapshot (D3) |
| `tx_hash` | `submitBurn` | as today + envelope |
| `webhook_payload` | `recordWebhookPayload` (now **awaited**) | stores `payload_hash`, **not** the raw body (2.6); links the journal event (2.7) |
| `gate_result` | `runPreflightCheck` per gate | + envelope |
| `poll_result` | reconciliation worker + observation polls | resurrection of the unused recorder (D3/D5) |
| `manual_note` | operator note | resurrection of the unused recorder |
| `transition` | **NEW** — `executeTransition`, exactly one per successful transition (2.5) | canonical chain record |
| `reconciliation_detection` | **NEW** — reconciliation worker, only when it routes (5.7) | describes the divergence |

### 2.5 "Exactly one evidence record per transition" — canonical writer

`executeTransition` inserts **one** `transition`-type evidence record immediately after the audit `emitEvent`,
for **every** successful transition (all 16 action functions, §3). This is the chain's backbone and is the
only part that is a hard invariant, because today these transitions write **no** evidence at all:
`recordBurnConfirmation`, `beginReleaseObservation`, `markSettled`, `markFailed`, `markCancelled`,
`moveToManualReview`.

**Flags for reviewer — two interpretations made explicit (approve/reject before implementation):**

1. *(accepted)* "Exactly one evidence record per transition" = **one canonical `transition`-type record**.
   Per-leg artifacts (`api_response`, `tx_hash`, `gate_result`, `webhook_payload`, `poll_result`) remain
   supplementary. Not enforcing "one row total" (a `runPreflightCheck` transition legitimately emits N
   `gate_result` rows; the canonical record is the 1 that carries the transition itself).
2. *(accepted, documented)* Evidence write is **not** fused into the state-flip's DB update (no transaction
   wrapper exists in `src/database.js`). The post-write is best-effort with a loud error log; a dropped
   evidence insert is itself a detectable inconsistency and is policed by the reconciliation consistency
   job (5.3), so the invariant is *enforced*, not *assumed*.

### 2.6 PII / sensitive-data posture

Evidence **never stores** recipient name, account/sort/bank code, ID numbers, raw API payload bodies, or
credentials. The full canonical JSON is hashed into `payload_hash`; `details` carries only safe summary
fields (disbursement id, external refs, status values, error codes, timestamps). The same posture applies
to the webhook journal (§2.7) and snapshots (§2.8). Called out as a GAP-register update (G-17 closure).

### 2.7 Webhook journal — `yellow_card_webhook_events` (WIRED)

`handleYellowCardWebhook` (awaited) inserts one journal row per verified delivery: `event_id` (derived from
the verified payload, stable across redeliveries), disbursement_id, source, summary status, `payload_hash`,
`verified` result, `observed_at`. Raw body is **not** stored (2.6). Redeliveries reuse the same `event_id`.
The journal feeds duplicate-event detection (5.2) and the duplicate-ack path in the webhook handler.

### 2.8 Shared observation log — `external_status_snapshots` (WIRED)

New helper `recordStatusSnapshot({ db, disbursementId, source, status, responseTimeMs, errorMessage,
payloadHash })` in `evidenceCollector.js`, called by the recorders (§3) and by the reconciliation worker's
polls (5.7). `raw_response` stays NULL unless the caller explicitly passes a sanitized summary. `auditTimeline.js`
already reads this table — it now gets real rows. Pairs with the new `poll_result` writer for observation legs.

---

## 3. Transition → evidence writer mapping (every successful transition)

All rows below denote the **canonical `transition` record that `executeTransition` writes on success**
(2.5) **plus** the supplementary writer that action already emits or gains.

| # | Transition action | Supplementary evidence / rows today | New canonical transition evidence |
|---|---|---|---|
| 1 | `runPreflightCheck` | `gate_result` per gate (`payout_gates` rows) | transition |
| 2 | `submitBurn` | `tx_hash`; **New:** `on_chain_events` broadcast row (4) | transition |
| 3 | `recordBurnConfirmation` | **none today**; **New:** `on_chain_events` confirmed row (4) + snapshot (2.8) | transition |
| 4 | `requestAttestation` | `api_response` + snapshot | transition |
| 5 | `confirmAttestation` | `api_response` + snapshot | transition |
| 6 | `beginReleaseObservation` | **none today**; snapshot `unobserved` | transition |
| 7 | `recordReleaseObservation` | `api_response` + snapshot | transition |
| 8 | `confirmDestinationRelease` | `api_response` + snapshot | transition |
| 9 | `recordReleaseObservedFailed` | `api_response` + snapshot | transition |
| 10 | `submitYellowCardPayout` | `api_response` + snapshot (+ persisted `payout_id`) | transition |
| 11 | `confirmYellowCardPayout` | `api_response` + snapshot; webhook path `webhook_payload` + journal row | transition |
| 12 | `markSettled` | **none today** | transition |
| 13 | `markFailed` | **none today** | transition |
| 14 | `markCancelled` | **none today** | transition |
| 15 | `moveToManualReview` | **none today**; **New:** `manual_review_queue` row (6) | transition |
| 16 | Manual-review resolutions (`manual_review → failed/settled/cancelled`) | as 12–14 | transition |

Consequence: a settled disbursement's stored evidence alone (no wall-clocks, no live calls) contains the full
chain — this is the receipt's input (7).

---

## 4. Dead-table dispositions (G-16) — exact decisions with reasons

| Table | Decision | Reason |
|---|---|---|
| `yellow_card_webhook_events` | **WIRE** | Canonical place for verified webhook deliveries; feeds duplicate-event detection (5.2) and the duplicate-ack path. Evidence references journal rows. |
| `on_chain_events` | **WIRE** | Burn broadcast + confirmation rows give the Stacks leg an observable log that reconciliation (5.4/5.5) and the receipt (7) read. `recordBurnConfirmation` and the burn-scan job write confirmed rows. |
| `relay_wallet_activity` | **REMOVE** (migration + backlog) | CineX-owned internal table, out of BOS scope; migrating it forward would create dead columns (E-class → `docs/POSTPONED_BACKLOG.md`). |
| `external_status_snapshots` | **WIRE** | Already read by `auditTimeline.js:58`; becomes the shared observation log (2.8). |
| `config_snapshots` | **REMOVE** (migration + backlog) | The exchange rate it was meant to snapshot already persists on the `disbursements` row; adapter config is deployment config, not per-disbursement audit. MVInfra — no consumer today (grep: nothing reads it). |
| `manual_review_queue` | **WIRE** | The operator queue: rows on entry to `manual_review` (6); `dashboardQueries.getManualReviewQueue` retargets from the `disbursements` scan onto it. |

Both removals land in `migrations/008_sprint_4.sql` (`DROP TABLE`), and each removal carries a dated, reasoned
`POSTPONED_BACKLOG.md` entry per the change-control rule.

---

## 5. Reconciliation worker — five detection modes (Sprint 4 core)

`src/services/bos/reconciliationWorker.js` keeps its public surface (`init/start/stop/reconcileOnce/getStats`,
5-min interval) but the job set is **replaced** by five deterministic, offline, idempotent detection jobs.
No `getPayoutStatus` (worker switches to the canonical `lookupSend` seam — the production `getPayoutStatus`
at `yellowcardAdapter.js:402` becomes deprecated-annotated; the mock has no `getPayoutStatus`, so today the
worker is untestable). **Injectable clock**: `init(ctx, { getNow })` with `getNow = () => new Date()` default;
all SLAs computed in JS from stored timestamps (no `NOW()` in worker SQL) so FakeDb tests are deterministic.

Shared scan rules: rows in `manual_review` or terminal states are **excluded** from every scan (manual_review
is not in `TERMINAL_STATES`, otherwise `manual_review → manual_review` re-executes and spams the queue).

### 5.1 Missing webhook

- Domain: rows in `yellowcard_payout_submitted` (or payout leg observed states) whose provider result never
  arrived via webhook.
- Algorithm: for each such row with a `payout_id`, poll `lookupSend(payout_id)`.
  - provider `status=completed` → snapshot + `poll_result` evidence + advance to
    `yellowcard_payout_confirmed` (happy reconciliation).
  - provider `status=failed` → snapshot + evidence + `markFailed`.
  - provider says pending and age(payout_submitted) > SLA → route `manual_review` (5.7).
  - no `payout_id` → route `manual_review` (cannot resolve offline).
- Idempotent: re-runs re-poll; CAS claim prevents double-advance; identical benign redeliveries recorded
  without routing.

### 5.2 Duplicate event

- Domain: `yellow_card_webhook_events` grouped by `event_id` (and by `payout_id`).
- Algorithm: if one event_id or payout_id yielded **conflicting** statuses (e.g. in_progress then failed) →
  snapshot + `reconciliation_detection` evidence + route `manual_review`. Identical redelivery (same event_id,
  same status) → recorded, **no** routing.
- *Flagged interpretation:* duplicate *successful* webhooks that agree are benign; only conflicting facts
  escalate.

### 5.3 Inconsistent status (evidence consistency)

- Domain: every active disbursement (all legs).
- Algorithm: re-check the "duck test" one more time offline using last recorded artifacts
  (on_chain_events ↔ burn leg states; `release_status` ↔ release leg states; webhook journal /
  external_refs ↔ payout leg states). Divergence between a leg's persisted fact and its recorded observations
  → snapshot + detection evidence + route `manual_review`. Also flags the dropped-evidence-insert case (2.5.2).

### 5.4 Timeout escalation (backstop)

- Domain: every non-terminal, non-manual row.
- Algorithm: reuse `STATE_SLA_MS` from `stuckStateReaper.js`; a row whose `last_heartbeat_at` exceeds SLA and is
  **not** already in `manual_review` → snapshot + detection evidence + route `manual_review`. This is a
  deliberate backstop to `stuckStateReaper` (interval may be down), not a rewrite of it; the `moveToManualReview`
  action (now writing queue rows + transition evidence) keeps both paths consistent and deduped.

### 5.5 Orphaned payouts

- Domain: payout-leg rows.
- Algorithm: `payout_id` NULL but `external_refs` unmatchable; or provider `lookupSend` recognizes the payout_id
  as belonging to a **different** disbursement (cross-wire); or provider 404 on a payout we believe was created
  → snapshot + detection evidence + route `manual_review`.

### 5.6 Operation sequence per detection

`poll / read evidence → recordStatusSnapshot → write reconciliation_detection evidence → route via
executeTransition` (route = advance-to-confirmed on happy reconciliation, else `→ manual_review`). Evidence is
always written **before** the state flip; detection evidence is written **only** when routing, never on benign
observations (keeps the chain meaningful and spam-free).

---

## 6. Manual-review queue (WIRED)

`moveToManualReview` (and the runtime cluster of 5.4's reaper timeout) enqueue a row via a new
`enqueueManualReview({ db, disbursementId, reason })`: `ON CONFLICT`-guarded against an open row for the same
disbursement so repeated escalations don't duplicate. Resolution (`manual_review → failed/settled/cancelled`)
marks the open row resolved with timestamp + resolution. `dashboardQueries.getManualReviewQueue` retargets onto
the table. `recordManualNote` evidence writer is wired for operator notes in this context.

---

## 7. Settlement receipt — deterministic, JSON, evidence-reconstructable

New file `src/services/bos/settlementReceipt.js` → `generateSettlementReceipt({ db, disbursementId })`.

- Deterministic: **no `generated_at`/wall-clock fields**; identical stored state ⇒ identical output.
- Sources: `disbursements` row + `disbursement_audit` + `disbursement_evidence` (via `getEvidence`) +
  `external_refs` + `external_status_snapshots` + `on_chain_events` + `yellow_card_webhook_events`.
- **Gaps are explicit**: any leg whose evidence is missing/absent produces a `gaps` entry describing the
  missing leg and the evidence ids that were inspected for it. The receipt reconstructs a **factual** picture —
  it never fabricates a leg. A non-`settled` final status is reported as fact with the terminal evidence.

### 7.1 Example — complete settled receipt

```jsonc
{
  "schema_version": 1,
  "receipt_version": 1,
  "reconstructed_from": "evidence",
  "bos_payout_id": "bos_01HZX...",
  "final_status": "settled",
  "settlement_reference": {
    "provider": "yellowcard",
    "provider_payout_id": "sing_9f2d...",
    "external_settlement_reference": "ext_ref_7k19"
  },
  "stacks_leg": {
    "burn_tx_hash": "0x9b2a...",
    "usdcx_amount_base_units": "10000000",
    "burn_status": "confirmed",
    "burn_confirmed_at": "2026-09-22T10:04:12.000Z",
    "attestation_id": "att_3c88",
    "attestation_status": "confirmed"
  },
  "release_leg": {
    "release_status": "observed_confirmed",
    "observed_at": "2026-09-22T10:09:45.000Z"
  },
  "provider_leg": {
    "status": "confirmed",
    "payout_submitted_at": "2026-09-22T10:10:02.000Z",
    "payout_confirmed_at": "2026-09-22T10:11:30.000Z",
    "ngn_amount": "51234.00"
  },
  "timeline": { "initiated_at": "2026-09-22T09:58:00.000Z", "settled_at": "2026-09-22T10:12:40.000Z" },
  "evidence_refs": [
    { "id": "6f3c...", "event_type": "transition", "status": { "from": "yellowcard_payout_confirmed", "to": "settled" }, "payload_hash": "sha256:ab12..." },
    { "id": "9d21...", "event_type": "webhook_payload", "status": { "result": "confirmed" }, "payload_hash": "sha256:cd34..." }
  ],
  "gaps": []
}
```

### 7.2 Example — receipt with an explicit gap

`final_status: "burn_confirmed"`, the release leg unreachable because no `attestation_id` was ever persisted
(attestation evidence missing):

```jsonc
"gaps": [
  { "leg": "release", "reason": "no attestation_id persisted", "evidence_ids_checked": ["ambiguous evidence ids"] }
]
```

---

## 8. Per-file changes (implementation map)

| File | Change |
|---|---|
| `src/services/bos/evidenceCollector.js` | Envelope + `crypto.randomUUID` id + `payload_hash` + PII stripping; new types `transition`/`reconciliation_detection`; wire `recordPollResult`, `recordManualNote`; add `recordStatusSnapshot`; `getEvidence` ordering + PII-safe read. |
| `src/services/bos/stateMachine.js` | `executeTransition` writes the single canonical `transition` evidence record after `emitEvent` (2.5). |
| `src/services/bos/transitionActions.js` | Snapshot calls in observation/attestation/payout actions; `on_chain_events` in `submitBurn`/`recordBurnConfirmation`; `enqueueManualReview` in `moveToManualReview`. |
| `src/services/bos/disbursementService.js` | `handleYellowCardWebhook`: **await** `recordWebhookPayload`; insert webhook journal row (2.7); duplicate-ack uses journal `event_id`. |
| `src/services/bos/reconciliationWorker.js` | Replace jobs with the five modes (5); `lookupSend` seam; injectable `getNow`; route helpers (5.6). |
| `src/services/bos/stuckStateReaper.js` | Route through `enqueueManualReview`/evidence (shared helper) so its escalations are honored + logged. |
| `src/services/bos/settlementReceipt.js` | **NEW** — `generateSettlementReceipt` (7). |
| `src/services/bos/auditTimeline.js` | Consume live snapshots/evidence (labels unchanged). |
| `src/services/bos/monitoring/dashboardQueries.js` | `getManualReviewQueue` retargets onto `manual_review_queue`. |
| `src/services/bos/yellowcardAdapter.js` | `getPayoutStatus` marked deprecated (worker uses `lookupSend`). |
| `migrations/008_sprint_4.sql` | **NEW** — `DROP TABLE relay_wallet_activity, config_snapshots`; any needed indexes/columns for the journal wiring. |
| `docs/POSTPONED_BACKLOG.md` | Removal notes for both dropped tables (dated, reasoned per change-control). |
| `docs/PRODUCT_BASELINE.md` / `docs/GAP_REGISTER.md` / `docs/CLAIMS_REGISTER.md` / `README.md` | G-16 closed (wire/remove each table with reasons), G-17 closed (all six recorders live), evidence-model + receipt docs; claims stay SIMULATED/MODEL CORRECTED. |

---

## 9. Test files and coverage

### New

| File | Cases |
|---|---|
| `test/unit/evidence-recorders.test.js` | Envelope correctness (all fields), `payload_hash` present and raw payload absent, PII fields never appear in `evidence_data`, snapshot write for each recorder, `recordPollResult`/`recordManualNote` wired, ordering `(created_at, id)`. |
| `test/unit/transition-evidence.test.js` | Every successful transition (16 actions) writes **exactly one** `transition` evidence record; none today (`markSettled/markFailed/markCancelled/moveToManualReview/recordBurnConfirmation/beginReleaseObservation`) gain it; record appears after audit `emitEvent`; fields `{from,to,triggered_by}`. |
| `test/unit/reconciliation.test.js` | Five jobs, each: deterministic offline (FakeDb + mock adapters + injected clock), idempotent re-run (no double-advance, no queue duplication), evidence-before-flip ordering, manual/terminal rows excluded; the `getPayoutStatus`→`lookupSend` seam; dup-conflict routes while benign redelivery records without routing. |
| `test/unit/settlement-receipt.test.js` | Complete settled receipt identical across calls (determinism); leg present/absent; `gaps` populated on missing evidence; non-settled final status reported as fact; built from stored rows only (no live adapter). |
| `test/unit/dead-tables.test.js` | Wired tables (`yellow_card_webhook_events`, `on_chain_events`, `external_status_snapshots`, `manual_review_queue`) receive rows through their flows; removed tables (`relay_wallet_activity`, `config_snapshots`) no longer referenced anywhere. |

### Updated

| File | Change |
|---|---|
| `test/unit/webhook-verify.test.js:192` | Evidence count `2 → 3` (canonical transition record on the advancing delivery) + new journal-row assertion; duplicate delivery still adds nothing beyond the journal redelivery record. |
| `test/e2e/mock-lifecycle.e2e.test.js` | Full mock lifecycle to `SETTLED` asserts the evidence trail (every transition present, hash-not-payload) and a receipt generated from the settled row with `gaps: []`. |
| `test/unit/auditTimeline.test.js`, `test/unit/duplicate-handling.test.js`, `test/unit/release-observation.test.js` | Must pass unchanged (grep confirms their evidence stubs tolerate the additive writers). `harness.test.js` module list gains `settlementReceipt.js`. |

Evidence for the report: full suite output recorded; final count taken from the run, never invented.

---

## 10. Commit plan + scope check

Combined scope ≈ **15 logical commits** → exceeds ~10 → **proposed split**, reviewer picks order.

### 4a — Evidence foundation (~9 commits) — **recommended first**

1. `feat(evidence): envelope + uuid + payload hashes + PII strip` (evidenceCollector rewrite, snapshot helper).
2. `feat(evidence): single canonical transition record in executeTransition`.
3. `feat(evidence): wire poll_result + manual_note recorders`.
4. `feat(webhook): awaited webhook evidence + allowed journal rows`.
5. `feat(evidence): on_chain_events wired (broadcast + confirmation)`.
6. `feat(evidence): manual_review_queue rows in moveToManualReview + dashboard retarget`.
7. `chore(db): drop relay_wallet_activity + config_snapshots + backlog notes`.
8. `test: evidence-recorders + transition-evidence + dead-tables + webhook-verify/e2e updates`.
9. `docs: evidence model + G-16/G-17 closure`.

### 4b — Reconciliation + receipts (~6 commits)

10. `feat(reconcile): five-mode deterministic worker + lookupSend + clock`.
11. `test: reconciliation determinism/idempotency/detection`.
12. `feat: settlementReceipt generator`.
13. `test: settlement-receipt determinism + gaps`.
14. `test: e2e evidence trail + receipt from settled row`.
15. `docs: sprint 4 report + receipts + claims`.

**Recommendation: 4a first** — 4b's reconciliation and receipts *consume* the chain 4a builds; 4a is fully
testable and shippable on its own. Each commit keeps `npm test` green.

---

## 11. Deviations from the Sprint 2 state, with reason

| # | Deviation | Reason |
|---|---|---|
| D1 | Canonical `transition` evidence type + auto-writer in `executeTransition`. | Sprint 2 left `markSettled/markFailed/markCancelled/moveToManualReview/recordBurnConfirmation/beginReleaseObservation` with no evidence; a complete chain requires it. |
| D2 | `recordWebhookPayload` **awaited** + webhook journal rows. | The payload evidence is the confirmation leg; fire-and-forget could silently drop it (G-06). Journal enables duplicate (5.2) and missing-webhook (5.1) detection. |
| D3 | Recorders also append `external_status_snapshots`; `poll_result` + `manual_note` wired. | Makes the shared observation log a first-class artifact for reconciliation + auditTimeline; closes G-17 (all six recorders live). |
| D4 | Two new evidence types (`transition`, `reconciliation_detection`). | Required by the prompt's "exactly one evidence per transition" and "detect → evidence describing the detection". |
| D5 | `reconciliationWorker` rewritten to five deterministic modes; `getPayoutStatus` → `lookupSend`; injected `getNow`. | Worker referenced a seam absent from mocks (untestable today); deterministic/offline is a prompt requirement. |
| D6 | `on_chain_events` wired. | G-16 table becomes the Stacks leg's observable log for burn failure/duplicate detection + receipt. |
| D7 | `manual_review_queue` populated; dashboard query retargets. | G-16 table becomes the real operator queue; reconciler/reaper/operator all route through it. |
| D8 | `relay_wallet_activity` + `config_snapshots` dropped (migration + backlog). | No consumer, out of BOS scope (relay = CineX-owned, E-class); rate already on row; prevents dead-column accretion (G-16). |
| D9 | Settlement receipt is deterministic (no `generated_at`). | "Reconstructable from stored evidence alone" + reproducible hash review ⇒ no wall-clock fields. |
| D10 | e2e evidence assertions extended; `webhook-verify.test.js` count 2→3. | Canonical transition records (D1) add one insert to the webhook path; existing `>= 4` count still passes. |

No D/E-classified work is implemented: real provider/corridor verification, testnet, and the public API
(Sprint 5) remain out of scope.

---

## 12. What remains UNVERIFIED — explicit statement

- **Anything external** (xReserve release surface, Yellow Card send statuses, Stacks burn confirmations):
  unchanged UNVERIFIED posture; all reconciliation decisions in tests run against mocks and FakeDb.
- **Real-world divergence semantics** (5.1–5.5): a corridor may express "missing webhook" differently than
  `lookupSend` returns today; every detection route described here is against the current adapter surfaces
  and is **model-corrected, not corridor-verified**.
- **Timeout magnitudes** already carry the Sprint 2 caveat (placeholder SLAs, re-tuned in a verification
  sprint).
- The e2e mock lifecycle proves the state machine coerces evidence and produces a gap-free receipt **given
  the mock**, never that external settlement behaves as the mock does.

---

## 13. Gate checklist before implementation review

1. ✅ (planned) evidence record shape is fixed and documented (event type, source, external ref, timestamp, status, payload hash, verification), PII-free.
2. ✅ (planned) every successful transition writes **exactly one** canonical `transition` evidence record (`transition-evidence.test.js`).
3. ✅ (planned) all six unused items are wired: `recordWebhookPayload` (awaited), `recordManualNote`, `recordPollResult` (+ `getEvidence` consumed by the receipt).
4. ✅ (planned) no sensitive financial payloads stored anywhere — hashes only (`evidence-recorders.test.js` asserts raw PII absent).
5. ✅ (planned) all six G-16 tables dispositioned, wire/remove implemented; both removals ripple through `POSTPONED_BACKLOG.md`.
6. ✅ (planned) five reconciliation failure modes detected deterministically, offline, idempotently, routing to `manual_review` with detection evidence written before any state flip (`reconciliation.test.js`).
7. ✅ (planned) settlement receipt deterministic JSON reconstructable from evidence alone, explicit `gaps` (`settlement-receipt.test.js`).
8. ✅ (planned) e2e mock lifecycle asserts the complete trail + gap-free receipt from a settled row.
9. ✅ (planned) Sprint 2/3 suite still green; `webhook-verify.test.js` count updated with reason.
10. ✅ (planned) three baseline docs updated; no fabricated results; final test count taken from the run.
11. ✅ (planned) no new runtime npm dependencies; no CineX files modified; no pushes.

**STOP — plan ends here. Produced for review; nothing has been implemented, no source file was modified, and
the baseline suite (78/77/0/1) was merely observed. No external network call was made. No commit was created.**