\# Submission Text — Payout Rail



> \*\*Historical record.\*\* This is the text submitted to the Stacks Endowment Getting Started application in October 2026. It is preserved for transparency and as a starting point for future applications. It is not product documentation. For current product description, see \[`README.md`](../../../README.md) and \[`PROJECT\_CONCEPT.md`](../strategy/PROJECT\_CONCEPT.md).



> Application document. Contains the exact text for each field of the Stacks Endowment Getting Started application.



\---



\## PROJECT BASICS



\### Project name



Payout Rail



\### Website or repo



https://github.com/OmenaiVIC/payout-rail



\### Primary category



Payments



\### Secondary category



(No applicable secondary option for Payments. Leave blank.)



\---



\## PROJECT DESCRIPTION



Payout Rail is an open-source orchestration layer that connects Stacks applications' on-chain settlement to reliable local fiat payouts in emerging markets. Stacks applications can settle programmable dollar-denominated value on-chain, but developers serving users in emerging markets still face a fragmented last-mile problem: there is no reusable orchestration layer that turns on-chain settlement into reliable local fiat payouts. Every team that needs to pay a user in local currency rebuilds the same retries, state tracking, evidence trail, and reconciliation logic from scratch.



What exists today: a working prototype with a 15-state orchestration machine, an audit-grade evidence chain, a reconciliation layer, a versioned v1 public API, 189 passing automated tests, and a reproducible offline demo that runs a full USDCx-to-NGN payout end to end. The repository is public and documented.



What the grant funds: the transition from working prototype to validated, reusable infrastructure. Three milestones: (1) canonical Stacks/USDCx integration verified against testnet, (2) Nigeria/NGN corridor validated against a provider sandbox, and (3) a public SDK, an external integrator example, and a published release candidate.



What reviewers should understand first: Payout Rail is not a bridge, exchange, custodian, or fiat payment processor. It is the orchestration layer that connects Stacks settlement to local payout rails. Nigeria is the first validated corridor, not the product definition. The architecture is corridor-agnostic by design.



\---



\## AUDIENCE AND ECOSYSTEM FIT



\### Primary audience



The customer is the Stacks application that needs to pay people — not the end user. The end user is the recipient: someone in Nigeria who earned on-chain value and wants local currency delivered to their bank account.



\### Audience segmentation



\- Marketplaces settling seller earnings

\- DAOs and contributor platforms distributing rewards

\- Creator platforms paying out to creators

\- Grant platforms disbursing to grantees

\- Gaming ecosystems paying out to players

\- Freelance and work platforms paying contractors

\- Payroll and reward systems

\- Remittance and agent-payment products

\- Fintech and crypto applications in emerging economies integrating Stacks



\### Why Stacks?



Three reasons. First, Stacks now settles programmable dollar-denominated value — USDCx makes dollar settlement on Stacks real. Second, the Stacks ecosystem is actively funding payment primitives: escrow, streaming, savings, agent payments. The primitive layer exists. Third, the last mile is missing. The layer that converts settled value into local fiat is not funded, not built, and not reusable.



Payout Rail completes what the ecosystem has started. It is complementary to HermesBridge (which brings liquidity into Stacks), Stackstream (which streams payments on-chain), sBTC Escrow (which holds value conditionally), and agent-payment projects (which initiate payments). Each needs a payout layer; none has built one.



\### Maintenance plan



Payout Rail is maintained by a small team with defined roles and a succession path. Victor Omenai is the lead maintainer and architect. McDaniells Albert, a co-developer on the CineX project until the previous grant cycle concluded, is co-maintainer, available part-time during the grant and potentially full-time afterwards. Jacob Momoh, a senior engineer with production experience, is senior advisor and fallback maintainer for architectural review, security review, and continuity.



The project is designed to survive any single contributor's absence: each milestone names who delivers it and who reviews it, and no milestone depends on one person's continuous availability. After the grant, the project is small enough to maintain at low cost indefinitely, or to continue via a Builder Track grant or ecosystem partnership if traction warrants.



\### Ecosystem fit



This application is timely because the Stacks ecosystem is currently funding payment and escrow primitives — sBTC Escrow, Stackstream, Nayori, AgentPay, and others — but not the last-mile layer that connects them to local payout rails. Payout Rail is complementary to those projects, not competitive. It fills a gap they collectively leave open: how value actually reaches a real person's bank account in a local currency. It aligns with the ecosystem's current direction toward real-world Bitcoin utility.



\---



\## RISK AND PRIOR HISTORY



\### Referral source



Stacks community member; heard about this cycle through the Stacks Endowment's X account and email newsletter.



\### Risk disclosure



The two highest-scoring risks are provider credentials and the canonical Stacks burn entrypoint.



Provider credentials: Yellow Card sandbox access requires KYB and account approval. If credentials are not granted by the Milestone 2 date, sandbox verification cannot be completed. Mitigation: apply in Week 1, escalate at Week 4 if needed, and fall back to a mock-verified milestone with the honest label "sandbox verification pending credentials."



Stacks burn entrypoint: the current adapter targets the `usdcx` token contract; the canonical path may be through the `usdcx-v1` protocol entrypoint. Mitigation: this is explicitly addressed in Milestone 1 with testnet verification.



Secondary risks include team member availability (mitigated by the documented succession path), sandbox provider design changes (localized to the adapter layer), and external integration difficulty (addressed by Milestone 3 developer testing). The project is deliberately designed not to hold funds, not to custodian keys, and not to make regulatory or compliance claims; those choices bound legal exposure. Full risk register in `docs/grant/application/RISK\_REGISTER.md`.



\### Prior grants



$5,000 from the Stacks Endowment's Community DeGrants program, Cohort 3, 2026. This grant funded CineX, a separate open-source project for milestone-based financing of Africa's creative economy.



CineX's own README describes it accurately as a "prototype / reference implementation." It has 322 contract tests, 235 backend tests, and 41 frontend tests; 32 Clarity contracts deployed to Stacks testnet; and a working backend orchestration service (the Bridge Orchestration Service, or BOS) that handles milestone-based disbursement state transitions. It is not on mainnet, has no claimed live adoption, and is not independently audited.



What the grant funded was real: the contracts, the tests, the BOS, and the reference implementation. What it did not fund was a production system or measurable adoption. That distinction is important, and CineX's README makes it explicitly.



\*\*Important clarification:\*\* This application is not a continuation of CineX. Payout Rail was built to serve CineX out of necessity — CineX needed a way to orchestrate milestone-based payouts from on-chain settlement to local payout rails. In building it, we discovered the orchestration layer is not specific to creative financing. It is general-purpose infrastructure that any Stacks application with payout needs can use. Payout Rail is a separate product with a separate roadmap and a separate audience.



\### Prior Stacks work



CineX — an open-source prototype for milestone-based creative financing on Stacks. Repository: https://github.com/OmenaiVIC/CineX. The Payout Rail orchestration layer was developed during this work as a backend service for CineX, and later extracted into its own independent repository.



Community engagement: CineX is in ongoing community engagement with the Plateau Creative Industries Co-operative Society (PCICS) in Jos, Nigeria. This relationship is in an early formation stage. An MOU exists. It is not a funded deployment and does not constitute adoption or traction.



Program affiliation: Victor Omenai was an inaugural cohort member of the Stacks Foundry Validate Program (May–June 2026), a completed cohort participation. This does not imply ongoing backing, endorsement, or funding.



\---



\## TRACK-SPECIFIC CONTEXT



\### Getting Started



\*\*What are you proposing to explore or build?\*\*



An open-source orchestration layer that connects Stacks applications' on-chain settlement to reliable local fiat payouts. The grant funds three milestones: canonical Stacks/USDCx integration verified against testnet; Nigeria/NGN corridor validated against a provider sandbox; and a public SDK, integration guide, and external integrator example published as a release candidate.



\*\*What user or ecosystem problem motivates the project?\*\*



Stacks applications can settle programmable dollar-denominated value on-chain, but developers serving emerging-market users cannot easily get that value into local fiat. Every team rebuilds the same retries, state tracking, evidence trail, and reconciliation from scratch. There is no reusable orchestration layer. The grant funds that layer.



\*\*Why is Stacks the right environment for this work?\*\*



Stacks now settles programmable dollars via USDCx; the ecosystem is funding payment primitives; the last mile — where value becomes local currency for a real person — is the layer still missing. The work is Stacks-native because it depends on Stacks settlement as the source of value, and because it complements the ecosystem's existing payment projects rather than duplicating them.



\*\*What have you already validated, prototyped, or learned?\*\*



Built and tested: a 15-state orchestration machine with 48 transitions, an audit-grade evidence chain, a reconciliation layer with five detection modes, a versioned v1 public API with fail-closed auth and deterministic idempotency, 189 passing automated tests, and a reproducible offline demo that runs a full USDCx-to-NGN payout end to end with an empty receipt gaps array.



Learned: the operational complexity of payouts is real and reusable; the canonical Stacks/USDCx withdrawal model is observable but not executable by the application; the Yellow Card Sends API requires `YcHmacV1` authentication, not the legacy scheme; deterministic idempotency and optimistic concurrency are non-negotiable in financial systems; the evidence chain is a security property, not a feature.



Not yet validated: no adapter has been verified against a live or sandbox provider (no credentials in this environment); no external Stacks application has integrated the layer; the mainnet path requires KYB and production credentials that are out of scope for this grant.



\*\*Who will do the work and what experience do they bring?\*\*



Victor Omenai (lead maintainer): principal engineer, architect of the layer, led the extraction and delivered all development sprints to date. McDaniells Albert (co-maintainer): co-developer on the CineX project, focused on adapter work and integration testing. Jacob Momoh (senior advisor and fallback maintainer): senior engineer with production experience, provides architectural and security review, and continuity if other team members are unavailable.



\*\*What is the smallest useful outcome this grant should produce?\*\*



A validated Nigeria/NGN corridor with a public SDK and a working external integrator example, all open-source, documented, and reusable by any Stacks application.



\*\*What evidence will show the concept is worth continuing?\*\*



Four kinds: sandbox test output showing a real payout through a real provider; an external integrator example that another developer can follow and reproduce; at least one external Stacks application expressing interest or beginning integration; and a complete release candidate with documentation, tests, and a reproducible demo. Each is verifiable by anyone from the public repository.



\*\*What dependencies or risks could affect delivery?\*\*



Dependencies: Yellow Card sandbox credentials, Stacks testnet access, and team availability. Risks: provider credential timing (Medium/High), Stacks burn entrypoint mismatch (High/Medium), sandbox design changes (Medium/Medium), and external integration difficulty (Medium/Medium). Full risk register in the repository.



\*\*What support from the Stacks ecosystem would help?\*\*



Three things, none of them blockers: an introduction to Yellow Card's sandbox process if the Endowment has a relationship; an introduction to one or two Stacks applications with real payout needs, for external piloting; and ecosystem visibility, since adoption of infrastructure depends on discovery.



\*\*How will you share progress or learnings publicly?\*\*



Sprint reports published to the repository after each milestone; public commit history showing incremental progress; a public demo any reviewer can run; a public test suite; milestone reports submitted to the Endowment program manager; and open development on GitHub from day one. No private progress. No claims without evidence.



\*\*What happens after the grant if the work succeeds?\*\*



Three paths, in order of preference. Follow-on Builder Track grant for production hardening and multi-corridor expansion. Ecosystem partnership if a Stacks participant adopts the layer and co-funds maintenance. Or distributed self-funding — the project is small enough to maintain indefinitely by a three-person team with no hosted services and no paid dependencies.



\*\*Any other context reviewers should consider?\*\*



The project is deliberately honest about what is unverified. The README contains a claims register with explicit UNVERIFIED markers and a maturity statement: "Prototype — sandbox-ready interfaces." The theory of change includes falsification conditions. The architecture is corridor-agnostic: Nigeria is the first validated corridor, not the product definition. The evidence chain is not a marketing feature; it is a security property that any integrator inherits.



\---



\## MILESTONES



\### Milestone 1



\*\*Name:\*\* Canonical Stacks payout integration



\*\*Target date:\*\* 11/14/2026



\*\*Description:\*\*

\- Reconcile the orchestration core with the canonical USDCx withdrawal architecture

\- Correct the burn entrypoint model against current Stacks documentation

\- Produce testnet evidence of burn tracking

\- Document the integration boundary



\*\*Success criteria:\*\*

\- A burn is broadcast to Stacks testnet through the corrected entrypoint and confirmed on-chain

\- Testnet transaction evidence is captured in the evidence chain and retrievable

\- The integration boundary is documented in `docs/PROVIDER\_ADAPTERS.md`



\*\*Payment percent:\*\* 20



\*\*Amount, USD:\*\* $2,000



\---



\### Milestone 2



\*\*Name:\*\* Nigeria local payout integration



\*\*Target date:\*\* 12/12/2026



\*\*Description:\*\*

\- Complete the Yellow Card sandbox integration

\- Validate the NGN payout workflow end to end

\- Produce webhook verification evidence

\- Demonstrate reconciliation and failure handling

\- Produce end-to-end sandbox test evidence

\- Produce a reproducible end-to-end payout with a complete evidence trail



\*\*Success criteria:\*\*

\- A payout completes end to end in Yellow Card sandbox, from create to settled

\- Webhook signature verification is demonstrated with a sandbox-signed payload

\- A settlement receipt with zero gaps is generated from the sandbox run

\- At least one failure path (e.g., provider rejection or timeout) is demonstrated and routed to manual review



\*\*Payment percent:\*\* 30



\*\*Amount, USD:\*\* $3,000



\---



\### Milestone 3



\*\*Name:\*\* External integration and public release



\*\*Target date:\*\* 01/09/2027



\*\*Description:\*\*

\- Publish a public SDK or integration package

\- Produce an integration guide

\- Ship an external integrator example

\- Conduct external developer testing

\- Produce at least one external pilot if feasible

\- Publish a complete release candidate with security posture, architecture docs, and maturity statement



\*\*Success criteria:\*\*

\- The SDK and integration guide are published

\- The external integrator example is runnable by a stranger in under ten minutes

\- At least one external developer has tested the integration and provided written feedback

\- The release candidate is tagged and documented



\*\*Payment percent:\*\* 50



\*\*Amount, USD:\*\* $5,000



\*\*Final adoption metric:\*\*



At least one external Stacks application has integrated Payout Rail in a sandbox or testnet pilot, evidenced by a public repository, a signed integration confirmation, or a demo run provided by the integrating team. If no external adoption occurs by the end of the grant period, the outcome is reported honestly in the final milestone report, and the theory of change is noted as partially falsified.



\---



\## SUMMARY



This application requests $10,000 from the Stacks Endowment's Getting Started track to fund the transition of Payout Rail from working prototype to validated, reusable payout infrastructure. The project has already produced a hardened orchestration layer with 189 passing tests, a reproducible demo, and complete public documentation. The grant funds the validation steps that require external infrastructure (testnet and provider sandbox) and the external integration work that proves the layer is adoptable.



The project is complementary to the Stacks ecosystem's existing payment projects, honest about what is verified versus unverified, and designed to survive beyond the grant period.

