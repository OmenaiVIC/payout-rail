# 09 — SPRINT 7: OPEN-SOURCE RELEASE CANDIDATE

> Task: make the repository presentable as independent reusable infrastructure rather than an internal extracted subsystem.
> Mode: plan-first, implementation-with-tests, no external network calls.
> Outputs: README, ARCHITECTURE.md, INTEGRATION.md, PROVIDER_ADAPTERS.md, SECURITY.md, DEVELOPMENT.md, maturity statement, claims/evidence table, removal of obsolete documentation.

---

## Why This Sprint Exists

Sprints 0.5 through 6 built the system, corrected the model, hardened the orchestration, produced the evidence chain, exposed the public API, and demonstrated the Nigeria corridor end-to-end.

What is missing is **the presentation**. Today the repository reads as an internal extraction. A stranger opening it will not understand:

- What problem it solves
- Who it is for
- How to integrate it
- What is real versus what is unverified
- Why it matters now

This sprint produces the documentation that makes the repository legible to an external developer, a grant reviewer, and a prospective integrator.

This sprint produces **documentation only**. It does not change code, API, or tests.

---

## Strategic Sources

The framing for this sprint comes from three strategy documents:

- `docs/grant/strategy/PROJECT_CONCEPT.md` — problem statement, customer segments, blue ocean positioning, "Nigeria is the first corridor, not the product"
- `docs/grant/strategy/THEORY_OF_CHANGE.md` — the causal chain, two-milestone grant structure, means of verification
- `docs/grant/strategy/PESTLE.md` — the "Why Now", the competitive landscape, the HermeticBridge complementarity

The README's opening framing must reflect these documents. Do not invent a different positioning.

---

## The Positioning to Encode

**The last-mile payout layer for Stacks.**

The product is emerging-market payout infrastructure. Nigeria is the first validated corridor, not the product definition.

**The customer is not the end user.** The customer is the Stacks application that needs to pay people: marketplaces, DAOs, creator platforms, grant platforms, gaming ecosystems, freelance platforms, payroll systems, remittance products, agent-payment systems.

**The differentiation is complementary, not competitive.** The Stacks ecosystem already has payment primitives. This layer connects them to local payout rails:

- HermesBridge brings USDC liquidity _into_ Stacks. This layer moves value _out_ to local payout rails.
- Stackstream streams on-chain payments. This layer converts a settled payout into a local delivery.
- sBTC Escrow holds value conditionally on-chain. This layer dispatches the released value to a real destination.
- AgentPay and others initiate payments. This layer records the lifecycle with audit-grade evidence.

---

## Scope (In)

Produce or update the following documents:

### 1. `README.md`

- Open with the one-sentence problem statement (from the project concept)
- Explain what the layer is, who it is for, and what problem it solves
- State the blue ocean positioning clearly
- Name the customer segments
- State explicitly: "Nigeria is the first validated corridor, not the product"
- State explicitly: "This is complementary to, not competitive with, other Stacks payment infrastructure"
- Include a quick-start section that points at the demo command
- Include an honest maturity statement (see §5 below)
- Include a claims table (see §6 below)
- Link to all other docs

### 2. `docs/ARCHITECTURE.md`

- The system architecture in prose and diagrams
- The state machine (14 states, transitions)
- The evidence chain
- The reconciliation layer
- The adapter boundary
- The public API surface
- What is and is not in the system

### 3. `docs/INTEGRATION.md`

- How another Stacks application integrates the layer
- The v1 API surface with request/response/error schemas
- Authentication boundary
- Idempotency contract
- A worked integration walkthrough

### 4. `docs/PROVIDER_ADAPTERS.md`

- What the adapter interface is
- The three current adapters (Stacks, xReserve, Yellow Card)
- What is UNVERIFIED and why
- How a new adapter is added
- How a new corridor is configured

### 5. `docs/SECURITY.md`

- What the layer does and does not custody
- The authentication model
- Fail-closed behavior
- The evidence chain as a security property
- What is not claimed (no compliance, no production security certification)
- Known limitations

### 6. `docs/DEVELOPMENT.md`

- How to run the tests
- How to run the demo
- How to contribute
- What is in scope and out of scope for contributions
- The sprint discipline used in this repository

### 7. Maturity statement

A single clear statement in the README and reiterated in SECURITY.md. Choose exactly one of:

- Prototype
- Testnet
- Sandbox
- Production

Only select the truthful status. Based on the current state, the correct answer is **Prototype with sandbox-ready interfaces**. Do not overclaim.

### 8. Claims/evidence table

A single table in the README (or linked from it) that lists every significant claim about the product and classifies each:

- IMPLEMENTED (code exists)
- TESTED (automated test evidence)
- VERIFIED (external system evidence)
- SANDBOX VERIFIED (sandbox evidence)
- MOCKED (mock/test only)
- PLANNED (not implemented)
- UNVERIFIED (cannot establish)

Pull the current classifications from `docs/CLAIMS_REGISTER.md` and consolidate them for external readers.

### 9. Remove obsolete documentation

Any documentation that contradicts the current implementation must be either updated or removed. Do not leave contradictory statements in the repo.

Specifically check:

- `README.md` (if it still describes the extraction)
- Any leftover extraction-phase docs that no longer reflect reality
- Any sprint reports that describe states the code has since moved past (leave reports as historical record, but do not let the README reference them as current)

## Scope (Out)

- Any code change
- Any API change
- Any test change
- Sprint 7.5 (external integrator example)
- Sprint 8 (grant package)
- Any new feature
- Any adapter change

---

## Constraints

- Do not modify CineX.
- No external network calls.
- No new runtime npm dependencies.
- No code changes: this sprint is documentation only.
- Evidence over claims: do not claim implemented, tested, verified, sandbox-verified, or production-ready status without supporting evidence.
- No marketing language. Plain, honest, defensible.
- One commit per logical document or group of documents.

---

## Acceptance Criteria

1. `README.md` opens with the problem statement from `PROJECT_CONCEPT.md` and carries the last-mile framing.
2. The README names the customer segments explicitly.
3. The README states "Nigeria is the first validated corridor, not the product."
4. The README states the complementary relationship with HermesBridge and other Stacks ecosystem projects.
5. `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/PROVIDER_ADAPTERS.md`, `docs/SECURITY.md`, `docs/DEVELOPMENT.md` all exist and are complete.
6. The maturity statement is present in both the README and SECURITY.md, and it is truthful.
7. A claims/evidence table appears in the README.
8. Any documentation that contradicts the current implementation is either updated or removed.
9. `npm test` still passes (184/183/0/1).
10. No code was modified.
11. No new runtime npm dependencies.
12. No external network calls.

---

## Working Method (per Master Prompt §WORKING METHOD)

1. **Inspect** — read the current `README.md`, existing docs, `docs/CLAIMS_REGISTER.md`, the strategy documents, and the sprint reports.
2. **Baseline** — run `npm test`; confirm Sprint 6 state (184/183/0/1).
3. **Plan** — produce `docs/SPRINT_7_PLAN.md` with:
   - The exact structure of each document
   - Which existing docs are updated versus newly created
   - Which docs are removed or archived
   - The maturity statement text
   - The claims/evidence table content
   - Any deviations from the plan, with reason
   - **Wait for review before implementing.**

4. **Implement** — one commit per logical document or group.
5. **Test** — full suite must still pass; no test changes expected.
6. **Evidence** — capture the final README as rendered, plus the document set.
7. **Document** — add `docs/SPRINT_7_REPORT.md`.

---

## Deliverables

- `docs/SPRINT_7_PLAN.md` — plan (reviewed before implementation)
- Updated `README.md`
- New: `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/PROVIDER_ADAPTERS.md`, `docs/SECURITY.md`, `docs/DEVELOPMENT.md`
- Maturity statement in README and SECURITY.md
- Claims/evidence table in README
- Removed or updated obsolete documentation
- `docs/SPRINT_7_REPORT.md`
- No code changes
- No new runtime npm dependencies
- No external network calls

---

## Blockers to Report (Do Not Silently Resolve)

If any of the following are true during implementation, STOP and report:

- A documented capability cannot be described without over-claiming
- The current implementation contradicts what the strategy documents say
- A document cannot be completed without code changes
- The claims/evidence table cannot be consolidated from `CLAIMS_REGISTER.md`
- The maturity statement cannot be stated truthfully without qualification

Report blockers with: what was found, what was expected, options, and recommended option.

---

## Gate

Do NOT proceed to Sprint 7.5 or Sprint 8 until:

1. README reflects the strategy framing
2. All six documents exist and are complete
3. Maturity statement is truthful
4. Claims/evidence table is present
5. Obsolete documentation is removed or updated
6. `npm test` still passes
7. No code was modified
8. No new runtime npm dependencies were added
9. No external network calls were made
10. `SPRINT_7_REPORT.md` exists with evidence

Stop after Step 3 (Plan). Produce `SPRINT_7_PLAN.md` and wait for review.
