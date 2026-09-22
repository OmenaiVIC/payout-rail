\# Payout Rail — Prompt Library

This folder contains the operating instructions for the Payout Rail extraction and rebuild project.

It is the project's operating manual. The agent reads the relevant file at the start of each task. Files are versioned with the repository so that instructions remain stable, reviewable, and reproducible across sessions.

\---

\## Purpose

The prompts define:

\- The standing role and principles the agent must operate under.

\- The extraction strategy that moves the BOS out of CineX without damaging CineX.

\- The technical baseline that must be established before rebuilding.

\- The sprint-by-sprint scope for the Payout Rail project.

\---

\## How to Use These Prompts

\### Session Start (Every Time)

Before giving the agent any task, paste this once:

Read and internalize docs/prompts/00_MASTER.md and docs/PRODUCT_CHANGE_CONTROL.md as standing constraints for this session. Confirm you have read both, summarize the key principles you will operate under, then wait for the task.

\### Task Start

Then give the agent a short directive referencing the specific prompt file for the current task, for example:

Execute docs/prompts/01_PROMPT_0A_EXTRACTION.md under the standing constraints. Additional constraint: discovery-only. Write outputs to docs/extraction-plan/. Do not write, move, copy, or delete any other files. Stop when done and wait for my review.

\---

\## Execution Order

| #   | File                              | Purpose                                                   | Status     |
| --- | --------------------------------- | --------------------------------------------------------- | ---------- |
| 00  | `00_MASTER.md`                    | Role, principles, working method. Read every session.     | Standing   |
| 01  | `01_PROMPT_0A_EXTRACTION.md`      | Extract BOS from CineX into Payout Rail.                  | Completed  |
| 02  | `02_PROMPT_0_BASELINE.md`         | Technical and product baseline.                           | Completed  |
| 03  | `03_SPRINT_1_ORCHESTRATION.md`    | SUPERSEDED by 03a.                                        | Superseded |
| 03a | `03a_SPRINT_0_5_MVP_PATH.md`      | MVP path fixes (six P0/P1 gaps).                          | Completed  |
| 04a | `04a_SPRINT_1_5_HARDENING.md`     | Deterministic idempotency, CAS guard, duplicate handling. | Completed  |
| 04b | `04b_SPRINT_2_STACKS_USDCX.md`    | Settlement model correction (observation-based).          | Completed  |
| 05  | `05_SPRINT_4_EVIDENCE.md`         | Evidence chain, reconciliation, settlement receipts.      | Active     |
| 06  | `06_SPRINT_3_YELLOWCARD.md`       | Yellow Card integration.                                  | Deferred   |
| 07  | `07_SPRINT_5_PUBLIC_INTERFACE.md` | Public API and example client.                            | Pending    |
| 08  | `08_SPRINT_6_DEMO.md`             | Reproducible Nigeria payout demonstration.                | Pending    |
| 09  | `09_SPRINT_7_OPENSOURCE.md`       | Open-source release candidate.                            | Pending    |
| 10  | `10_SPRINT_8_GRANT.md`            | Product evidence and grant readiness.                     | Pending    |
| 11  | `11_SPRINT_9_COMMERCIAL_MODEL.md` | Commercial model (stub, deferred).                        | Stub       |

Note: Sprint 3 is intentionally deferred until after Sprint 4. That is why its file is numbered `06_` while Sprint 4 is `05_`. The table lists them in execution order, not filename order.
\---

\## Standing Constraints

These apply to every session and every task:

| Constraint | Location |

|------------|----------|

| Product Change Control Rule | `docs/PRODUCT\_CHANGE\_CONTROL.md` |

| Master role and principles | `docs/prompts/00\_MASTER.md` |

| Protected source product | CineX |

| Destination repository | Payout Rail |

\---

\## Guardrails

\- CineX is a protected source product. Do not modify, rename, archive, or strip CineX functionality merely to serve Payout Rail.

\- Extraction is a copy-and-decouple exercise, not a rewrite. Preserve working functionality until a documented reason to change it exists.

\- Evidence over claims. Do not claim implemented, tested, verified, sandbox-verified, or production-ready status without supporting evidence.

\- No scope creep. Anything classified D (post-grant) or E (outside scope) must go to `docs/POSTPONED\_BACKLOG.md`, not into the implementation.

\- Fail closed. Ambiguous or unverifiable settlement states must not advance to the next financial action.

\- Human review required. Where the product design requires human approval, automation must never silently bypass it.

\---

\## Outputs Produced by These Prompts

| Prompt | Outputs |

|--------|---------|

| 00 | Session constitution only. No files. |

| 01 (0A) | `docs/extraction-plan/EXTRACTION\_MAP.md`, `docs/extraction-plan/REPOSITORY\_BOUNDARY.md`, `docs/extraction-plan/EXTRACTION\_GAP\_REGISTER.md` |

| 02 (0) | `docs/PRODUCT\_BASELINE.md`, `docs/CLAIMS\_REGISTER.md`, gap register |

| 03 (S1) | Orchestration core, state machine, transition tests |

| 04 (S2) | Stacks/USDCx lifecycle adapter and tests |

| 05 (S3) | Yellow Card adapter and tests |

| 06 (S4) | Evidence chain and reconciliation workers |

| 07 (S5) | Public API and example client |

| 08 (S6) | Demo runner and settlement receipt |

| 09 (S7) | Release candidate documentation set |

| 10 (S8) | Capability matrix, claims register, grant package |

\---

\## Maintenance

\- During active development, these prompts are the source of truth for project scope and constraints.

\- Do not delete prompts while a sprint that references them is in progress.

\- When the project reaches a stable release, move this folder to `docs/archive/prompts/` for historical reference rather than deleting it.

\---

\## Related Documents

\- `docs/PRODUCT\_CHANGE\_CONTROL.md` — standing change control rule

\- `docs/POSTPONED\_BACKLOG.md` — deferred items (auto-populated by the agent)

\- `docs/extraction-plan/` — outputs of PROMPT 0A

\- `docs/ARCHITECTURE.md` — created in Sprint 7

\- `docs/PRODUCT\_BASELINE.md` — created in PROMPT 0

\- `docs/CLAIMS\_REGISTER.md` — created in PROMPT 0 and updated through Sprint 8
