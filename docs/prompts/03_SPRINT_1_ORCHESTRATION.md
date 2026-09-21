# 03 — SPRINT 1: STANDALONE ORCHESTRATION CORE

> Task: make the orchestration engine provider-agnostic and independently testable.
> Mode: implementation with TDD. State machine, transition guards, idempotency.
> Outputs: domain entities, lifecycle states, transition tests, updated state machine docs.

---

SPRINT 1 — STANDALONE ORCHESTRATION CORE

Objective:
Make the BOS orchestration engine independently understandable and provider-agnostic.

Scope:

1. Define canonical domain entities for:

- Payout
- Settlement
- Provider Action
- Evidence
- Webhook Event
- Reconciliation Event.

2. Define explicit lifecycle states.

Minimum required conceptual states:

PAYOUT_CREATED
PREFLIGHT
SOURCE_SETTLEMENT_PENDING
SOURCE_SETTLEMENT_CONFIRMED
EXTERNAL_SETTLEMENT_PENDING
EXTERNAL_SETTLEMENT_CONFIRMED
LOCAL_PAYOUT_PENDING
LOCAL_PAYOUT_SUBMITTED
LOCAL_PAYOUT_CONFIRMED
SETTLED

Failure/control states:

MANUAL_REVIEW
FAILED
CANCELLED

Do not add states unless justified by an actual lifecycle requirement.

3. Define legal state transitions.

4. Implement transition guards.

5. A financial action must not occur unless its prerequisite state is confirmed.

6. Implement idempotent transition handling.

7. Separate:

- orchestration logic
  from
- provider adapters.

8. Provider adapters must expose explicit interfaces.

9. Add deterministic tests for:

- valid transitions
- invalid transitions
- duplicate transitions
- retry
- worker restart
- failure
- manual review
- terminal states.

10. Preserve existing useful behavior where possible.

Acceptance Criteria:

- Core orchestration can be tested without external providers.
- Illegal financial state transitions are rejected.
- Duplicate events do not duplicate actions.
- Provider-specific code is not required to understand the core state machine.
- All transition rules have tests.
- Documentation reflects the resulting state machine.
