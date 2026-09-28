/**
 * BOS Flutterwave Bridge Adapter — REST client for the Flutterwave v3 Transfers API
 *
 * Implements the same adapter interface consumed by transitionGuards.js and
 * transitionActions.js as yellowcardAdapter.js: submitSend / lookupSend /
 * healthCheck / verifyWebhookSignature / classifyError. No interface changes.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS ADAPTER ACTUALLY DISBURSES — a USDC-to-wallet disbursement, NOT an
 * NGN bank payout. Do not describe it as a "second NGN payout provider".
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The documented v3 transfer body this adapter sends:
 *
 *   { account_bank: 'flutterwave', account_number: <merchant_id>,
 *     debit_currency: 'NGN', amount: 100, currency: 'USDC',
 *     network: 'POLYGON', destination: <wallet_address>,
 *     reference: <idempotency_key> }
 *
 * reads as: debit NGN from the Flutterwave merchant balance, deliver USDC to a
 * POLYGON wallet address. It does NOT serve the Nigeria / NGN local-fiat payout
 * leg this product thesis rests on — it sits next to the bridge leg that
 * xreserveAdapter.js already owns. `destination` is a wallet address, and the
 * pipeline's `ngn_recipient` shape has no wallet field, so this adapter cannot be
 * populated from a real disbursement today.
 *
 * YELLOW CARD REMAINS THE PRIMARY NGN PAYOUT PROVIDER. This adapter does not
 * replace it, is not wired to it, and does not change the default payout path.
 * Routing the pipeline to Flutterwave is NOT implemented — see backlog P-1.
 * The genuine Flutterwave off-ramp (USDC → NGN bank payout) is a different
 * product, is not implemented here, and is deferred to P-7: its endpoint was
 * not verifiable offline, so it was deferred rather than guessed at.
 *
 * ⚠ CURRENCY INVERSION — the `currency` parameter below lands in the wire field
 * `debit_currency`, NOT in `currency`. The wire field `currency` is the constant
 * "USDC". This is INVERTED relative to Yellow Card, where `currency` means what
 * the recipient receives. In Flutterwave's semantics `currency` describes what is
 * delivered to the destination and `debit_currency` what is debited from the
 * merchant balance. The inversion reproduces the documented body exactly from the
 * pipeline's real call shape (`submitSend({ currency: 'NGN' })` at
 * transitionActions.js:362). Do not "fix" it to a literal pass-through — that was
 * evaluated and rejected (plan §7.3, decision D-4).
 *
 * ⚠ UNITS — `amount` is passed through VERBATIM. The NGN kobo convention that
 * governs Yellow Card (disbursementService.js:40-44) does NOT apply here; the body
 * pairs `amount` with `currency: 'USDC'`, so it is USDC base units. The adapter
 * performs no conversion: a silent conversion is exactly the class of defect that
 * loses money, and this leg has no verified FX or unit convention. UNVERIFIED.
 *
 * ⚠ SECURITY — `verif-hash` webhook verification is materially weaker than Yellow
 * Card's per-body HMAC. It is a STATIC SHARED SECRET compared as a plain string;
 * it is not a function of the body. Therefore it authenticates the *sender* only
 * and provides NO payload integrity — anyone holding FLW_SECRET_HASH can forge an
 * arbitrary `transfer.completed` payload, including a SUCCESSFUL outcome for a
 * transfer that never happened — and it provides NO REPLAY PROTECTION, since a
 * captured valid request is replayable forever. That is a property of the scheme,
 * not of this implementation; the scheme has nowhere to put a timestamp or nonce.
 *
 * The load-bearing control is NOT the signature. It is the LOCAL durable
 * idempotency_key UNIQUE constraint (migrations/001_bos_schema.sql:43,
 * re-affirmed migrations/006_sprint_1_5.sql:4-18): the handler derives the
 * disbursement from data.reference, which carries the idempotency key, so a
 * replayed webhook collides on that constraint and cannot advance a second
 * payout. If FLW_SECRET_HASH is rotated or that constraint is ever relaxed, the
 * replay risk becomes real. Rotate the secret on a schedule, treat it as a
 * credential, and never log it or the verif-hash header value.
 *
 * Auth: `Authorization: Bearer {FLW_SECRET_KEY}`. Base URL: FLW_BASE_URL,
 * defaulting to https://api.flutterwave.com/v3.
 *
 * Verification status: WIRE-CONTRACT TESTED against a stubbed fetch only. Nothing
 * here has been verified against a live or sandbox Flutterwave endpoint — the
 * operator reported sandbox confirmation before the sprint, recorded as reported
 * and not independently reproduced. The claims-register tier is IMPLEMENTED +
 * TESTED (wire-level, stubbed fetch) — sandbox/live UNVERIFIED. This is not
 * "integrated", "live", or "production-ready", and it must not be called that.
 *
 * Reference: docs/flutterwave-api-reference.md
 */

import crypto from 'node:crypto';

const FLW_BASE_URL = process.env.FLW_BASE_URL || 'https://api.flutterwave.com/v3';
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || '';
const FLW_MERCHANT_ID = process.env.FLW_MERCHANT_ID || '';

// Documented-wire constants. Not env-configurable — the sprint fixes exactly six
// FLW_* variables. FLW_NETWORK and FLW_SETTLE_CURRENCY are overridable per call via
// the recipient object so a future corridor can retarget without a new env var.
const FLW_ACCOUNT_BANK = 'flutterwave';
const FLW_NETWORK = 'POLYGON';
const FLW_DEBIT_CURRENCY = 'NGN';
const FLW_SETTLE_CURRENCY = 'USDC';

/** Thrown when no wallet destination can be resolved. Never send an empty one. */
export class MissingRecipientDestinationError extends Error {
  constructor(message = 'Flutterwave destination is a wallet address; none of recipient.walletAddress, recipient.address, recipient.destination was supplied') {
    super(message);
    this.name = 'MissingRecipientDestinationError';
  }
}

/**
 * Error taxonomy for Flutterwave API errors. Identical to
 * yellowcardAdapter.js:36-46 and xreserveAdapter.js — duplicated rather than
 * extracted, because extraction would modify the Yellow Card adapter (out of
 * scope). Tracked as P-3.
 *
 * transient: network timeout, 5xx, rate limit — safe to retry
 * permanent: 4xx (except 429), invalid request — do NOT retry
 * unknown: unexpected error shape
 */
export function classifyError(error) {
  if (error && error.name === 'AbortError') return 'transient';
  if (error && error.name === 'TypeError' && error.message?.includes('fetch')) return 'transient';
  const status = error?.status || error?.statusCode;
  if (status) {
    if (status === 429) return 'transient';
    if (status >= 500) return 'transient';
    if (status >= 400 && status < 500) return 'permanent';
  }
  return 'unknown';
}

/**
 * Build common fetch options. Bearer auth; no timestamp, no request signature.
 */
function _headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...(FLW_SECRET_KEY ? { Authorization: `Bearer ${FLW_SECRET_KEY}` } : {}),
    ...extra,
  };
}

/**
 * Execute a fetch with timeout and error classification.
 * The AbortController timeout is what makes a hung provider retryable rather
 * than a stuck worker.
 */
async function _fetch(url, options = {}, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    err._classification = classifyError(err);
    throw err;
  }
}

/**
 * Normalize Flutterwave status values to canonical BOS statuses
 * (pending | processing | completed | failed).
 *
 * Fail-closed: nothing maps to `completed` unless the provider explicitly said
 * SUCCESSFUL. `NEW` maps to `pending`, not `processing` — the sandbox never
 * leaves NEW, so `processing` would assert forward motion that does not exist.
 * CANCELLED / REVERSED are mapped defensively; that they exist is UNVERIFIED.
 *
 * @param {string} raw — status from Flutterwave
 * @returns {string} canonical BOS status
 */
export function _normalizeStatus(raw) {
  if (!raw) return 'pending';
  switch (raw) {
    case 'SUCCESSFUL':
      return 'completed';
    case 'FAILED':
    case 'CANCELLED':
    case 'REVERSED':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * Resolve the destination wallet address, or fail closed.
 *
 * The pipeline's recipient shape (transitionActions.js:562-568) is bank/momo and
 * carries no wallet field, so this is a real gap rather than a defensive nicety.
 * See backlog P-2 for the recipient-shape extension that would close it.
 */
function _resolveDestination(recipient) {
  const destination = recipient?.walletAddress || recipient?.address || recipient?.destination || '';
  if (!destination) throw new MissingRecipientDestinationError();
  return destination;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Send Methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /v3/transfers — Submit a stablecoin disbursement (USDC to a wallet)
 *
 * This is NOT an NGN bank payout. `debit_currency` (from the `currency` param) is
 * taken from the merchant balance; `amount` + `currency: 'USDC'` are delivered to
 * the wallet at `destination`. See the module header and reference §0.
 *
 * `callback_url` is accepted and ignored: Flutterwave registers webhook targets
 * in dashboard settings, not per transfer, so there is no wire field for it. It is
 * kept for interface parity with yellowcardAdapter.js.
 *
 * @param {Object} params
 * @param {string} params.idempotency_key  — carried as `reference`; the local UNIQUE
 *   constraint on idempotency_key is the control that actually holds (§3.5)
 * @param {number|string} params.amount    — passed through VERBATIM; NOT kobo
 * @param {string} [params.currency]       — the DEBIT currency → wire `debit_currency`
 *   (inverted vs Yellow Card — read the module header)
 * @param {string} [params.recipient_type] — accepted for interface parity; the
 *   documented body has no channel field, so it is not sent
 * @param {Object} params.recipient        — { walletAddress | address | destination, network? }
 * @param {string} [params.callback_url]   — accepted, never sent
 * @returns {Promise<{ send_id: string, status: string, reference?: string }>}
 */
export async function submitSend({ idempotency_key, amount, currency, recipient_type, recipient, callback_url }) {
  const destination = _resolveDestination(recipient);

  const body = JSON.stringify({
    account_bank: FLW_ACCOUNT_BANK,
    account_number: FLW_MERCHANT_ID,
    // The `currency` parameter is what gets debited from the merchant balance.
    debit_currency: currency || FLW_DEBIT_CURRENCY,
    amount,
    // What the destination receives. Constant, and NOT the `currency` parameter.
    currency: FLW_SETTLE_CURRENCY,
    network: recipient?.network || FLW_NETWORK,
    destination,
    reference: idempotency_key,
  });

  const url = `${FLW_BASE_URL}/transfers`;
  const resp = await _fetch(url, {
    method: 'POST',
    headers: _headers(),
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Flutterwave transfer failed (${resp.status}): ${text.substring(0, 200)}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();

  // Guardrail: a returned reference that does not echo the key we sent is logged,
  // never silently accepted — duplicate/conflict behaviour stays visible.
  if (idempotency_key && data.reference && data.reference !== idempotency_key) {
    console.warn(
      '[flutterwave] returned reference does not echo the sent idempotency key — ' +
      'provider-side reference uniqueness is UNVERIFIED; local idempotency_key UNIQUE remains the control'
    );
  }

  return {
    send_id: data.id,
    status: _normalizeStatus(data.status),
    reference: data.reference,
  };
}

/**
 * GET /v3/transfers/{sendId} — Lookup transfer status
 *
 * @param {string} sendId — Flutterwave transfer id
 * @returns {Promise<{ status: string, data?: Object }>}
 *   status: 'pending' | 'processing' | 'completed' | 'failed'
 *   data: the full response, so recordApiResponse evidence capture is unchanged
 */
export async function lookupSend(sendId) {
  const url = `${FLW_BASE_URL}/transfers/${sendId}`;
  const resp = await _fetch(url, {
    method: 'GET',
    headers: _headers(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Flutterwave lookup failed (${resp.status}): ${text.substring(0, 200)}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();
  return {
    status: _normalizeStatus(data.status),
    data,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /v3/balances — Health check.
 *
 * UNVERIFIED: the sprint hedged "or equivalent" and this endpoint is not in its
 * confirmed list. If it 404s against a real sandbox only this method needs
 * correcting; it is isolated behind the same four-method interface.
 * Never throws.
 *
 * @returns {Promise<{ healthy: boolean, latencyMs: number, data?: Object, error?: string }>}
 */
export async function healthCheck() {
  const start = Date.now();
  try {
    const url = `${FLW_BASE_URL}/balances`;
    const resp = await _fetch(url, {
      method: 'GET',
      headers: _headers(),
    }, { timeoutMs: 5000 });
    const data = resp.ok ? await resp.json().catch(() => null) : null;
    return { healthy: resp.ok, latencyMs: Date.now() - start, data };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare a `verif-hash` header against FLW_SECRET_HASH.
 *
 * Flutterwave's scheme is a STATIC SHARED SECRET plain-string comparison, not an
 * HMAC — the value is not a function of the body. It therefore cannot be
 * expressed through verifyHmac (webhookVerifier.js), and the canonical
 * `verifyFlutterwaveWebhook` lives there. This adapter-level method is the
 * interface-parity entry point and delegates the same comparison.
 *
 * The secret is read LAZILY inside the function, not bound at module load, so the
 * mandated fail-closed case is directly testable. The default *parameter* is
 * evaluated per call, so the public signature is unchanged.
 *
 * `rawBody` is accepted for interface parity with verifyWebhookSignature but is
 * deliberately NOT part of the comparison — see the security warning in the
 * module header. It carries no integrity guarantee.
 *
 * @param {string|Buffer} _rawBody — accepted for interface parity, unused
 * @param {string} signature — the `verif-hash` header value
 * @param {string} [secret] — defaults to FLW_SECRET_HASH, read per call
 * @returns {boolean} true only on an exact, same-length match
 */
export function verifyWebhookSignature(_rawBody, signature, secret = process.env.FLW_SECRET_HASH || '') {
  if (!secret || !signature) return false;
  const a = Buffer.from(String(signature), 'utf8');
  const b = Buffer.from(String(secret), 'utf8');
  // timingSafeEqual throws on length mismatch; Flutterwave documents a plain
  // ===, so a length check first is both safe and observably identical.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default {
  submitSend,
  lookupSend,
  healthCheck,
  verifyWebhookSignature,
  classifyError,
};
