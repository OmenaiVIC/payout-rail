# DEMO — Nigeria (NGN) Payout Reproduction Runner

`scripts/demo-payout-ngn.js` is a self-contained reproduction of the full
USDCx → NGN corridor (burn → attestation → destination release → Yellow Card
payout → settled) that **does not require any external service, credential, or
Postgres instance**.

## What runs real, what is simulated

| Layer | Status |
|---|---|
| Sprint 5 state machine (`src/services/bos/stateMachine.js`) | **real, unmodified** |
| Guards (`transitionGuards.js`), actions (`transitionActions.js`) | **real, unmodified** |
| Evidence recorders (`evidenceCollector.js`, `externalRefRecorder`, upserts) | **real, unmodified** |
| Sprint 4 settlement receipt generator (`settlementReceipt.js`) | **real, unmodified** |
| Sprint 5 v1 disbursement service / router wire-up (`advance`, `getDisbursement`, `getReceipt`) | **real, unmodified** |
| Ledger (Postgres) | **emulated in-process** — every SQL statement is parsed and executed against in-memory tables by the runner; no `pg` client is used |
| Stacks chain (burn tx, attestation, release observation) | **simulated** |
| xReserve API | **simulated** |
| Yellow Card API | **simulated** |

Consequence: the demo proves the **orchestration** completes end to end against a
faithful in-memory ledger. It does **not** prove an external burn, attestation or
Yellow Card payout is true — every external event in the timeline is labelled
`DEMO` / `(simulated)`, and the printed receipt repeats this caveat.

## Run it

```bash
npm run demo:payout:ngn                # short form
node scripts/demo-payout-ngn.js        # equivalent
```

The script builds and starts a real in-process Express server on a probe-selected
loopback port, seeds the emulated ledger (recipient registry, exchange rate,
attribution), creates a disbursement (`25.00 USD → 25,000,000 USDCx →
4,125,000 NGN`), and drives it through all 12 transitions via the `advance` service
loop. It then reads back the Sprint 4 receipt and **asserts** `final_status ===
'settled'` and `gaps.length === 0` before writing the receipt to
`demo-output/receipt-<disbursement-id>.json`.

Exit codes:

| Code | Meaning |
|---|---|
| `0` | DEMO success — lifecycle reached `settled`, zero evidence gaps, receipt written |
| `2` | SANDBOX mode with incomplete credentials — **fail closed**, nothing was run |
| `1` | Unexpected error |

## Output

The 12-row timeline traces the full lifecycle:

```
(created) → disbursement_initiated → preflight_check → burn_submitted →
burn_confirmed → attestation_requested → attestation_confirmed →
destination_release_unobserved → destination_release_observed →
destination_release_confirmed → yellowcard_payout_submitted →
yellowcard_payout_confirmed → settled
```

The settlement receipt in `demo-output/` includes the `settlement_reference`
(Yellow Card `send_id` / reference), the `stacks_leg` (simulated burn tx hash,
USDCx amount, attestation), the `release_leg`, the `provider_leg` (NGN amount in
kobo), the `timeline` and the full `evidence_refs` chain (gate results +
transition + `tx_hash` + `api_response` + `poll_result` records with their
`payload_hash`es).

## Sandbox mode (fail closed)

`node scripts/demo-payout-ngn.js --mode=sandbox` evaluates the per-leg credential
matrix (`PAYOUT_TX_SIGNING_KEY`, `XRESERVE_PROTOCOL_CONTRACT`,
`YELLOW_CARD_API_KEY`, `YELLOW_CARD_SECRET_KEY`, `YELLOW_CARD_ENV=sandbox`).

- With any leg missing it prints the matrix and exits `2` **without running** —
  verification cannot be reported, so nothing is fabricated.
- With a full matrix it still refuses (G-20 blocks live Yellow Card payout
  verification in this repo): live sandbox settlement is out of scope of the
  runner.

## Tests

`test/unit/demo-runner.test.js` (part of `npm test`) spawns the runner and
asserts three contracts:

1. the demo walk reaches `settled` with `gaps: []` and exit `0`;
2. a receipt file is written whose payload says `final_status: settled`,
   `gaps: []`, and carries a settlement reference;
3. sandbox mode with no credentials fails closed (exit `2`).