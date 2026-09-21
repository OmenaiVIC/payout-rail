# Postponed Backlog — payout-rail

Items deferred beyond the BOS extraction, recorded with the disposition agreed at
review. Imported from the extraction's carry-forward list (see
`EXTRACTION_REPORT.md`, "Carry-forwards (known issues preserved verbatim)").

For the CineX-side log entry, see `CineX/docs/POSTPONED_BACKLOG.md`.

---

## C-01 — Burn confirmation re-reads `external_tx_id` before it is written

- **Status:** POSTPONED — fix in Sprint 1.
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

- **Status:** POSTPONED — **MUST-FIX before Sprint 3 (Yellow Card go-live)**.
  This is a **double-payout risk**.
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