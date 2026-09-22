# 06 — SPRINT 3: YELLOW CARD MODEL CORRECTION

> Task: replace the incorrect Yellow Card adapter auth scheme and request shapes with the canonical current API from public documentation.
> Mode: plan-first, implementation-with-tests, no external network calls.
> Outputs: corrected adapter, mocked contract tests, UNVERIFIED markers, documentation updates.

---

## Why This Sprint Exists

The Sprint 0 baseline (`docs/PRODUCT_BASELINE.md`) found that the Yellow Card adapter's auth scheme is `INCORRECT/OUTDATED` vs current public docs (G-07). The baseline also found the in-repo reference file (`docs/yellowcard-api-reference.md`) does not exist.

Sprint 3 corrects the model. It does NOT verify against a live sandbox — that requires credentials that are not available. Every external behavior remains `UNVERIFIED` until a credential-gated verification sprint runs.

---

## Source of Truth

The canonical current Yellow Card documentation is public and authoritative:

1. **Authentication** — `YcHmacV1` scheme with `X-YC-Timestamp` header. Signing message = timestamp + path + method + base64(SHA256(body)) for POST/PUT. `Authorization: YcHmacV1 {apiKey}:{signature}` [citation:1][citation:3].
2. **Submit Send** — `POST /business/send`. Payments are now called Sends. Fields: `channelId` (or `channelType` + `country` + `currency`), `sequenceId`, `amount` (USD) OR `localAmount` (not both), `forceAccept`, sender/destination objects [citation:14].
3. **Sandbox base URL** — `https://sandbox.api.yellowcard.io/business/` [citation:1][citation:14].
4. **Webhook verification** — HMAC-SHA256 signature in header; verify with shared secret [citation:8][citation:15].

The agent must fetch or reference these docs during planning. Do not invent endpoint shapes.

---

## Scope (In)

1. **Correct the auth scheme (`_computeAuth`).**
   - Replace the current JSON-envelope `Authorization` with `YcHmacV1 {apiKey}:{signature}`.
   - Add the `X-YC-Timestamp` header with ISO 8601 datetime.
   - Correct the signing message to: `timestamp + path + method` (for GET) or `timestamp + path + method + base64(SHA256(body))` (for POST/PUT).
   - Document the correction in code comments.

2. **Correct the request shapes.**
   - Verify `submitSend` uses `/business/send` with the documented body fields.
   - Correct `lookupSend` to match the documented lookup path.
   - Correct any other adapter methods that reference deprecated `/payments` paths.
   - Do not invent new endpoints; use only documented ones.

3. **Correct the webhook verification.**
   - The webhook verifier should validate the Yellow Card signature header using the documented mechanism.
   - If the current verification is already correct, document that and leave it.

4. **Add a test reference document.**
   - Create `docs/yellowcard-api-reference.md` containing the corrected endpoint shapes, auth scheme, and links to the public docs.
   - This replaces the missing reference the adapter currently cites.

5. **Add mocked contract tests.**
   - Tests that assert the correct auth header shape (`YcHmacV1`, `X-YC-Timestamp`).
   - Tests that assert the correct signing message composition.
   - Tests that assert the correct request body fields.
   - Tests that assert webhook verification behavior.
   - All tests run offline with mocked credentials.

6. **Add UNVERIFIED markers.**
   - Every external behavior that has not been verified against a live sandbox must be clearly marked `UNVERIFIED` in code comments and documentation.
   - Do NOT claim the adapter works; claim it matches the documented model.

## Scope (Out)

- Real sandbox calls (requires credentials)
- Any state machine change
- Any evidence chain change
- Any public API change
- Sprint 6 (demo)

---

## Constraints

- Do not modify CineX.
- No external network calls.
- No new runtime npm dependencies.
- Use only public Yellow Card documentation as the source of truth. Do not invent endpoint behavior.
- If the public documentation is ambiguous or unavailable for a specific endpoint, STOP and report — do not guess.
- One commit per logical fix.

---

## Acceptance Criteria

1. `_computeAuth` produces `Authorization: YcHmacV1 {apiKey}:{signature}` and includes `X-YC-Timestamp`.
2. The signing message matches the documented concatenation.
3. Request shapes match documented fields (`channelId`, `sequenceId`, `amount` or `localAmount`, `forceAccept`, etc.).
4. `docs/yellowcard-api-reference.md` exists and cites the public docs.
5. Mocked contract tests assert the corrected shapes.
6. Every unverified external behavior is marked `UNVERIFIED`.
7. No claim of working integration is made.
8. All existing tests still pass.
9. No external network calls in any test or production path.
10. No new runtime npm dependencies.

---

## Working Method

1. **Inspect** — read `src/services/bos/yellowcardAdapter.js`, the webhook verifier, and existing tests.
2. **Fetch the docs** — retrieve the current Yellow Card authentication and send endpoint docs. Cite them.
3. **Baseline** — run `npm test`; confirm Sprint 5 state (153/152/0/1).
4. **Plan** — produce `docs/SPRINT_3_PLAN.md` with:
   - The exact auth scheme correction
   - The exact request shape corrections per endpoint
   - The webhook verification correction (or confirmation it is already correct)
   - The reference document contents
   - Test files to create
   - Deviations from the Sprint 5 state, with reason
   - **Explicit statement of what remains UNVERIFIED and why**
   - **Wait for review before implementing.**
5. **Implement** — one commit per fix.
6. **Test** — full suite must pass.
7. **Document** — update README; add `docs/SPRINT_3_REPORT.md`.

---

## Deliverables

- `docs/SPRINT_3_PLAN.md` — plan (reviewed before implementation)
- Corrected `yellowcardAdapter.js` (auth scheme, request shapes)
- Corrected webhook verification (if needed)
- `docs/yellowcard-api-reference.md`
- Mocked contract tests
- `docs/SPRINT_3_REPORT.md`
- No CineX changes
- No new runtime npm dependencies
- No external network calls

---

## Blockers to Report

If any of the following are true, STOP and report:

- The public documentation is ambiguous for a specific endpoint
- A correction requires a schema change that breaks existing code
- The webhook verification cannot be corrected without credentials
- A test cannot be written without external credentials
- The correction contradicts what the baseline assumed

---

## Gate

Do NOT proceed to Sprint 6 until:

1. `_computeAuth` matches the documented scheme
2. Request shapes match documented fields
3. `docs/yellowcard-api-reference.md` exists
4. Mocked contract tests pass
5. All unverified behavior is marked `UNVERIFIED`
6. All existing tests still pass
7. `SPRINT_3_REPORT.md` exists with evidence
8. No CineX files were modified
9. No new runtime npm dependencies were added
10. No external network calls were made

Stop after Step 4 (Plan). Produce `SPRINT_3_PLAN.md` and wait for review.
