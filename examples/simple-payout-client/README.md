# simple-payout-client

A zero-dependency example client for the payout-rail **v1 public disbursement API**
(`/api/v1/disbursements/*`). It demonstrates the four things an integration needs
on day one:

1. **create** — `POST /api/v1/disbursements` (idempotent create)
2. **advance** — `POST /api/v1/disbursements/:id/advance`
3. **receipt** — `GET /api/v1/disbursements/:id/receipt`
4. **error handling** — normalized `ErrorResponse` bodies on every failure path

It makes **no network calls except to the configured base URL**, and runs the same
way against a real deployment as against the repo's mocked test harness.

## Prerequisites

- Node.js >= 18 (global `fetch`; no dependencies)
- A running payout-rail instance reachable at `PAYOUT_API_BASE_URL` (default:
  `http://localhost:3001`). For local development, `npm start` in the repo root
  boots the app; the repo's test harness boots the same v1 router in-process with
  mocked adapters (see `test/unit/examples-client.test.js`).

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PAYOUT_API_BASE_URL` | | `http://localhost:3001` | API base URL (no trailing slash needed) |
| `BOS_API_TOKEN` | ✅ | — | The shared bearer token the server enforces (fail-closed) |

## Run

```bash
BOS_API_TOKEN=your-token npm start
```

The client reads the token from the environment, creates a demo disbursement,
advances it one step, fetches its settlement receipt, and then deliberately hits
two error paths (unknown id → `404`, wrong token → `401`) to show how failures are
surfaced. It exits `0` when the whole sequence completes and non-zero on an
unexpected failure.

## Sample run

Captured verbatim from `test/unit/examples-client.test.js` (mocked infrastructure,
ephemeral local listener); only volatile values are elided with `…`:

```
simple-payout-client demo
base: http://127.0.0.1:63903

create       {"id":"2fecff56-…","status":"preflight_check"}
idempotency_key disbursement:7f13ec69…
advance      {"success":true,"new_state":"manual_review"}
receipt      {"final_status":"manual_review","gaps":4}

error path: GET receipt for an unknown id
  -> 404 not_found — Disbursement not found: 00000000-0000-0000-0000-000000000000
error path: request with a wrong token
  -> 401 unauthorized — unauthorized

demo complete
```

`gaps: 4` is expected — a freshly created row has no burn / attestation /
release / payout evidence yet; the receipt states those gaps instead of
fabricating completion.

## Using the exports

The module also exports the same operations as functions, each returning the
parsed JSON body and throwing `ApiError` (with `.status`, `.error_code`, `.details`)
on non-2xx:

```js
import { createPayout, advancePayout, getReceipt, ApiError } from './client.js';

const { disbursement } = await createPayout({
  source_reference: 'campaign-001',
  amount_usd: 50,
  amount_usdcx: 50000000,
  creator_address: 'SP…',
  recipient_bank_account: '0123456789',
  recipient_bank_code: '044',
});

const { result } = await advancePayout(disbursement.id, 1);
const { receipt } = await getReceipt(disbursement.id);
```

## Idempotency & errors to know

- **Create is idempotent:** retrying `POST /api/v1/disbursements` with an identical
  body returns the same `disbursement.id` (no second row). The `idempotency_key`
  on the response is derived from stable inputs only and can be stored to
  recognize retries externally.
- **Failures are normalized:** every error carries `{ error, error_code, details? }`
  — see the endpoint table and error-code list in the repo `README.md`
  ("Disbursement API v1").