\# Multi-Corridor Plan — Payout Rail



> Status: Planning document. Not a sprint deliverable. No code changes described here have been made.

> Purpose: name the roadmap for expanding Payout Rail from a single-corridor orchestration layer to a multi-corridor network.

> What this is not: a claim that multiple corridors are live. Only NGN is implemented. Everything else is planned, configuration-ready, or pending provider onboarding.



\---



\## 1. Where Payout Rail is today



Payout Rail is a provider-agnostic orchestration layer that connects Stacks settlement to local fiat payouts. It has one working corridor: \*\*Nigeria/NGN via Yellow Card\*\*.



The orchestration core — 15-state machine, evidence chain, reconciliation layer, v1 public API — is complete and covered by 243 tests. The adapter interface is proven by a second implementation (Flutterwave), even though that second adapter does not yet serve a live corridor.



The layer is ready to add corridors. The corridors themselves are not yet added.



\---



\## 2. What a corridor requires



Adding a corridor is not a config change. Each one requires the following:



| Requirement | What it means |

|---|---|

| \*\*Provider support\*\* | A licensed provider that serves the country and currency |

| \*\*Onboarding\*\* | KYB, KYC, AML review, and a legal agreement with the provider |

| \*\*Sandbox access\*\* | Provider sandbox credentials to test the payout flow |

| \*\*Rate pair\*\* | A rate for `USDCx/<currency>` — seeded or sourced live |

| \*\*Recipient schema\*\* | Bank account format, mobile money format, or wallet address |

| \*\*Gate thresholds\*\* | Per-disbursement and daily caps in that currency |

| \*\*Recipient registry\*\* | A whitelist or eligibility mechanism for that corridor |

| \*\*Documentation\*\* | Update `PROVIDER\_ADAPTERS.md`, `README.md`, and the claims register |



Each corridor is a sprint. The work is bounded but real.



\---



\## 3. Provider landscape



Several providers serve USDC-to-local-fiat payouts in Africa. Each has different coverage, onboarding requirements, and API maturity.



| Provider | Coverage | Onboarding | Status |

|---|---|---|---|

| \*\*Yellow Card\*\* | Nigeria (primary), and other African markets | KYB, AML review, legal agreement | Applied; onboarding in progress |

| \*\*Flutterwave\*\* | Nigeria, Ghana, Kenya, South Africa, and others | F4B KYC for stablecoin off-ramp | Sandbox adapter built; off-ramp blocked by F4B production approval |

| \*\*Zuba\*\* | Nigeria | Sandbox available | Candidate — not yet evaluated |

| \*\*Breet\*\* | Nigeria, Ghana | Sandbox available; KYB under 24 hours | Candidate — not yet evaluated |

| \*\*Monica.cash\*\* | Nigeria | Sandbox keys available after KYB | Candidate — not yet evaluated |

| \*\*Partna\*\* | Nigeria, Kenya, Ghana, Malawi, Zambia | Requires company website | Deferred — website not yet built |

| \*\*Kora (One Rail)\*\* | Nigeria, Kenya, Ghana, South Africa, Egypt | Recently launched | Deferred — too new to evaluate |



\*\*Note:\*\* Provider claims are drawn from public documentation. None has been verified by Payout Rail beyond the sandbox work done on Yellow Card and Flutterwave.



\---



\## 4. Corridor roadmap



The order below reflects provider coverage, developer-friendliness, and strategic fit. It does not reflect a commitment to deliver each corridor on a specific timeline.



\### Now — NGN (Nigeria)



\*\*Provider:\*\* Yellow Card

\*\*Status:\*\* Implemented. Sandbox onboarding in progress.

\*\*What remains:\*\* Complete KYB, obtain sandbox credentials, produce end-to-end NGN payout evidence.



\### Next — NGN second provider



\*\*Provider:\*\* Flutterwave (pending F4B), or Zuba, or Breet

\*\*Status:\*\* Flutterwave adapter built; off-ramp blocked. Zuba and Breet are candidates.

\*\*What remains:\*\* Complete F4B KYC (Flutterwave) or evaluate Zuba/Breet sandbox. Produce end-to-end evidence with the second provider.



\*\*Why this comes before new corridors:\*\* A second provider for NGN proves the adapter interface works for a payout, not just for a wire model. That is the strongest possible proof of the provider-agnostic claim.



\### Later — KES (Kenya)



\*\*Provider:\*\* Flutterwave, or Partna, or another

\*\*Status:\*\* Configuration-ready. Not implemented.

\*\*What remains:\*\* Provider onboarding, corridor configuration, recipient schema, sandbox evidence.



\### Later — GHS (Ghana)



\*\*Provider:\*\* Flutterwave, or Breet

\*\*Status:\*\* Configuration-ready. Not implemented.

\*\*What remains:\*\* Provider onboarding, corridor configuration, recipient schema, sandbox evidence.



\### Later — ZAR (South Africa)



\*\*Provider:\*\* Flutterwave

\*\*Status:\*\* Configuration-ready. Not implemented.

\*\*What remains:\*\* Provider onboarding, corridor configuration, recipient schema, sandbox evidence.



\---



\## 5. The P-1 dependency



The orchestration core currently routes the payout leg through `ctx.adapters.yellowcard`, hard-coded at 14 sites. Two provider adapters exist, but the pipeline can only route through one.



Full provider routing is tracked as \*\*P-1\*\* in `docs/POSTPONED\_BACKLOG.md`. It requires changes to the state machine's action layer and the evidence chain — both of which are deliberately out of scope for the adapter sprints.



\*\*No second provider can be routed through the pipeline until P-1 is delivered.\*\*



The order is therefore:



1\. Deliver P-1 (full provider routing)

2\. Complete onboarding for the second provider

3\. Prove the second provider end-to-end in sandbox

4\. Then expand to additional corridors



Skipping P-1 produces a second provider that exists in configuration but cannot serve a payout.



\---



\## 6. What this unlocks



Once two providers serve the NGN corridor:



\- \*\*The provider-agnostic claim is proven\*\* — not theoretical.

\- \*\*The multi-corridor plan becomes actionable\*\* — the pattern for adding a corridor is established.

\- \*\*The provider registry becomes meaningful\*\* — applications can query supported providers.



Once three corridors are live:



\- \*\*The layer is a corridor network\*\* — Layer 2 of the shovel-and-picks essay.

\- \*\*Corridor-as-a-Service becomes possible\*\* — a single API where the application names a country and currency, and the layer routes to the right provider.

\- \*\*The grant narrative strengthens\*\* — "validated first through Nigeria, extensible to other corridors" becomes a claim with evidence.



\---



\## 7. What this does not do



This document does not:



\- Add corridors (it plans them)

\- Change the state machine

\- Change the evidence chain

\- Claim multi-corridor support (it claims configuration-readiness only)

\- Commit to timelines for corridors beyond NGN



The current state remains: \*\*NGN is implemented. A second NGN provider is next. Additional corridors are planned.\*\*



\---



\## 8. Related documents



\- `docs/SHOVEL\_AND\_PICKS.md` — the five-layer frame and the corridor network as Layer 2

\- `docs/PROVIDER\_ADAPTERS.md` — the adapter interface and current implementations

\- `docs/POSTPONED\_BACKLOG.md` — P-1 (full provider routing), P-7 (Flutterwave off-ramp)

\- `docs/COMMERCIAL\_MODEL.md` — the Blue Ocean frame and the corridor abstraction

\- `docs/grant/strategy/PROJECT\_CONCEPT.md` — "Nigeria is the first validated corridor, not the product definition"

