/**
 * BOS Webhook Verifier — HMAC-SHA256 signature verification for incoming webhooks
 *
 * Validates webhook authenticity from xReserve and Yellow Card.
 * Supports configurable secret per adapter.
 */

import crypto from 'node:crypto';

function getXReserveSecret() { return process.env.XRESERVE_WEBHOOK_SECRET || ''; }
function getYellowCardSecret() { return process.env.YELLOW_CARD_WEBHOOK_SECRET || ''; }

/**
 * Verify HMAC-SHA256 signature of a webhook payload
 *
 * @param {string} payload — raw request body (string)
 * @param {string} signature — signature from header (hex or base64)
 * @param {string} secret — shared secret
 * @param {string} algorithm — 'sha256' (default)
 * @returns {boolean}
 */
function verifyHmac(payload, signature, secret, algorithm = 'sha256') {
  if (!payload || !signature || !secret) return false;

  const expected = crypto
    .createHmac(algorithm, secret)
    .update(payload, 'utf8')
    .digest('hex');

  // Support both hex and base64 signatures
  let sigHex = signature;
  if (signature.startsWith('sha256=')) {
    sigHex = signature.slice(7);
  } else if (signature.startsWith('hmac-sha256,')) {
    sigHex = signature.slice(12);
  }

  // Constant-time comparison
  try {
    const sigBuf = Buffer.from(sigHex, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Verify an xReserve webhook
 *
 * Headers checked: X-Signature, X-Hub-Signature-256
 * @param {string} rawBody
 * @param {Object} headers — request headers
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyXReserveWebhook(rawBody, headers) {
  const secret = getXReserveSecret();
  if (!secret) {
    // No secret configured — skip verification in dev
    return { valid: true, reason: 'no_secret_configured' };
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
 * Headers checked: X-Signature, X-YellowCard-Signature
 * @param {string} rawBody
 * @param {Object} headers — request headers
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyYellowCardWebhook(rawBody, headers) {
  const secret = getYellowCardSecret();
  if (!secret) {
    return { valid: true, reason: 'no_secret_configured' };
  }

  const signature =
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
 * Generic webhook verification — auto-detects source
 * @param {string} source — 'xreserve' | 'yellowcard'
 * @param {string} rawBody
 * @param {Object} headers
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyWebhook(source, rawBody, headers) {
  switch (source) {
    case 'xreserve':
      return verifyXReserveWebhook(rawBody, headers);
    case 'yellowcard':
      return verifyYellowCardWebhook(rawBody, headers);
    default:
      return { valid: false, reason: `unknown_source: ${source}` };
  }
}

module.exports = {
  verifyHmac,
  verifyXReserveWebhook,
  verifyYellowCardWebhook,
  verifyWebhook,
};
