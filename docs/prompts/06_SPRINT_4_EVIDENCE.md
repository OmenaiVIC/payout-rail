# 06 — SPRINT 4: SETTLEMENT EVIDENCE AND RECONCILIATION

> Task: make every payout auditable from source settlement through local payout.
> Mode: implementation with tests. Immutable evidence chain, reconciliation workers, settlement receipts.
> Outputs: evidence records, reconciliation workers, receipt generator, tests.

---

SPRINT 4 — SETTLEMENT EVIDENCE AND RECONCILIATION

Objective:
Make every payout auditable from source settlement through local payout.

Implement an evidence chain:

Payout ID
→ Stacks transaction
→ USDCx burn
→ withdrawal status
→ external settlement evidence
→ local provider transaction
→ local payout status
→ final settlement state.

Tasks:

1. Define immutable evidence records.

2. Store:

- event type
- source
- external reference
- timestamp
- status
- payload hash or safe normalized representation
- verification result.

3. Do not store unnecessary sensitive financial information.

4. Implement reconciliation workers.

5. Implement:

- missing webhook recovery
- polling recovery
- duplicate event handling
- inconsistent status detection
- timeout escalation
- manual review.

6. Create settlement receipt generation.

Example:

## Settlement Receipt

BOS Payout ID
Stacks TX
USDCx amount
Burn status
Withdrawal status
External settlement reference
Provider
Provider payout ID
NGN amount
Final status
Timestamps
Evidence references

7. Add tests.

Acceptance Criteria:

A completed test payout produces a complete machine-readable evidence trail.

A missing or contradictory event cannot silently produce SETTLED.

Every settlement can be reconstructed from stored evidence.
