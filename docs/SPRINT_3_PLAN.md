# SPRINT 3 PLAN — YELLOW CARD MODEL CORRECTION

> Task: `docs/prompts/06_SPRINT_3_YELLOWCARD.md`
> Mode: executable plan. **Implemented as of Sprint 3 — see `docs/SPRINT_3_REPORT.md` for the delivery/verification state.**
> Status of this plan: **IMPLEMENTED**

---

## 1. Context and Source of Truth

Sprint 0 (`docs/PRODUCT_BASELINE.md`), `docs/GAP_REGISTER.md` G-07/G-18 and `docs/CLAIMS_REGISTER.md` record the
defect set this sprint fixes:

- G-07 (P1): `yellowcardAdapter._computeAuth` builds a JSON-envelope `Authorization`, no `X-YC-Timestamp` header,
  signing message = `timestamp + apiKey + hex(sha256(body))` — missing **path** and **method**, body hash in **hex**
  where docs specify **base64**, envelope where docs specify `YcHmacV1 {apiKey}:{signature}`.
- G-18 (P2): `yellowcardAdapter.js:13` cites `docs/yellowcard-api-reference.md`, which does not exist.
- CLAIMS_REGISTER:53, :82 — auth `INCORRECT/OUTDATED` vs public docs; :83 — send endpoint/payload `UNVERIFIED /
  potentially OUTDATED`; :84 — sandbox `SANDBOX-CAPABLE` but no evidence.

**Canonical statements used as the planning source** (quoted verbatim from the task doc, which itself carries the
public-doc citations [1][3][8][14][15]):

1. **Authentication** — `YcHmacV1` scheme with `X-YC-Timestamp` header. Signing message =
   `timestamp + path + method + base64(SHA256(body))` for POST/PUT. `Authorization: YcHmacV1 {apiKey}:{signature}`
   [citation:1][citation:3].  → GET/DELETE message = `timestamp + path + method` (task doc §Scope item 1c).
2. **Submit Send** — `POST /business/send`. Payments are now called Sends. Fields: `channelId` (or
   `channelType` + `country` + `currency`), `sequenceId`, `amount` (USD) **OR** `localAmount` (not both),
   `forceAccept`, `sender`/`destination` objects [citation:14].
3. **Sandbox base URL** — `https://sandbox.api.yellowcard.io/business/` [citation:1][citation:14].
4. **Webhook verification** — HMAC-SHA256 signature in header; verify with shared secret [citation:8][citation:15].

**Planning-time deviation (declared):** the task doc's Working Method step 2 says "Fetch the docs — retrieve the
current Yellow Card authentication and send endpoint docs. Cite them." The user's standing constraint for this sprint
is **no external network calls** (task doc Constraints: "No external network calls"). The literal fetch therefore did
not happen at planning time. This plan resolves the conflict without guessing: it uses only the canonical statements
above, which are already the distilled, cited content of the public docs. Every shape not derivable from those
statements is listed as **UNVERIFIED** with the concrete confirmation step needed, and per the task's blocker rule
("If the public documentation is ambiguous or unavailable for a specific endpoint, STOP and report — do not guess")
any item the reference doc cannot pin down at implementation time is a **STOP-and-report gate** (§8), not a guess.

---

## 2. Baseline

- `npm test` run locally at plan time: **153 tests / 152 pass / 0 fail / 1 skipped** (12 suites, ≈13.9s) — matches the
  task doc's stated Sprint 5 state (153/152/0/1).
- Working tree: the only uncommitted change is `docs/prompts/06_SPRINT_3_YELLOWCARD.md` (task doc has local edits,
  132 insertions / 49 deletions vs HEAD). This plan is written against the **current on-disk** task doc. The task doc
  is out of scope to commit in this sprint.
- Current adapter wire behavior (from code, `src/services/bos/yellowcardAdapter.js`):
  - `_computeAuth(method, body)` (:56-68): message = `timestamp + apiKey + bodyHash` where bodyHash =
    `hex(sha256(body))` for POST and `''` for GET/DELETE; emits `Authorization: YcHmacV1 {JSON envelope}`;
    no `X-YC-Timestamp`. Module-private (not exported).
  - `_headers(method, body)` (:73-80): `Content-Type: application/json` + `Authorization` only. No `X-YC-Timestamp`.
  - `submitSend` (:146-175): `POST {base}/send` body `{ amount: String, currency, recipientType, recipient, callbackUrl }`
    + header `X-Idempotency-Key`. Base URL already includes `/business`, so the URL is `/business/send` — the path is
    correct.
  - `lookupSend` (:184-204): `GET {base}/send/{sendId}` — path under confirmation (§3.2).
  - Other methods: `/sends`, `/sends/fee`, `/account`, `/details/bank`, `/channels`, `/rates` — **no `/payments`
    paths exist today** (checked).
  - Webhook: `verifyYellowCardWebhook` (webhookVerifier.js:91-109) checks `x-signature` | `x-yellowcard-signature` |
    `x-hub-signature-256`, hex HMAC-SHA256, constant-time compare, fails closed when secret unset.

---

## 3. Corrections

### 3.1 Auth scheme — exact correction (`_computeAuth` + `_headers`)

Module-internal signature change (safe: `_computeAuth`/`_headers` are private, not exported; no caller outside the
adapter):

- `_computeAuth(method, body, path, secret, apiKey)` — **add `path` parameter**.
- Timestamp: ISO 8601 UTC (current code trims to seconds). Keep full ISO 8601 UTC; **precision (sec vs millis) and
  timezone normalization are UNVERIFIED** (§7, confirm against reference doc).
- Compose message:
  - POST/PUT: `timestamp + path + method + base64(sha256(body))` — body hash **hex → base64** (definite correction).
  - GET/DELETE: `timestamp + path + method` (no body component — already "no body" today, but re-verified).
- Sign with `HMAC-SHA256(secret, message)`. Current code hex-encodes the HMAC output; the docs do not state the output
  encoding — **hex vs base64 of the final HMAC is UNVERIFIED** (§7). Plan keeps hex as the working default and flags
  it; the reference doc must pin it or implementation STOPs.
- `Authorization: YcHmacV1 {apiKey}:{signature}` — **replace the JSON envelope** (definite correction).
- `_headers` returns `X-YC-Timestamp: <timestamp>` **plus** `Authorization` — add the header (definite correction).
- Keep fail-closed: empty secret or apiKey → no `Authorization`, no signature (current behavior preserved).
- `path` = the URL path sent to the API, e.g. `/business/send`. Path-normalization rule (query string, trailing slash)
  is **UNVERIFIED** (§7).
- Correction documented in code comments, per task scope item 1d.

### 3.2 Request shapes — per endpoint

**`submitSend` → `POST /business/send`** (scope item 2a). URL already correct. Body rewrite (wire level only —
adapter-to-caller interface stays exactly as consumed by `transitionActions.js`, which continues to pass
`{ idempotency_key, amount, currency, recipient_type, recipient, callback_url }`):

| Documented field | Mapping from BOS | Status |
|---|---|---|
| `sequenceId` | `idempotency_key` (the deterministic `disbursement:…` key). Removes the `X-Idempotency-Key` header — documented idempotency is the `sequenceId` body field. | Definite direction; `sequenceId`=dedup semantics UNVERIFIED (§7) |
| `amount` XOR `localAmount` | Pipeline is NGN: send **`localAmount`** = NGN value in smallest unit and **omit** `amount` (USD). | Direction from canonical statement; kobo-vs-decimal convention UNVERIFIED (§7) |
| `channelId` | (blank for now) | UNVERIFIED — see §7 |
| `channelType` + `country` + `currency` | If no channelId: `channelType='bank'`(?), `country='NG'`(?), `currency='NGN'`. | UNVERIFIED — see §7 |
| `forceAccept` | Structural boolean; default/meaning for bank payouts UNVERIFIED (§7) | — |
| `sender` / `destination` | Current `recipient` (`{bankCode, accountNumber, accountName}`) maps to `destination`; `sender` omitted. **Exact `destination` sub-fields are UNVERIFIED (§7).** | Direction from canonical list; sub-shape is a §8 STOP gate |
| `recipientType`, `recipient`, `callbackUrl` | Documented field list has none of these. `callbackUrl` delivery configuration is UNVERIFIED (§7). | Removed from wire body |

No new endpoints invented; only the documented `POST /business/send` is used.

**`lookupSend` → status lookup** (scope item 2b). Current: `GET /business/send/{sendId}`. The canonical statement does
**not** give the lookup path (submit is `/business/send`, plural container is `/business/sends`). Candidate
`GET /business/sends/{sendId}` is **UNVERIFIED, not asserted** — this is a §8 STOP gate (do not guess). Response
mapping (`normalizeStatus`) unchanged; status vocabulary (`pending|processing|completed|failed`,
`successful → completed`) stays UNVERIFIED (§7).

**Other methods (scan, no change expected):** `listSends` `/business/sends`, `getSendFee` `/business/sends/fee`,
`healthCheck` `/business/account`, `resolveBankAccount` `POST /business/details/bank`, `getChannels` `/business/channels`,
`getRates` `/business/rates`. Each is re-asserted against the reference doc during implementation; the task scope flags
only "deprecated `/payments` paths" (none present). If any path does not match the reference doc, that single endpoint
becomes a STOP-and-report item (§8) rather than a silent change.

### 3.3 Webhook verification — CONFIRMED correct mechanism, header-name item pending

- Task scope item 3c: "If the current verification is already correct, document that and leave it."
- Current mechanism (`verifyYellowCardWebhook`): HMAC-SHA256 over the **raw body**, constant-time compare, accepts
  hex and `sha256=` / `hmac-sha256,` prefixes, **fails closed** on missing secret. `webhooks.js` verifies over
  `req.rawBody` (raw body captured; `express.json({ verify })`). Mechanism matches the canonical statement
  ("HMAC-SHA256 in header; verify with shared secret").
- **Conclusion: the verification mechanism stays as-is.**
- Pending item: the **exact signature header name** Yellow Card sends (`x-yellowcard-signature`? `x-hub-signature-256`?
  other). The canonical statement does not name it. The three currently-checked headers are retained; the reference doc
  must pin the real name, or this is a §8 STOP gate (no guessing).

---

## 4. Reference document contents — `docs/yellowcard-api-reference.md` (new)

Task scope item 4 / G-18 fix / G-07 acceptance baseline (GAP_REGISTER:207-208: "...treat it as the acceptance baseline
for G-07"). Sections:

1. **Header**: status ("Sprint 3 model — matches canonical statements cited in `docs/prompts/06_SPRINT_3_YELLOWCARD.md`;
   not sandbox-verified"); scope note that every external behavior is UNVERIFIED until a credential-gated sprint.
2. **Sources**: links to the public Yellow Card documentation site (docs.yellowcard.engineering — the authoritative
   source), cited per the task doc's citations; plus the task-doc citation map. (Links are cited, not fetched —
   see §1 deviation.)
3. **Authentication**: `YcHmacV1 {apiKey}:{signature}` header, `X-YC-Timestamp`, signing-message composition for
   GET vs POST/PUT, base64 body-hash rule.
4. **Base URLs**: production `https://api.yellowcard.io/business`, sandbox `https://sandbox.api.yellowcard.io/business`.
5. **Corrected endpoints** with field tables: Submit Send (`POST /business/send`), Send lookup (path pending §3.2),
   plus the scanned methods (§3.2) each marked with its confirmation status.
6. **Webhooks**: HMAC-SHA256 mechanism, the header-name pending item (§3.3), fail-closed rule.
7. **Sandbox notes**: sandbox capability, no credentials → no evidence (mirrors CLAIMS_REGISTER:84).
8. **UNVERIFIED checklist**: one row per §7 item, with the confirmation required.

---

## 5. Test files to create (all offline, mocked credentials, no network)

No adapter-contract tests exist today (GAP G-24 calls this out). New files:

1. **`test/unit/yellowcard-auth.test.js`** — assert, via a stubbed global `fetch` on the **public methods**
   (keeps `_computeAuth`/`_headers` private; no export churn):
   - `Authorization` matches `YcHmacV1 <apiKey>:<signature>` (no JSON envelope, no stray `{`).
   - `X-YC-Timestamp` present and ISO 8601.
   - Signing-message composition proven by re-deriving the expected HMAC from the captured `X-YC-Timestamp` +
     path + method (+ base64 sha256 body for POST) and comparing to the sent signature — covers the GET and POST
     message forms.
   - Signature varies when path / method / body change.
   - Fail-closed: empty apiKey or secret → no `Authorization`, no `X-YC-Timestamp`.
2. **`test/unit/yellowcard-submit-send-contract.test.js`** — fetch-stub asserts the `POST /business/send` wire body:
   `sequenceId` from `idempotency_key`, no `X-Idempotency-Key` header, `amount`/`localAmount` exclusivity
   (localAmount only for NGN), `forceAccept` boolean present, `destination` present, `sender`/`channelId`
   omitted-or-blank per §3.2, `recipientType`/`recipient`/`callbackUrl` absent. `Authorization` +
   `X-YC-Timestamp` present.
3. **`test/unit/yellowcard-lookup-contract.test.js`** — fetch-stub asserts lookup HTTP verb + path (path per §3.2
   candidate, asserted **only after the §8 gate clears**; if the gate does not clear, this file is not written and the
   blocker is reported instead) + auth headers present.
4. **`test/unit/yellowcard-webhook.test.js`** — `verifyYellowCardWebhook`: valid HMAC hex accepted; tampered payload /
   bad signature rejected; missing signature rejected; secret unset → fail-closed; `sha256=` prefix accepted.
   (Extend rather than duplicate `test/unit/webhook-verify.test.js` if existing G-06 coverage already overlaps.)

Test hygiene: env vars (`YELLOW_CARD_API_KEY`, `YELLOW_CARD_SECRET_KEY`, `YELLOW_CARD_API_URL`,
`YELLOW_CARD_WEBHOOK_SECRET`) set per-test and restored; `fetch` replaced by a stub in each file and restored; no
socket/network use anywhere. Mocked credentials, per task scope item 5 ("All tests run offline with mocked
credentials").

---

## 6. Deviations from the Sprint 5 state (153/152/0/1), with reason

| # | Deviation | Reason |
|---|---|---|
| 1 | Test count rises from 153 to ~170+ (estimate) once the four new contract-test files land. | Task requires new mocked contract tests (scope item 5) + "All existing tests still pass" (acceptance #8). Net: 153 existing stay green; additions are the delta. |
| 2 | `submitSend` wire body changes (`channelId/sequenceId/amount-or-localAmount/forceAccept/sender-destination`, no `X-Idempotency-Key`). | G-07/CLAIMS_REGISTER:83 demand documented shapes; **adapter-to-pipeline interface unchanged** (`transitionActions.js`/guards untouched), so no state-machine/evidence/public-API change — confirming to task scope-out. |
| 3 | `_computeAuth`/`_headers` module-private signatures change (path param; header set). | Required to produce the documented message; no public surface. Covered immediately by the auth contract tests. |
| 4 | Working-method step 2 ("Fetch the docs") not performed literally. | User standing constraint: no external network calls. Resolved by using the task doc's canonical quoted statements + UNVERIFIED markers + STOP gates instead of guessing. |
| 5 | Task doc `docs/prompts/06_SPRINT_3_YELLOWCARD.md` is uncommitted-modified at plan time. | Pre-existing local edit (not part of this sprint's work); plan targets the on-disk content. Not committed here. |

---

## 7. Explicit list of what remains UNVERIFIED — and why

Every item below cannot be derived from the task doc's canonical statements and was **not** checked against a live
sandbox (no credentials) or live docs (no network). Each gets a confirmation step at implementation; anything the
reference doc cannot pin down triggers a STOP (§8).

1. Timestamp precision/normalization in the signing message (sec vs millis, timezone) — sandbox-verification only.
2. Encoding of the final HMAC signature (hex vs base64) in `{apiKey}:{signature}`.
3. Path-normalization rule in the signing message (query-string inclusion, trailing slash).
4. `sequenceId` as idempotency/dedup semantics and duplicate-handling behavior.
5. `amount` vs `localAmount` for NGN: whether `localAmount` is kobo (smallest unit) or a decimal naira value.
6. `forceAccept` default and meaning for NGN bank payout.
7. Exact `sender` / `destination` object sub-fields.
8. Which channel selector to send for NGN bank payouts: `channelId` vs `channelType`+`country`+`currency`.
9. Webhook configuration in the Sends model (the removed `callbackUrl` path — how a business's webhook URL is set).
10. Exact webhook signature **header name**.
11. Send-lookup endpoint path (singular vs plural).
12. Send status vocabulary mapping to BOS states (`successful → completed` believed, not verified).
13. Sandbox reachability of every corrected endpoint (no credentials → impossible this sprint).

Why UNVERIFIED is correct here: the task explicitly forbids sandbox claims without credentials (scope-out), forbids
inventing endpoint behavior, and the no-network constraint blocked live-doc confirmation during planning. The sprint
deliverable is "matches the documented model", not "works against the API" — every code comment and the reference doc
will carry the `UNVERIFIED` marker (acceptance #6, #7).

---

## 8. STOP-and-report gates (task Blockers to Report)

These items become a **STOP and report** — not a guess — if the reference doc cannot be resolved at implementation
time:

- G1: `destination` object sub-shape (item 7 above).
- G2: Send lookup path (item 11).
- G3: Webhook signature header name (item 10).
- G4: Any scanned endpoint path (§3.2) that does not match a documented path.
- G5: Final HMAC output encoding (item 2).
- G6: Any correction that would force a schema / public-API / caller change (task: "A correction requires a schema
  change that breaks existing code"). Current plan intentionally avoids any.

If a gate fires, implementation halts, the finding is reported in this plan/chat, and nothing for that endpoint is
changed until resolved.

---

## 9. One-commit-per-fix sequence (implementation time, after review)

1. `fix: yellowcard auth scheme (YcHmacV1 apiKey:signature + X-YC-Timestamp, timestamp+path+method[+base64 body])`
   — `_computeAuth`/`_headers` + auth contract tests.
2. `fix: yellowcard submitSend documented request shape` — `POST /business/send` body fields + submit contract tests.
3. `fix: yellowcard lookupSend documented path` — only if gate G2 clears; else commit nothing and report.
4. `docs: add yellowcard-api-reference.md (reference baseline for G-07/G-18)` + CLAIMS_REGISTER/GAP_REGISTER status
   lines for G-07/G-18.
5. `test: yellowcard webhook verification behavior` — only if gate G3 clears; else hold and report.
6. After all commits: full `npm test` must stay green (153 + new, 0 fail); then `docs/SPRINT_3_REPORT.md`.

No CineX files, no schema/state-machine/evidence/public-API changes, no new runtime dependencies, no network calls.
Commits are executed only after this plan is reviewed; no commit happens at plan time.