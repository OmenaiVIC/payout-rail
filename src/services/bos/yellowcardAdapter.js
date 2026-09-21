/**
 * BOS Yellow Card Bridge Adapter — REST client for Yellow Card NGN payout API
 *
 * Implements the adapter interface consumed by transitionGuards.js and transitionActions.js.
 *
 * Auth: YcHmacV1 scheme — HMAC-SHA256 signature over (timestamp + apiKey + bodyHash)
 *       using YELLOW_CARD_SECRET_KEY. Not Bearer tokens.
 *
 * Endpoints: Base URL is /business (NOT /v1).
 *   Sandbox: https://sandbox.api.yellowcard.io/business
 *   Production: https://api.yellowcard.io/business
 *
 * Reference: docs/yellowcard-api-reference.md
 */

import crypto from 'node:crypto';
import { verifyHmac } from './webhookVerifier.js';

const YELLOW_CARD_API_URL = process.env.YELLOW_CARD_API_URL || 'https://api.yellowcard.io/business';
const YELLOW_CARD_API_KEY = process.env.YELLOW_CARD_API_KEY || '';
const YELLOW_CARD_SECRET_KEY = process.env.YELLOW_CARD_SECRET_KEY || '';
const YELLOW_CARD_ENV = process.env.YELLOW_CARD_ENV || 'production'; // 'sandbox' | 'production'
const YELLOW_CARD_WEBHOOK_SECRET = process.env.YELLOW_CARD_WEBHOOK_SECRET || '';

/**
 * Error taxonomy for Yellow Card API errors.
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
 * Compute YcHmacV1 signature for Yellow Card API request.
 *
 * Signature = HMAC-SHA256(secret, timestamp + apiKey + bodyHash)
 * bodyHash  = SHA-256 hex of request body (empty string for GET/DELETE)
 * timestamp = ISO-8601 UTC, e.g. "2026-07-23T12:00:00Z"
 *
 * @param {string} method — HTTP method
 * @param {string|null} body — raw JSON body string (null for GET)
 * @param {string} secret — YELLOW_CARD_SECRET_KEY
 * @param {string} apiKey — YELLOW_CARD_API_KEY
 * @returns {{ authorization: string, timestamp: string }}
 */
function _computeAuth(method, body, secret = YELLOW_CARD_SECRET_KEY, apiKey = YELLOW_CARD_API_KEY) {
  if (!secret || !apiKey) {
    return { authorization: '', timestamp: '' };
  }
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bodyHash = (body && method !== 'GET' && method !== 'DELETE')
    ? crypto.createHash('sha256').update(body).digest('hex')
    : '';
  const message = timestamp + apiKey + bodyHash;
  const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const authValue = `YcHmacV1 ${JSON.stringify({ timestamp, apiKey, bodyHash, signature })}`;
  return { authorization: authValue, timestamp };
}

/**
 * Build common fetch options for Yellow Card API calls
 */
function _headers(method, body, extra = {}) {
  const { authorization } = _computeAuth(method, body);
  return {
    'Content-Type': 'application/json',
    ...(authorization ? { 'Authorization': authorization } : {}),
    ...extra,
  };
}

/**
 * Execute a fetch with timeout and error classification
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
    const classified = classifyError(err);
    err._classification = classified;
    throw err;
  }
}

/**
 * Compute HMAC-SHA256 signature for webhook payload verification
 *
 * @param {string|Buffer} payload — raw request body
 * @param {string} secret — webhook signing secret
 * @returns {string} hex-encoded HMAC signature
 */
export function signWebhook(payload, secret = YELLOW_CARD_WEBHOOK_SECRET) {
  if (!secret) return '';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return hmac.digest('hex');
}

/**
 * Verify a webhook signature against the expected HMAC
 *
 * Delegates to the canonical verifier in webhookVerifier.js — there is exactly
 * one HMAC implementation in the codebase.
 *
 * @param {string|Buffer} payload — raw request body
 * @param {string} signature — signature from webhook header (may include 'sha256=' prefix)
 * @param {string} secret — webhook signing secret
 * @returns {boolean} true if signature is valid
 */
export function verifyWebhookSignature(payload, signature, secret = YELLOW_CARD_WEBHOOK_SECRET) {
  if (!secret || !signature) return false;
  return verifyHmac(payload, signature, secret);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Send Methods (NGN Payout)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /business/send — Submit NGN payout request
 *
 * @param {Object} params
 * @param {string} params.idempotency_key   — unique key to prevent duplicate payouts
 * @param {number|string} params.amount     — amount in NGN kobo (smallest unit)
 * @param {string} params.currency          — 'NGN'
 * @param {string} params.recipient_type    — 'bank_account' | 'mobile_money'
 * @param {Object} params.recipient         — { bankCode, accountNumber, accountName?, type? }
 * @param {string} [params.callback_url]    — webhook URL for status updates
 * @returns {Promise<{ send_id: string, status: string, sequence_id?: string }>}
 */
export async function submitSend({ idempotency_key, amount, currency, recipient_type, recipient, callback_url }) {
  const body = JSON.stringify({
    amount: String(amount),
    currency: currency || 'NGN',
    recipientType: recipient_type || 'bank_account',
    recipient: recipient || {},
    callbackUrl: callback_url || '',
  });
  const url = `${YELLOW_CARD_API_URL}/send`;
  const resp = await _fetch(url, {
    method: 'POST',
    headers: _headers('POST', body, { 'X-Idempotency-Key': idempotency_key || '' }),
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Yellow Card send failed (${resp.status}): ${text.substring(0, 200)}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();
  return {
    send_id: data.id || data.paymentId || data.sendId,
    status: normalizeStatus(data.status),
    sequence_id: data.sequenceId || undefined,
  };
}

/**
 * GET /business/send/{sendId} — Lookup payout status
 *
 * @param {string} sendId — Yellow Card send ID
 * @returns {Promise<{ status: string, data?: Object }>}
 *   status: 'pending' | 'processing' | 'completed' | 'failed'
 */
export async function lookupSend(sendId) {
  const url = `${YELLOW_CARD_API_URL}/send/${sendId}`;
  const resp = await _fetch(url, {
    method: 'GET',
    headers: _headers('GET', null),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Yellow Card lookup failed (${resp.status}): ${text.substring(0, 200)}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();
  return {
    status: normalizeStatus(data.status),
    data,
  };
}

/**
 * GET /business/sends — List sends with optional filters
 *
 * @param {Object} [params]
 * @param {number} [params.limit]   — max results (default 20)
 * @param {number} [params.offset]  — pagination offset
 * @param {string} [params.status]  — filter by status
 * @returns {Promise<{ sends: Array, total?: number }>}
 */
export async function listSends({ limit, offset, status } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  if (status) params.set('status', status);
  const qs = params.toString();
  const url = `${YELLOW_CARD_API_URL}/sends${qs ? '?' + qs : ''}`;
  const resp = await _fetch(url, {
    method: 'GET',
    headers: _headers('GET', null),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Yellow Card list sends failed (${resp.status}): ${text.substring(0, 200)}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();
  return { sends: data.sends || data.data || data, total: data.total };
}

/**
 * GET /business/sends/fee — Get fee estimate for a send
 *
 * @param {Object} params
 * @param {number|string} params.amount   — amount in NGN kobo
 * @param {string} params.currency        — 'NGN'
 * @returns {Promise<{ fee: number, total: number }>}
 */
export async function getSendFee({ amount, currency = 'NGN' }) {
  const params = new URLSearchParams({ amount: String(amount), currency });
  const url = `${YELLOW_CARD_API_URL}/sends/fee?${params.toString()}`;
  const resp = await _fetch(url, {
    method: 'GET',
    headers: _headers('GET', null),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Yellow Card fee query failed (${resp.status}): ${text.substring(0, 200)}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();
  return {
    fee: data.fee || 0,
    total: data.total || Number(amount),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Account & Config Methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /business/account — Health check / verify API is reachable
 * @returns {Promise<{ healthy: boolean, latencyMs?: number, data?: Object, error?: string }>}
 */
export async function healthCheck() {
  const start = Date.now();
  try {
    const resp = await _fetch(`${YELLOW_CARD_API_URL}/account`, {
      method: 'GET',
      headers: _headers('GET', null),
    }, { timeoutMs: 5000 });
    const data = resp.ok ? await resp.json().catch(() => null) : null;
    return { healthy: resp.ok, latencyMs: Date.now() - start, data };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err.message };
  }
}

/**
 * POST /business/details/bank — Resolve/verify a bank account
 *
 * @param {Object} params
 * @param {string} params.bankCode      — bank code (e.g., '044' for Access Bank)
 * @param {string} params.accountNumber — account number
 * @returns {Promise<{ valid: boolean, account_name?: string, bank_name?: string }>}
 */
export async function resolveBankAccount({ bankCode, accountNumber }) {
  const body = JSON.stringify({ bankCode, accountNumber });
  const url = `${YELLOW_CARD_API_URL}/details/bank`;
  const resp = await _fetch(url, {
    method: 'POST',
    headers: _headers('POST', body),
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Yellow Card bank resolve failed (${resp.status}): ${text.substring(0, 200)}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();
  return {
    valid: true,
    account_name: data.accountName || data.account_name,
    bank_name: data.bankName || data.bank_name,
    ...data,
  };
}

/**
 * GET /business/channels — List available payout channels
 *
 * @returns {Promise<{ channels: Array }>}
 */
export async function getChannels() {
  const url = `${YELLOW_CARD_API_URL}/channels`;
  const resp = await _fetch(url, {
    method: 'GET',
    headers: _headers('GET', null),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Yellow Card channels query failed (${resp.status}): ${text.substring(0, 200)}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();
  return { channels: data.channels || data.data || data };
}

/**
 * GET /business/rates — Get current exchange rates
 *
 * @param {Object} [params]
 * @param {string} [params.from]  — source currency (e.g., 'USDC')
 * @param {string} [params.to]    — target currency (e.g., 'NGN')
 * @param {number|string} [params.amount] — amount for conversion estimate
 * @returns {Promise<{ rate: number, from?: string, to?: string }>}
 */
export async function getRates({ from, to, amount } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (amount) params.set('amount', String(amount));
  const qs = params.toString();
  const url = `${YELLOW_CARD_API_URL}/rates${qs ? '?' + qs : ''}`;
  const resp = await _fetch(url, {
    method: 'GET',
    headers: _headers('GET', null),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Yellow Card rates query failed (${resp.status}): ${text.substring(0, 200)}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();
  return {
    rate: data.rate || data.data?.rate,
    from: data.from || from,
    to: data.to || to,
    ...data,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-Compat Aliases
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use submitSend() instead. Kept for backward compatibility.
 */
export async function initiatePayout({ idempotency_key, amount, recipient_type, recipient, currency, callback_url }) {
  return submitSend({ idempotency_key, amount, recipient_type, recipient, currency, callback_url });
}

/**
 * @deprecated Use lookupSend() instead. Kept for backward compatibility.
 */
export async function getPayoutStatus(payoutId) {
  return lookupSend(payoutId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize Yellow Card status values to canonical BOS statuses
 * @param {string} raw — status from Yellow Card API
 * @returns {string} normalized status
 */
function normalizeStatus(raw) {
  if (!raw) return 'pending';
  if (raw === 'successful') return 'completed';
  return raw;
}

export default {
  // Core send methods
  submitSend,
  lookupSend,
  listSends,
  getSendFee,
  // Account & config
  healthCheck,
  resolveBankAccount,
  getChannels,
  getRates,
  // Webhook verification
  signWebhook,
  verifyWebhookSignature,
  // Error classification
  classifyError,
  // Backward-compat aliases
  initiatePayout,
  getPayoutStatus,
};
