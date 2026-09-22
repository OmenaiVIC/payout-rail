# 05 — SPRINT 3: NIGERIA / NGN PAYOUT INTEGRATION

> Task: implement a provider-correct Yellow Card payout adapter for the NGN corridor.
> Mode: implementation with deterministic mocked tests. Sandbox path only if credentials exist.
> Outputs: YellowCardAdapter, webhook verification, idempotency, status normalization.

---

SPRINT 3 — NIGERIA / NGN PAYOUT INTEGRATION

Objective:
Implement a provider-correct Yellow Card payout adapter for the Nigeria/NGN validation corridor.

Tasks:

1. Review the current official Yellow Card API documentation.

2. Compare the existing adapter against the documented API.

3. Do not preserve undocumented endpoint assumptions.

4. Define:
   YellowCardAdapter interface

Minimum conceptual operations:

- initiate payout
- retrieve payout status
- resolve/validate recipient where supported
- retrieve supported payout channels where required
- verify webhook
- normalize provider status
- health check.

5. Implement the adapter using environment-based credentials.

6. No credentials in source code.

7. No credentials in logs.

8. Implement request/response normalization.

9. Implement idempotency according to provider capabilities.

10. Implement webhook verification using the provider's documented mechanism.

11. Implement duplicate webhook protection.

12. Implement retry behavior only where safe.

13. Distinguish:

- accepted
- pending
- completed
- failed
- reversed
- unknown.

14. Build deterministic mocked provider tests.

15. If Yellow Card sandbox credentials are available, add a sandbox integration test path.

16. If credentials are NOT available:

- implement the correct adapter
- implement mocked tests
- document LIVE/SANDBOX verification as BLOCKED.

Acceptance Criteria:

- Provider implementation matches current documented API.
- NGN is explicitly supported in the corridor configuration.
- Webhooks are authenticated where provider documentation permits.
- Duplicate webhooks do not duplicate payouts.
- Provider failures do not advance BOS state incorrectly.
- No production payout is claimed without real evidence.
