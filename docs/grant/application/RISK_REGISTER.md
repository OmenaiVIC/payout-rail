\# Risk Register — Payout Rail



> Application document. Answers "Risk disclosure" from the Stacks Endowment Getting Started application.

> Not a sprint deliverable. Part of the grant application package.

> Structure: identification, qualification, quantification, response plan, monitoring.



\## Risk classification



\- \*\*Likelihood:\*\* Low / Medium / High

\- \*\*Impact:\*\* Low / Medium / High

\- \*\*Score:\*\* Likelihood × Impact (1–9)



\## Delivery risks



\### D-1: Provider credentials are unavailable during the grant period



\*\*Description:\*\* Yellow Card sandbox access requires KYB and an account approval process. If credentials are not granted before the grant's Milestone 2 date, sandbox verification cannot be completed.



\- \*\*Likelihood:\*\* Medium

\- \*\*Impact:\*\* High (Milestone 2 blocked)

\- \*\*Score:\*\* 6



\*\*Response:\*\*

\- Apply for sandbox access in Week 1 of the grant period

\- If credentials are not granted by Week 4, escalate to the Stacks Endowment program manager

\- Fallback: produce a mock-verified Milestone 2 with the honest label "sandbox verification pending credentials" — this is already the current state and is documented in the repo



\*\*Monitoring:\*\* Weekly check-in on credential status



\### D-2: A team member becomes unavailable for a milestone



\*\*Description:\*\* McDaniells may be part-time due to current commitments; Jacob may relocate internationally.



\- \*\*Likelihood:\*\* Medium

\- \*\*Impact:\*\* Low (succession path documented)

\- \*\*Score:\*\* 3



\*\*Response:\*\*

\- Succession path is documented in `MAINTENANCE\_PLAN.md`

\- Milestones name who delivers and who reviews

\- No milestone depends on a single person's continuous availability



\*\*Monitoring:\*\* Monthly team check-in



\### D-3: Sandbox provider requires design changes not anticipated



\*\*Description:\*\* Yellow Card's sandbox may reject the current wire-level integration in ways the public docs do not reveal.



\- \*\*Likelihood:\*\* Medium

\- \*\*Impact:\*\* Medium (Milestone 2 extends)

\- \*\*Score:\*\* 4



\*\*Response:\*\*

\- Adapter interface is provider-agnostic; changes are localized to `yellowcardAdapter.js`

\- Evidence chain records every observation; drift is detectable

\- Budget includes contingency review time



\*\*Monitoring:\*\* First sandbox test reveals issues; escalate immediately



\## Technical risks



\### T-1: Stacks burn entrypoint mismatch (G-09)



\*\*Description:\*\* The current adapter targets the `usdcx` token contract; the canonical path may be through the `usdcx-v1` protocol entrypoint.



\- \*\*Likelihood:\*\* High (documented as open)

\- \*\*Impact:\*\* Medium (Milestone 1 requires resolution)

\- \*\*Score:\*\* 6



\*\*Response:\*\*

\- Milestone 1 explicitly addresses this

\- Testnet verification is the verification method

\- If the entrypoint differs, the adapter interface allows swapping without state machine changes



\*\*Monitoring:\*\* Milestone 1 testnet evidence



\### T-2: xReserve observation model requires further correction



\*\*Description:\*\* Sprint 2 corrected the fabricated release model, but xReserve's canonical behavior is documented, not verified.



\- \*\*Likelihood:\*\* Medium

\- \*\*Impact:\*\* Medium (may affect Milestone 2 if release observation is required)

\- \*\*Score:\*\* 4



\*\*Response:\*\*

\- Observation surface is fail-closed (unobserved states route to manual\_review)

\- If xReserve behavior differs from documentation, correction is localized to `xreserveAdapter.js`



\*\*Monitoring:\*\* Milestone 2 sandbox evidence



\### T-3: Integration with a real Stacks application proves harder than expected



\*\*Description:\*\* The external integrator example may not match what real applications need.



\- \*\*Likelihood:\*\* Medium

\- \*\*Impact:\*\* Medium (Milestone 3 extends)

\- \*\*Score:\*\* 4



\*\*Response:\*\*

\- Milestone 3 includes external developer testing

\- Feedback is incorporated before final release

\- The v1 API is documented for external consumption



\*\*Monitoring:\*\* External developer feedback during Milestone 3



\## Legal and regulatory risks



\### L-1: Regulatory environment in Nigeria shifts



\*\*Description:\*\* Nigeria may restrict stablecoin-to-fiat conversion or change provider requirements.



\- \*\*Likelihood:\*\* Low

\- \*\*Impact:\*\* High (corridor blocked)

\- \*\*Score:\*\* 3



\*\*Response:\*\*

\- The layer never holds funds; it orchestrates through licensed providers

\- The integrator is treated as the regulated party, not the layer

\- Corridor abstraction allows configuration of other corridors if NGN becomes unworkable



\*\*Monitoring:\*\* Regulatory news; provider terms updates



\### L-2: Provider terms of service restrict integration patterns



\*\*Description:\*\* Yellow Card's terms may prohibit certain uses of their API.



\- \*\*Likelihood:\*\* Low

\- \*\*Impact:\*\* Medium

\- \*\*Score:\*\* 2



\*\*Response:\*\*

\- Integration follows the documented public API

\- No custodial or money-transmission activity

\- Any restriction discovered during sandbox testing is documented and addressed



\*\*Monitoring:\*\* Provider terms review at Milestone 2



\## Operational risks



\### O-1: Grant period is too short for all three milestones



\*\*Description:\*\* 8–12 weeks is tight for sandbox verification plus external integration.



\- \*\*Likelihood:\*\* Medium

\- \*\*Impact:\*\* Medium (Milestone 3 may extend)

\- \*\*Score:\*\* 4



\*\*Response:\*\*

\- Milestone structure is sequential and dependency-driven

\- Milestone 3 can extend into post-grant work if needed

\- The grant funds the transition to validated infrastructure; the release candidate is the deliverable, not mainnet



\*\*Monitoring:\*\* Weekly progress review



\### O-2: Team coordination across time zones



\*\*Description:\*\* If Jacob relocates internationally, asynchronous coordination becomes the default.



\- \*\*Likelihood:\*\* Medium

\- \*\*Impact:\*\* Low

\- \*\*Score:\*\* 2



\*\*Response:\*\*

\- Team structure is already async-friendly

\- Weekly written updates

\- Jacob's role is structured as review and continuity, not full-time execution



\*\*Monitoring:\*\* Monthly check-in



\## Market risks



\### M-1: No external application adopts the layer



\*\*Description:\*\* The infrastructure may be technically sound but see no uptake.



\- \*\*Likelihood:\*\* Medium

\- \*\*Impact:\*\* Medium (the theory of change is partially falsified)

\- \*\*Score:\*\* 4



\*\*Response:\*\*

\- The theory of change explicitly names this as a falsification condition

\- Milestone 3 includes external developer outreach

\- If no adoption by end of grant, the honest outcome is documented in the final report



\*\*Monitoring:\*\* External interest during Milestone 3



\### M-2: Ecosystem pivots away from payout infrastructure



\*\*Description:\*\* Stacks ecosystem priorities may shift.



\- \*\*Likelihood:\*\* Low

\- \*\*Impact:\*\* Medium

\- \*\*Score:\*\* 2



\*\*Response:\*\*

\- The layer is standalone; it does not depend on ecosystem shifts

\- It serves any Stacks application with payout needs



\*\*Monitoring:\*\* Quarterly cycle themes



\## Risk summary



| ID | Risk | Likelihood | Impact | Score |

|---|---|---|---|---|

| D-1 | Provider credentials unavailable | Medium | High | 6 |

| D-2 | Team member unavailable | Medium | Low | 3 |

| D-3 | Sandbox requires design changes | Medium | Medium | 4 |

| T-1 | Stacks burn entrypoint mismatch | High | Medium | 6 |

| T-2 | xReserve model correction | Medium | Medium | 4 |

| T-3 | Integration harder than expected | Medium | Medium | 4 |

| L-1 | Nigeria regulatory shift | Low | High | 3 |

| L-2 | Provider terms restriction | Low | Medium | 2 |

| O-1 | Grant period too short | Medium | Medium | 4 |

| O-2 | Time zone coordination | Medium | Low | 2 |

| M-1 | No external adoption | Medium | Medium | 4 |

| M-2 | Ecosystem pivot | Low | Medium | 2 |



\*\*Highest-scoring risks:\*\* D-1 (provider credentials), T-1 (Stacks burn entrypoint). Both have dedicated milestones and documented response plans.



\## Risk ownership



| Risk | Owner |

|---|---|

| D-1, D-3, L-1, L-2 | Victor Omenai (lead) |

| D-2, O-2 | Victor Omenai (with team input) |

| T-1, T-2, T-3 | McDaniells Albert (co-maintainer) |

| O-1, M-1, M-2 | Victor Omenai |

