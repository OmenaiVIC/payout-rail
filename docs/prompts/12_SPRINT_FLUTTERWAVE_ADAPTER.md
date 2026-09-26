\# 12 — SPRINT: FLUTTERWAVE PROVIDER ADAPTER

> Task: add Flutterwave as a second payout provider behind the existing provider-agnostic adapter interface.

> Mode: plan-first, implementation-with-tests, no external network calls in the default suite.

> Outputs: FlutterwaveAdapter, wire-contract tests, corridor config, docs updates, sprint report.

\---

\## Why This Sprint Exists

Payout Rail was designed with a provider-agnostic adapter interface. Until now, only one provider has been implemented: Yellow Card. The interface was theoretical — the abstraction had never been exercised by a second implementation.

Flutterwave is now the second provider. Adding it proves the abstraction works, strengthens the multi-corridor story (Flutterwave covers most of Africa), and reduces dependence on a single provider's credential timeline.

The reviewer's question — "How does Payout Rail differ from existing tooling?" — is answered in part by this sprint: Payout Rail is not tied to any single provider. Two providers now exist behind the same interface.

\---

\## What Has Been Confirmed

The Flutterwave v3 sandbox was tested directly before this sprint began. The following are confirmed working:

\- `POST /v3/transfers` with `account\_bank: "flutterwave"` queues a stablecoin transfer successfully

\- The response shape includes: `id`, `status` (`NEW`), `amount`, `currency`, `debit\_currency`, `fee`, `reference`, `meta.debit\_currency\_amount`

\- `GET /v3/transfers/{id}` returns the current transfer status

\- Auth is `Authorization: Bearer {FLW\_SECRET\_KEY}`

\- Base URL is `https://api.flutterwave.com/v3`

The following are confirmed by Flutterwave documentation but cannot be verified in sandbox:

\- Webhooks are sent only for transfers that reach a terminal state (`SUCCESSFUL` or `FAILED`)

\- Sandbox stablecoin transfers remain in `NEW` state and do not finalize

\- The webhook header is `verif-hash`

\- Verification is a plain string comparison against `FLW\_SECRET\_HASH`

\- The payload uses `event: "transfer.completed"` with `data.status` for the outcome

\---

\## Scope (In)

\### 1. FlutterwaveAdapter

Create `src/services/bos/flutterwaveAdapter.js` implementing the same interface as `yellowCardAdapter.js`:

\- `submitSend({ idempotency\_key, amount, currency, recipient\_type, recipient })` — calls `POST /v3/transfers` with `account\_bank: "flutterwave"`

\- `lookupSend(sendId)` — calls `GET /v3/transfers/{sendId}`

\- `verifyWebhookSignature(rawBody, signature)` — compares `signature` to `FLW\_SECRET\_HASH`

\- `healthCheck()` — calls `GET /v3/balances` or equivalent

\- `classifyError(error)` — same taxonomy as Yellow Card (transient, permanent, unknown)

The adapter must match the documented v3 transfer body:

```json

{
  "account_bank": "flutterwave",
  "account_number": "<merchant_id>",
  "debit_currency": "NGN",
  "amount": 100,
  "currency": "USDC",
  "network": "POLYGON",
  "destination": "<recipient_wallet_address>",
  "reference": "<idempotency_key>"
}


\### 2. Corridor configuration



Update the corridor config to support provider selection. A corridor entry can now name a provider: `yellowcard` or `flutterwave`. The default remains `yellowcard`.



\### 3. Environment variables



Add to `.env.example`:



\- `FLW\_SECRET\_KEY` — the v3 secret key

\- `FLW\_PUBLIC\_KEY` — the v3 public key

\- `FLW\_ENCRYPTION\_KEY` — the v3 encryption key

\- `FLW\_SECRET\_HASH` — the webhook verification hash

\- `FLW\_MERCHANT\_ID` — the merchant ID used as `account\_number`

\- `FLW\_BASE\_URL` — defaults to `https://api.flutterwave.com/v3`



\### 4. Tests



Create `test/unit/flutterwave-contract.test.js` with:



\- `submitSend` sends the documented body shape

\- Auth header is `Bearer {FLW\_SECRET\_KEY}`

\- The `reference` field carries the idempotency key

\- `lookupSend` calls the correct endpoint

\- `verifyWebhookSignature` accepts a matching hash

\- `verifyWebhookSignature` rejects a mismatched hash

\- `verifyWebhookSignature` fails closed when `FLW\_SECRET\_HASH` is unset

\- `classifyError` classifies 4xx as permanent, 5xx as transient, timeouts as transient



All tests use a stubbed `fetch`. No network calls.



\### 5. Documentation updates



\- `docs/PROVIDER\_ADAPTERS.md` — add Flutterwave as a second provider, with the v3 auth flow, endpoints, and webhook verification

\- `docs/ARCHITECTURE.md` — update the adapter boundary section

\- `README.md` — update the corridor configuration line to name two providers

\- `docs/COMMERCIAL\_MODEL.md` — update the Key Partners table

\- `docs/CLAIMS\_REGISTER.md` — add a Flutterwave claim row, classified as IMPLEMENTED + TESTED (wire-level), with live/sandbox UNVERIFIED

\- `docs/SPRINT\_FLUTTERWAVE\_REPORT.md` — the sprint report



\### 6. What remains UNVERIFIED



The sprint report must state explicitly:



\- Live webhook delivery is UNVERIFIED — Flutterwave's sandbox does not finalize stablecoin transfers, so webhooks are never fired

\- The webhook payload shape is documented but not captured from a live webhook

\- Live transfer finalization is UNVERIFIED — the sandbox transfer remained in `NEW` state



These are platform limitations, not adapter defects. They are marked honestly.



\## Scope (Out)



\- Any change to the state machine

\- Any change to the evidence chain

\- Any change to the v1 public API

\- Any change to the Yellow Card adapter

\- Any live network call in the test suite

\- Any new runtime npm dependency



\---



\## Constraints



\- Do not modify CineX.

\- No external network calls in the default test suite.

\- No new runtime npm dependencies.

\- The adapter must implement the same interface as YellowCardAdapter — no interface changes.

\- Fail closed: a missing `FLW\_SECRET\_HASH` must reject all webhooks.

\- One commit per logical fix.

\- All existing tests must still pass.



\---



\## Acceptance Criteria



1\. `FlutterwaveAdapter` exists and implements the same interface as `YellowCardAdapter`.

2\. `submitSend` sends the documented v3 body shape.

3\. `lookupSend` calls the correct endpoint.

4\. `verifyWebhookSignature` compares `verif-hash` to `FLW\_SECRET\_HASH` and fails closed when unset.

5\. Corridor config supports provider selection.

6\. `.env.example` documents all six FLW variables.

7\. Wire-contract tests pass.

8\. All existing tests still pass (189 baseline).

9\. Documentation is updated in all six named files.

10\. `SPRINT\_FLUTTERWAVE\_REPORT.md` exists and states what is UNVERIFIED.

11\. No external network calls in the default suite.

12\. No new runtime npm dependencies.

13\. No CineX changes.



\---



\## Working Method



1\. \*\*Inspect\*\* — read `yellowCardAdapter.js`, its interface, the corridor config, the webhook handler, and the existing wire-contract tests.

2\. \*\*Baseline\*\* — run `npm test`; confirm 189/188/0/1.

3\. \*\*Plan\*\* — produce `docs/SPRINT\_FLUTTERWAVE\_PLAN.md` with:

&#x20;  - The exact adapter structure

&#x20;  - The exact wire body

&#x20;  - The webhook verification logic

&#x20;  - The corridor config change

&#x20;  - The env var names and defaults

&#x20;  - Test files to create

&#x20;  - Deviations from the existing adapter pattern, if any, with reason

&#x20;  - The UNVERIFIED list

&#x20;  - \*\*Wait for review before implementing.\*\*

4\. \*\*Implement\*\* — one commit per logical fix.

5\. \*\*Test\*\* — full suite must pass.

6\. \*\*Evidence\*\* — capture test output; note that live verification is blocked on sandbox finalization.

7\. \*\*Document\*\* — update all six files, add the sprint report.



\---



\## Deliverables



\- `docs/SPRINT\_FLUTTERWAVE\_PLAN.md` — plan (reviewed before implementation)

\- `src/services/bos/flutterwaveAdapter.js`

\- Corridor config update

\- `.env.example` update

\- `test/unit/flutterwave-contract.test.js`

\- Updated: `PROVIDER\_ADAPTERS.md`, `ARCHITECTURE.md`, `README.md`, `COMMERCIAL\_MODEL.md`, `CLAIMS\_REGISTER.md`

\- `docs/SPRINT\_FLUTTERWAVE\_REPORT.md`

\- No CineX changes

\- No new runtime npm dependencies

\- No external network calls in the default suite



\---



\## Blockers to Report



If any of the following are true during implementation, STOP and report:



\- The Flutterwave interface cannot be implemented without changing the shared adapter interface

\- A wire shape cannot be determined from the documentation or the confirmed sandbox response

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

5\. `.env.example` has all six FLW variables

6\. All six documentation files are updated

7\. `SPRINT\_FLUTTERWAVE\_REPORT.md` exists and states what is UNVERIFIED

8\. No CineX changes

9\. No new runtime npm dependencies

10\. No external network calls in the default suite



Stop after Step 3 (Plan). Produce `SPRINT\_FLUTTERWAVE\_PLAN.md` and wait for review.

```
