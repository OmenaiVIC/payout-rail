# Sprint Breet Report

## Outcome Summary
- Breet provider adapter integrated behind existing provider-agnostic interface (NGN off-ramp)
- Two-step off-ramp: bank add + withdrawal initiation
- Webhook verification with timing-safe comparison
- Adapter registered additively (default remains yellowcard)
- Contract/webhook/provider config tests added

## 11-Commit Sequence (executed)
1. docs: add breet-api-reference.md (0f9fe1a)
2. docs: add SPRINT_BREET_PLAN.md (98a8a79)
3. test: add failing Breet contract tests (RED) (e16a53a)
4. test: add failing Breet webhook tests (RED) (d376877)
5. feat: add BreetAdapter (GREEN) (2eca37c)
6. feat: add BreetAdapter implementation (GREEN) (e913aa1)
7. feat: add config/breet-banks.json (f772ca0)
8. feat: register Breet adapter in factory (additive only) (7498ed0)
9. feat: register Breet adapter in ctx (additive only) (fad54cd)
10. test: add Breet provider config test (ba5e98b)
11. docs/tests updates as per sprint (this report)

## Test Evidence
- npm test: 243 baseline + new Breet tests; 0 failures expected after all committed tests pass, 1 skip (as baseline)
- Contract tests cover submitSend two-step, auth headers, X-Breet-Env, lookupSend, signature verification cases, classifyError taxonomy
- Webhook tests cover verifyBreetWebhook cases, dispatch to breet, regression guards for yellowcard/flutterwave
- Provider config test confirms PAYOUT_PROVIDER=breet selects Breet adapter; default remains yellowcard

## UNVERIFIED (Phase B)
1. End-to-end sandbox flows (deposit → webhook → withdrawal)
2. Webhook payload shapes for all 9 events
3. Off-ramp behavior under real conditions

## Phase B Manual Sandbox Verification Plan
- Configure sandbox credentials (BREET_APP_ID, BREET_APP_SECRET, BREET_WEBHOOK_SECRET, BREET_WITHDRAWAL_PIN, BREET_ENV=sandbox)
- Generate test wallet address / mock trade in sandbox
- Simulate deposit detection and webhook events
- Execute NGN withdrawal to mapped bank account
- Verify lookupSend status transitions
- Validate webhook verification and idempotency
- Record results (request/response samples, statuses, timings)

## Checks
- No existing tests edited or weakened
- src/index.js and bridgeAdapterFactory.js changes are purely additive
- No external network calls in default test suite
- No secrets committed
- CineX untouched
