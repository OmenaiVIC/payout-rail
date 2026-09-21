# 04 — SPRINT 2: STACKS/USDCx WITHDRAWAL LIFECYCLE

> Task: replace incorrect xReserve assumptions with the canonical Stacks/USDCx withdrawal lifecycle.
> Mode: integration modeling and deterministic mocked tests.
> Outputs: corrected adapter, lifecycle tests, README distinguishes implemented vs externally dependent.

---

SPRINT 2 — STACKS/USDCx WITHDRAWAL LIFECYCLE RECONCILIATION

Objective:
Replace any incorrect assumptions about xReserve with the canonical Stacks/USDCx withdrawal lifecycle.

Important:
Do not assume that the BOS itself performs Circle/xReserve attestation operations.

The BOS must correctly model and track the externally operated withdrawal lifecycle.

Tasks:

1. Review the current Stacks USDCx withdrawal documentation and relevant API/contract documentation.

2. Map:

Stacks USDCx burn
→ Stacks attestation/withdrawal processing
→ external USDC release
→ destination settlement evidence.

3. Identify what the BOS must:

- initiate
- observe
- query
- verify
- record.

4. Identify what is performed externally and therefore must NOT be represented as an internally controlled BOS action.

5. Redesign the existing xReserve adapter if required.

6. Prefer naming that describes the actual integration boundary.

If "xReserveAdapter" is technically misleading, document and/or rename it appropriately.

7. Implement:

- withdrawal identification
- withdrawal status retrieval
- polling
- timeout
- retry
- terminal status handling
- evidence capture.

8. Never treat a mocked withdrawal status as real settlement evidence.

9. Add deterministic mocked tests for every documented lifecycle state.

10. Add test fixtures representing:

- pending
- processing
- completed
- failed
- unknown
- timeout
- malformed provider response.

Acceptance Criteria:

- BOS no longer models an unsupported xReserve flow as if it were canonical.
- The actual Stacks/USDCx withdrawal lifecycle is represented.
- External settlement is only marked CONFIRMED when appropriate evidence exists.
- Tests cover all expected statuses.
- No live credential is required to run tests.
- README explicitly distinguishes:
  "implemented orchestration"
  from
  "externally dependent settlement."

BLOCKER RULE:

If the current API cannot be verified from official documentation or cannot be accessed in the current environment, stop at the correct adapter boundary and report BLOCKED.
Do not fabricate endpoint behavior.
