\# Project Concept — Payout Rail



> Working title. Final name pending trademark clearance (see `docs/COMMERCIAL\_HYPOTHESIS.md` §10).

> Status: Strategy document. Not a sprint deliverable.



\## One sentence



Payout Rail is an open-source orchestration layer that connects Stacks applications' on-chain settlement to reliable local fiat payouts in emerging markets, validated first through the Nigeria/NGN corridor.



\## The problem



Stacks applications can settle programmable, dollar-denominated value on-chain. But application developers serving users in emerging markets still face a fragmented last-mile problem: there is no reusable orchestration layer that turns on-chain settlement into reliable local fiat payouts. Every team that needs to pay a user in local currency rebuilds the same retries, the same state tracking, the same evidence trail, and the same reconciliation logic — from scratch.



This is not a settlement problem. Stacks already settles. This is not a bridge problem. Value can already reach Stacks. This is the layer \*after\* both of those: the operational complexity of getting value to a real person in a real bank account, in a real local currency, in a market where crypto-native settlement is not the user's final destination.



\## The product



Payout Rail is that missing layer.



It sits between an originating Stacks application and a local payout provider. It holds the payout lifecycle — state management, transition guards, idempotency, retries, provider adapters, webhook verification, reconciliation, evidence collection, auditability, and human approval controls. It does not replace the provider. It orchestrates the payout through the provider with the discipline a financial system requires.



\## The customer



The customer is not the end user. The customer is the Stacks application that needs to pay people.



Named segments:

\- Marketplaces settling seller earnings

\- DAOs and contributor platforms distributing rewards

\- Creator platforms paying out to creators

\- Grant platforms disbursing to grantees

\- Gaming ecosystems paying out to players

\- Freelance and work platforms paying contractors

\- Payroll and reward systems

\- Remittance and agent-payment products

\- Fintech and crypto applications in emerging economies integrating Stacks



The end user is the person receiving the value: someone in Nigeria who earned $50 worth of on-chain value and wants ₦ to arrive in their bank account.



\## Why this exists now



Three shifts have converged:



1\. \*\*Stacks has matured enough to settle dollar-denominated value\*\* — USDCx on Stacks makes programmable dollar settlement real.

2\. \*\*The Stacks ecosystem is actively building payment and escrow primitives\*\* — sBTC Escrow, Stackstream, Nayori, AgentPay, PaySats, and others. The primitive layer is being funded. The last-mile layer is not.

3\. \*\*Emerging-market demand for local fiat settlement is real\*\* — crypto-native settlement is not the end state for most users in these markets. It is the mechanism. The destination is local currency in a bank account.



The ecosystem has solved value \*entering\* Stacks (HermesBridge and others). It has not yet solved value \*leaving\* Stacks into local payout rails. That is the gap this project addresses.



\## The blue ocean positioning



\*\*The last-mile payout layer for Stacks.\*\*



Not a bridge. Not an exchange. Not a custodian. Not a fiat payment processor. Not a creative-financing application.



A programmable settlement-orchestration layer that helps Stacks applications move on-chain value through compliant local payout rails to users in markets where crypto-native settlement is not the user's final destination.



\## Nigeria is the first corridor, not the product



The product is emerging-market payout infrastructure. Nigeria is the first validated corridor because it is where the provider coverage, the FX path, and the demand all align today.



The long-term architecture is corridor-agnostic. Additional corridors — Kenya/KES, South Africa/ZAR, and others — are adapter additions, not product rewrites. The design supports them from day one.



\## What makes it different



The Stacks ecosystem already has payments primitives. Payout Rail is not a competitor to those. It is complementary:



\- \*\*HermesBridge\*\* brings USDC liquidity \*into\* Stacks. Payout Rail moves value \*out\* to local payout rails.

\- \*\*Stackstream\*\* streams on-chain payments. Payout Rail converts a settled payout into a local fiat delivery.

\- \*\*sBTC Escrow\*\* holds value conditionally on-chain. Payout Rail dispatches the released value to a real-world destination.

\- \*\*AgentPay and other agent-payment projects\*\* initiate payments. Payout Rail records the payout's lifecycle with audit-grade evidence.



The gap is not another payment primitive. The gap is the orchestration layer that connects them all to the local rails where real people receive real value.



\## What the project is funded to deliver



The grant funds the transition from \*\*validated prototype\*\* to \*\*verified, reusable payout integration layer\*\*:



\- Reconcile the orchestration core with the canonical Stacks/USDCx withdrawal architecture

\- Validate the Nigeria/NGN corridor through a sandbox provider integration

\- Publish a public SDK and an external integrator example

\- Demonstrate a reproducible end-to-end payout with a complete evidence trail

\- Produce the documentation, security posture, and integration guidance that lets another Stacks application adopt the layer without depending on the authors



\## What the project is not



\- Not a live production system (this grant funds validation, not launch)

\- Not a custodian of funds

\- Not a provider of fiat processing licenses

\- Not a claim of regulatory compliance

\- Not a multi-corridor production system (Nigeria first; others configured)

\- Not a CineX product (CineX is a separate protected source product; Payout Rail was extracted from it and exists independently)



\## How success is measured



Primary: \*\*a reusable, open-source orchestration layer that any Stacks application can integrate.\*\*



Secondary: \*\*at least one external Stacks application integrating the layer in a sandbox or testnet pilot.\*\*



The first is the deliverable. The second is the proof that the first matters.



\## Status



\- Core architecture: built and tested (10 sprints, 184 tests, 0 failures)

\- Evidence chain: built

\- Reconciliation: built

\- Public API: built

\- Example client: built

\- Reproducible demo: built

\- Nigeria provider adapter: corrected to documented model, sandbox verification pending credentials

\- External integrator example: to be delivered under this grant

\- Sandbox verification: to be delivered under this grant

