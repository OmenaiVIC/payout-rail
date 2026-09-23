# Payout Rail

Payout Rail is an open-source orchestration layer that connects Stacks applications' on-chain settlement to reliable local fiat payouts in emerging markets, validated first through the Nigeria/NGN corridor.

> **The last-mile payout layer for Stacks.**

Payout Rail is emerging-market payout infrastructure. Stacks applications settle programmable, dollar-denominated value on-chain; Payout Rail turns that settled value into reliable local fiat payouts. **Nigeria is the first validated corridor — not the product definition.** The architecture is corridor-agnostic by design: additional corridors (Kenya/KES, South Africa/ZAR, and others) are adapter additions, not product rewrites.

---

## 1. Who it's for

The customer is **the Stacks application that needs to pay people** — not the end user. Named segments:

- Marketplaces settling seller earnings
- DAOs and contributor platforms distributing rewards
- Creator platforms paying out to creators
- Grant platforms disbursing to grantees
- Gaming ecosystems paying out to players
- Freelance and work platforms paying contractors
- Payroll and reward systems
- Remittance and agent-payment products
- Fintech and crypto applications in emerging economies integrating Stacks

The end user is the person receiving the value: someone in Nigeria who earned $50 worth of on-chain value and wants ₦ to arrive in their bank account.

## 2. Complementary, not competitive

Payout Rail does not compete with Stacks payment primitives — it completes them:

| Primitive | What it does | What Payout Rail adds |
|---|---|---|
| HermesBridge | Brings USDC liquidity *into* Stacks | Moves value *out* to local payout rails |
| Stackstream | Streams on-chain payments | Converts a settled payout into a local fiat delivery |
| sBTC Escrow | Holds value conditionally on-chain | Dispatches the released value to a real-world destination |
| AgentPay / agent-payment projects | Initiate payments | Records the payout's lifecycle with audit-grade evidence |

The gap is not another payment primitive. The gap is the orchestration layer that connects them all to the local rails where real people receive real value.

## 3. What this layer does

- **The pipeline** — a worker-per-tick loop advances every non-terminal disbursement one step at a time through its lifecycle, with idempotency and optimistic concurrency preventing double-execution.
- **The state machine** — 15 states (a `preflight_check` entry gate plus the 14-state payout lifecycle) and 48 transitions (24 explicit + 24 generic), with guards and actions per edge, terminal states `settled` / `failed` / `cancelled`, and a `manual_review` human-in-the-loop path.
- **The evidence chain** — every successful transition writes a canonical evidence record; gate results, webhooks, polls, API calls, manual notes, and tx hashes are appended as records, with settlement receipts reconstructed from stored evidence only.
- **The reconciliation layer** — internal evidence is reconciled against provider `external_refs`; amount/state drift is detected and routed to `manual_review` rather than silently corrected.
- **The v1 public API** — idempotent create, advance, receipt, retry, recover, approve and resolve, behind fail-closed bearer auth, with a normalized error contract.
- **Corridor configuration** — rate pairs, recipient-registry mode, gates, and circuit-breaker settings per corridor; NGN is implemented and covered by tests, KES/ZAR are configuration-proven.

## 4. Status — maturity

> **Maturity: Prototype — sandbox-ready interfaces.**

> Payout Rail is **prototype** software. The pipeline, the 15-state machine, the
> evidence chain, the v1 public API, and the Nigeria (NGN) corridor are
> implemented and covered by 183 passing automated tests, but no external adapter
> has been verified against a live or sandbox provider (no provider credentials
> exist in this environment — G-20), and no external application has used the
> layer. **Do not use Payout Rail to move real funds or handle real beneficiary
> data.**

## 5. Claims and evidence

Consolidated from [`docs/CLAIMS_REGISTER.md`](docs/CLAIMS_REGISTER.md) for external readers.
Classification key: **IMPLEMENTED / TESTED / VERIFIED / SANDBOX VERIFIED / MOCKED / PLANNED / UNVERIFIED / KNOWN GAP**.

| Claim | Classification | Evidence (in repo) |
|---|---|---|
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

See [`docs/CLAIMS_REGISTER.md`](docs/CLAIMS_REGISTER.md) for the full register with per-row evidence, and [`docs/GAP_REGISTER.md`](docs/GAP_REGISTER.md) for the open gaps.

## 6. What it does NOT do

- Not a bridge, exchange, custodian, fiat payment processor, or creative-financing product.
- Not a live production system — **not mainnet**.
- Not a custodian: **no keys, no funds, no PII storage** (evidence holds hashes and sanitized summaries only).
- Not a provider of fiat-processing licenses or a claim of regulatory compliance.
- Not a multi-corridor production system — Nigeria first, others configured.

Grounding: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §"Not in the system".

## 7. Quick start

```bash
npm ci
npm test        # 184 tests, 183 pass, 1 skip (Postgres-gated); no Postgres, credentials, or network needed
npm run demo:payout:ngn                # demo mode — loopback, fully offline, in-process mocks only
npm run demo:payout:ngn -- --mode=sandbox   # fail-closed: exits 2 without credentials rather than running
```

- Default mode drives the real v1 router and pipeline to `settled` with an empty receipt `gaps` array — success is never fabricated.
- Output goes to `demo-output/receipt-<id>.json` (gitignored). Pass `--output-dir <dir>` to relocate it.

## 8. Test status

184 tests, 183 pass, 1 skip (the Postgres-gated integration case), verified unchanged in Sprint 6. The suite runs offline against an in-repo `FakeDb` with mock adapters — zero infrastructure.

## 9. Environment reference

All values below are read from the environment (`.env`); tokens are environment-only, never in code or the repository. See `.env.example`.

| Variable | Purpose | Default |
|---|---|---|
| `BOS_API_TOKEN` | Bearer token required for the disbursement API; unset → all requests rejected (fail closed) | — |
| `BOS_PIPELINE_BATCH_SIZE` | Max disbursements advanced per pipeline tick | `25` |
| `BOS_PIPELINE_INTERVAL_MS` | Pipeline worker tick (ms) | `30000` |
| `DEFAULT_USDCX_NGN_RATE` | Seed exchange rate when the rate table is empty | `1650` |
| `BOS_RECIPIENT_REGISTRY` | `permissive` → permissive registry; anything else → null registry (rejects by default) | `null` |
| `BOS_DAILY_PAYOUT_CAP_USD` / `BOS_MAX_PER_DISBURSEMENT_USD` | Financial gate caps | `10000` / `1000` |
| `YELLOW_CARD_API_URL` / `YELLOW_CARD_API_KEY` / `YELLOW_CARD_SECRET_KEY` / `YELLOW_CARD_ENV` / `YELLOW_CARD_WEBHOOK_SECRET` | Yellow Card provider adapter (Sends API, `YcHmacV1`) | — |
| `XRESERVE_PROTOCOL_CONTRACT` / `XRESERVE_WEBHOOK_SECRET` | xReserve bridge adapter | — |
| `PAYOUT_*` | Stacks burn leg (network, Hiro API, USDCx contract, signing key, callback base) | per network |
| `BRIDGE_ADAPTER_ENV` | Adapter selection (`xreserve` / `mock`) | `xreserve` |

Poll variables (`BOS_POLL_INTERVAL_MS` / `BOS_MAX_POLL_ATTEMPTS`) were removed in Sprint 1.5 and do not exist. The dev auth backdoor (`BOS_ALLOW_UNAUTHENTICATED_DEV`) was removed in Sprint 3 and does not exist.

## 10. Documentation

| Doc | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System context, the 15-state / 48-transition machine, the evidence chain, reconciliation, worker model |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | The v1 API, error contract, webhooks, idempotency, actors, auth |
| [`docs/PROVIDER_ADAPTERS.md`](docs/PROVIDER_ADAPTERS.md) | Adapter boundary, current adapters and their veracity, adding an adapter, corridor configuration |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Custody model, auth, fail-closed behavior, evidence as security property, known limitations |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Prerequisites, test/demo commands, repo layout, contributing scope, sprint discipline |
| [`docs/DEMO.md`](docs/DEMO.md) | The NGN payout demo runner |
| [`docs/CLAIMS_REGISTER.md`](docs/CLAIMS_REGISTER.md) | Every claim, classified, with its evidence |
| [`docs/GAP_REGISTER.md`](docs/GAP_REGISTER.md) | Open gaps and their fix direction |
| [`docs/POSTPONED_BACKLOG.md`](docs/POSTPONED_BACKLOG.md) | Deferred work and classified out-of-scope items |
| [`docs/yellowcard-api-reference.md`](docs/yellowcard-api-reference.md) | The Yellow Card Sends reference the wire-contract tests compile against |

Provenance: Payout Rail was extracted from the CineX project; the extraction-time record is archived in [`docs/EXTRACTION_REPORT.md`](docs/EXTRACTION_REPORT.md) (historical). Sprint plans and reports under `docs/` are historical records and are not references to current behavior.

## 11. License

MIT. Extracted from the CineX project (provenance and attribution in [`ATTRIBUTION.md`](ATTRIBUTION.md)). Contributions: see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for scope and process.