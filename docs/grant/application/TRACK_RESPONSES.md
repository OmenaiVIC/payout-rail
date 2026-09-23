\# Getting Started Track Responses — Payout Rail



> Application document. Answers the eleven track-specific questions from the Stacks Endowment Getting Started application.

> Not a sprint deliverable. Part of the grant application package.



\## Track selection



\*\*Primary category:\*\* Payments

\*\*Secondary category:\*\* None Applicable



\*\*Track:\*\* Getting Started



Rationale: Payout Rail is pre-product-market-fit infrastructure with a working prototype, a technical architecture, and a reproducible demo. It does not yet have production deployments or measurable adoption volume. The Getting Started track is designed for exactly this stage.





\---



\## The eleven track questions



\### 1. What are you proposing to explore or build?



Payout Rail is an open-source orchestration layer that connects Stacks applications' on-chain settlement to reliable local fiat payouts in emerging markets. The grant funds the transition from a \*\*working prototype\*\* to a \*\*validated, reusable integration layer\*\*, through:



\- Milestone 1: canonical Stacks/USDCx integration verified against testnet

\- Milestone 2: Nigeria/NGN corridor validated against Yellow Card sandbox

\- Milestone 3: public SDK, integration guide, and external integrator example published



The grant does not fund production deployment or mainnet launch. It funds the validation work that makes production possible in a later phase.



\### 2. What user or ecosystem problem motivates the project?



Stacks applications can settle programmable, dollar-denominated value on-chain. But application developers serving users in emerging markets still face a fragmented last-mile problem: there is no reusable orchestration layer that turns on-chain settlement into reliable local fiat payouts.



Every team that needs to pay a user in local currency rebuilds the same retries, state tracking, evidence trail, and reconciliation logic from scratch. The layer replaces that per-application engineering with a documented integration surface and an audit-grade evidence chain.



\### 3. Why is Stacks the right environment for this work?



Three reasons:



1\. \*\*Stacks now settles programmable dollars.\*\* USDCx on Stacks makes dollar-denominated settlement real.

2\. \*\*The ecosystem is actively building payment primitives.\*\* Escrow, streaming, savings, and agent payments are being funded. The primitive layer exists.

3\. \*\*The last mile is missing.\*\* The layer that converts settled value into local fiat is not funded, not built, and not reusable.



Payout Rail completes what the ecosystem has already started. It is complementary to HermesBridge (liquidity in), Stackstream (streaming), sBTC Escrow (conditional release), and agent-payment projects (initiation). Each of those needs a payout layer; none of them has built one.



\### 4. What have you already validated, prototyped, or learned?



\*\*What exists today:\*\*



\- A working orchestration core with a 15-state machine and 48 transitions

\- A full evidence chain with settlement receipts reconstructed from stored evidence only

\- A reconciliation layer with five detection modes routing to manual review

\- A versioned v1 public API with fail-closed bearer authentication and deterministic idempotency

\- A reproducible demo: `npm run demo:payout:ngn` runs end-to-end offline and reaches `settled` with `gaps: \[]`

\- 189 automated tests, 0 failures

\- A complete documentation set: README, ARCHITECTURE, INTEGRATION, PROVIDER\_ADAPTERS, SECURITY, DEVELOPMENT



\*\*What has been learned:\*\*



\- The operational complexity of payouts is real and reusable

\- The canonical Stacks/USDCx withdrawal model is observable but not executable by the app

\- The Yellow Card Sends API requires `YcHmacV1` auth, not the legacy scheme

\- Deterministic idempotency and concurrency guards are non-negotiable in financial systems

\- The evidence chain is a security property, not a nice-to-have



\*\*What has not been validated:\*\*



\- No adapter has been verified against a live or sandbox provider (no credentials in this environment)

\- No external Stacks application has integrated the layer

\- The mainnet path requires KYB and production credentials that are out of scope for this grant



\### 5. Who will do the work and what experience do they bring?



\*\*Victor Omenai — Lead Maintainer\*\*

\- Principal engineer and architect of the layer

\- Led the extraction from CineX and delivered Sprints 0.5 through 7.5

\- Responsible for architectural decisions, sprint execution, release management, community engagement



\*\*McDaniells Albert — Co-Maintainer\*\*

\- Co-developer on the CineX project until the previous grant cycle concluded

\- Available part-time during the grant; may become full-time co-maintainer after current commitments conclude

\- Responsible for adapter work, integration testing, contribution review



\*\*Jacob Momoh — Senior Advisor and Fallback Maintainer\*\*

\- Senior engineer with production experience

\- Trusted technical reviewer and long-standing collaborator of the lead maintainer

\- Responsible for architectural review, security review, and continuity

\- Async-capable role



Full team structure and succession path: `docs/grant/application/MAINTENANCE\_PLAN.md`



\### 6. What is the smallest useful outcome this grant should produce?



A \*\*validated Nigeria/NGN corridor\*\* with a \*\*public SDK\*\* and a \*\*working external integrator example\*\*, all open-source and reusable by any Stacks application.



Concretely: a developer from another Stacks application can clone the repo, read the README, run the demo, read the integration guide, and integrate the layer into their own application — and the layer will deliver a real payout through a sandbox provider (once credentials exist).



If we produce only that, the grant succeeds.



\### 7. What evidence will show the concept is worth continuing?



Four kinds of evidence:



1\. \*\*Technical evidence:\*\* Sandbox test output showing a real payout through a real provider

2\. \*\*Reusability evidence:\*\* An external integrator example that another developer can follow and reproduce

3\. \*\*Adoption evidence:\*\* At least one external Stacks application expresses interest in or begins integration

4\. \*\*Public proof of work:\*\* A complete release candidate with documentation, tests, and a reproducible demo



The evidence is verifiable by anyone. No claim depends on our say-so.



\### 8. What dependencies or risks could affect delivery?



\*\*Dependencies:\*\*

\- Yellow Card sandbox credentials (KYB + account approval)

\- Stacks testnet access (public, no credentials needed)

\- Team availability across a distributed group



\*\*Risks:\*\*

\- Provider credentials may not arrive on schedule (D-1, Medium/High)

\- Stacks burn entrypoint may differ from the current model (T-1, High/Medium)

\- Sandbox may require design changes not anticipated (D-3, Medium/Medium)

\- External integration may prove harder than expected (T-3, Medium/Medium)



Full risk register: `docs/grant/application/RISK\_REGISTER.md`



\### 9. What support from the Stacks ecosystem would help?



Three things:



1\. \*\*Introduction to Yellow Card's sandbox process.\*\* If the Stacks Endowment has a relationship with Yellow Card, an introduction would accelerate the credentialing step.

2\. \*\*Introduction to one or two Stacks applications with real payout needs.\*\* An external pilot is Milestone 3's strongest success signal.

3\. \*\*Visibility in ecosystem communications.\*\* The layer is infrastructure; ecosystem visibility is the primary adoption channel.



None of these are blockers. All would accelerate delivery.



\### 10. How will you share progress or learnings publicly?



\- \*\*Sprint reports\*\* published to the repository after each milestone

\- \*\*Public commit history\*\* showing incremental progress

\- \*\*Public demo\*\* any reviewer can run: `npm run demo:payout:ngn`

\- \*\*Public test suite\*\* showing 189 tests passing

\- \*\*Milestone reports\*\* submitted to the Endowment program manager

\- \*\*Open development\*\* — all work is on GitHub from day one



No private progress. No claims without evidence.



\### 11. What happens after the grant if the work succeeds?



Three paths:



1\. \*\*Follow-on grant application.\*\* If the project demonstrates traction, a Builder Track grant would fund production hardening, mainnet readiness, and multi-corridor expansion.



2\. \*\*Ecosystem partnership.\*\* If a Stacks ecosystem participant (a wallet, a marketplace, a payments project) adopts the layer, maintenance could be co-funded through partnership or integration agreements.



3\. \*\*Standalone continuation.\*\* The project is small enough to maintain indefinitely. A three-person team, no hosted services, no paid dependencies.



The grant funds validation. Production is the next phase. The project is designed so that each phase is viable on its own.



\### Any other context reviewers should consider



\- The project is deliberately honest about what is unverified. The README contains a claims register with explicit `UNVERIFIED` markers and a maturity statement: "Prototype — sandbox-ready interfaces."

\- The theory of change includes falsification conditions — statements that, if true, would mean the theory is wrong. Reviewers can hold us to them.

\- The architecture is corridor-agnostic. Nigeria is the first validated corridor, not the product definition.

\- The evidence chain is not a marketing feature. It is a security property that any integrator inherits.

