# Sprint 7 Plan — Open-Source Documentation Release

> Task: `docs/prompts/09_SPRINT_7_OPENSOURCE.md` (plan-first).
> Status: **PLAN ONLY — awaiting review. No implementation performed.**
> Baseline (verified this session): `npm test` → **184 tests, 183 pass, 0 fail, 1 skip**
> (1 skip = the Postgres-gated integration test `test/integration/disbursement-create.pg.test.js`).
> Constraints honored so far: no source changes, no commits, no network calls, no new deps.

---

## 0. What this sprint ships

A documentation-only release that makes Payout Rail externally readable and honest:

- Rewritten `README.md` carrying the project-concept positioning ("the last-mile payout layer
  for Stacks"), the customer segments, the corridor framing, the maturity statement, a
  claims/evidence table, and a quick start (demo command).
- Five new docs: `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/PROVIDER_ADAPTERS.md`,
  `docs/SECURITY.md`, `docs/DEVELOPMENT.md`.
- Maturity statement in README + SECURITY.md (exactly one truthful label: **Prototype**).
- Claims/evidence table in README, consolidated from `docs/CLAIMS_REGISTER.md`.
- Contradictory documentation updated or retired (see §6).

Scope out (unchanged from prompt): any code/API/test change, any adapter change, sprint 7.5
external-integrator work, sprint 8 grant package, new features, network calls, new runtime deps,
and any modification of `src/`, `migrations/` (SQL), `scripts/` (runner), or `test/`.

---

## 1. Canonical facts this sprint encodes (verified, not assumed)

Every document below is written against the following code truths, verified this session. Where a
finding contradicts an existing doc, the contradiction is resolved in the doc (or retired),
never by altering code.

| # | Fact | Source (verified) | Contradicted by |
|---|------|-------------------|-----------------|
| F1 | Disbursement states = **15** enum values | `src/services/bos/types.js:22-38`; both file headers already say "15 states" (`types.js:3`, `stateMachine.js:2`) | `docs/CLAIMS_REGISTER.md:20` "14 states", `:46-47` "13 states" (stale); README flow diagram is fine |
| F2 | Registered transitions = **48** (24 explicit + 24 generic) | `stateMachine.js:40-209`; runtime-verified: `getAllTransitions().length === 48`. The generic loop processes every non-`TERMINAL_STATES` state; `manual_review` is not terminal, so it additionally registers the `manual_review→manual_review` self-loop | `CLAIMS_REGISTER.md:25,46` "45 (23 explicit + 22 generic)" and "14 states, 45 transitions" (stale) |
| F3 | `BOS_PIPELINE_BATCH_SIZE` default = **25** | `pipelineWorker.js:19` | `README.md:48` (50), `.env.example:27` (50) — both marked FALSE in register but still in the files |
| F4 | Idempotency = deterministic key, implemented | `disbursementService.js:53-63` — `disbursement:<sha256(source_reference\|source_application\|amount_usdcx\|recipient_bank_account)>`; `UNIQUE(idempotency_key)` in `migrations/006_*`; tests `idempotency-key`, `duplicate-handling`, `public-api-idempotency` | `POSTPONED_BACKLOG.md` C-04 still listed as open MUST-FIX (now fulfilled) |
| F5 | `preflight_check` is a real enum state but the *linear* lifecycle has 14 progression states | `types.js:9-14` (canonical flow comment) + `:22-38` (enum) | resolvable wording: "15 states = 14-state lifecycle + preflight entry gate" |
| F6 | Yellow Card auth = `YcHmacV1 {apiKey}:{signature}` + `X-YC-Timestamp`, message = timestamp + pathname + method [+ base64(sha256(body))], signature base64; webhook HMAC accepts hex/base64/base64url | `docs/yellowcard-api-reference.md` (Sprint 3 acceptance baseline); `test/unit/yellowcard-*.test.js` (28 wire-contract tests, all pass) | `docs/PRODUCT_BASELINE.md` (baseline snapshot that predates Sprint 3 and still shows the auth as INCORRECT/OUTDATED) |
| F7 | Live/sandbox provider verification is **UNVERIFIED** — no credentials exist in this environment; G-20 blocks the Yellow Card sandbox loop permanently | `demo-payout-ngn.js` sandbox matrix (exit 2 on missing creds); `GAP_REGISTER.md` G-20 | nowhere — this is the honest baseline the docs must assert |
| F8 | Release destination is observed, never fabricated (G-08 model) | `types.js:40-45`; Sprint 2 amendment | `PRODUCT_BASELINE.md` no-op rows remain as history only |
| F9 | `npm test` = 184/183/0/1 (verified this session, Sprint 6 state) | `npm test` | README/DEVELOPMENT will assert this number |

Decision: **15 states** and **48 transitions** are the canonical numbers used across README,
ARCHITECTURE, and the refreshed claims register. Every stale count in `CLAIMS_REGISTER.md`
(F1/F2) is corrected there, because the register is a living document and its summary currently
misleads.

---

## 2. Doc matrix: updated vs new vs archived

### Created (5 new files)
1. `docs/ARCHITECTURE.md`
2. `docs/INTEGRATION.md`
3. `docs/PROVIDER_ADAPTERS.md`
4. `docs/SECURITY.md`
5. `docs/DEVELOPMENT.md`

### Updated
1. `README.md` — full rewrite (reframe, maturity, claims table, quick start, env table fix).
2. `docs/CLAIMS_REGISTER.md` — reconcile counts (F1/F2 → 15 states / 48 transitions), refresh the
   summary section that has gone stale (DEAD-list vs current import graph), correct the header
   ("Generated: 2026-09-21 · Sprint 0" → maintained through Sprint 7), and re-audit the
   "preserved-verbatim-but-DEAD" rows against the actual import graph (e.g. `fallbackPoller.js`
   was removed in Sprint 1.5; `webhookVerifier` was wired in Sprint 0.5/3).
3. `docs/POSTPONED_BACKLOG.md` — mark C-04 **fulfilled** (evidence: F4) rather than deleting the
   row; annotate C-01 with its current resolution status.
4. `.env.example` — change the stale `BOS_PIPELINE_BATCH_SIZE=50` example to the code default
   `25` and drop/annotate any removed poll vars. This is a config **example** (a doc artifact,
   not source); it is covered by the prompt's "remove contradictory documentation" instruction.

### Kept as historical record (not reframed, not linked as current)
- All `docs/SPRINT_*_PLAN.md` / `docs/SPRINT_*_REPORT.md`. The prompt explicitly treats sprint
  reports as historical records.
- `docs/yellowcard-api-reference.md` — a live technical reference; the acceptance baseline for
  Sprint 3. `PROVIDER_ADAPTERS.md` links to it.
- `docs/DEMO.md` — still accurately describes the runner (`real vs simulated`, sandbox exit 2).
  README quick start links to it.
- `docs/GAP_REGISTER.md` — live working register. G-01/G-02 remain open P0s and are reflected as
  known limitations in SECURITY.md / DEVELOPMENT.md.

### Archived in place (banner-marked historical, links preserved, README stops citing as current)
1. `docs/EXTRACTION_REPORT.md` — extraction-phase provenance. Add an ARCHIVED banner ("historical
   record of the Sprint 0 extraction; superseded by ARCHITECTURE.md/INTEGRATION.md"). README
   references it only as provenance, not as current. Keeping it in place (rather than moving to
   `docs/archive/`) preserves links from `ATTRIBUTION.md` and `migrations/001_bos_schema.sql`.
2. `docs/PRODUCT_BASELINE.md` — a Sprint-0 baseline snapshot that now contradicts current code
   (F6 auth rows are pre-Sprint-3; webhook-no-verification rows pre-Sprint 0.5/3). Banner it
   ARCHIVED with a one-line "superseded by" pointer; do not let it be treated as current.
3. `docs/COMMERCIAL_HYPOTHESIS.md`, `docs/PRODUCT_CHANGE_CONTROL.md`, `docs/grant/**` — untouched
   (strategy/process docs, not product docs).

Rationale for banner-in-place over deletion or `docs/archive/` move: git history already holds
the originals; banner-marking preserves inbound links with zero churn, satisfies "contradictory
docs must be updated or removed", and matches the prompt's "leave as historical record" posture.
The move-to-`docs/archive/` variant is available on request but is not recommended here.

---

## 3. Exact structure of each document

### 3.1 `README.md` (rewrite; root)

1. **Problem statement** — the one-sentence statement from `PROJECT_CONCEPT.md` (verbatim).
2. **What this is** — quote the blue-ocean position: "The last-mile payout layer for Stacks."
   One paragraph: emerging-market payout infrastructure; Nigeria is the first validated corridor,
   **not the product definition**.
3. **Who it's for** — customer segments verbatim from the strategy: marketplaces, DAOs, creator
   platforms, grant platforms, gaming ecosystems, freelance platforms, payroll systems, remittance
   products, agent-payment systems. Call out that the customer is the Stacks application, not the
   end user.
4. **Complementary, not competitive** — table: HermesBridge / Stackstream / sBTC Escrow / AgentPay
   (each: what it does, and what this layer adds — from the prompt's positioning section).
5. **What this layer does** — pipeline, state machine, evidence chain, reconciliation, v1 API,
   corridor config. One paragraph each, plain prose, no marketing.
6. **Status — maturity statement** (see §4) + one-line label.
7. **Claims/evidence table** (see §5) — the consolidation from CLAIMS_REGISTER for external
   readers, with a legend and a pointer to `docs/CLAIMS_REGISTER.md` for the full register.
8. **What it does NOT do** — explicit non-goals: not a bridge, exchange, custodian, fiat
   processor, or creative-financing product; not mainnet; no custody of keys/funds; no PII
   storage. (Grounds in ARCHITECTURE.md §"Not in the system".)
9. **Quick start** — `npm ci`, `npm test` (below), `npm run demo:payout:ngn` (demo mode,
   loopback, fully offline), and `--mode=sandbox` (fail-closed exit 2 without credentials).
   Output path note (`demo-output/receipt-<id>.json`, gitignored).
10. **Test status** — one line: 184 tests, 183 pass, 1 skip (Postgres-gated), verified Sprint 6.
11. **Environment reference** — corrected table from the real env surface: `BOS_API_TOKEN`,
    `BOS_PIPELINE_BATCH_SIZE` **default 25** (F3), `DEFAULT_USDCX_NGN_RATE` (1650), provider
    creds (bereflows pattern `YELLOW_CARD_*`, xReserve vars) — one row each, sourced from code,
    none fabricated. Poll vars are absent (removed Sprint 1.5).
12. **Documentation index** — links to the six docs + `DEMO.md`, `yellowcard-api-reference.md`,
    `CLAIMS_REGISTER.md`, `GAP_REGISTER.md`, plus a provenance sentence linking
    `EXTRACTION_REPORT.md` (historical).
13. **License** — MIT; provenance one-liner (extracted from CineX, attribution in
    `ATTRIBUTION.md`); contribution pointer → `docs/DEVELOPMENT.md`.

### 3.2 `docs/ARCHITECTURE.md` (new)

1. **System context & boundaries** — ASCII component diagram: v1 API → disbursement service →
   state machine (guards + actions) → evidence recorders / audit / receipt; adapters (Stacks,
   xReserve, Yellow Card) at the external boundary; worker-per-tick loop.
2. **The state machine** — the 15 states (F1), the 48 transitions (F2; 24 explicit + 24 generic; the
    generic loop also registers a `manual_review→manual_review` self-loop because `manual_review` is
    not in `TERMINAL_STATES`), a transition table (from → to, trigger, guard, action) rendered from §F,
    terminal states (`settled`, `failed`, `cancelled`, `manual_review`), and the `preflight_check`
    entry gate (F5). Explain the chaining behavior of the observation states (release leg, G-08/F8).
3. **The evidence chain** — `gate_result` records, the canonical `transition` record, audit log,
   6 evidence recorders (webhook, poll, manual-note, api, tx-hash, gate), `reconciliation_detection`,
   settlement receipts. Present as the security/audit property (expanded in SECURITY.md).
4. **The reconciliation layer** — internal evidence vs provider `external_refs`; amount/state
   reconciliation; the Sprint 6 demo's `gaps: []` result (what it proves and doesn't).
5. **The adapter boundary** — interface shape, error taxonomy (permanent vs transient),
   signature helpers; what lives inside vs outside the layer (F7 honesty for each adapter).
6. **Public API surface** — endpoint inventory (summary only; full schemas in INTEGRATION.md).
7. **In the system / not in the system** — explicit lists; "not in the system" covers: custody,
   key management, ledger ownership, a scheduling SLA, auth for the integrator's own end users,
   mainnet execution.
8. **Known limitations** — G-01 (fail-open preflight audit) and G-02 (schema/code mismatch) as
   recorded-but-open P0s, with pointers to GAP_REGISTER.

### 3.3 `docs/INTEGRATION.md` (new)

1. **Integration summary** — what another Stacks application must run and provide; the contract
   in one screen.
2. **v1 API reference** — each endpoint (create, advance, get, receipt, retry, recover, webhook
   receivers), method, path, request/response JSON schema, error codes, `POST` conditions note.
3. **Authentication boundary** — `BOS_API_TOKEN` bearer; fail-closed; no default/backdoor tokens
   (dev escape hatch deleted — the demo exercises the fail-closed path).
4. **Idempotency contract** — the deterministic key (F4), why duplicates collide, what the caller
   must reuse (`source_reference` etc.), UNIQUE constraint behavior, retry semantics.
5. **Observation obligations** — what the app must supply for burn/attestation/release evidence
   and webhook harvesting (G-08: observe, never fabricate).
6. **Worked walkthrough** — the create → stepwise advance → receipt flow against the loopback
   demo, using the Sprint 5 example client (`examples/simple-payout-client`), with a concrete
   25 USD → NGN example and the expected receipt `final_status: settled`.
7. **Sandbox vs demo vs production posture** — what exists today (demo, loopback only;
   sandbox gated on credentials) and what does not (no mainnet path).

### 3.4 `docs/PROVIDER_ADAPTERS.md` (new)

1. **Adapter interface** — the contract an adapter must satisfy (methods, error classification,
   signing/verifying, evidence emission).
2. **Current adapters** (each with a status line from the claims table):
   - **Stacks** — burn + attestation observation; status.
   - **xReserve** — USDC bridge; release *observation* surface (G-08, F8); UNVERIFIED external.
   - **Yellow Card** — Sends API; `YcHmacV1` auth (F6); submit/lookup/payout-status/webhook;
     wire-contract tested (28 tests); **sandbox UNVERIFIED** (no credentials, G-20).
3. **What is UNVERIFIED and why** — the honest table (per adapter: claimed surface, evidence in
   repo, live/sandbox evidence, blocker). Lead with: no provider credentials exist in this
   environment, so **no adapter has SANDBOX-VERIFIED status**.
4. **Adding a new adapter** — steps and conventions (interface, classifyError, sign/verify,
   evidence, tests, corridor wiring).
5. **Configuring a new corridor** — rate pair (e.g. `USDCx/NGN`, `DEFAULT_USDCX_NGN_RATE`),
   currency minor-unit convention (NGN kobo; `computeAmountNgnExpected`),
   recipient registry mode, gates, breaker; NGN = validated, KES/ZAR = configuration-proven,
   sandbox-verification-pending (per COMMERCIAL_HYPOTHESIS).
6. **References** — `docs/yellowcard-api-reference.md`, test files.

### 3.5 `docs/SECURITY.md` (new)

1. **What the layer does and does not custody** — no private keys, no funds, no directly-identifying
   PII (evidence records use hashes; PESTLE posture). The integrator holds keys and executes
   on-chain actions.
2. **Authentication model** — bearer token, fail-closed, no backdoor.
3. **Fail-closed behavior** — unconfigured secrets reject; missing/invalid signatures reject
   (verified by tests); the sandbox runner exits non-zero; the known fail-open gap (G-01) is
   disclosed here with its evidence location.
4. **Evidence chain as a security property** — immutable-ish append-only audit, `gate_result`
   pre-flight checks, idempotency against double-spend, webhook HMAC verification (both
   `YcHmacV1` request auth and `x-yc-signature` payload verification, encodings hex/base64/
   base64url — tested).
5. **Network posture** — tests are offline; demo is loopback-only; no inbound exposure assumptions.
6. **Maturity statement** (repeated from README, §4) + explicit non-claims: no compliance
   certification, no production security certification, not for real funds/beneficiary data.
7. **Known limitations** — G-01, G-02 (P0, recorded), G-07/U (live sandbox unverified via G-20),
   pointer to GAP_REGISTER.

### 3.6 `docs/DEVELOPMENT.md` (new)

1. **Prerequisites** — Node 18+, npm, no Postgres required for the suite.
2. **Run the tests** — `npm ci`, `npm test` → expect 184/183/0/1; note the single Postgres-gated
   skip; `--test-concurrency=1` note for reproducibility.
3. **Run the demo** — `npm run demo:payout:ngn`, `--mode=sandbox`, `--output-dir`, receipt output.
4. **Repository layout** — `src/services/bos/**`, `src/routes/disbursementsV1.js`, `scripts/`,
   `examples/simple-payout-client/`, `migrations/`, `test/`, `docs/`.
5. **Contributing** — in scope: evidence-backed fixes to the open P0s (G-01/G-02) via the change
   control process, new adapters, new corridor configs, doc corrections; **out of scope**:
   mainnet enablement, campaign/escrow/verification modules, unverified provider claims, silent
   claim upgrades.
6. **Sprint discipline** — plan-first (`SPRINT_N_PLAN.md` reviewed before implementation),
   evidence per sprint (`SPRINT_N_REPORT.md`), registers (CLAIMS/GAP/POSTPONED), change control
   classification (A–E; D/E → POSTPONED_BACKLOG), scope-conflict → STOP-and-report.

---

## 4. Maturity statement (exact text)

Label (README + SECURITY.md):

> **Maturity: Prototype — sandbox-ready interfaces.**

Full statement (byte-consistent in README §6 and SECURITY.md §6 — same paragraph):

> Payout Rail is **prototype** software. The pipeline, the 15-state machine, the evidence chain,
> the v1 public API, and the Nigeria (NGN) corridor are implemented and covered by 183 passing
> automated tests, but no external adapter has been verified against a live or sandbox provider
> (no provider credentials exist in this environment — G-20), and no external application has
> used the layer. **Do not use Payout Rail to move real funds or handle real beneficiary data.**

This is the single, unconditional label the prompt requires; no qualifiers, no marketing.

---

## 5. Claims/evidence table content (for README)

Consolidated from `docs/CLAIMS_REGISTER.md` for external readers. Classification key:
IMPLEMENTED / TESTED / VERIFIED / SANDBOX VERIFIED / MOCKED / PLANNED / UNVERIFIED.

| Claim | Classification | Evidence (in repo) |
|-------|----------------|--------------------|
| End-to-end NGN payout lifecycle (USDCx → NGN, created → settled) | IMPLEMENTED + TESTED | `src/services/bos/**`; demo-runner test reaches `settled`, receipt `final_status: settled`, `gaps: []` |
| 15-state disbursement state machine (14-state lifecycle + preflight entry gate), 48 transitions | IMPLEMENTED + TESTED | `types.js:22-38`; `stateMachine.js:40-209` (24 explicit + 24 generic, incl. the `manual_review→manual_review` self-loop); runtime check `getAllTransitions().length === 48`; transition tests |
| Worker-per-tick pipeline processing | IMPLEMENTED + TESTED | `pipelineWorker.js:100-152` |
| Pre-flight financial gates (2PA, amount tolerance, daily/per-disbursement caps, circuit breaker, whitelist, attributable funds, beneficiary payload) | IMPLEMENTED + TESTED | `payout_gates`; Sprint 6 demo: 8 `gate_result` records all `passed: true` |
| Deterministic idempotency (C-04) | IMPLEMENTED + TESTED | `disbursementService.js:53-63`; `migrations/006` `UNIQUE(idempotency_key)`; `idempotency-key`, `duplicate-handling`, `public-api-idempotency` tests |
| Evidence chain (transition records, 6 recorders, audit log, receipts, reconciliation detection) | IMPLEMENTED + TESTED | Sprint 4 (G-16/G-17 closed); demo receipt output |
| Fail-closed bearer auth (`BOS_API_TOKEN`) | IMPLEMENTED + TESTED | no backdoor token; demo runs the fail-closed path; auth tests |
| v1 public API (create/advance/get/receipt/retry/recover, webhooks) | IMPLEMENTED + TESTED | `disbursementsV1.js`; Sprint 5 client tests; demo drives through the real router |
| Stacks adapter (burn + attestation observation) | IMPLEMENTED + TESTED (mocked) | adapter + unit tests; **no live/sandbox evidence** |
| xReserve adapter (USDC bridge, release observation) | MODEL CORRECTED (G-08) / UNVERIFIED EXTERNAL | observation surface is a fail-closed stub; no credentials |
| Yellow Card adapter (Sends API, `YcHmacV1` auth) | IMPLEMENTED + TESTED (wire-level vs documented reference) | `yellowcard-api-reference.md`; 28 wire-contract tests pass; **live/sandbox UNVERIFIED (no credentials — G-20)** |
| Provider live/sandbox verification (any adapter) | UNVERIFIED | no credentials exist in this environment |
| Adoption by an external Stacks application | PLANNED | Sprint 7.5 (external integrator example) |
| Mainnet readiness | PLANNED / OUT OF SCOPE | strategy: mainnet out of scope for the grant |
| Known open P0 gaps (G-01 fail-open preflight; G-02 schema/code mismatch) | KNOWN GAP (recorded, not claimed fixed) | `GAP_REGISTER.md` |

Every classification above is pulled verbatim-class from the register (except F1/F2 count
 corrections, which this sprint reconciles). No claim is upgraded without the register's evidence
 bar ("No claim is upgraded merely because the code looks plausible").

---

## 6. Obsolete documentation — resolution list

| Doc | Current problem | Action |
|-----|-----------------|--------|
| `README.md` | Still opens as "BOS payout subsystem extracted from the CineX backend" (extraction framing); env default 50 vs code 25; "28+ transitions" undercount | Rewrite (§2/§3.1) |
| `docs/CLAIMS_REGISTER.md` | Header still says "Sprint 0 · Discovery only"; state counts 13/14 vs 15; transition count 45 vs 48; DEAD-summary may be stale vs import graph | Refresh + reconcile (F1/F2), re-audit summary |
| `docs/PRODUCT_BASELINE.md` | Pre-Sprint-3 snapshot contradicts current code (auth, webhook verification) | ARCHIVED banner + "superseded by ARCHITECTURE.md" pointer |
| `docs/EXTRACTION_REPORT.md` | Extraction-phase doc; only provenance remains relevant | ARCHIVED banner; README cites only as provenance |
| `docs/POSTPONED_BACKLOG.md` | C-04 listed as an open MUST-FIX but fulfilled in code (F4) | Mark fulfilled w/ evidence; keep row |
| `.env.example` | `BOS_PIPELINE_BATCH_SIZE=50` contradicts code (25) | Correct line 27 comment value to 25 (comment-only, D3); no poll vars present, nothing else changes |
| `docs/yellowcard-api-reference.md` | None (current, Sprint 3 baseline) | Keep; linked from PROVIDER_ADAPTERS.md |
| `docs/DEMO.md`, `docs/GAP_REGISTER.md`, `docs/COMMERCIAL_HYPOTHESIS.md`, `docs/PRODUCT_CHANGE_CONTROL.md`, `docs/grant/**` | None | Keep untouched |
| `docs/SPRINT_*_PLAN/REPORT.md` | Historical record | Keep, unlinked from README as "current" |

---

## 7. Deviations from the plan, with reason

1. **Canonical state/transition counts** — README and register default to **15 states / 48
   transitions** (code truth, F1/F2) rather than the register's stale "14/45" or README's
   "28+ transitions". Reason: the code is authoritative; the docs must agree with it.
2. **`CLAIMS_REGISTER.md` refresh is in scope** — the prompt asks only to *consolidate from* the
   register, but its counts and DEAD-summary now contradict the code it documents, which the
   prompt's "remove contradictory documentation" instruction requires fixing. Scope is limited to
   reconciliation + summary accuracy; the register's per-row evidence format is untouched.
3. **`.env.example` gets corrected (not counted as code)** — it is a config example artifact, and
   it currently asserts the false default that README historically repeated. If the user prefers
   to treat it as code-adjacent and out of scope, drop it; README env table is still fixed.
4. **Archive via banner, not `docs/archive/` move** — preserves inbound links in `ATTRIBUTION.md`
   and `migrations/001_bos_schema.sql`; zero link churn; satisfies "removed or updated".
5. **Maturity label is exactly one: Prototype** — "testnet/sandbox/production" would overclaim
   (no live/sandbox verification exists, G-20); "Prototype — sandbox-ready interfaces" matches
   the prompt's suggested truthful answer.
6. **No mdcp shard config introduced** — the `mdcp` skill is relevant, but the repo has no
   `mdcp.config.json` and the prompt's scope is a fixed doc set. Introducing a docs-as-code layer
   is a structural change best done as a follow-up with its own plan, not smuggled into Sprint 7.
   Flagged here so the reviewer can opt in if desired.
7. **Open P0 gaps are documented, not hidden** — G-01/G-02 remain open; SECURITY.md/DEVELOPMENT.md
   name them as known limitations and contribute-in-scope items. Documenting a gap is not
   claiming it; the claims table marks them KNOWN GAP, never fixed.
8. **Sprint reports stay put, README stops citing them as current** — matching the prompt; the
   README documentation index points at the six docs + DEMO + registers, not sprint history.

---

## 8. Implementation sequencing & commits (one commit per logical group)

1. **Commit 1** — `docs/SPRINT_7_PLAN.md` (this file, after review).
2. **Commit 2** — `docs/ARCHITECTURE.md` + `docs/INTEGRATION.md` (core technical story; cross-ref
   each other).
3. **Commit 3** — `docs/PROVIDER_ADAPTERS.md` + `docs/SECURITY.md` (boundary + security posture;
   maturity statement lands here and in README together).
4. **Commit 4** — `docs/DEVELOPMENT.md`.
5. **Commit 5** — `README.md` rewrite (positioning, maturity, claims table, quick start, env fix)
   + `.env.example` correction in the same commit (they must not diverge).
6. **Commit 6** — register reconciliation: `CLAIMS_REGISTER.md` + `POSTPONED_BACKLOG.md` (C-04
   fulfilled) + archive banners on `PRODUCT_BASELINE.md` / `EXTRACTION_REPORT.md`.
7. **Verification** — `npm test` (must remain 184/183/0/1, unchanged); `git diff --stat` showing
   zero `src/|migrations/|scripts/|test/` changes; README link check.
8. **Commit 7** — `docs/SPRINT_7_REPORT.md` (evidence: final rendered README, doc set list, test
   run, the fact table F1–F9 re-verified at sprint end, blockers section if any arose).

---

## 9. Acceptance criteria mapping

| Acceptance | How satisfied |
|------------|---------------|
| README opens with PROJECT_CONCEPT problem statement + last-mile framing | §3.1.1–3.1.4 |
| Customer segments named | §3.1.3 |
| "Nigeria is the first validated corridor, not the product" | §3.1.4 |
| Complementary-to-HermesBridge framing | §3.1.4 table |
| Five new docs complete | §3.2–3.6 |
| Maturity statement truthful, in README + SECURITY.md | §4 |
| Claims/evidence table in README | §5 |
| Contradictory docs updated/removed | §6 |
| `npm test` still passes unchanged | §8 step 7 |
| No code modified / no new runtime deps / no network calls | checked at verification step §8.7 |

---

## 10. Stop point

Per the sprint prompt's working method: **stop after the plan**. This plan is produced;
implementation does not begin until the user reviews and approves.

Proceed / revise / or hold.