# 07 — SPRINT 5: PUBLIC INTEGRATION INTERFACE

> Task: define the minimum developer-facing interface for a Stacks application to integrate the BOS.
> Mode: API contract design, schemas, example client.
> Outputs: public API, request/response/error schemas, example client in examples/simple-payout-client/.

---

SPRINT 5 — PUBLIC INTEGRATION INTERFACE

Objective:
Create the minimum developer-facing interface required for another Stacks application to integrate the BOS.

Tasks:

1. Define the public BOS API/interface.

Minimum operations:

create payout
get payout
get payout status
get settlement evidence
retry eligible payout
request manual review where applicable.

2. Define request schemas.

3. Define response schemas.

4. Define error schemas.

5. Define authentication boundary.

6. Define idempotency-key behavior.

7. Create a minimal example application.

The example must demonstrate:

Stacks application
→ BOS
→ payout lifecycle
→ evidence.

8. Create:
   examples/simple-payout-client/

9. Provide:

- README
- configuration example
- sample requests
- sample responses
- error examples
- lifecycle example.

10. Do not build a large frontend.

Acceptance Criteria:

A developer unfamiliar with CineX can understand how to integrate the BOS by reading the example.

The example runs against mocked/sandbox infrastructure without requiring CineX's creative-financing system.

The integration surface is documented and versionable.
