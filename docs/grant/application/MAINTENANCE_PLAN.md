\# Maintenance Plan — Payout Rail



> Application document. Answers "Maintenance plan" from the Stacks Endowment Getting Started application.

> Not a sprint deliverable. Part of the grant application package.



\## Team structure



Payout Rail is maintained by a small team with defined roles and an explicit succession path. The project is not a single point of failure.



\*\*Victor Omenai — Lead Maintainer\*\*

\- Principal engineer and architect of the layer

\- Responsible for: architectural decisions, sprint execution, release management, community engagement

\- Led the extraction from CineX and delivered Sprints 0.5 through 7.5

\- Available for the full duration of the grant



\*\*McDaniells Albert — Co-Maintainer\*\*

\- Co-developer on the CineX project until the previous grant cycle concluded

\- Available for part-time contribution during the grant period; may become full-time co-maintainer after current commitments conclude

\- Responsible for: adapter work, integration testing, contribution review



\*\*Jacob Momoh — Senior Advisor and Fallback Maintainer\*\*

\- Senior engineer with production experience

\- Trusted technical reviewer and long-standing collaborator of the lead maintainer

\- Responsible for: architectural review, security review, and continuity if the lead or co-maintainer cannot continue

\- Role is structured to be asynchronous — Jacob can contribute from any location



\## Succession path



If any team member becomes unavailable during the grant period, the following applies:



| Scenario | Action | Timeline impact |

|---|---|---|

| McDaniells unavailable for a milestone | Victor delivers solo; McDaniells returns as commitments allow | None |

| Victor unavailable for a milestone | Jacob reviews and approves; execution continues via contributors | None for documentation; 2 weeks for hands-on engineering |

| Victor and McDaniells both unavailable | Jacob takes over as interim lead | 4 weeks for hands-on engineering; none for documentation |



The project is designed to survive any single contributor's absence.



\## What this team structure means for the grant



\- The grant funds a small team, not a solo effort. Each milestone names who delivers it and who reviews it.

\- The budget reflects this. A portion is allocated to senior review and a portion to execution, so both have dedicated time.

\- The work plan shows distributed responsibility. No milestone depends on a single person's continuous availability.



\## How issues are handled



\*\*Issue triage\*\*

\- Issues are opened via GitHub Issues

\- The primary maintainer triages within 7 days

\- Issues are classified as: bug, feature request, documentation, security, or out-of-scope

\- Out-of-scope issues are closed with a pointer to `docs/POSTPONED\_BACKLOG.md`



\*\*Bug fixes\*\*

\- Critical bugs (funds at risk, security, data corruption): fixed within 72 hours

\- Non-critical bugs: fixed in the next scheduled release

\- Bugs that require external provider credentials to verify: labelled `UNVERIFIED` until credentials exist



\*\*Security issues\*\*

\- Security issues are handled through GitHub's private vulnerability reporting

\- No public disclosure until a fix is available

\- Disclosed vulnerabilities are documented in a `SECURITY.md` changelog



\*\*Feature requests\*\*

\- Feature requests are evaluated against the product scope in `docs/grant/strategy/PROJECT\_CONCEPT.md`

\- Requests that expand scope go to `docs/POSTPONED\_BACKLOG.md`

\- Requests that align with the current roadmap are scheduled into the next sprint



\## What support users can expect



\*\*Documentation\*\*

\- The repository README is the front door

\- `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/PROVIDER\_ADAPTERS.md`, `docs/SECURITY.md`, and `docs/DEVELOPMENT.md` cover the system in depth

\- The demo runner (`npm run demo:payout:ngn`) provides a runnable reference



\*\*Community support\*\*

\- GitHub Issues for questions and bug reports

\- No paid support tier during the grant period

\- Response expectations: 7 days for non-critical issues, 72 hours for critical



\*\*What is not supported\*\*

\- Production deployment assistance

\- Regulatory or compliance guidance

\- Provider credential provisioning

\- Custom feature development



\## How maintenance is funded after the grant



Three paths, in order of preference:



1\. \*\*Follow-on grants\*\* — if the project demonstrates traction during the grant period (external integration, sandbox validation), a Builder Track grant would fund production hardening

2\. \*\*Ecosystem partnership\*\* — if a Stacks ecosystem participant (a wallet, a marketplace, a payments project) adopts the layer, maintenance could be co-funded

3\. \*\*Distributed self-funding\*\* — the project is small enough that a three-person team can maintain it at low cost indefinitely. No hosted services, no paid dependencies, no external infrastructure.



\## What happens if maintenance stops



If maintenance must stop, the following are true:



\- The code remains available under MIT license

\- Anyone can fork and continue

\- The test suite is complete enough that a new maintainer can verify the system works without the original author

\- The documentation is written for strangers, not insiders

\- The evidence chain and settlement receipts are self-describing



The project is designed to be survivable. It does not depend on the original author's continued involvement.



\## Review and updates



This maintenance plan is reviewed at the end of each milestone. If the project's shape changes materially during the grant period, this document is updated and the change is noted in the sprint report.

