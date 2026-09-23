\# Theory of Change — Payout Rail

> Status: Strategy document. Not a sprint deliverable.

\## The causal chain

\### If we build an open-source orchestration layer that connects Stacks settlement to local fiat payout rails,

then Stacks applications that need to pay users in emerging markets will have a reusable, tested, auditable way to deliver local currency without rebuilding the operational complexity from scratch,

because the layer replaces months of per-application engineering with a documented integration surface and an evidence trail,

which means more Stacks applications will offer real payouts to real users in local currencies,

which grows the ecosystem of users for whom Stacks applications solve a complete problem — not just an on-chain problem, but the whole problem of receiving value in the form they actually need,

which strengthens the case that Stacks is not just a settlement layer but an application platform for global value movement.

\## The chain, structured

| Level | Statement |

|---|---|

| \*\*Activity\*\* | Build, test, document, and open-source a payout orchestration layer with a validated Nigeria/NGN corridor |

| \*\*Output\*\* | A public API, an external integrator example, a reproducible demo, and a complete evidence trail |

| \*\*Outcome\*\* | Stacks applications can integrate the layer and pay users in local currencies without rebuilding payout infrastructure |

| \*\*Impact\*\* | Stacks becomes the settlement platform of choice for applications serving emerging-market users, because the last mile is solved |

\## What we assume to be true

The theory of change rests on five assumptions. Each must be stated honestly because the grant funds the validation of these assumptions, not the certainty of them.

1\. \*\*Stacks applications actually want to pay users in local fiat.\*\* If they only want on-chain settlement, the layer is unnecessary.

2\. \*\*Yellow Card or an equivalent provider can service the Nigeria/NGN corridor with acceptable economics.\*\* If not, the corridor cannot be validated.

3\. \*\*The operational complexity of payouts is a real barrier to adoption.\*\* If teams can solve it in days, the layer adds little.

4\. \*\*An open-source layer will be adopted rather than rebuilt.\*\* If every team prefers to build their own, the layer is a demonstration, not infrastructure.

5\. \*\*The Stacks ecosystem values this capability enough to support it.\*\* If the ecosystem sees it as peripheral, adoption will not follow.

\## What the grant funds

The grant funds the transition from \*\*built but unvalidated\*\* to \*\*validated and reusable\*\*.

Specifically, the grant funds **three milestones**, structured as **20% / 30% / 50%** tranches against a $10,000 request:

- Milestone 1: 20% = $2,000
- Milestone 2: 30% = $3,000
- Milestone 3: 50% = $5,000

### Milestone 1 — Canonical Stacks payout integration (20% — $2,000)

Deliverables:

- Reconcile the orchestration core with the canonical USDCx withdrawal architecture
- Correct the burn entrypoint model against current Stacks documentation
- Produce testnet evidence of burn tracking
- Document the integration boundary

### Milestone 2 — Nigeria local payout integration (30% — $3,000)

Deliverables:

- Complete the Yellow Card sandbox integration
- Validate the NGN payout workflow end-to-end
- Produce webhook verification evidence
- Demonstrate reconciliation and failure handling
- Produce end-to-end sandbox test evidence
- Produce a reproducible end-to-end payout with a complete evidence trail

### Milestone 3 — External integration and public release (50% — $5,000)

Deliverables:

- Publish a public SDK or integration package
- Produce an integration guide
- Ship an external integrator example
- Conduct external developer testing
- Produce at least one external pilot if feasible
- Publish a complete release candidate with security posture, architecture docs, and maturity statement

Mainnet readiness is explicitly \*\*not\*\* in the grant scope. It requires production credentials and KYB that are out of reach without additional funding or ecosystem partnership.

## Why three milestones

The Stacks Endowment Getting Started track specifies two milestone structures:

- Under $7,000: two milestones, 50% / 50%
- $7,000 or more: three milestones, 20% / 30% / 50%

This grant requests **$10,000**, which falls into the higher tier. The three-milestone structure aligns the payment schedule with demonstrated progress and matches the funder's published requirements for grants at this size.

The milestone boundaries also reflect the actual dependency structure of the work: canonical Stacks integration precedes Nigeria corridor validation; Nigeria corridor validation precedes external integration and public release.

\## What the grant does not fund

\- Mainnet deployment

\- Production KYB or regulatory process

\- Additional corridors beyond Nigeria (configurable, not validated)

\- Multi-country regulatory analysis

\- Commercial launch costs

\## How success is verified

| Claim | Means of verification |

|---|---|

| The orchestration core is correct | Public test suite (184 tests, 0 failures) |

| The Nigeria corridor is validated | Sandbox test evidence with provider reference |

| The layer is reusable | External integrator example + integration guide |

| The demo is reproducible | `npm run demo:payout:ngn` with captured output |

| The evidence trail is real | Settlement receipt generated from stored evidence |

| The system is honest about its limits | Claims register with explicit UNVERIFIED markers |

\## What would falsify the theory

If any of these are true at the end of the grant period, the theory is falsified and the honest response is to say so:

\- No external Stacks application expresses interest in integrating the layer

\- The Nigeria corridor cannot be validated in sandbox for reasons outside our control

\- The operational complexity is not, in practice, a barrier

\- The ecosystem prefers to build its own rather than adopt

Stating this in advance is what makes the theory falsifiable, and what makes the grant application honest.

\## The strategic framing

\*\*The last-mile payout layer for Stacks.\*\*

The ecosystem has funded the primitives: escrow, streaming, savings, agent payments. The last mile — where value becomes local currency for a real person — is the layer still missing. This grant funds that layer.
