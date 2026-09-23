# Postponed Backlog — payout-rail

Items deferred beyond the BOS extraction, recorded with the disposition agreed at
review. Imported from the extraction's carry-forward list (see
`EXTRACTION_REPORT.md`, "Carry-forwards (known issues preserved verbatim)").

For the CineX-side log entry, see `CineX/docs/POSTPONED_BACKLOG.md`.

---

## C-01 — Burn confirmation re-reads `external_tx_id` before it is written

- **Status:** POSTPONED — fix in Sprint 1. **Current disposition (Sprint 7): still OPEN** as P1 `G-05` in `docs/GAP_REGISTER.md` (no `RESOLVED` marker). The fix direction (persist `external_tx_id` on submit, or read from `external_refs` by key) has not been implemented; a just-submitted burn still cannot be confirmed by `isBurnConfirmed` and is routed to manual review by the stuck-state reaper.
- **Problem (plain English):** When the pipeline creates the burn transaction on
  Stacks (`submitBurn`), it stores the disbursement with its `external_tx_id` still
  empty. The confirmation step (`isBurnConfirmed`) looks up the disbursement by that
  same `external_tx_id`. So for a just-submitted burn, the lookup finds nothing and the
  state machine cannot confirm it — the disbursement can sit unconfirmed until the
  stuck-state reaper picks it up and routes it to manual review.
- **Why it was kept:** It is a faithful copy of the behaviour that existed in the
  upstream CineX code at the extraction commit. The extraction scope was "preserve
  verbatim", so it shipped as a documented carry-forward rather than a silent fix.
- **Why it matters:** A legitimate burn can be mis-routed to the human-in-the-loop
  queue (or flapped as failed) purely because the confirmation lookup targets a column
  that hasn't been populated yet.
- **Suggested fix direction:** In `submitBurn`, write back the transaction id/`tx_id`
  immediately (or have the confirmation step query by `disbursement_id`/idempotency key
  instead of `external_tx_id`) before `burn_confirmed` is reachable.

---

## C-04 — Weak idempotency key can allow a duplicate payout

- **Status:** ~~POSTPONED — **MUST-FIX before Sprint 3 (Yellow Card go-live)**~~ → **FULFILLED (Sprint 7).**
  This was a **double-payout risk**; the fix shipped in Sprint 6 (deterministic
  idempotency, claim F4 — `disbursementService.js:53-63` derives the idempotency key
  from stable inputs and `migrations/006` adds the `UNIQUE(idempotency_key)`
  constraint; the public API and pipeline retry on the same key so replayed ticks
  collide and are rejected). The row is retained as the record of the risk.
- **Problem (plain English):** The idempotency key that guards against re-processing a
  disbursement is built from `source_reference`, `amount_usdcx`, and the wall-clock
  **timestamp at creation time**. Because two otherwise identical operations created in
  different milliseconds get different keys, a retry (e.g. after a worker crash, a
  duplicate dispatch, or a manual re-run) is **not** recognised as the same operation
  and can be processed a second time. In the payout leg (Yellow Card), a duplicated
  burn/attestation/release could mean sending money twice for one disbursement.
- **Why it was kept:** Faithful copy of the upstream implementation at the extraction
  commit; behavioural change was out of scope.
- **Suggested fix direction:** Derive the idempotency key from stable inputs only —
  e.g. `disbursement:{source_reference}:{amount_usdcx}` with a deterministic hash — so
  retries collide with the original and are rejected by the `UNIQUE` constraint.
  Wire the same key through burn → attestation → release so a replayed pipeline tick
  cannot advance a disbursement past a step that already succeeded.

---

## C-06 — `exchange_rates` uniqueness already mitigated here

- **Status:** CLOSED (no further action). Root cause logged against CineX.
- Payout-rail's migration runner tracks applied migrations (`schema_migrations` table),
  so the `exchange_rates` seed insert runs exactly once — it cannot accumulate
  duplicate rows across restarts. No additional mitigation is required in this repo.

---

## C-07 — `fallbackPoller.js` deleted in Sprint 1.5 (G-14)

- **Status:** SUPERSEDED — module deleted. Logged per change-control rule for D/E items.
- **Capability removed:** A polling fallback that periodically queried external APIs
  (`stacks.getTransactionStatus`, `xreserve.getAttestationStatus`/`getReleaseStatus`,
  `yellowcard.getPayoutStatus`) when webhooks failed or were delayed, advancing or
  failing disbursements based on external status.
- **Reason for removal (Sprint 1.5):** The module used CommonJS (`module.exports`) in an
  ESM package and would crash on import; it had zero importers. Its job is already
  covered by (a) the existing confirmation guards (`transitionGuards.js`), which query
  the same adapters during normal advancement, and (b) the already-wired `stuckStateReaper`
  and `reconciliationWorker`. No concrete need for an independent poller exists in
  Sprint 2 or 3.
- **Why deferred:** Redundant today; kept as a backlog item only for completeness.
- **Resurrection conditions (Sprint 3+):** If Yellow Card webhook-delivery SLAs ever
  require proactive status polling (i.e. when a missed webhook can strand real money),
  rebuild the poller as an ESM module wired into `pipelineWorker` with its own scheduler.
  All provider methods it needs already exist on the adapters.
- **Dependencies:** adapter methods exist; proof-of-life requires a real webhook-flake
  scenario.
- **Estimated complexity to resurrect:** Medium (a new worker + test suite).

---

## Sprint 2 additions (G-08 observation model — deferred, not built)

### S2-1 — Observation recency / freshness column (`release_observed_at`) is declined this sprint

- **Status:** POSTPONED (proposed, not implemented). Design note: placing recency into a column
  invites stale-data unlocks; the Sprint 2 payout guard instead **re-observes the external surface at
  transition time** (a fresh poll every tick), so a separate recency column is not needed to keep the
  fail-closed property. Proposed for a monitoring/verification sprint: expose observation `observed_at`
  on the disbursement and alert on staleness.
- **Resurrect if:** the real observation surface is slow/expensive to poll (throttling), or a dashboard
  needs last-seen evidence per disbursement.

### S2-2 — Extra release-monitoring improvements (flagged collateral D5, scope-limited)

Per the approved D5 guardrail, Sprint 2 changed **only** the state reference in
`monitorJob.checkDestinationReleaseFailures`. Deferred monitoring hardening:

- Distinct alert severities for `destination_release_unobserved` (no evidence yet — warning) vs
  `destination_release_observed` (evidence exists — critical), instead of one critical level.
- A "pre-SLA advisory" alert when a disbursement approaches the reaper threshold but has not yet been
  reaped (surfaces visibility without a state change).
- Exposing `release_status` in the monitoring dashboard queries and alert details.
- Alert message that names the observation status (`unobserved`/`observed_pending`) and its age, so the
  ops channel shows whether any evidence has ever existed.

**Resurrect if:** a monitoring sprint or go-live readiness review asks for operator-grade release-leg
visibility; all are additive to the current (correct but coarse) single check.

---

## Sprint 4 additions (evidence foundation 4a — tables dropped / superseded)

### S4-1 — `relay_wallet_activity` dropped (4a, approved D/E disposition)

- **Status:** CLOSED — table dropped in `migrations/008_sprint_4.sql`.
- **Why it was kept until now:** Faithful copy of the upstream CineX schema at extraction;
  the extraction scope was "preserve verbatim".
- **Why it is dropped:** The table was write-dead — no code path ever inserts a row (verified
  in Sprint 4: zero references outside the schema). The evidence story is now singular:
  ledger of record is `disbursement_evidence` (+ `external_status_snapshots`,
  `on_chain_events`, `yellow_card_webhook_events`), so a never-written relay-wallet table only
  invited confusion about where chain evidence lives. `on_chain_events` covers the on-chain
  tracking role.
- **Resurrect if:** a relay-wallet auditing discipline is ever introduced (requires a real
  writer + test coverage before it returns).

### S4-2 — `config_snapshots` dropped (4a, approved D/E disposition)

- **Status:** CLOSED — table dropped in `migrations/008_sprint_4.sql`.
- **Why it was kept until now:** Faithful copy of the upstream CineX schema at extraction.
- **Why it is dropped:** Write-dead (zero references outside the schema) and superseded by the
  gate/transition evidence trail: preflight gates are recorded per gate in `payout_gates` with
  matching `evidence_type = 'gate_result'` rows, and every successful transition writes a
  canonical `transition` evidence record. A snapshot of configuration state added nothing not
  already captured.
- **Resurrect if:** change-management needs a dedicated before/after view of app configuration
  at transition time.

---

## Sprint 5 additions (public disbursement API 5a — deferred, not built)

### RBAC-1 — Role-based access control for `approve` / `resolve` (P2)

- **Status:** POSTPONED — P2. Sprint 5 ships operator actions behind the shared
  fail-closed token only (approved Option C / Deviation 3 & 4 in
  `docs/SPRINT_5_PLAN.md`); RBAC is deliberately **not** implemented in 5a.
- **What exists instead:** `POST /api/v1/disbursements/:id/approve` and
  `POST /api/v1/disbursements/:id/resolve` are gated by the same `BOS_API_TOKEN`
  bearer used by every other disbursement route. The `approver` label is a
  caller-supplied string recorded in `two_person_approvals.approver_address`;
  on resolve, `reviewer` is recorded as `resolved_by` on the `manual_review_queue`
  row (operator call) or `workflow` (system call). The two-person rule is counted
  on distinct labels, not distinct identities.
- **Risk while in backlog:** any caller holding the shared token can record an
  approval or resolve a manual_review row. Compensation: approvals need two
  distinct labels and every resolution is attributed + audit-logged; but one
  leaked token could in principle fabricate both sides.
- **Suggested fix direction:** real operator RBAC — an `operators` table keyed by
  identity with per-operator API tokens, a role check (`approve` / `resolve`) at
  the route layer, and `approver` / `reviewer` derived from the authenticated
  principal instead of the request body. Optionally thread the identity into the
  receipt as `inspected_by`.
- **Estimated complexity to resurrect:** Medium — new table(s) + auth middleware +
  route changes + tests. No state-machine changes required.
- **Resurrect if:** more than a handful of operators, or an audit requirement that
  a free-form label cannot satisfy.
