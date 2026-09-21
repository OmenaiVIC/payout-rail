# 09 — SPRINT 7: OPEN-SOURCE RELEASE CANDIDATE

> Task: make the BOS presentable as independent reusable infrastructure.
> Mode: documentation, README, maturity statement, claims/evidence table.
> Outputs: README, ARCHITECTURE.md, INTEGRATION.md, PROVIDER_ADAPTERS.md, SECURITY.md, DEVELOPMENT.md.

---

SPRINT 7 — OPEN-SOURCE RELEASE CANDIDATE

Objective:
Make the BOS presentable as independent reusable infrastructure rather than an internal CineX subsystem.

Tasks:

1. Review repository naming.

2. Remove unnecessary CineX creative-financing dependencies.

3. Ensure the BOS can be understood independently.

4. Update README.

README must contain:

- What it is
- Problem
- Target developer/user
- Architecture
- Supported corridor
- Supported providers
- Installation
- Configuration
- API
- Example
- Testing
- Demo
- Current limitations
- Security
- External dependencies
- Roadmap.

5. Add ARCHITECTURE.md.

6. Add INTEGRATION.md.

7. Add PROVIDER_ADAPTERS.md.

8. Add SECURITY.md.

9. Add DEVELOPMENT.md.

10. Add explicit maturity statement:

Prototype / testnet / sandbox / production.

Only select the truthful status.

11. Add claims/evidence table.

12. Remove obsolete documentation that contradicts implementation.

13. Do not claim:

- production readiness
- live payouts
- regulatory compliance
- custody
- multi-country support
  unless independently demonstrated.

Acceptance Criteria:

An external Stacks developer can clone the repository and understand:
what it does,
how it works,
how to run it,
how to integrate it,
what is real,
what is mocked,
and what remains unfinished.
