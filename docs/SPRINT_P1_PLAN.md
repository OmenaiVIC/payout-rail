# SPRINT_P1_PLAN.md — Pipeline Provider Routing (Plan)

**Status: PLAN ONLY — awaiting review. Nothing implemented.**
**Sprint source:** `docs/POSTPONED_BACKLOG.md` P-1 (also `docs/GAP_REGISTER.md` G-05 / C-01 carry-forward).
**Repo:** `payout-rail` (standalone; no CineX changes).

**Constraints for this sprint**

- No source file is modified by this plan; no commits; no network calls.
- Baseline must stay green: `npm test` → **268 tests, 15 suites, 267 pass, 0 fail, 1 skipped**.
- Tests may be changed only where they pin the exact boundary this sprint moves. No assertion is weakened or deleted; each changed assertion keeps its substantive claim and is called out in §8.
- No new runtime npm dependencies.
- Provider resolution must fall back to `yellowcard` when `PAYOUT_PROVIDER` is unset, and must **fail closed** (throw at startup) when it is set to a provider that cannot serve the NGN bank payout leg.
- The fail-closed property is load-bearing: an unresolvable provider must never degrade into "advance anyway".

---

## 1. Executive summary

P-1 is **wiring, not construction**. `bridgeAdapterFactory.js` already exports `getPayoutProvider()` (line 94) and `getPayoutAdapter()` (lines 102-103), and the payout adapters already share the interface the pipeline consumes (`submitSend` / `lookupSend` / `healthCheck` / `verifyWebhookSignature` / `classifyError`). What is missing is that the four pipeline modules never ask for the adapter — they read `ctx.adapters.yellowcard` directly — and the evidence chain stamps `yellowcard` and `hmac-sha256` as constants.

**Findings**

| # | Finding | Severity | Verification |
|---|---|---|---|
| F-1 | **Flutterwave must not be routable to the NGN payout leg.** `flutterwaveAdapter.js:9-25` states it disburses USDC to a POLYGON wallet (wire `currency: 'USDC'`, inverted `debit_currency`), that `ngn_recipient` has no wallet field to populate it from, and that "YELLOW CARD REMAINS THE PRIMARY NGN PAYOUT PROVIDER". Routing `submitSend` to it would record an NGN bank payout while delivering a different asset to a different destination. | **BLOCKER for D-P1-1** | `flutterwaveAdapter.js:1-55` |
| F-2 | P-1 is wiring: the factory resolver already exists and is unwired. | In-scope | `bridgeAdapterFactory.js:94,102` |
| F-3 | The backlog's "14 hard-coded sites" is a **prose superset**: only **5 executable adapter calls** exist. The rest are provider-key literals in refs/evidence, callback URL, webhook resolution, receipt detection. | In-scope (scope correction) | §5 |
| F-4 | `recordWebhookPayload` hardcodes `verification.method = 'hmac-sha256'`. Flutterwave uses a static `verif-hash` compare and Breet a static `x-webhook-secret` compare — neither is an HMAC of the body. Recording `hmac-sha256` for them is a **false evidence claim**, which is why Breet currently records nothing and a test pins that. | P1 defect | `evidenceCollector.js:279`; `breet-webhook-route.test.js:199` |
| F-5 | Webhook → disbursement resolution is Yellow Card-only (`external_refs.system='yellowcard' AND identifier_type='payout_id'`). Flutterwave resolves on `disbursements.idempotency_key`; Breet's payload shape is unknown. | In-scope | `disbursementService.js:488-540` |
| F-6 | `deriveWebhookEventId` reads `payload.event_id \|\| payload.reference` — a Yellow Card shape. Flutterwave's id is at `payload.data.id`; Breet is unknown. | In-scope | `evidenceCollector.js:123` |
| F-7 | `pickTransitionExternalRef` hardcodes `system: 'yellowcard'` whenever `details.payout_id` is present. | In-scope | `evidenceCollector.js:~359` |
| F-8 | `settlementReceipt` detects the payout leg by the string `'yellowcard'`, the transition `'yellowcard_payout_confirmed'`, and the regex `/yellowcard\|lookupSend/i`, and then **writes** `settlement_reference.provider = 'yellowcard'` unconditionally. A non-default provider's receipt would report a missing payout ref, report no confirmation, and misattribute the provider in a signed-facing document. | In-scope | `settlementReceipt.js:85,95,111,204,217` |
| F-9 | State names are Yellow Card-branded (`yellowcard_payout_submitted/_confirmed`) and are load-bearing in the CHECK constraint, state machine, workers, receipt, audit timeline, and monitoring queries. | **Out of scope** (decision D-P1-2) | `types.js:32-33`, `stateMachine.js:144,153` |

---

## 2. Scope decisions requiring sign-off

**D-P1-1 — Provider granularity: one active payout provider per process.**
The resolver keys off `PAYOUT_PROVIDER` (already implemented, default `yellowcard`). "Per corridor" today therefore means "per deployment". A true per-disbursement or per-currency map would need a schema column (currency → provider) that does not exist, plus a migration; that is a different sprint. **Recommendation: single-provider process, documented as such.**

**D-P1-2 — Keep the `yellowcard_payout_*` state names.**
They are wire values in a CHECK constraint and are read by the receipt, audit timeline, workers, and monitoring SQL. Renaming them is a migration plus a wide blast radius and buys nothing for routing. **Recommendation: keep them and document them as historical labels, not provider indicators.** The plan removes provider *assumptions* around them, not the names.

**D-P1-3 — Capability gate on the payout leg.**
Because of F-1, `PAYOUT_PROVIDER=flutterwave` must be a **startup error**, not a silently different product. Introduce a static capability map in the factory (`ngn_bank`: `yellowcard`, `breet`) and refuse an adapter that lacks the leg. Breet's membership in that map is structural (bank code + withdrawal PIN) but **UNVERIFIED against live docs** — flagged in §11.

**D-P1-4 — Evidence verification method is explicit, and the object shape does not change.**
`recordWebhookPayload` gains an optional `verification` argument: `{ ok, method }`. Omitting it preserves today's `{ ok: signatureValid === true, method: 'hmac-sha256' }`, so the Yellow Card path and its fixtures are untouched. Call sites pass the truthful method. **No new keys** (`scheme`, `integrity`, …) — `evidence-recorders.test.js` deep-equals `verification`, and additive keys would ripple through fixtures for no routing benefit.

**D-P1-5 — Breet webhooks stay "verified, recorded, not advanced".**
Its payload shape is undocumented offline, so P-1 will verify, record evidence with `method: 'x-webhook-secret'`, and return `advanced: false` with an explicit reason. Inventing a resolution key would be a guess against money movement.

**D-P1-6 — Flutterwave webhooks record evidence but do not advance.**
Today they return `{ processed: true, advanced: false }` and write **no** evidence. After this sprint they record truthful evidence. Advancing stays blocked until a real NGN-capable Flutterwave transfer path exists (backlog P-7).

---

## 3. Baseline (captured before any change)

```
npm test  →  268 tests, 15 suites, 267 pass, 0 fail, 1 skipped, ~8.5s
```

Pinned behaviors that must survive:

- `test/unit/flutterwave-provider-config.test.js:75` — "both payout adapters satisfy the same interface the pipeline consumes".
- `test/unit/flutterwave-provider-config.test.js:95` — adapters map mirrors `ensureInit()`.
- `test/unit/flutterwave-provider-config.test.js:99-111` — the consumption path is `ctx.adapters.yellowcard.submitSend` (this is the boundary this sprint moves; see §8).
- `test/unit/breet-webhook-route.test.js:199` — Breet records no evidence because the method would be a false claim (this assertion inverts; see §8).
- `test/unit/ngn-amount.test.js:122` — kobo convention `4_125_000` on the default path.

---

## 4. Current architecture (as verified)

```
ensureInit()                         src/index.js:39-49
  adapters = { stacks, xreserve, yellowcard, breet }     ← flutterwave deliberately absent
  ctx = { getDb, adapters, recipientRegistry, emitEvent, getLogger }   ← no provider field

payout leg
  destination_release_confirmed --submitYellowCardPayout--> yellowcard_payout_submitted
      transitionActions.js:359  ctx.adapters.yellowcard.submitSend(...)
  yellowcard_payout_submitted   --isPayoutConfirmed-------> yellowcard_payout_confirmed
      transitionGuards.js:183   ctx.adapters.yellowcard.lookupSend(...)
      transitionActions.js:391  ctx.adapters.yellowcard.lookupSend(...)
  reconciliation polls
      reconciliationWorker.js:241, 487  _ctx.adapters.yellowcard.lookupSend(...)

webhook ingress (each provider has its own route + its own verifier)
  /yellowcard  HMAC-SHA256 over body        → resolve via external_refs(yellowcard, payout_id) → advance
  /flutterwave static verif-hash compare    → resolve via idempotency_key              → evidence only
  /breet       static x-webhook-secret      → 200 verified, nothing recorded, nothing advanced
```

**Why `flutterwave` is absent from the adapters map** is documented at `src/index.js:23-31`: the hard-coded payout sites (see §5 — 20 numbered sites, 5 executable calls), plus the fact that its body is USDC-to-wallet rather than an NGN bank payout. This sprint fixes the first reason. It does **not** fix the second, which is why D-P1-3 gates it.

---

## 5. Exact site inventory

### 5a. Executable adapter calls — 5 (not 14)

| # | File:line | Call |
|---|---|---|
| 1 | `transitionActions.js:359` | `ctx.adapters.yellowcard.submitSend` |
| 2 | `transitionActions.js:391` | `ctx.adapters.yellowcard.lookupSend` |
| 3 | `transitionGuards.js:183` | `ctx.adapters.yellowcard.lookupSend` |
| 4 | `reconciliationWorker.js:241` | `_ctx.adapters.yellowcard.lookupSend` (SLA poll) |
| 5 | `reconciliationWorker.js:487` | `_ctx.adapters.yellowcard.lookupSend` (orphan / cross-wire) |

### 5b. Provider-key literals — 8

| # | File:line | Literal |
|---|---|---|
| 6 | `transitionActions.js:365` | `callback_url: .../api/bos/webhooks/yellowcard` |
| 7 | `transitionActions.js:368` | `upsertExternalRef(..., 'yellowcard', 'payout_id', ...)` |
| 8 | `transitionActions.js:375` | `recordApiResponse({ adapter: 'yellowcard', method: 'submitSend' })` |
| 9 | `transitionActions.js:390` | `getExternalRef(..., 'yellowcard', 'payout_id')` |
| 10 | `transitionActions.js:393` | `upsertExternalRef(..., 'yellowcard', 'payout_id', ...)` |
| 11 | `transitionActions.js:399` | `recordApiResponse({ adapter: 'yellowcard', method: 'lookupSend' })` |
| 12 | `transitionGuards.js:178` | `_getExternalRef(..., 'yellowcard', 'payout_id')` |
| 13 | `reconciliationWorker.js:246,257,268,282` | `recordPollResult({ adapter: 'yellowcard', externalIdType: 'payout_id' })` |
| 14 | `disbursementService.js:488-540` | webhook SQL `external_system='yellowcard'` + `recordWebhookPayload({ source: 'yellowcard' })` |

### 5c. Detection / evidence assumptions — 6

| # | File:line | Assumption |
|---|---|---|
| 15 | `evidenceCollector.js:279` | `verification.method: 'hmac-sha256'` hardcoded |
| 16 | `evidenceCollector.js:123` | `deriveWebhookEventId` = `event_id \|\| reference` |
| 17 | `evidenceCollector.js:~359` | `pickTransitionExternalRef` → `system: 'yellowcard'` |
| 18 | `settlementReceipt.js:85` | `external_system === 'yellowcard' && identifier_type === 'payout_id'` |
| 19 | `settlementReceipt.js:95,111` | `status.to === 'yellowcard_payout_confirmed'`; regex `/yellowcard\|lookupSend/i` |
| 20 | `settlementReceipt.js:204,217` | gap-evidence regex repeats the brand filter; `settlement_reference.provider` is written as `'yellowcard'` regardless of the ref's actual system |

**20 numbered sites, 5 of them adapter calls.** The "14" in the backlog counted a mix of call sites, argument literals, and evidence writes inside a few blocks. The plan drives off this table, not the count.

State-name strings (`reconciliationWorker.js:39,288,407,410`, `monitorJob.js:272`, `settlementReceipt.js:27-28,138,185`, `auditTimeline.js:29-30`) are **not** in the inventory: per D-P1-2 they remain.

---

## 6. Target design

### 6a. One resolution seam

Add to `bridgeAdapterFactory.js`:

```js
const PAYOUT_LEGS = Object.freeze({
  yellowcard: Object.freeze(['ngn_bank']),
  breet:      Object.freeze(['ngn_bank']),   // UNVERIFIED against live docs
  flutterwave:Object.freeze([]),             // USDC-to-wallet only (F-1)
});

export function assertPayoutLeg(provider, leg = 'ngn_bank') { /* throws ProviderCapabilityError */ }
export function resolvePayoutAdapter(ctx, leg = 'ngn_bank') {
  const provider = ctx.payoutProvider || getPayoutProvider();
  if (typeof ctx.getPayoutAdapter === 'function') return ctx.getPayoutAdapter(leg);
  return ctx.adapters?.[provider] ?? ctx.adapters?.yellowcard;   // legacy fallback
}
```

Precedence: injected `ctx.getPayoutAdapter` → `ctx.adapters[ctx.payoutProvider]` → `ctx.adapters.yellowcard`.

The last rung is what keeps **every existing test green with no edit**: `createTestCtx()` builds `adapters = { ..., yellowcard: createMockYellowCard() }` and sets no `payoutProvider`, so resolution lands on the same mock object the current code reads directly.

In `src/index.js`, `ensureInit()` additionally sets `payoutProvider: getPayoutProvider()` and `getPayoutAdapter: () => getPayoutAdapter()` on the ctx, and asserts the configured provider serves `ngn_bank` at startup. `flutterwave` stays **out** of the adapters map (D-P1-3); the map stays exactly `{ stacks, xreserve, yellowcard, breet }`, so `harness.test.js:88` is untouched.

`PAYOUT_PROVIDER` unset → `getPayoutProvider()` already returns `yellowcard`. Set-but-unknown → throw at init (already the factory's behaviour; verify in C1).

### 6b. Provider id travels with the payout

`submitPayout` resolves once and uses that id for all four things it currently hardcodes:

- the adapter call,
- `upsertExternalRef(..., provider, 'payout_id', ...)`,
- `recordApiResponse({ adapter: provider, ... })`,
- `callback_url: `${PAYOUT_API_BASE_URL}/api/bos/webhooks/${provider}``,
- and it returns `{ payout_id, amount_ngn, provider }` so the transition evidence can record it.

`confirmYellowCardPayout` reads the ref by the resolved provider (falling back to `yellowcard` for rows written before this sprint), and the guard reads the same. Rename `submitYellowCardPayout` → `submitPayout` and keep `export const submitYellowCardPayout = submitPayout` so the only importer (`stateMachine.js:144`) can move in the same commit without a flag day.

### 6c. Truthful evidence

`recordWebhookPayload({ ..., verification })` — optional, default unchanged (D-P1-4). Mapping:

| provider | `verification.method` | integrity |
|---|---|---|
| yellowcard | `hmac-sha256` | per-body HMAC |
| flutterwave | `verif-hash` | static shared secret |
| breet | `x-webhook-secret` | static shared secret |

`deriveWebhookEventId(payload, provider = 'yellowcard')` keeps the Yellow Card shape as the default and adds `flutterwave → payload.data.id`, `breet → null`. `pickTransitionExternalRef` reads `details.provider` and falls back to `'yellowcard'` for legacy rows.

### 6d. Webhook resolution becomes per-provider

Extract the evidence step from `handleYellowCardWebhook` and give each provider an identity function:

| provider | resolve target | key |
|---|---|---|
| yellowcard | `external_refs(system='yellowcard', identifier_type='payout_id')` | `payload.payout_id` |
| flutterwave | `disbursements.idempotency_key` | `payload.data.reference` (already implemented) |
| breet | none | UNVERIFIED — `advanced: false`, `reason: 'unresolved: breet payload shape not documented (P-1)'` |

The Yellow Card handler keeps its SQL for now (C2 only parameterizes it); the shared resolver arrives in C5.

### 6e. Receipt stops guessing by brand

- payout ref: the newest `external_refs` row with `identifier_type = 'payout_id'`, regardless of `external_system`.
- confirmation transition: `String(e.data?.status?.to).endsWith('_payout_confirmed')`.
- snapshot regex (both the confirmation probe at 111 and the gap-evidence list at 204): `/payout|lookupSend|send|transfer/i`.
- `settlement_reference.provider`: the resolved ref's `external_system` (falling back to `row.payout_provider` if a column is added later, else `'yellowcard'` for legacy rows), not the literal `'yellowcard'` at 217.

The receipt is a customer-facing document, so a wrong `provider` field is a correctness bug, not a cosmetic one: it names the counterparty in a payout proof.

---

## 7. Change list by file

| File | Change | Commit |
|---|---|---|
| `bridgeAdapterFactory.js` | `PAYOUT_LEGS`, `assertPayoutLeg`, `resolvePayoutAdapter`, `ProviderCapabilityError` | C1 |
| `src/index.js` | ctx gains `payoutProvider` / `getPayoutAdapter`; startup capability assert | C1 |
| `test/helpers/ctx.js` | optional pass-through of `payoutProvider` / `getPayoutAdapter` (defaults unchanged) | C1 |
| `transitionActions.js` | 359, 365, 368, 375, 390-393, 399 → resolved provider; `submitPayout` + alias; return includes `provider` | C2 |
| `stateMachine.js:144` | import rename | C2 |
| `transitionGuards.js` | 178, 183 → resolved provider | C3 |
| `reconciliationWorker.js` | 241, 487 + `recordPollResult` labels | C4 |
| `evidenceCollector.js` | 123 `provider` param; 279 `verification` param; ~359 `details.provider` | C5 |
| `disbursementService.js` | generalised webhook evidence + per-provider resolution (F-5) | C5 |
| `routes/webhooks.js` | pass provider + verification method into handlers | C5 |
| `settlementReceipt.js` | 85, 95, 111, 204, 217 brand-free detection and attribution | C6 |
| `docs/*` | A3.1, POSTPONED_BACKLOG, GAP_REGISTER, this file | C7 |

No schema migration. No dependency change. No adapter-module change.

---

## 8. Test plan

### 8a. New tests

| File | Asserts |
|---|---|
| `test/unit/payout-provider-routing.test.js` | precedence of the three resolution rungs; unset → yellowcard; unknown → throws; `assertPayoutLeg('flutterwave')` throws |
| `test/unit/payout-actions-routing.test.js` | with a fake `mockbank` adapter on ctx: `submitSend` lands there, `external_refs.system = 'mockbank'`, `recordApiResponse.adapter = 'mockbank'`, callback URL `/webhooks/mockbank`; `confirm` reads the ref back |
| `test/unit/payout-guard-routing.test.js` | guard uses the resolved adapter; `u8231`/`u8232`/`u8233` preserved |
| `test/unit/reconciliation-routing.test.js` | both poll sites use the resolved adapter; `recordPollResult` labels carry the provider |
| `test/unit/webhook-evidence-method.test.js` | per provider: `verification.method` is truthful; evidence is written for flutterwave/breet, state does not advance |
| `test/unit/settlement-receipt-provider-agnostic.test.js` | receipt resolves a `mockbank` payout ref and a `*_payout_confirmed` transition with no `yellowcard` string anywhere, **and** `settlement_reference.provider === 'mockbank'` |
| `test/integration/payout-routing.pg.test.js` | **real Postgres**: default provider end-to-end, plus one non-default provider with a stub adapter, asserting final state + evidence rows |

### 8b. Deliberate edits to boundary-pinning tests

| File:line | Today | After | Why not a weakening |
|---|---|---|---|
| `flutterwave-provider-config.test.js:99-111` | asserts the consumption path is `ctx.adapters.yellowcard.submitSend` | asserts the consumption path is `resolvePayoutAdapter(ctx).submitSend`, and that the default resolves to the Yellow Card mock | The substantive claim (the pipeline calls the reviewed interface on the configured adapter, not a second hard-wired one) is preserved and becomes the stronger statement |
| `breet-webhook-route.test.js:199` | asserts **no** evidence row, because the hardcoded method would lie | asserts **one** evidence row with `method: 'x-webhook-secret'`, and keeps `UPDATE disbursements = 0` | The invariant being protected is "no false evidence claim", not "no evidence"; the fix satisfies it by recording the truth |
| `harness.test.js:88` | deep-equals adapters keys | unchanged; add `payoutProvider === 'yellowcard'` | Additive only |

**Everything else must pass untouched**, including `ngn-amount.test.js:122`, `reconciliation.test.js:426`, `duplicate-handling.test.js:135`, `webhook-verify.test.js:212`, `settlement-receipt.test.js`, `public-api-receipt.test.js`, and `mock-lifecycle.e2e.test.js`. If one of them needs an edit, the design in §6a-6e is wrong and should be revised rather than the test.

### 8c. Gates

Per commit: `node --test test/unit/<area>.test.js` then full `npm test` (268+/0 fail, 1 skip). `npm run test:integration` locally **only if** a Postgres is reachable; otherwise the new `*.pg.test.js` is reported as UNVERIFIED in the commit message, not claimed green.

---

## 9. Commit sequence

| C | Subject | Content | Gate |
|---|---|---|---|
| C1 | `feat(bos): add payout adapter resolution seam` | factory capability map + resolver; ctx fields; startup assert. **No call site changes.** | full suite identical to baseline; new routing test |
| C2 | `refactor(bos): route payout submit/confirm through the seam` | transitionActions 359/365/368/375/390-399 + `submitPayout` alias + `provider` in return; stateMachine import | ngn-amount, duplicate-handling, preflight-guard, harness, e2e; new actions test |
| C3 | `refactor(bos): route payout guard through the seam` | transitionGuards 178/183; error codes unchanged | preflight-guard; new guard test |
| C4 | `refactor(bos): route reconciliation polls through the seam` | reconciliationWorker 241/487 + labels; SLA + escalate text unchanged | reconciliation (incl. 426); new poll test |
| C5 | `fix(evidence): record truthful webhook verification and provider identity` | evidenceCollector 123/279/359; disbursementService resolution; routes pass provider + method; update the two boundary tests | webhook-verify, yellowcard-webhook, breet-webhook*, flutterwave-contract, evidence-recorders, new method test |
| C6 | `fix(receipt): detect and attribute the payout leg without provider literals` | settlementReceipt 85/95/111/204/217 | settlement-receipt, public-api-receipt, e2e, new receipt test |
| C7 | `docs: close P-1` | `PROVIDER_ADAPTERS.md` A3.1 → implemented; `POSTPONED_BACKLOG.md` P-1 → DONE with commit range; `GAP_REGISTER.md` note; this plan → IMPLEMENTED | docs only |

Each commit is independently revertable. C5 depends on C1 (seam); C6 depends on C5 (provider id in refs); everything else is independent.

---

## 10. Risks

1. **Silent provider substitution** — mitigated by returning the provider id in the action result and asserting it in the new actions test.
2. **Callback URL drift** — the URL is provider-derived; a provider without a route would have its webhooks 404. Breet and Flutterwave routes exist; any future provider needs a route in the same commit.
3. **Evidence consumers** — `evidence-recorders.test.js` deep-equals `verification`; D-P1-4 forbids new keys, so the shape is stable.
4. **`details.provider` threading is unverified** (see §11). If the state machine does not forward the action result into transition details, C5 needs one extra hop; the fallback to `'yellowcard'` keeps legacy rows correct either way.
5. **Breet capability claim** — if Breet's API turns out not to be an NGN bank payout, `PAYOUT_LEGS.breet` must be emptied before release; the gate makes that a one-line change.

---

## 11. UNVERIFIED (resolve at the commit noted)

| Item | Where | Resolve at |
|---|---|---|
| Whether `details.provider` reaches `pickTransitionExternalRef` (does `stateMachine` forward the action's return into transition evidence details?) | `stateMachine.js` action wiring | C2 |
| Breet webhook payload shape and payout-id field | no offline doc | C5 (stays "not advanced" if unresolved) |
| Breet is genuinely an NGN bank payout provider (bank code + withdrawal PIN strongly suggest yes) | `breetAdapter.js:137-187` | C1 (D-P1-3) |
| Integration suite requires a live Postgres; cannot be executed offline | `test/integration/*.pg.test.js` | C2/C6 |
| Backlog's "14 sites" vs the 20 numbered sites in §5 | `docs/POSTPONED_BACKLOG.md` P-1 | C7 (correct the prose) |
| `getPayoutProvider()` behaviour for an unknown value (throw vs default) | `bridgeAdapterFactory.js:94` | C1 |

---

## 12. Explicitly not doing

- Renaming `yellowcard_payout_submitted` / `_confirmed` (D-P1-2).
- Making provider selection per-disbursement or per-currency (D-P1-1) — needs schema.
- Enabling Flutterwave as an NGN payout provider (F-1 / D-P1-3). That is P-7.
- Implementing a Breet payout resolution key from the docs we do not have (D-P1-5).
- Any change to the USDC/bridge leg, xreserve, or the Stacks adapters.
- Any schema migration, dependency addition, or change-control bypass.
