CONSTRAINT: This is a discovery-and-mapping phase only. Do NOT write, move, copy, or delete any files yet. Produce only the three required documents (EXTRACTION\_MAP.md, REPOSITORY\_BOUNDARY.md, EXTRACTION\_GAP\_REGISTER.md) in a scratch folder called docs/extraction-plan/. Stop after producing those documents and wait for my review.



PROMPT 0A — CINE X PRESERVATION + PAYOUT RAIL EXTRACTION

Role

Act as the Senior Technical Product Manager, CTO, and Principal Software Architect responsible for extracting the existing payout-orchestration functionality from the CineX codebase into a new, independent open-source infrastructure repository.

The product being extracted will be referred to provisionally as:

Payout Rail

Its underlying architectural component/service may continue to be called:

BOS — Bridge Orchestration Service

Do not treat "Payout Rail" as a final legal or commercial brand name. It is the working product/repository name for this development phase.



1\. CRITICAL PRODUCT-BOUNDARY RULE

CineX is NOT being replaced.

CineX is a separate strategic product that must be preserved.

The existing CineX repository contains the broader creative-financing product and its associated intellectual property, architecture, contracts, project logic, financing logic, creative-sector functionality, and other components.

The purpose of this task is NOT to convert CineX into a payout product.



The purpose is to:

Extract the reusable payout-orchestration subsystem from CineX into a new independent repository so that it can be developed, tested, documented, released, and potentially reused independently.

This distinction is mandatory.

DO NOT:

convert the CineX repository into Payout Rail

delete CineX creative-financing functionality

remove CineX contracts merely because Payout Rail does not need them

rewrite CineX's README to describe Payout Rail

rename CineX

archive CineX

strip CineX down to the payout layer

destructively refactor CineX for the benefit of Payout Rail

assume that CineX is obsolete

remove creative-financing dependencies from the original CineX repository

make changes to CineX solely to satisfy Payout Rail requirements

Unless explicitly authorized later, CineX is a protected source product.



2\. FUTURE REINTEGRATION IS INTENTIONAL

The future possibility of integrating Payout Rail back into CineX is explicitly preserved.

The intended long-term relationship may eventually become:

CineX

Creative Financing Application

&#x20;       |

&#x20;       | integrates with

&#x20;       v

Payout Rail

Reusable Payout Orchestration Infrastructure



CineX may eventually consume Payout Rail for payout and settlement functionality.

However:

Future reintegration is OUT OF SCOPE for this project.

Do not implement reintegration now.

Do not modify CineX merely to prepare for reintegration.

Instead, design Payout Rail with clean interfaces and provider-agnostic boundaries so that a future application—including CineX—could consume it without requiring CineX-specific dependencies.



3\. SOURCE AND DESTINATION

Source

The current CineX repository is the source from which the existing BOS/payout implementation will be extracted.

Treat the current CineX repository as the source of truth for identifying what currently exists.

Do not assume that everything described in previous documentation still exists exactly as described.

Inspect the actual repository.

Destination

Create/use a separate repository for Payout Rail.

Working repository name:

payout-rail



The final GitHub repository name may be changed later after product naming is finalized.

After extraction, all substantive Payout Rail development must occur in the new repository.



4\. EXTRACTION PRINCIPLE

This is an extraction and decoupling exercise, not a blind copy and not a rewrite.

First identify:

What code constitutes the existing payout/BOS implementation.

What CineX-specific functionality it currently depends upon.

What dependencies can be extracted cleanly.

What dependencies need replacement with standalone interfaces.

What dependencies are unrelated to Payout Rail.

What code is incomplete, experimental, mocked, obsolete, or misleading.

What functionality must be preserved exactly during extraction.

What functionality should be redesigned only after the extraction baseline is established.

Do not redesign the entire system during extraction.



5\. REQUIRED EXTRACTION AUDIT

Before making structural changes, inspect the relevant CineX codebase and produce an extraction map.

At minimum identify:

Core orchestration

payout lifecycle

state machine

transition guards

actions

workers

queues/jobs if present

retry logic

timeout logic

failure handling

manual-review handling

Settlement

Stacks integration

USDCx integration

withdrawal/settlement tracking

external settlement assumptions

xReserve-related code

transaction tracking

polling

reconciliation

Local payout

Yellow Card integration

NGN payout logic

recipient/bank handling

payout status

webhooks

HMAC/signature handling

idempotency

provider errors

Supporting infrastructure

persistence

database models

configuration

environment variables

logging

monitoring

evidence/audit records

API routes

types/interfaces

tests

fixtures

mocks

documentation



6\. DEPENDENCY CLASSIFICATION

For every dependency discovered between BOS and CineX, classify it as one of:

A — Reusable

The component can move into Payout Rail with little or no conceptual change.

B — Extractable

The component is useful but currently coupled to CineX and must be refactored into a standalone implementation.

C — CineX-specific

The component belongs to creative financing and must remain in CineX.

D — Replaceable

The BOS implementation currently depends on a CineX component that should be replaced by a generic Payout Rail interface.

E — Obsolete/unused

The dependency is no longer required.

F — Unknown

The purpose or correctness cannot yet be established.

Do not silently resolve "Unknown" dependencies by guessing.

Record them.



7\. PRESERVE CINE X

During this sprint, treat the original CineX repository as protected.

Before modifying anything:

establish the current repository state

inspect the Git status

identify the current branch

identify relevant commits

identify uncommitted changes

identify the BOS/payout directories/files

record the extraction boundary

Do not destroy or overwrite existing CineX work.

If a clean extraction requires a temporary copy or working branch, use one.

If repository operations could risk existing user work, STOP and report the risk before proceeding.



8\. CREATE THE NEW PAYOUT RAIL REPOSITORY

Create the new repository/workspace from the identified BOS implementation.

The resulting repository must eventually be capable of existing independently of CineX.

The new repository should not require:

CineX frontend

CineX creative-financing contracts

CineX project models

CineX creative profiles

CineX investor/funder marketplace

CineX campaign logic

CineX milestone-financing business logic

CineX-specific UI



unless a dependency is explicitly demonstrated to be part of the reusable payout infrastructure.



9\. NO PREMATURE CLEANUP

Do not immediately delete suspicious code.

During extraction, preserve enough of the existing implementation to understand what it does.

First:

Inspect

→ Map

→ Classify

→ Extract

→ Verify

→ Then refactor



Do not perform a large architectural rewrite simply because the existing code is imperfect.

The next sprint will establish the technical baseline and identify what should be rebuilt.



10\. PRODUCT IDENTITY AFTER EXTRACTION

The new repository must be understandable without knowledge of CineX.

A developer opening the Payout Rail repository should be able to understand:

what it does

what problem it solves

what it does not do

what inputs it receives

what settlement events it tracks

how payout providers are integrated

how state transitions work

how evidence is recorded

how errors and retries work

how to run tests

how to run the eventual demo

Do not write marketing claims yet.

Do not claim production readiness.

Do not claim live settlement.

Do not claim live Yellow Card transactions.

Do not claim verified external settlement unless evidence exists.



11\. CURRENT PRODUCT SCOPE

The extracted product is intended to become:

Reusable payout-orchestration infrastructure connecting Stacks application settlement to local payout rails, initially validated through the USDCx → external settlement → NGN corridor.

The product is an orchestration layer.

It is NOT:

a bridge

an exchange

a custodian

a bank

a fiat processor

a consumer wallet

a remittance company

a crypto exchange

a creative-financing application

a CineX replacement



12\. FUTURE CINE X INTEGRATION

Do not implement this now.

However, ensure the architecture can eventually support:

CineX

&#x20;   |

&#x20;   | create payout request

&#x20;   v

Payout Rail

&#x20;   |

&#x20;   | settlement orchestration

&#x20;   v

Stacks / USDCx

&#x20;   |

&#x20;   v

External settlement

&#x20;   |

&#x20;   v

Local payout provider

&#x20;   |

&#x20;   v

Recipient



This future relationship must influence interface quality, but must NOT expand the current implementation scope.



13\. REQUIRED OUTPUT OF THIS SPRINT

Before proceeding to the technical baseline, produce:

docs/EXTRACTION\_MAP.md

Document:

CineX source location

BOS source location

extracted components

retained components

CineX dependencies

dependencies removed

dependencies replaced

unresolved dependencies

files/modules moved

files/modules intentionally not moved

known risks

extraction assumptions

docs/REPOSITORY\_BOUNDARY.md

Document:

CineX owns:

The creative-financing application and all CineX-specific functionality.

Payout Rail owns:

Reusable payout-orchestration infrastructure.

Future integration:

Possible, but not part of this project.

docs/EXTRACTION\_GAP\_REGISTER.md

Record every unresolved issue discovered during extraction.

Classify each as:

P0 — blocks safe extraction

P1 — blocks core functionality

P2 — important but non-blocking

P3 — later improvement



14\. HARD GATE

Do NOT proceed to Sprint 0 technical baseline until:

The new Payout Rail working repository exists.

The relevant BOS implementation has been extracted/copied into it.

CineX remains preserved.

CineX-specific creative-financing functionality has not been destructively removed.

The repository boundary is documented.

The extraction map exists.

Major CineX dependencies have been identified.

The new repository can be inspected independently.

No unsupported production or integration claims have been introduced.

If any of these conditions cannot be established, STOP and report the blocker.



15\. FINAL RULE

The strategic principle for this entire project is:

We are not abandoning CineX to build Payout Rail. We are extracting a reusable infrastructure capability from CineX so that both products can eventually exist independently and Payout Rail can later be integrated back into CineX if appropriate.

Preserve the asset.

Extract the infrastructure.

Build the infrastructure independently.

Do not destroy the source product.





