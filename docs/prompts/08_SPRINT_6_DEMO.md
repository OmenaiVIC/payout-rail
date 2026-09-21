# 08 — SPRINT 6: REPRODUCIBLE NIGERIA PAYOUT DEMONSTRATION

> Task: produce reproducible evidence of the Nigeria corridor without pretending unavailable infrastructure exists.
> Mode: demo runner with DEMO_MODE and SANDBOX_MODE. Never mix evidence.
> Outputs: demo runner, transaction timeline, machine-readable settlement receipt, reproducible command.

---

SPRINT 6 — REPRODUCIBLE NIGERIA PAYOUT DEMONSTRATION

Objective:
Produce the strongest possible reproducible evidence of the Nigeria corridor without pretending unavailable external infrastructure exists.

Target lifecycle:

Stacks application
→ USDCx settlement event
→ BOS tracking
→ external settlement confirmation
→ Yellow Card NGN payout
→ payout confirmation
→ settlement receipt.

Tasks:

1. Build a deterministic demo runner.

2. Support two explicit modes:

DEMO_MODE
SANDBOX_MODE

3. DEMO_MODE:
   All external dependencies mocked.
   Clearly label every mocked event.

4. SANDBOX_MODE:
   Use actual test/sandbox services where credentials and provider access are available.

5. Never mix demo and real evidence.

6. Produce a human-readable transaction timeline.

7. Produce machine-readable settlement receipt.

8. Record:

- timestamps
- IDs
- statuses
- external references
- evidence.

9. Add a reproducible test command.

Example concept:

npm run demo:payout:ngn

10. Add documentation describing exactly what the command proves and does not prove.

Acceptance Criteria:

The demonstration is reproducible by another developer.

Demo results cannot be mistaken for production transactions.

If sandbox credentials exist, the sandbox path produces actual provider evidence.

If they do not exist, the application explicitly reports the missing external verification rather than fabricating success.
