# 02 — PROMPT 0: TECHNICAL BASELINE + GAP REGISTER

> Task: establish the technical and product baseline for Payout Rail.
> Mode: discovery, classification, and documentation. No architectural changes.
> Outputs: docs/PRODUCT_BASELINE.md, docs/CLAIMS_REGISTER.md, P0–P3 gap register.

---

# PROMPT 0 — PAYOUT RAIL TECHNICAL BASELINE + GAP REGISTER

## Role

Continue acting as the Senior Technical Product Manager, CTO, and Principal Engineer for the newly extracted **Payout Rail** repository.

The original CineX repository is a separate protected product.

All work in this sprint occurs in the new Payout Rail repository.

Do not return to modifying CineX unless explicitly instructed.

---

# Objective

Establish a complete technical and product baseline for the extracted Payout Rail implementation before rebuilding or redesigning it.

This sprint is discovery and baseline work.

**Do not perform major architectural implementation changes in this sprint.**

---

# 1. INSPECT THE ENTIRE PAYOUT RAIL REPOSITORY

Inspect:

- source tree
- package configuration
- application entry points
- core domain
- state machine
- workers
- persistence
- adapters
- Stacks integration
- USDCx integration
- xReserve-related implementation
- Yellow Card integration
- webhooks
- polling
- retries
- reconciliation
- monitoring
- logging
- API routes
- configuration
- environment variables
- tests
- mocks
- fixtures
- documentation

Do not rely only on the README.

Trace the actual implementation.

---

# 2. TRACE THE COMPLETE PAYOUT LIFECYCLE

Determine exactly how the current implementation handles:

```text
Payout creation
      ↓
Preflight
      ↓
Stacks / USDCx settlement
      ↓
External settlement
      ↓
Local payout initiation
      ↓
Provider processing
      ↓
Webhook / polling
      ↓
Reconciliation
      ↓
Final settlement
```

Document what actually exists.

Do not describe intended behavior as implemented behavior.

---

# 3. CLASSIFY EVERY INTEGRATION

For each external integration, classify it as:

- REAL API implementation
- SANDBOX-CAPABLE
- MOCKED
- SIMULATED
- PLACEHOLDER
- INCORRECT/OUTDATED
- UNKNOWN

At minimum assess:

### Stacks

- transaction interaction
- transaction lookup
- USDCx interaction
- event handling
- withdrawal tracking

### External settlement

- xReserve assumptions
- attestation assumptions
- withdrawal status
- external USDC release

### Yellow Card

- payout initiation
- payout status
- recipient handling
- bank/channel handling
- fees
- FX
- webhooks
- HMAC/signature verification
- health/status

---

# 4. VERIFY THE SETTLEMENT MODEL

Pay particular attention to the current xReserve implementation.

Do not assume that the current application-side representation is correct.

Compare the implementation against the current canonical Stacks/USDCx withdrawal lifecycle.

Determine:

1. What happens on Stacks.
2. What event indicates a USDCx burn.
3. What external attestation/processing occurs.
4. What BOS should initiate.
5. What BOS should observe.
6. What BOS should query.
7. What BOS should verify.
8. What BOS should merely record as external evidence.
9. What BOS cannot independently prove.

If the current architecture incorrectly models an external settlement process as an application-controlled operation, record it as a correction requirement.

Do not preserve an incorrect model merely because it already exists.

---

# 5. VERIFY YELLOW CARD ASSUMPTIONS

Compare the current adapter against the current provider API documentation available to the development environment.

Determine:

- endpoint correctness
- request structure
- authentication
- HMAC/signature handling
- payout creation
- payout status
- recipient resolution
- bank/channel support
- webhook behavior
- idempotency
- error handling
- sandbox availability
- production requirements

Do not claim live provider capability without evidence.

---

# 6. RUN THE EXISTING TEST SUITE

Run all currently available tests.

Record:

- total tests
- passing tests
- failing tests
- skipped tests
- errors
- warnings
- test categories
- known environmental issues

Do not fix every failure yet.

The purpose of this sprint is to establish the baseline.

If tests cannot run, record exactly why.

---

# 7. IDENTIFY CURRENT ARCHITECTURE

Create a concise architecture map covering:

```text
API / Application Layer
        ↓
Payout Domain
        ↓
State Machine
        ↓
Workers / Jobs
        ↓
Settlement Adapter
        ↓
Provider Adapter
        ↓
Persistence
        ↓
Evidence / Reconciliation / Monitoring
```

Correct the diagram to match the actual repository.

---

# 8. CREATE PRODUCT BASELINE

Create:

```text
docs/PRODUCT_BASELINE.md
```

Include:

- what Payout Rail currently is
- what it currently does
- what it partially does
- what is mocked
- what is simulated
- what is incomplete
- what is externally dependent
- what is not implemented
- current architecture
- current test status
- current integration status
- known limitations

Use evidence-based language.

---

# 9. CREATE CLAIMS REGISTER

Create:

```text
docs/CLAIMS_REGISTER.md
```

For every significant product/technical claim, classify it:

| Claim               | Evidence                 | Status           |
| ------------------- | ------------------------ | ---------------- |
| Implemented         | Code exists              | IMPLEMENTED      |
| Tested              | Automated test evidence  | TESTED           |
| Externally verified | External system evidence | VERIFIED         |
| Sandbox verified    | Sandbox evidence         | SANDBOX VERIFIED |
| Mocked              | Mock/test only           | MOCKED           |
| Planned             | Not implemented          | PLANNED          |
| Unknown             | Cannot establish         | UNKNOWN          |

Never upgrade a claim merely because the architecture appears plausible.

---

# 10. IDENTIFY REBUILD PRIORITIES

Create a gap register covering:

### P0

Issues that make the current system technically unsafe or fundamentally incorrect.

### P1

Issues blocking the core product objective.

### P2

Important improvements that do not block the pilot.

### P3

Future enhancements.

At minimum assess:

- state machine
- idempotency
- retries
- persistence
- settlement lifecycle
- Stacks integration
- USDCx lifecycle
- external settlement tracking
- Yellow Card adapter
- webhook handling
- reconciliation
- evidence
- API
- testing
- documentation
- security

---

# 11. DO NOT BUILD THE NEXT SPRINT YET

Do not begin:

- major state-machine redesign
- xReserve redesign
- Yellow Card rebuild
- public API redesign
- frontend development
- multi-country support
- Bitcoin DLCs
- Lightning
- oracle infrastructure
- BTC/USD oracle
- custody
- exchange functionality
- CineX reintegration

Those belong to later stages or are outside scope.

---

# 12. HARD GATE

Sprint 0 is complete only when:

- the repository has been fully inspected
- the existing lifecycle is documented
- external integrations are classified
- current tests have been run or their inability to run documented
- xReserve/USDCx assumptions have been assessed
- Yellow Card assumptions have been assessed
- `PRODUCT_BASELINE.md` exists
- `CLAIMS_REGISTER.md` exists
- the P0–P3 gap register exists

Then STOP.

Return:

1. Executive technical summary
2. Current architecture
3. Payout lifecycle
4. Integration maturity matrix
5. Test baseline
6. Claims register summary
7. P0/P1/P2/P3 gaps
8. Recommended Sprint 1 scope
9. Blockers requiring human decisions

Do not silently proceed into Sprint 1.
