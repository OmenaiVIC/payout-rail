\# COMMERCIAL_HYPOTHESIS

Status: Working hypothesis. Not validated. Not a business plan.

Purpose: capture the commercial thinking behind Payout Rail so it is not lost during the technical sprint sequence.

Created: 2026-09-21.

> This document is a hypothesis, not a claim. Nothing here is verified. It exists so that the technical work has a commercial north star, and so that Sprint 9 (docs/prompts/11_SPRINT_9_COMMERCIAL_MODEL.md, currently STUB) has raw material to formalize once the technical evidence base exists

\---

\## 1. The Blue Ocean Framing

The current landscape for crypto-to-fiat payouts splits into three camps:

| Camp | Examples | Weakness |

|---|---|---|

| Centralized payout processors | Stripe, Wise, Payoneer | Not crypto-native; expensive; closed |

| Bridge / swap infrastructure | Circle CCTP, various bridges | Moves value but does not orchestrate local payout |

| Direct provider integrations | Yellow Card, Flutterwave direct | Each app rebuilds the same orchestration |

\*\*The gap:\*\* there is no open, reusable \*\*orchestration layer\*\* that sits between a Stacks application's settlement and a local payout provider. Every team rebuilds the same state machine, the same retries, the same evidence trail.

\*\*The blue ocean move:\*\* define and own the \*orchestration category\* for Stacks → Global South payouts, open-sourced, with a hosted commercial tier.

\---

\## 2. Problem Statement (Draft)

Stacks applications that need to pay recipients in local currencies face:

\- No standard way to connect USDCx settlement to local payout rails

\- No reusable state machine for the payout lifecycle

\- No audit trail that satisfies compliance reviewers

\- No provider-agnostic abstraction (each provider is integrated from scratch)

\- No open-source reference implementation they can trust

Result: every Stacks application either builds this from zero, or does not build it at all and stays in crypto-only flows.

\---

\## 3. Target Customer Segments (Hypothesis)

Ordered by likelihood of adoption:

1\. \*\*Stacks applications with real payout needs\*\* — grants platforms, freelancer payment tools, DAO contributor payouts, gaming economies

2\. \*\*Stacks protocols\*\* that want to offer fiat off-ramps as a feature

3\. \*\*Exchanges and custodians\*\* serving African and Global South markets

4\. \*\*NGOs and aid organizations\*\* experimenting with crypto rails

5\. \*\*Other chains\*\* (later) that want to reuse the orchestration pattern

\---

\## 4. Corridor Strategy

\### Primary validation corridor

\- \*\*Nigeria / NGN\*\* — Yellow Card integration, sandbox or mock mode

\### Demo-mode corridors (Sprint 6)

\- \*\*Kenya / KES\*\* — configuration-proven, sandbox verification pending

\- \*\*South Africa / ZAR\*\* — configuration-proven, sandbox verification pending

\### Rationale

Multi-corridor proves the corridor-abstraction is real, not hypothetical. However, only NGN will have actual provider evidence in this phase. KES and ZAR will demonstrate that the adapter/config pattern works, but will be explicitly labelled as "configuration-ready, sandbox-verification-pending."

\### Future corridors

Additional Yellow Card markets and other Global South corridors, subject to provider coverage and grant funding.

\---

\## 5. The ILP Hypothesis (Long-Term Routing Vision)

\### What ILP Is

The Interledger Protocol (ILP) is an open, currency-agnostic routing and clearing protocol. It connects disparate ledgers — banks, blockchains, mobile money, CBDCs — without requiring participants to share the same ledger \[citation:1]\[citation:14].

\### What ILP Is Not

\*\*ILP does not natively settle value.\*\* The Interledger Foundation explicitly states that nodes must reconcile balances through pre-funded accounts or bilateral arrangements \[citation:1]. ILP routes payment \*instructions\*, not money.

\### The Opportunity for Payout Rail

In the long term, ILP could become the \*\*routing layer\*\* that sits above individual payout providers. Instead of hardcoding Yellow Card, Payout Rail could route payment instructions through ILP connectors to whichever provider offers the best rate and reliability for a given corridor.

This would make Payout Rail a \*\*corridor-agnostic orchestration layer\*\* rather than a Yellow Card-specific integration.

\### What Is Required for This to Work

1\. \*\*ILP connectors with local liquidity\*\* in target corridors (KES, ZAR, NGN)

2\. \*\*Mojaloop or equivalent infrastructure\*\* with production-grade connector availability \[citation:14]

3\. \*\*Payout Rail adapters\*\* that can speak ILP alongside native provider APIs

\### Current Reality

No production-grade ILP connectors for KES or ZAR payouts have been identified. Mojaloop uses ILP in Africa, but its connector network for direct Stacks-to-fiat payouts is not established.

\### Conclusion

ILP is a \*\*roadmap item\*\*, not an MVP component. Yellow Card remains the last-mile provider for this phase. ILP should be documented as the long-term routing architecture that makes Payout Rail provider-agnostic.

\*\*Grant narrative:\*\* "Payout Rail is designed with an ILP-ready adapter layer, enabling future routing through Interledger connectors as they become available in target corridors."

\---

\## 6. Revenue Mechanisms (Hypothesis — not validated)

Candidate models, to be tested:

| Model | Description | Pros | Cons |

|---|---|---|---|

| Managed hosting (SaaS) | Hosted Payout Rail for teams that do not want to run it | Recurring revenue; clear value | Requires ops maturity |

| Per-payout fee | Basis points on settled volume | Aligns with customer success | Needs volume to matter |

| Enterprise support | SLA + support contracts for self-hosters | High-margin | Hard to sell early |

| Grant funding | Pre-revenue phase | Buys time to build | Not sustainable |

| Protocol fee share | If Payout Rail becomes standard on Stacks | Scalable | Requires ecosystem adoption |

\*\*Working hypothesis:\*\* start with grants → transition to managed hosting + per-payout fee as volume appears.

\---

\## 7. Unit Economics (Placeholder — needs real numbers)

| Cost | Amount | Notes |

|---|---|---|

| Yellow Card fee per payout | TBD | Must be sourced from YC directly |

| FX spread | TBD | Varies by corridor |

| On-chain gas (Stacks) | TBD | Small but real |

| Infrastructure cost | TBD | Depends on hosting model |

| Support cost per customer | TBD | Post-launch |

\*\*Take rate must exceed provider fee + FX spread + infra cost + support cost.\*\* None of these are known yet. Do not publish a take rate until they are.

\---

\## 8. Competitive Differentiation

If everything in Payout Rail is open source, what defends the business?

Candidate answers (unvalidated):

\- \*\*Operational excellence\*\* — the hosted version is simply better run than self-hosted

\- \*\*Compliance posture\*\* — audit-grade evidence trail is hard to replicate

\- \*\*Corridor depth\*\* — first mover on specific Global South corridors

\- \*\*Ecosystem trust\*\* — being the default in the Stacks community

\- \*\*Support quality\*\* — enterprise customers pay for SLAs, not code

\- \*\*ILP-ready architecture\*\* — future-proofed against provider lock-in

\*\*Open question:\*\* is there a proprietary component (e.g., advanced reconciliation, ML-based fraud detection, provider negotiation) that stays closed-source while the core stays open?

\---

\## 9. The Grant-to-Revenue Bridge

The realistic path over 18–24 months:

1\. \*\*Months 0–6:\*\* Build and open-source Payout Rail. Apply for Stacks ecosystem grants. Prove technical thesis.

2\. \*\*Months 6–12:\*\* Land 2–3 design partners. Run sandbox pilots. Gather real usage data. Publish evidence.

3\. \*\*Months 12–18:\*\* Launch managed hosting tier. Onboard first paying customers. Establish corridor depth in NGN + 2 others.

4\. \*\*Months 18–24:\*\* Expand corridors. Hire first ops/support. Prove unit economics.

\---

## 10. Naming Decision (Pending — Do Not Finalize)

### Trademark Research Findings (2026-09-21)

| Name         | Risk         | Finding                                                                                                                                                                                                                                                                                                              |
| ------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Payrail**  | **High**     | Active USPTO proceedings with Payrailz, LLC (marks PAYRAILZ) and Payrails GmbH (marks PAYRAILS). Also active commercial use in Indonesia (PT KAI RailPay), Serbia (Raiffeisenbank RailPay), Singapore (Railpays Pte Ltd), and US fintech.                                                                            |
| **Sendrail** | **High**     | Existing open-source project `MukundaKatta/sendrail` with live landing page. Describes itself as "Stablecoin rails from the US and GCC to India and the Philippines." Direct prior use in the same commercial space.                                                                                                 |
| **Settlr**   | **Moderate** | Existing entities: (1) Settlr Zurich — post-trade management automation for financial services, backed by Tenity/Julius Baer [citation:1]; (2) Settlr — stablecoin billing for cannabis industry [citation:5]; (3) Figma escrow prototype (likely inactive) [citation:9]. No dominant player, but name is not clean. |

### Decision

**Working folder name remains `payout-rail`.** No final brand name is adopted at this stage.

"Settlr" is recorded as a candidate, but carries moderate risk due to existing use in financial services (Zurich startup). It cannot be adopted without a professional clearance search.

### Candidate Names (None Cleared)

| Candidate      | Notes                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Settlr**     | Moderate risk — existing fintech use in Zurich [citation:1], cannabis payments [citation:5]. Pronunciation: "settler" or "settle-er". |
| **Settlerail** | Not yet checked                                                                                                                       |
| **Sendline**   | Not yet checked                                                                                                                       |

### Next Steps for Naming

1. **Do not commit to any brand name without a professional clearance search.**
2. Public trademark databases (USPTO, EUIPO, CIPC South Africa) are insufficient alone. Nigeria's trademark registry is not fully digitized for public search [citation:3].
3. **Engage a trademark attorney** for clearance across:
   - USPTO (US)
   - EUIPO (EU)
   - CIPC (South Africa)
   - Nigerian Trademarks Registry [citation:3][citation:7]
   - Kenya Industrial Property Institute
4. **Record the final decision here** once clearance is complete.
5. **Working name `payout-rail`** is purely a workspace label. It has no legal weight and can be changed without consequence.

### What Not to Do

- Do not use "Sendrail" or "Railpay" in any public-facing material.
- Do not invest in branding, domains, or marketing under any unverified name.
- Do not assume a name is available because it does not appear in a quick online search [citation:3].

\## 11. Open Questions Requiring Validation

These must be answered before a business plan is credible:

\- Do Stacks applications actually want this, or do they solve it themselves?

\- Is Yellow Card the right long-term provider, or is multi-provider abstraction essential from day one?

\- \*\*Do production-grade ILP connectors exist for KES, ZAR, or NGN payouts?\*\* If yes, when?

\- Is "open-source core + paid hosting" the right model, or is a proprietary product more defensible?

\- How does this compare to Circle's own payout roadmap for USDC?

\- What is the actual regulatory exposure in each corridor?

\- Is Stacks the right wedge, or should Payout Rail be chain-agnostic from day one?

\- Would CineX itself pay for this? (Dogfooding test)

\---

\## 12. Relationship to Sprint 8 (Grant Readiness)

Sprint 8 produces the technical evidence package. This document is the commercial counterpart. Sprint 9 (not yet created) will formalize the commercial model using both.

For grant applications:

\- Lead with technical evidence (Sprint 8 output)

\- Support with commercial hypothesis (this document, formalized)

\- Never claim revenue that has not been earned

\- Frame grants as enabling the bridge from proof to sustainability

\- \*\*ILP narrative:\*\* position as future-proofing against provider lock-in

\---

\## 13. Change Control

Any change to the commercial hypothesis goes through `docs/PRODUCT\_CHANGE\_CONTROL.md`. This document is a hypothesis; changes are expected. But each change must be recorded, not silently overwritten.

\---

\## Related Documents

\- `docs/PRODUCT\_CHANGE\_CONTROL.md`

\- `docs/CLAIMS\_REGISTER.md` (created in Prompt 0)

\- `docs/PRODUCT\_BASELINE.md` (created in Prompt 0)

\- Sprint 8 output: capability matrix, evidence register

\ Sprint 9: - `docs/prompts/11_SPRINT_9_COMMERCIAL_MODEL.md`
