/**
 * BOS Webhook Verifier — signature verification for incoming webhooks
 *
 * Validates webhook authenticity from xReserve, Yellow Card and Flutterwave.
 * Supports configurable secret per adapter.
 *
 * ESM, single canonical verifier: adapter-level verifyWebhookSignature
 * (yellowcardAdapter.js, flutterwaveAdapter.js) delegates here. Fails CLOSED:
 * when no secret is configured the payload is rejected, never trusted.
 *
 * Two schemes live here, and they are not interchangeable:
 *
 *   - verifyHmac (xReserve, Yellow Card): a per-body HMAC-SHA256 digest. The
 *     signature is a function of the body, so tampering invalidates it.
 *   - verifyFlutterwaveWebhook: a STATIC SHARED SECRET plain-string comparison
 *     of the `verif-hash` header. It is NOT a function of the body, so it cannot
 *     be expressed through verifyHmac — no verif-hash value is ever such a
 *     digest, and routing Flutterwave through verifyHmac would silently reject
 *     every genuine Flutterwave webhook.
 */

import crypto from 'node:crypto';

function getXReserveSecret() { return process.env.XRESERVE_WEBHOOK_SECRET || ''; }
function getYellowCardSecret() { return process.env.YELLOW_CARD_WEBHOOK_SECRET || ''; }

// Read lazily at call time (like the getters above) so the unconfigured case is
// testable without cache-busted re-imports.
function getFlutterwaveSecret() { return process.env.FLW_SECRET_HASH || ''; }

/**
 * Verify HMAC-SHA256 signature of a webhook payload
 *
 * Yellow Card signs webhooks with a BASE64 digest (docs /docs/webhooks-api,
 * example 'fakno+9epoa/obe='); xReserve and legacy callers use hex. One check
 * therefore accepts all three encodings: the expected digest is computed once
 * (hex internally, base64 string for the fast path), the documented prefixes
 * ('sha256=', 'hmac-sha256,') are stripped, and the supplied signature is
 * decoded as hex / base64 / base64url and compared in constant time — only
 * against buffers of the same byte length (timingSafeEqual throws otherwise,
 * and a wrong-encoding decode has the wrong length so it is excluded cheaply).
 * Fail-closed: no payload / signature / secret rejects.
 *
 * @param {string|Buffer} payload — raw request body
 * @param {string} signature — signature from header (hex, base64, or base64url; optional prefix)
 * @param {string} secret — shared secret
 * @param {string} algorithm — 'sha256' (default)
 * @returns {boolean}
 */
function verifyHmac(payload, signature, secret, algorithm = 'sha256') {
  if (!payload || !signature || !secret) return false;

  const expectedHex = crypto
    .createHmac(algorithm, secret)
    .update(payload, 'utf8')
    .digest('hex');
  const expectedBase64 = Buffer.from(expectedHex, 'hex').toString('base64');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  // Strip documented signature prefixes before decoding.
  let sig = signature.trim();
  if (sig.startsWith('sha256=')) {
    sig = sig.slice(7);
  } else if (sig.startsWith('hmac-sha256,')) {
    sig = sig.slice(12);
  }

  // Fast path: exact base64 match (the encoding Yellow Card uses). A string
  // equal to a valid base64 digest can never also be a valid hex digest —
  // base64 of 32 bytes is 44 chars, hex is 32 — so this cannot false-positive.
  if (sig === expectedBase64) return true;

  // Constant-time comparison across candidate encodings (hex / base64 /
  // base64url): a hex sig decodes via base64 too, but to the wrong length,
  // so the length guard keeps timingSafeEqual on equal-length buffers only.
  for (const enc of ['hex', 'base64', 'base64url']) {
    let cand;
    try {
      cand = Buffer.from(sig, enc);
    } catch {
      continue;
    }
    if (cand.length !== expectedBuf.length) continue;
    try {
      if (crypto.timingSafeEqual(cand, expectedBuf)) return true;
    } catch {
      // fall through to next candidate
    }
  }
  return false;
}

/**
 * Verify an xReserve webhook
 *
 * Headers checked: X-Signature, X-Hub-Signature-256
 * Fail-closed: an unconfigured secret rejects, rather than skipping, checks.
 * @param {string|Buffer} rawBody
 * @param {Object} headers — request headers
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyXReserveWebhook(rawBody, headers) {
  const secret = getXReserveSecret();
  if (!secret) {
    return { valid: false, reason: 'no_secret_configured' };
  }

  const signature =
    headers['x-signature'] ||
    headers['x-hub-signature-256'] ||
    headers['x-xreserve-signature'] ||
    '';

  if (!signature) {
    return { valid: false, reason: 'missing_signature' };
  }

  const valid = verifyHmac(rawBody, signature, secret);
  return valid ? { valid: true } : { valid: false, reason: 'invalid_signature' };
}

/**
 * Verify a Yellow Card webhook
 *
 * Headers checked (in order): X-YC-Signature (the header Yellow Card documents —
 * base64), then the legacy x-signature / x-yellowcard-signature / x-hub-signature-256
 * candidates retained for compatibility.
 * Fail-closed: an unconfigured secret rejects, rather than skipping, checks.
 * @param {string|Buffer} rawBody
 * @param {Object} headers — request headers
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyYellowCardWebhook(rawBody, headers) {
  const secret = getYellowCardSecret();
  if (!secret) {
    return { valid: false, reason: 'no_secret_configured' };
  }

  const signature =
    headers['x-yc-signature'] ||
    headers['x-signature'] ||
    headers['x-yellowcard-signature'] ||
    headers['x-hub-signature-256'] ||
    '';

  if (!signature) {
    return { valid: false, reason: 'missing_signature' };
  }

  const valid = verifyHmac(rawBody, signature, secret);
  return valid ? { valid: true } : { valid: false, reason: 'invalid_signature' };
}

/**
 * Verify a Flutterwave webhook
 *
 * Header checked: verif-hash — compared as a PLAIN STRING against the static
 * FLW_SECRET_HASH secret. This is not an HMAC; the header value is not derived
 * from the request body, so `rawBody` is accepted for signature parity with the
 * other verifiers and is deliberately NOT part of the comparison.
 *
 * ⚠ SECURITY — this scheme is materially weaker than the HMAC used for xReserve
 * and Yellow Card. Because the value is a static shared secret rather than a body
 * digest, it authenticates the SENDER ONLY and provides:
 *   - no payload integrity — a forged body with a valid hash verifies exactly as
 *     well as a genuine one, so anyone holding FLW_SECRET_HASH can forge an
 *     arbitrary transfer.completed payload; and
 *   - no replay protection — a captured valid request is replayable forever.
 *     The scheme has nowhere to carry a timestamp or nonce, so no additional
 *     check can be added here.
 *
 * The load-bearing compensating control is NOT this comparison — it is the local
 * durable idempotency_key UNIQUE constraint (migrations/001_bos_schema.sql:43).
 * The handler derives the disbursement from data.reference, which carries the
 * idempotency key, so a replayed webhook collides on that constraint and cannot
 * advance a second payout. If the secret is rotated or that constraint is ever
 * relaxed, the replay risk becomes real. Treat FLW_SECRET_HASH as a credential:
 * never committed, never logged, and never log the verif-hash header value.
 *
 * Fail-closed: an unconfigured secret rejects, rather than skipping, checks.
 *
 * @param {string|Buffer} rawBody — accepted for interface parity; unused
 * @param {Object} headers — request headers
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyFlutterwaveWebhook(rawBody, headers) {
  const secret = getFlutterwaveSecret();
  if (!secret) {
    return { valid: false, reason: 'no_secret_configured' };
  }

  const signature = headers['verif-hash'] || '';

  if (!signature) {
    return { valid: false, reason: 'missing_signature' };
  }

  // Constant-time over equal-length buffers. timingSafeEqual throws on a length
  // mismatch, and a length check also matches Flutterwave's documented exact
  // string comparison observably.
  const a = Buffer.from(String(signature), 'utf8');
  const b = Buffer.from(secret, 'utf8');
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return valid ? { valid: true } : { valid: false, reason: 'invalid_signature' };
}

/**
 * Generic webhook verification — auto-detects source
 * @param {string} source — 'xreserve' | 'yellowcard' | 'flutterwave'
 * @param {string|Buffer} rawBody
 * @param {Object} headers
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyWebhook(source, rawBody, headers) {
  switch (source) {
    case 'xreserve':
      return verifyXReserveWebhook(rawBody, headers);
    case 'yellowcard':
      return verifyYellowCardWebhook(rawBody, headers);
    case 'flutterwave':
      return verifyFlutterwaveWebhook(rawBody, headers);
    default:
      return { valid: false, reason: `unknown_source: ${source}` };
  }
}

export {
  verifyHmac,
  verifyXReserveWebhook,
  verifyYellowCardWebhook,
  verifyFlutterwaveWebhook,
  verifyWebhook,
};
