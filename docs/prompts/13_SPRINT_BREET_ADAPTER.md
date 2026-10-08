\# 13 — SPRINT: BREET PROVIDER ADAPTER



> Task: add Breet as a third provider adapter behind the existing provider-agnostic interface, serving the NGN off-ramp direction.

> Mode: plan-first, implementation-with-tests, no external network calls in the default suite.

> Outputs: BreetAdapter, wire-contract tests, webhook verification, corridor config, docs updates, sprint report.



\---



\## Why This Sprint Exists



Payout Rail was designed with a provider-agnostic adapter interface. Two adapters exist:



\- \*\*Yellow Card\*\* — serves the NGN local payout leg (primary)

\- \*\*Flutterwave\*\* — serves the stablecoin disbursement leg; off-ramp blocked by F4B production approval



Neither provides a second working off-ramp for the NGN corridor. Breet does.



Breet is a Circle Alliance partner that provides stablecoin-to-fiat off-ramp APIs across Nigeria, Ghana, Kenya, Rwanda, and Tanzania. Its API accepts USDC deposits, converts them, and settles NGN to Nigerian bank accounts. That is the off-ramp direction Payout Rail requires.



Adding Breet as a third adapter:



1\. Proves the provider-agnostic interface works with three implementations

2\. Provides a real, accessible second provider for the NGN corridor

3\. Expands the corridor roadmap to KES, RWF, and TZS



\---



\## What Has Been Confirmed



The Breet sandbox was accessed directly before this sprint began. The following are confirmed:



\- Sandbox dashboard: `partners.breet.io`

\- App ID: provided by the operator in `.env` as `BREET\_APP\_ID`

\- Merchant Reference: provided by the operator in `.env` as `BREET\_MERCHANT\_REF`

\- Webhook verification event received on 2026-10-08

\- Webhook secret issued (value stored locally, never committed): delivered in the `x-webhook-secret` header of the `webhook.verification` event

\- Base URL: `https://api.breet.io/v1`

\- Environment header: `X-Breet-Env: sandbox` for sandbox, `X-Breet-Env: production` for live

\- Auth headers: `x-app-id` and `x-app-secret`

\- 9 webhook events subscribed



The following are documented but not yet verified:



\- Deposit address generation endpoint

\- Mock deposit endpoint (sandbox only)

\- Auto-settlement flow (deposit → conversion → local currency)

\- Withdrawal initiation endpoint

\- Withdrawal status endpoint

\- Webhook payload shapes for each of the 9 events



\---



\## Breet API Documentation — Required Reading



The exact wire body depends on the Breet API documentation. First, fetch `https://docs.breet.io/llms.txt` to get the complete index of pages. Then fetch the following specific pages:



\- `https://docs.breet.io/deposits`

\- `https://docs.breet.io/auto-settlement`

\- `https://docs.breet.io/testing`

\- `https://docs.breet.io/withdrawals`

\- `https://docs.breet.io/webhooks`

\- `https://docs.breet.io/pagination`

\- `https://docs.breet.io/errors`

\- `https://docs.breet.io/rate-limiting`



And any other page from the index that covers the off-ramp flow. The plan must fetch or quote the documented endpoint shapes before implementation.



\*\*Two flags to note while reading the Breet documentation:\*\*



1\. The `X-Breet-Env` header value for sandbox is `sandbox`, not `development`. The error handling documentation confirms this.

2\. The off-ramp flow has two distinct steps: \*\*deposit detection\*\* (USDC in) and \*\*withdrawal initiation\*\* (NGN out to bank account). The withdrawal endpoint is documented separately from the deposit endpoint. The agent must read both.



If the agent cannot reach `docs.breet.io`, it must state that in the plan and stop. The operator will provide the relevant documentation sections manually.



\---



\## Scope (In)



\### 1. BreetAdapter



Create `src/services/bos/breetAdapter.js` implementing the same interface as `yellowcardAdapter.js`:



\- `submitSend({ idempotency\_key, amount, currency, recipient\_type, recipient })` — initiates the off-ramp: USDC in, NGN out

\- `lookupSend(sendId)` — queries the withdrawal status

\- `verifyWebhookSignature(rawBody, signature)` — compares the `x-webhook-secret` header to `BREET\_WEBHOOK\_SECRET`

\- `healthCheck()` — queries an account or balance endpoint

\- `classifyError(error)` — same taxonomy as Yellow Card and Flutterwave



\### 2. Webhook verification



Add a `verifyBreetWebhook(rawBody, headers)` branch to `webhookVerifier.js`, and a `POST /api/bos/webhooks/breet` route to `routes/webhooks.js`.



Verification: compare the `x-webhook-secret` header to `BREET\_WEBHOOK\_SECRET` using a timing-safe comparison. Fail closed when the secret is unset.



\### 3. Corridor configuration



Extend the provider selection to include `breet`. The default remains `yellowcard`.



\### 4. Environment variables



Add to `.env.example` (placeholder names only, empty values, no secrets):



\- `BREET\_APP\_ID` — the sandbox or production App ID

\- `BREET\_APP\_SECRET` — the sandbox or production App Secret

\- `BREET\_MERCHANT\_REF` — the merchant reference

\- `BREET\_WEBHOOK\_SECRET` — the webhook verification secret

\- `BREET\_BASE\_URL` — defaults to `https://api.breet.io/v1`

\- `BREET\_ENV` — `sandbox` or `production`



\*\*Do NOT create, write, or read the `.env` file.\*\* Only create `.env.example`. The operator (me) will create `.env` locally with the real values.



\### 5. Tests



Create `test/unit/breet-contract.test.js` with:



\- `submitSend` sends the documented off-ramp body shape

\- Auth headers are `x-app-id` and `x-app-secret`

\- The environment header is `X-Breet-Env: sandbox`

\- `lookupSend` calls the correct endpoint

\- `verifyWebhookSignature` accepts a matching `x-webhook-secret`

\- `verifyWebhookSignature` rejects a mismatched secret

\- `verifyWebhookSignature` fails closed when `BREET\_WEBHOOK\_SECRET` is unset

\- `classifyError` classifies 4xx as permanent, 5xx as transient, timeouts as transient



All tests use a stubbed `fetch`. No network calls.



\### 6. Documentation updates



\- `docs/PROVIDER\_ADAPTERS.md` — add Breet as a third provider

\- `docs/ARCHITECTURE.md` — update the adapter boundary

\- `README.md` — update the corridor configuration and roadmap

\- `docs/COMMERCIAL\_MODEL.md` — update the Key Partners table

\- `docs/CLAIMS\_REGISTER.md` — add a Breet claim row

\- `docs/MULTI\_CORRIDOR\_PLAN.md` — update the provider landscape

\- `docs/breet-api-reference.md` — new reference document

\- `docs/SPRINT\_BREET\_REPORT.md` — sprint report



\### 7. What remains UNVERIFIED



The sprint report must state explicitly:



\- The sandbox deposit, withdrawal, and webhook flows have not been tested end to end at the time of implementation

\- The webhook payload shapes are documented but not captured from a live event (except `webhook.verification`)

\- The off-ramp direction (USDC in → NGN out) is confirmed by Breet's public positioning but not by a live test in this environment



These are marked honestly.



\### 8. Phase B — Sandbox verification (manual, post-sprint)



This phase is not part of the automated test suite. It is a manual verification step that happens after the sprint, using the Breet sandbox and the Webhook.site inbox.



Steps:



1\. Trigger a mock deposit in the Breet sandbox using the documented mock-deposit endpoint.

2\. Observe the webhook events arriving at Webhook.site: `trade.pending`, `trade.completed`.

3\. Capture the exact payload shape of each event.

4\. Compare the captured payloads against the adapter's expectations.

5\. Trigger a withdrawal to a Nigerian test bank account.

6\. Observe `withdrawal.pending`, `withdrawal.processing`, `withdrawal.completed`.

7\. Capture each payload shape.

8\. Fix any mismatches between the captured payloads and the adapter's wire-contract tests.

9\. Document the verification outcome in `docs/SPRINT\_BREET\_REPORT.md` under "Sandbox verification".



What Phase B verifies:



\- The deposit flow (USDC in, address generation, detection)

\- The auto-settlement flow (conversion, NGN crediting)

\- The withdrawal flow (NGN to recipient bank account)

\- The webhook payload shapes for all 9 events



What Phase B does not verify:



\- Production behavior (out of scope)

\- Compliance or regulatory claims (none are made)



\## Scope (Out)



\- Any change to the state machine

\- Any change to the evidence chain

\- Any change to the v1 public API

\- Any change to the Yellow Card or Flutterwave adapters

\- Any live network call in the test suite

\- Any new runtime npm dependency

\- The Flutterwave F4B production KYC (separate workstream)



\---



\## Constraints



\- Do not modify CineX.

\- No external network calls in the default test suite.

\- No new runtime npm dependencies.

\- The adapter must implement the same interface as `YellowCardAdapter` — no interface changes.

\- Fail closed: a missing `BRET\_WEBHOOK\_SECRET` must reject all webhooks.

\- One commit per logical fix.

\- All existing tests must still pass (243 baseline).

\- No secrets in code, logs, or committed files.

\- Do NOT create, write, or read `.env`. Only create `.env.example`.

\- If `docs.breet.io` cannot be reached, state that in the plan and stop. Do not guess wire shapes.



\---



\## Acceptance Criteria



1\. `BreetAdapter` exists and implements the same interface as `YellowCardAdapter`.

2\. `submitSend` sends the documented off-ramp body shape.

3\. `lookupSend` calls the correct endpoint.

4\. `verifyWebhookSignature` compares `x-webhook-secret` to `BREET\_WEBHOOK\_SECRET` and fails closed when unset.

5\. Corridor config supports provider selection including `breet`.

6\. `.env.example` documents all six BRET variables with placeholder names and empty values.

7\. Wire-contract tests pass.

8\. All existing tests still pass (243 baseline).

9\. Documentation is updated in all eight named files.

10\. `SPRINT\_BREET\_REPORT.md` exists, states what is UNVERIFIED, and includes a "Phase B — Sandbox verification" section describing the manual verification steps that follow the sprint.

11\. No external network calls in the default suite.

12\. No new runtime npm dependencies.

13\. No CineX changes.

14\. No secrets committed.



\---



\## Working Method



1\. \*\*Inspect\*\* — read `yellowcardAdapter.js` and `flutterwaveAdapter.js` as templates. Read `docs.breet.io` documentation for the following sections:

&#x20;  - \*\*Authentication\*\* — headers and environment (`X-Breet-Env: sandbox` for sandbox, `production` for live)

&#x20;  - \*\*Deposits\*\* — address generation and detection

&#x20;  - \*\*Auto-Settlement\*\* — how deposits convert and settle automatically to local currency

&#x20;  - \*\*Withdrawals\*\* — how the recipient's bank account is credited

&#x20;  - \*\*Webhooks\*\* — payload shapes for each of the 9 events

&#x20;  - \*\*Pagination\*\* — how list endpoints handle page and size

&#x20;  - \*\*Errors\*\* — response format and error taxonomy

&#x20;  - \*\*Rate limiting\*\* — how to handle 429 responses

&#x20;  - Any section covering the end-to-end flow from deposit to local bank account



2\. \*\*Baseline\*\* — run `npm test`; confirm 243/242/0/1.



3\. \*\*Plan\*\* — produce `docs/SPRINT\_BREET\_PLAN.md` with:

&#x20;  - The exact adapter structure

&#x20;  - The exact off-ramp wire body from the Breet docs

&#x20;  - The withdrawal status endpoint

&#x20;  - The webhook verification logic

&#x20;  - The corridor config change

&#x20;  - The env var names and defaults

&#x20;  - Test files to create

&#x20;  - Deviations from the existing adapter pattern, if any, with reason

&#x20;  - The UNVERIFIED list

&#x20;  - The Phase B sandbox verification plan

&#x20;  - \*\*Wait for review before implementing.\*\*



4\. \*\*Implement\*\* — one commit per logical fix.



5\. \*\*Test\*\* — full suite must pass.



6\. \*\*Evidence\*\* — capture test output; note that Phase B sandbox verification is the next step.



7\. \*\*Document\*\* — update all eight files, add the sprint report including the Phase B plan.



\---



\## Deliverables



\- `docs/SPRINT\_BREET\_PLAN.md` — plan (reviewed before implementation)

\- `src/services/bos/breetAdapter.js`

\- Corridor config update

\- `.env.example` update (placeholder names only, no secrets)

\- Webhook verification + route

\- `test/unit/breet-contract.test.js`

\- `test/unit/breet-webhook.test.js`

\- Updated: `PROVIDER\_ADAPTERS.md`, `ARCHITECTURE.md`, `README.md`, `COMMERCIAL\_MODEL.md`, `CLAIMS\_REGISTER.md`, `MULTI\_CORRIDOR\_PLAN.md`

\- New: `docs/breet-api-reference.md`

\- New: `docs/SPRINT\_BREET\_REPORT.md` including the Phase B plan

\- No CineX changes

\- No new runtime npm dependencies

\- No external network calls in the default suite

\- No secrets committed



\---



\## Blockers to Report



If any of the following are true during implementation, STOP and report:



\- `docs.breet.io` cannot be reached

\- The Breet API documentation does not expose the off-ramp endpoint

\- The wire body cannot be determined from the documentation

\- The corridor config change requires a schema migration

\- An existing test breaks and cannot be fixed without changing its assertions

\- The webhook verification cannot be implemented without a live payload



\---



\## Gate



Do NOT consider this sprint complete until:



1\. The adapter exists and implements the interface

2\. All wire-contract tests pass

3\. All existing tests pass

4\. Corridor config supports provider selection

5\. `.env.example` has all six BRET variables

6\. All documentation files are updated

7\. `SPRINT\_BREET\_REPORT.md` exists, states what is UNVERIFIED, and includes the Phase B plan

8\. No CineX changes

9\. No new runtime npm dependencies

10\. No external network calls in the default suite

11\. No secrets committed



Stop after Step 3 (Plan). Produce `SPRINT\_BREET\_PLAN.md` and wait for review.

