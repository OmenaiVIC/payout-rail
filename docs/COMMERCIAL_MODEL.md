# Commercial Model — Payout Rail

> Status: Strategy document. Formalizes `docs/COMMERCIAL\_HYPOTHESIS.md` into a commercial model using Blue Ocean analysis.

> Not a sprint deliverable. Not a revenue claim. No revenue exists today.

---

## 1. The Blue Ocean Frame

Payout Rail occupies an uncontested market space: **the last-mile orchestration layer for Stacks applications serving emerging markets.**

The Stacks ecosystem is actively funding payment primitives — liquidity bridges, escrow protocols, streaming payments, agent-payment systems. Each of those needs a payout layer to complete the flow. None has built one.

Fiat off-ramp providers — Yellow Card, Flutterwave, and others — are licensed, closed, single-vendor integrations. Every Stacks application that needs payouts rebuilds the same state machine, retries, evidence trail, and reconciliation from scratch.

Payout Rail is neither a primitive nor an off-ramp. It is the orchestration layer between them. That is the gap.

---

## 2. The Three Tiers of Noncustomers

**First-tier noncustomers: "Soon-to-be."**

Stacks applications that want to pay users in local currency but currently cannot, or do so with duct-tape solutions. They integrate providers directly, or they tell users to cash out themselves, or they simply do not offer local payouts. They are dissatisfied but have no alternative. They are waiting for Payout Rail.

**Second-tier noncustomers: "Refusing."**

Applications that have considered building on Stacks and rejected the idea because the last mile is too hard. They use other chains with existing off-ramp infrastructure, or they use centralized payment providers. They are not in the Stacks ecosystem because the payout layer does not exist.

**Third-tier noncustomers: "Unexplored."**

Emerging-market applications — marketplaces, payroll systems, remittance products — that do not know Stacks exists, or do not consider it relevant because it cannot pay their users locally. They are the largest latent demand pool. They are entirely unexplored.

---

## 3. The Six Paths

**Path 1 — Across alternative industries.** What do Stacks apps do instead of payouts on Stacks? They use centralized providers directly, or they build on other chains. The real alternative is not a competitor — it is \*abandoning Stacks for the last mile.\*

**Path 2 — Across strategic groups.** Direct provider integrations are the low-cost, high-effort option. Payout Rail is the open-source, high-auditability option. The strategic group that does not exist: provider-agnostic orchestration with audit-grade evidence.

**Path 3 — Across the chain of buyers.** The current focus in payments is the end user. Payout Rail's focus is the **Stacks application** — the buyer who actually pays. The end user never pays Payout Rail.

**Path 4 — Across complementary offerings.** What happens before a payout? Escrow release, milestone verification, treasury management. What happens after? Reconciliation, tax reporting, audit. Payout Rail already handles both ends via the evidence chain.

**Path 5 — Across functional-emotional orientation.** Payments infrastructure is functional: does it work? The emotional dimension is trust: can I prove it worked? Payout Rail's evidence chain is an emotional offering disguised as a technical one.

**Path 6 — Across time.** Regulatory and market trends in emerging markets favor transparent, auditable infrastructure. Payout Rail is built for that trend, not against it.

---

## 4. The ERRC Grid

| Eliminate | Raise |

|---|---|

| The need to rebuild payout orchestration per application | Audit-grade evidence as a first-class feature |

| Provider lock-in | Deterministic idempotency and concurrency safety |

| The "trust me" posture of closed processors | Reconciliation as a security property |

| Payouts as an afterthought | The orchestration layer as a recognized category |

| Reduce | Create |

|---|---|

| Time-to-first-payout for Stacks applications | Provider-agnostic adapter pattern |

| Integration complexity (configuration, not code) | Open-source, self-hostable infrastructure |

| Cost of audit and compliance preparation | Settlement receipts reconstructable from evidence |

| | Corridor abstraction (NGN first, KES/ZAR configurable) |

---

## 5. The Business Model Canvas

### Customer Segments

**Primary:** Stacks applications that need to pay people in local fiat — marketplaces, DAOs and contributor platforms, creator platforms, grant platforms, gaming ecosystems, freelance platforms, payroll systems, remittance products.

**Secondary:** The Stacks ecosystem itself — wallets, protocols, and infrastructure projects that want to offer payouts as a feature to their own users.

**Not a customer:** The end user. The recipient benefits but does not pay. The Stacks application is the buyer.

### Value Proposition

"Solve the last mile without rebuilding it."

A provider-agnostic orchestration layer that turns settled on-chain value into reliable local fiat payouts, with audit-grade evidence and deterministic idempotency built in.

### Channels

- **Awareness:** GitHub repository, Stacks Endowment grants, Zero Authority bounties, Let Africa Build's pipeline, X community
- **Evaluation:** README, runnable demo, integration guide, external integrator example
- **Purchase:** The v1 public API (Hosted Tier) or GitHub Clone (Open Source Tier)
- **Delivery:** Self-hosted via the repository, or managed by Payout Rail
- **After-sales:** GitHub Issues for community, dedicated Slack for paid tiers

### Customer Relationships

Self-service for the open-source tier. Dedicated onboarding and support for the Managed Hosted tier. Co-creation through the Milestone 3 external testing program.

### Revenue Streams (Hypothesis — Not Validated)

Because Payout Rail is open-source and self-hostable, we do not charge a transaction fee on the core orchestration logic. Instead, we monetize the operational burden and compliance risk through three tiers:

**Tier 1: Open Source (Free)**
- The developer clones the repo, runs it on their own infrastructure, and manages their own Postgres database and provider API keys.
- **Target:** Early-stage Stacks apps and tinkerers.

**Tier 2: Hosted Orchestration (SaaS — $199/month)**
- Payout Rail runs the infrastructure. The Stacks app just hits our API. We manage the uptime, the worker queues, the retry logic, and the database.
- **Target:** Growing Stacks apps that want to pay people without managing a DevOps stack.

**Tier 3: Audit & Evidence Add-on ($99/month)**
- The Stacks app gets access to a hosted dashboard that generates immutable, cryptographic PDF settlement receipts. This is for their accountants, auditors, and investors.
- **Target:** Any app moving more than $10k/month that needs to prove to their auditors exactly where the money went.

**No revenue exists today.** Sprint 9 formalizes and tests this revenue hypothesis.

### Key Resources

- **Intellectual:** The orchestration core, the evidence chain, the reconciliation layer, the adapter pattern, the settlement receipt generator
- **Human:** Victor Omenai (lead), McDaniells Albert (co-maintainer), Jacob Momoh (senior advisor)
- **Financial:** Zero infrastructure costs for the open-source tier. Hosted tier costs scale linearly with usage.

### Key Activities

- **Engineering:** Adapter maintenance, provider integration, evidence integrity, reconciliation correctness, release management
- **Community:** Sprint reports, external developer support, bounty coordination via Zero Authority
- **Partnership:** Provider relationships, ecosystem engagement, grant reporting

**Not activities:** Payout Rail does not hold funds, custody keys, process fiat, or act as a money transmitter.

### Key Partners

| Partner | Role |
|---|---|
| Yellow Card | First and primary payout provider for the NGN corridor. Licensed, regulated. The pipeline payout leg is hard-wired to Yellow Card (14 sites); Flutterwave is not an NGN off-ramp today. |
| Stacks Endowment | Grant funder. Validates the infrastructure thesis. |
| Zero Authority | Community engagement and external developer testing platform. |
| Let Africa Build (LAB) | Developer pipeline and ecosystem outreach. |
| CineX | First integrator. Proof of adoptability. |
| Flutterwave | Second payout adapter (Sprint 12): v3 **USDC-to-wallet disbursement**, NOT an NGN bank payout (`docs/flutterwave-api-reference.md` §0). Wire-contract tested; **not routed from the pipeline** (backlog P-1); **sandbox/live UNVERIFIED** (no credentials). Commercial potential is as a corridor option, not yet an active off-ramp partner. Off-ramp access requires an approved F4B production account (completed KYC); the sandbox cannot access it (confirmed 2026-10-02). |
| Breet | Third payout adapter (Sprint 13): NGN local-fiat off-ramp (add bank → withdraw to bank). Wire-contract tested; **webhook verifier deferred** (a focused sprint must add it as isolated, additive code); **not routed from the pipeline** (backlog P-1); **sandbox/live UNVERIFIED** (no credentials, G-20). |

> **Partner-role honesty.** Flutterwave and Breet are listed as partner _roles_ because their adapters exist and are tested at the wire level — not because commercial relationships exist. Flutterwave's status per `docs/CLAIMS_REGISTER.md` §5.1 is `IMPLEMENTED + TESTED` with **external UNVERIFIED**; its reference doc is a prompt-derived stub (P-4); the pipeline does not route through it. Breet's status is the same classification, with its webhook verifier deferred to a focused sprint; it is also not routed. Neither adapter generates revenue. No revenue claim is implied; "No revenue exists today" is unchanged.
>
> **Corridor composition.** Corridor abstraction (NGN first, KES/ZAR configurable) predates Sprint 12. Flutterwave does not change the corridor map: the v3 body delivers USDC to a wallet; the NGN payout corridor is still Yellow Card's. Full provider routing (P-1) would change this section when it lands, and it is deferred because it touches the state machine action layer and the evidence chain.

### Cost Structure

People-first, cloud-second. The cost structure is dominated by engineering time.

| Cost | Nature |
|---|---|
| Engineering hours | Fixed per milestone |
| Senior review | Fixed |
| Infrastructure (Hosted Tier) | Variable (serverless/cloud functions) |
| Documentation and community | Fixed |
| Contingency | Fixed reserve |

**No variable costs at scale for the open-source tier.** Adding a corridor means adding a configuration entry. 
---

## 6. Long-term strategic options: vertical integration

Payout Rail's current position is a **thin orchestration layer** between the Stacks application and the payout provider. It captures value through convenience, audit-grade evidence, and provider-agnosticism. It does not capture the FX spread (which belongs to the provider), the user relationship (which belongs to the application), or the settlement fee (which belongs to both).

Two strategic options could thicken the value capture position over the long term. Neither is on the current roadmap. Both are documented here so they are not forgotten.

### Forward integration — moving toward the end user

**What it would mean:** Payout Rail offers payouts directly to end users, or owns the recipient relationship through a consumer-facing product.

**What it would capture:** The user relationship, a per-payout fee from the end user, and the data layer around recipient preferences and payment history.

**What it would require:** A consumer-facing product (wallet, app, or interface), consumer support operations, user acquisition, and either a licensed entity or a partner-of-record arrangement.

**Why it is not on the current roadmap:**

\- The project has no users today

\- Consumer products are a different discipline from infrastructure

\- The Stacks ecosystem already has consumer wallets with established user bases

\- Forward integration would put Payout Rail in competition with the applications it serves

**Conditions that would make it viable:**

\- After Milestone 3, when at least one external application has integrated

\- After the layer has real usage data

\- Only if there is a clear gap in the market that existing wallets or applications are not filling

### Backward integration — moving toward the provider

**What it would mean:** Payout Rail becomes the payout provider itself, acquires a licensed entity, or builds direct relationships with banks in each corridor.

**What it would capture:** The provider fee, the FX spread, and control over the payout experience.

**What it would require:** A money transmitter license (or equivalent) in each corridor, KYB/AML compliance infrastructure, banking relationships, capital reserves, and regulatory reporting.

**Why it is not on the current roadmap:**

\- The regulatory burden is enormous

\- The capital requirements are significant

\- The project would become a regulated financial entity, reversing the current positioning

\- The entire "we never hold funds, the integrator is the regulated party" principle would be abandoned

**Conditions that would make it viable:**

\- Almost never for a small team

\- This is the path Circle, Stripe, and Wise took after years of scale

\- It is not the path for a grant-funded prototype

### The principle

Neither direction is on the roadmap. Both are documented so that if conditions change — if the project reaches scale, if a licensed entity becomes available at reasonable cost, if a corridor becomes strategically essential — the options are already named and analyzed.

The near-term strategy is to strengthen the orchestration layer's position: provider-agnostic, open-source, audit-grade. That is the defensible position. The long-term options are held in reserve.

## 7. Why Payout Rail Creates Value on Stacks

The value only exists on Stacks because the payout is reliable. Without Payout Rail, a Stacks application cannot offer local payouts. Without local payouts, that application's users never hold USDCx on Stacks in the first place. The payout layer is the reason the on-chain value exists.

Payout Rail does not move value out of Stacks. It creates the reason for value to exist on Stacks.

---

## 8. The Commercial Hypothesis (Not Yet Validated)

Payout Rail's commercial hypothesis is that Stacks applications will pay for:

\- A hosted orchestration tier (for teams that do not want to run infrastructure)

\- Per-payout support (for self-hosters who want SLAs)

\- Enterprise support (for high-volume integrators)

The hypothesis is unvalidated. The grant funds validation. Sprint 9 formalizes the model once external adoption exists.

---

## 9. Related Documents

\- `docs/COMMERCIAL\_HYPOTHESIS.md` — the original hypothesis, including ILP vision and naming research

\- `docs/grant/strategy/PROJECT\_CONCEPT.md` — problem statement, customer, positioning

\- `docs/grant/strategy/THEORY\_OF\_CHANGE.md` — the causal chain

\- `docs/grant/strategy/PESTLE.md` — the "Why Now"

\- `docs/grant/submissions/2026-10-endowment-getting-started.md` — the grant application
