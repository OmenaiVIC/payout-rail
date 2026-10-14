# Sprint Breet Webhook Verifier — PLAN (revision 3, approved — four corrections applied)

> Mode: APPROVED FOR IMPLEMENTATION. Revision 2 was approved with four corrections;
> this revision applies them, plus a **revised Step 0**: the live Breet sandbox
> capture is **deferred** (mock-trade trigger unreachable for this account tier —
> see §8), so tests run against a **synthetic, explicitly UNVERIFIED** fixture. No
> `.env` read/write; `process.env.BREET_*` by name only; no secret value in any
> test, fixture, log, or commit.

---

## 0. Review disposition (revision 2 approved, four corrections)

The review returned **Option A + Option B, not A or B**:

- **A** — add the isolated `POST /api/bos/webhooks/breet` route and its tests:
  **approved**.
- **B** — correct the false "no verifier branch" claim in `SESSION_HANDOFF.md` and
  `PROVIDER_ADAPTERS.md`: **also required**, as a separate docs-correctness commit.

Revision 2 was approved with **four corrections applied in this revision**:

1. **Sandbox capture is step 0 — with a revised Step 0.** The §8 capture was to run
   at the very start of Phase 4, *before any test is written*. The live capture is
   **deferred**: Breet's sandbox mock-trade trigger is unreachable with the provided
   credentials (docs disagree on the required `X-Breet-Env`; see §8). Tests therefore
   run against a **synthetic, explicitly UNVERIFIED** fixture (§6 test 4). The
   formerly conditional commit 5 (pin-to-captured-shape) stays **removed**; pinning
   is deferred to backlog **P-8**, not a conditional commit.
2. **No handler in `disbursementService.js`.** The route returns its response body
   inline; `disbursementService.js` is **not touched** this sprint. The proposed
   `handleBreetWebhook` is dropped.
3. **Fixed response body.** Success is exactly
   `{ processed: true, advanced: false, reason: 'breet webhook verified; payload
   resolution and state advance deferred to P-1' }`. Failure uses the **same error
   envelope as the existing Flutterwave route** —
   `{ processed: false, reason }` (verified against `src/routes/webhooks.js`).
4. **Commit order** is (1) route tests RED, (2) route GREEN, (3) docs correction,
   (4) sprint report — with `npm test`, `git show --stat HEAD`, and `git push origin
   main` between each, stopping on any failure.

---

## 1. STOP-AND-REPORT: the verifier is already on the canonical surface

`PRODUCT_CHANGE_CONTROL.md` requires stopping and reporting when a requirement
conflicts with the actual state. It does.

The sprint goal is "add a Breet webhook verifier to the canonical verification
surface." **That verifier already exists there at HEAD, and is already tested and
passing.** The prior repair (`9f7bd7d`) reverted the Breet *route* in
`src/routes/webhooks.js` but left the Breet *verifier branch* in
`src/services/bos/webhookVerifier.js` intact; the two governing docs were never
updated to match.

Evidence (verify against the working tree, not against any recorded hash):

| Claim | Actual repository evidence |
|---|---|
| "Breet has no verifier branch" (`SESSION_HANDOFF.md:72`) | `webhookVerifier.js:10` `getBreetSecret()`; `:110-129` `verifyBreetWebhook(...)`; `:142-143` `case 'breet':`; `:154` export |
| (same, `PROVIDER_ADAPTERS.md:159-165`) | identical branch present |
| Breet webhook tests exist | `test/unit/breet-webhook.test.js` — 6 tests, all pass in the baseline run |
| Breet has "no route today" | **TRUE** — `git grep -i "webhooks/breet\|'/breet'"` returns nothing; `webhooks.js` registers only `/yellowcard`, `/yellowcard/test`, `/flutterwave` |

Consequence: the verifier deliverable is already met; the genuinely missing
artifact is the **route**. The reviewer has now approved adding it (A) and
correcting the stale docs (B).

---

## 2. Baseline (recorded, not trusted from docs)

- **HEAD:** re-run `git rev-parse HEAD` immediately before Phase 4. A hash written
  into a doc goes stale on the very next commit (the handoff is the cautionary
  example: it names a HEAD one commit behind itself, and "frozen" counts that no
  longer hold). This plan therefore cites the *command*, not a frozen value.
  Planning-time output, presented as ephemeral: `eeeb1f7`, `origin/main`
  identical, working tree clean at that moment.
- `npm test`: **259 tests, 258 pass, 0 fail, 0 cancelled, 1 skip** (the
  Postgres-gated `G-02 (integration)` case, skipped because `TEST_DATABASE_URL` is
  unset). Re-run `npm test` to confirm before starting; do not trust this count.
- Breet-relevant passing tests in the baseline: `test/unit/breet-webhook.test.js`
  (6), `test/unit/breet-contract.test.js` (8, incl. `verifyWebhookSignature`),
  `test/unit/breet-provider-config.test.js` (2).

---

## 3. Required reading — findings

1. **`src/services/bos/webhookVerifier.js` (canonical verifier).** The Breet branch
   already exists: `getBreetSecret()` (`:10`), `verifyBreetWebhook(rawBody, headers)`
   (`:110-129`), dispatcher `case 'breet'` (`:142-143`), and the export (`:154`).
   **No export needs to be added or extended.** The sprint constraint forbids
   modifying existing functions here, so this file must remain byte-for-byte
   unchanged.
2. **`src/services/bos/breetAdapter.js`.** `verifyWebhookSignature(payload,
   signature, secret)` (`:69-80`) does a static shared-secret
   `crypto.timingSafeEqual` compare, defaults the secret from
   `envWebhookSecret()` → `BREET_WEBHOOK_SECRET` read **at call time** (`:12`),
   and returns `false` when secret or signature is absent or lengths differ
   (fail closed). Contract tests at `breet-contract.test.js:168-184` cover it.
3. **`src/routes/webhooks.js` (route registration pattern).** Verify-first helpers
   `verifyRequest` (`:29-35`) and `verifyFlutterwaveRequest` (`:38-44`) read
   `req.rawBody` (a Buffer captured by `express.json({ verify })`), reject
   `raw_body_unavailable`, then call the canonical verifier. Routes: `/yellowcard`
   (`:52-65`), `/yellowcard/test` (`:72-84`, admin-gated), `/flutterwave`
   (`:107-120`). Mounted at `src/index.js:105` → `app.use('/api/bos/webhooks',
   webhooksRouter)`. Handlers are imported from
   `../services/bos/disbursementService.js` (`:22`). **No Breet route exists.**
   The Breet route needs no handler import — it returns its body inline.
4. **`test/unit/breet-webhook.test.js`.** 6 tests over `verifyBreetWebhook` and the
   dispatcher (accept / mismatch / missing / unset-secret / dispatch breet /
   yellowcard-flutterwave regression). **Must not be edited.**
5. **Regression guards that must keep passing:** `test/unit/webhook-verify.test.js`
   (G-06, Yellow Card route, 6 tests) and `test/unit/flutterwave-webhook.test.js`
   (28 tests incl. cross-talk guard). Both green in the baseline.
6. **`docs/breet-api-reference.md` — the scheme IS documented.** §"Webhook
   Verification" (`:73-75`): header `x-webhook-secret` compared against
   `BREET_WEBHOOK_SECRET` "using timing-safe comparison. Fail closed if unset." See
   §4.
7. **`docs/PROVIDER_ADAPTERS.md` §2 Breet (`:143-181`) and §3.1 (`:200-223`).**
   Records the prior failure (`3903653` broke the Flutterwave/Yellow Card routes;
   reverted) and the additive-only constraint. §3.1 documents that a non-HMAC
   scheme (Flutterwave `verif-hash`) has **no payload integrity and no replay
   protection**, so the load-bearing control must be the local `idempotency_key`
   UNIQUE constraint. Breet's `x-webhook-secret` shares that exact weakness.

---

## 4. Breet webhook signature scheme (precise)

**It is a STATIC SHARED SECRET compared as a plain string in constant time. It is
NOT HMAC-over-body, and it is NOT a function of the body.**

- Header: `x-webhook-secret`.
- Secret: env `BREET_WEBHOOK_SECRET`.
- Compare: `crypto.timingSafeEqual(Buffer(signature), Buffer(secret))` after a
  length check; reject when unset (fail closed).
- Sources: `docs/breet-api-reference.md:73-75` (documented scheme);
  `src/services/bos/breetAdapter.js:69-80` (adapter implementation);
  `src/services/bos/webhookVerifier.js:110-129` (canonical implementation).
- **Security delta (must be documented, not hidden):** exactly the Flutterwave
  `verif-hash` weakness — authenticates the sender only, gives **no payload
  integrity** (a forged body with a valid secret verifies) and **no replay
  protection** (a captured request replays forever). Reuse of `verifyHmac` is
  impossible and would be wrong. Treat `BREET_WEBHOOK_SECRET` as a rotating
  credential; never log it or the header.

---

## 5. Exact change per file (A + B; review-gated)

### 5.1 Commit plan (one logical fix per commit)

**Step 0 (before any commit):** attempt the §8 real-sandbox capture. **Outcome: the
capture is DEFERRED** — Breet's mock-trade trigger is unreachable with the provided
credentials (§8). Tests are therefore written against a **synthetic fixture marked
UNVERIFIED** against a real Breet delivery. **No replay script is written this
sprint.** The capture attempt and its blocker are recorded in this plan and the
report; the upgrade to a verified fixture is tracked as backlog **P-8**.

The commit set is **five commits**, with the plan committed first so history reads
honestly (plan authorizes → tests drive → code → doc corrections → report):

0. `docs: add Sprint Breet Webhook plan`
   — `docs/SPRINT_BREET_WEBHOOK_PLAN.md` (this file) only.
1. `test: add failing Breet webhook route tests (RED)`
   — new `test/unit/breet-webhook-route.test.js` only, written against the synthetic
   documented-shape fixture.
2. `feat: add isolated POST /api/bos/webhooks/breet route (GREEN)`
   — `src/routes/webhooks.js` **new code only**: a `verifyBreetRequest` helper, the
   `/breet` route, and one new import (`verifyBreetWebhook`). **No
   `disbursementService.js` change.** The route returns the success body inline.
3. `docs: correct stale "no Breet verifier branch" claims`
   — `docs/SESSION_HANDOFF.md` + `docs/PROVIDER_ADAPTERS.md`. Argued as **one
   logical fix** (the same false claim, two files); split into two commits if the
   reviewer prefers.
4. `docs: add Sprint Breet Webhook report` —
   `docs/SPRINT_BREET_WEBHOOK_REPORT.md` + the **P-8** entry in
   `docs/POSTPONED_BACKLOG.md`.

**Push gates (`origin/main` must never carry a failing suite; RED is held locally):**

- **Commit 0:** `npm test` 0 failures (unchanged baseline) → `git show --stat HEAD`
  only the plan file → `git push origin main`.
- **Commit 1 (RED):** `npm test` **fails by design**. Run it and confirm the only
  failures are the new file; `git commit` — **do NOT push.**
- **Commit 2 (GREEN):** `npm test` 0 failures → `git show --stat HEAD~1 HEAD` (commits
  1 and 2 together touch only the files this plan names) → push **commits 1+2
  together**.
- **Commits 3 and 4** (docs, each green on its own): normal per-commit gate —
  `npm test` 0 failures → `git show --stat HEAD` → `git push origin main`.

**Do not squash.** Commit 1 must remain a distinct RED commit in history — it is the
evidence the tests exercise real behavior and were not written to match the
implementation. There is **no conditional commit 5**. If any pushed `origin/main`
ever shows a failing suite, that is a sprint-blocking bug: **STOP and report.**

### 5.2 File-by-file

| File | Change | New lines / location |
|---|---|---|
| `docs/SPRINT_BREET_WEBHOOK_PLAN.md` | **ADD** the approved sprint plan (this file). | new |
| `src/routes/webhooks.js` | **ADD** `verifyBreetRequest(req)` (mirror of `verifyFlutterwaveRequest`, reads `req.rawBody`, delegates to `verifyBreetWebhook`). **ADD** `router.post('/breet', ...)` (verify-first → 401 on failure → **return the success body inline**). **ADD** one new import (`verifyBreetWebhook`). **Do not touch** `verifyRequest`, `verifyFlutterwaveRequest`, `/yellowcard`, `/yellowcard/test`, `/flutterwave`, or the export. | helper after `:44`; route after `:120`; import at `:22-23` |
| `test/unit/breet-webhook-route.test.js` | **CREATE** (new file). See §6. | new |
| `docs/SESSION_HANDOFF.md` | **(B)** Correct `:71-75` to state the verifier branch **is** present and tested; only the route was absent. | `:71-75` |
| `docs/PROVIDER_ADAPTERS.md` | **(B)** Correct `:159-165` (and the §3 matrix row `:194`) to match reality. | `:159-165`, `:194` |
| `docs/POSTPONED_BACKLOG.md` | **ADD** backlog item **P-8**: obtain a real Breet webhook capture once the mock-trade trigger is resolvable, and upgrade the route's fixture from synthetic to verified. | new section after `P-7` |

**No `disbursementService.js` change (correction 2).** The route is the whole
surface: it verifies, then returns the truthful verified body **inline**:

```
{ processed: true, advanced: false,
  reason: 'breet webhook verified; payload resolution and state advance deferred to P-1' }
```

There is no `handleBreetWebhook`. If P-1 later needs a seam, a handler can be
extracted then — not now.

**Failure envelope mirrors Flutterwave exactly (correction 3).** The existing
`/flutterwave` route returns
`res.status(401).json({ processed: false, reason: verification.reason || 'invalid_signature' })`
(`src/routes/webhooks.js:110-112`). `/breet` uses the **identical** envelope.

**Change-control classification:** route + tests = **A**; doc corrections + backlog
= **B**. No C/D/E work; deferred items live in `POSTPONED_BACKLOG.md`.

### 5.3 Credentials / `.env` discipline (new, per review)

- **Do not read or write `.env`.** The credentials are the user's.
- The code may reference `process.env.BREET_*` **by name** only — never print, log,
  or persist their values, and never copy them into a file in the repo.
- No secret value, header value, or credential may appear in a test, fixture,
  log, or commit.

---

## 6. Tests — file, and assertions per test

New file `test/unit/breet-webhook-route.test.js`, mirroring the harness in
`flutterwave-webhook.test.js` (real Express app, `express.json({ verify })`
raw-body capture, `FakeDb`, mock adapters, ephemeral loopback listener — **no
external network**). Existing files are **not** edited.

**Fixture is SYNTHETIC and UNVERIFIED.** No live Breet delivery was captured (§8);
the fixture matches the shape the docs describe and is marked, in-file, as
UNVERIFIED against a real Breet delivery. The route does not parse fields (P-1
blocked), so this is sufficient to prove acceptance of the documented shape.

**Failure envelope (must mirror Flutterwave exactly).** The existing
`/flutterwave` route returns
`res.status(401).json({ processed: false, reason: verification.reason || 'invalid_signature' })`
(`src/routes/webhooks.js:110-112`). The `/breet` route uses the **identical**
envelope; tests 1–3 and 8 assert both the status and the exact
`{ processed: false, reason }` shape.

**Success body (fixed by correction 3).** Every successful response is exactly
`{ processed: true, advanced: false, reason: 'breet webhook verified; payload
resolution and state advance deferred to P-1' }`.

Verifier-level cases are already covered by `breet-webhook.test.js` and are **not**
duplicated here.

1. **unset secret → 401 `no_secret_configured`, no state touched.**
   Assert status 401, body deep-equals `{ processed: false, reason:
   'no_secret_configured' }`, zero `UPDATE disbursements`.
2. **missing `x-webhook-secret` → 401 `missing_signature`.** Assert the exact
   envelope `{ processed: false, reason: 'missing_signature' }`. No writes.
3. **mismatched secret → 401 `invalid_signature`.** Assert the exact envelope
   `{ processed: false, reason: 'invalid_signature' }`. No writes.
4. **exact secret match → 200 with the exact fixed body.**
   Post the **synthetic fixture** (documented shape, marked UNVERIFIED in-file — no
   live Breet delivery was captured, §8) with the matching secret. Assert status 200
   and **deep-equal** the body to exactly:
   `{ processed: true, advanced: false, reason: 'breet webhook verified; payload
   resolution and state advance deferred to P-1' }`; plus
   `db.countMatching(/UPDATE disbursements/) === 0` and zero
   `INSERT INTO disbursement_evidence`. This test asserts an **exact** shape
   (deep-equal, not field spot-checks) so any future reason-string or field drift
   fails loudly.
5. **body is not part of the comparison (pins the documented weakness).** Two
   different bodies, same secret → both 200 with the exact fixed body. Pins the
   absence of payload integrity so a future "fix" cannot silently change the
   contract.
6. **replay is harmless.** Post an identical request 3× → each 200, exact fixed
   body, still zero writes (the route holds no state). When P-1 lands and advance
   becomes real, this must move to a `test/integration/` idempotency-constraint
   test.
7. **regression guard — existing routes unaffected (the required guard).**
   In one test: (a) Yellow Card HMAC-signed payload still 200 and advances to
   `YELLOWCARD_PAYOUT_CONFIRMED`; (b) Flutterwave `verif-hash` payload still 200;
   (c) a `verif-hash` does **not** authenticate `/breet` (401); (d) an
   `x-webhook-secret` does **not** authenticate `/flutterwave` or `/yellowcard`
   (401). Cross-talk between the three schemes is a vulnerability and is asserted
   absent.
8. **raw body unavailable fails closed.** A request whose body the JSON parser did
   not capture (non-Buffer `req.rawBody`) → `{ valid: false, reason:
   'raw_body_unavailable' }` → 401 with the exact envelope
   `{ processed: false, reason: 'raw_body_unavailable' }`.

Skill alignment: follow `tdd` (one red → minimal green → repeat; no bulk tests of
imagined behavior; assert at the route/verifier seam). Use
`webhook-handler-patterns` order (verify → parse → handle idempotently) and the
`idempotent-financial-workflows` guardrail that the **signature is not the
idempotency control** — the `idempotency_key` UNIQUE constraint is.

---

## 7. Deviations from the prior state, with reason

1. **Prior docs said "no verifier branch."** Reality: it exists and is tested.
   Reason: `9f7bd7d` reverted only `webhooks.js`; the docs were never reconciled.
   Repository evidence is authoritative (00_MASTER principle 1).
2. **The verifier goal is literally already met.** Consequence of (1). The plan
   delivers the route (A) and fixes the docs (B).
3. **No modification to `webhookVerifier.js`.** The existing branch satisfies the
   canon and the constraint forbids touching it.
4. **No handler in `disbursementService.js` (correction 2).** The route returns the
   verified body inline; `disbursementService.js` is untouched this sprint. This
   keeps the change to a single source file (`src/routes/webhooks.js`) plus tests
   and docs.
5. **Live sandbox capture deferred (revised Step 0, §8).** The mock-trade trigger
   is unreachable with the provided credentials and Breet's docs contradict each
   other on `X-Breet-Env`. Tests use a synthetic UNVERIFIED fixture; the verified
   upgrade is backlog **P-8**.

---

## 8. Phase 4 Step 0 — Sandbox capture ATTEMPTED, then DEFERRED

Breet sandbox credentials **exist in this environment** (the user holds them). The
intent (correction 1) was to capture a real Breet sandbox delivery at the very
start of Phase 4, before writing any test, and pin the route + fixture to that
shape. **That capture could not be performed**, so this section records the
attempt, the blocker, and the fallback actually taken.

**Step 0 attempt — the mock-trade trigger is unreachable (Breet-side blocker).**
Attempts to trigger a real Breet sandbox event hit only errors:

- `sandbox` + `asset="TRX_TEST"` → **404 "wallet not found"** (the wallet does
  exist per `GET /trades/wallets`, `isActive=true`).
- `sandbox` + `asset=<asset id>` → **500-class error**.
- `development` + `asset="TRX_TEST"` → **500-class error**.
- `development` on other endpoints → **401 "wrong app id and secret combination"**.

Breet's own docs **contradict each other** on which `X-Breet-Env` value the
mock-trade endpoint requires. This is a Breet-side blocker, not ours.

**Revised Step 0 (the fallback actually taken):**

- **Do not wait for a capture.** Proceed to commit 1 (RED). No test is blocked on a
  live delivery.
- **Design the route to accept any JSON body.** It verifies `x-webhook-secret`,
  returns the honest `{ processed: true, advanced: false, reason: ... }` body, and
  **does not parse fields** (P-1 blocked).
- **Write all tests against a SYNTHETIC fixture** matching the shape the docs
  describe, with an in-file comment marking the fixture as **UNVERIFIED against a
  real Breet delivery**.
- **Do NOT write a sandbox replay script.** The previously proposed
  `scripts/breet-webhook-sandbox-check.mjs` is **not created** this sprint.
- **Record in the plan and the report:** *"Breet webhook payload shape is
  UNVERIFIED — no live sandbox delivery captured. Breet's mock-trade endpoint is
  unreachable with the provided sandbox credentials; documented inconsistency in
  Breet's docs on the required `X-Breet-Env` value. Sandbox validation deferred to a
  follow-up once Breet support resolves the trigger."*
- **Add backlog item P-8** (`docs/POSTPONED_BACKLOG.md`, §5.2): obtain a real Breet
  webhook capture once the mock-trade trigger is resolvable, and upgrade the route's
  fixture from synthetic to verified.

**Credentials / `.env` discipline:** do not read or write `.env`. Code may
reference `process.env.BREET_*` by name only, and must never print or persist their
values. No secret value, header value, or credential appears in any test, fixture,
log, or commit. `npm test` stays hermetic; the loopback test in §6 is the only
substitute and makes no network calls.

**Report requirement (Phase 5):** the sprint report must state explicitly that
sandbox validation was **NOT performed**, why, and list the un-captured shape in
UNVERIFIED.

---

## 9. UNVERIFIED (cannot be confirmed offline)

1. **Breet webhook payload shape(s)** for the 9 documented events — conceptually
   described, never captured from a live event (`breet-api-reference.md:86`).
   **Still UNVERIFIED:** the §8 capture was attempted but deferred (mock-trade
   trigger unreachable). §6 test 4 therefore uses a **synthetic** fixture matching
   the documented shape; upgrading it to a captured shape is backlog **P-8**.
2. **Whether Breet actually emits `x-webhook-secret` on real deliveries**, and its
   scope (per-merchant vs per-event). Not confirmed — no live delivery captured.
3. **Live Breet sandbox end-to-end** (deposit → webhook → withdrawal) was
   **attempted and could not be performed**: the mock-trade trigger returns
   404/500-class errors depending on `X-Breet-Env`, and Breet's docs disagree on the
   correct value. No sandbox capture/replay is performed this sprint. Reported in
   Phase 5 and tracked as backlog **P-8**.
4. **`SESSION_HANDOFF.md` is internally stale:** it names a HEAD one commit behind
   itself and asserts "no verifier branch" (false). Corrected by commit B.
5. **Absence of a route is confirmed; absence of any other Breet webhook surface is
   confirmed by grep only**, not by runtime exploration.

---

## 10. Definition of done for this sprint (A + B)

- **Step 0 attempted, then deferred:** the §8 live capture was attempted and blocked
  (mock-trade trigger unreachable); tests use a synthetic, explicitly UNVERIFIED
  fixture; no replay script is written; the verified upgrade is backlog **P-8**.
- Route implemented as isolated, additive-only code in `src/routes/webhooks.js`
  **only**; the existing `webhookVerifier.js`, `disbursementService.js`, and all
  pre-existing functions/routes are untouched. No `handleBreetWebhook`.
- Success body is exactly `{ processed: true, advanced: false, reason: 'breet
  webhook verified; payload resolution and state advance deferred to P-1' }`;
  failure uses the Flutterwave error envelope `{ processed: false, reason }`.
- New tests written red-first, then green, against the synthetic fixture; `npm test`
  shows **0 failures** and the skip count unchanged (1). No existing test edited,
  weakened, or deleted.
- **B:** `SESSION_HANDOFF.md` and `PROVIDER_ADAPTERS.md` corrected so no false "no
  verifier branch" claim remains (one combined docs commit, or two — reviewer's
  choice), and `POSTPONED_BACKLOG.md` gains item **P-8**.
- Commit set is five, in order: (0) plan, (1) route tests RED (held locally, not
  pushed), (2) route GREEN, (3) docs correction, (4) sprint report + P-8 backlog
  entry — commits 1+2 pushed together. **No squash; no conditional commit 5.**
- No new runtime npm dependency; no `.env` read/write; no secret value in any test,
  fixture, log, or commit.
- **Sandbox:** NOT performed — §8 records the attempt, the Breet-side blocker, and
  the synthetic-fixture fallback; the report states this explicitly and lists the
  payload shape in UNVERIFIED.
- `docs/SPRINT_BREET_WEBHOOK_REPORT.md` produced per `SPRINT_WORKFLOW.md` Phase 5.
- One commit per logical fix; between each — `npm test` (0 failures), `git show
  --stat HEAD` (only the named files), then `git push origin main`. **If either
  check fails, STOP and report.**

**Approved for implementation. No source files have been modified.**
