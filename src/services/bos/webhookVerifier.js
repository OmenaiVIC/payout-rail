/**
 * BOS Webhook Verifier — signature verification for incoming webhooks
 */

import crypto from 'node:crypto';

function getXReserveSecret() { return process.env.XRESERVE_WEBHOOK_SECRET || ''; }
function getYellowCardSecret() { return process.env.YELLOW_CARD_WEBHOOK_SECRET || ''; }
function getFlutterwaveSecret() { return process.env.FLW_SECRET_HASH || ''; }
function getBreetSecret() { return process.env.BREET_WEBHOOK_SECRET || ''; }

/**
 * Verify HMAC-SHA256 signature of a webhook payload
 */
function verifyHmac(payload, signature, secret, algorithm = 'sha256') {
  if (!payload || !signature || !secret) return false;

  const expectedHex = crypto
    .createHmac(algorithm, secret)
    .update(payload, 'utf8')
    .digest('hex');
  const expectedBase64 = Buffer.from(expectedHex, 'hex').toString('base64');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  let sig = signature.trim();
  if (sig.startsWith('sha256=')) {
    sig = sig.slice(7);
  } else if (sig.startsWith('hmac-sha256,')) {
    sig = sig.slice(12);
  }

  if (sig === expectedBase64) return true;

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

function verifyFlutterwaveWebhook(rawBody, headers) {
  const secret = getFlutterwaveSecret();
  if (!secret) {
    return { valid: false, reason: 'no_secret_configured' };
  }

  const signature = headers['verif-hash'] || '';

  if (!signature) {
    return { valid: false, reason: 'missing_signature' };
  }

  const a = Buffer.from(String(signature), 'utf8');
  const b = Buffer.from(secret, 'utf8');
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return valid ? { valid: true } : { valid: false, reason: 'invalid_signature' };
}

function verifyBreetWebhook(rawBody, headers) {
  const secret = getBreetSecret();
  if (!secret) {
    return { valid: false, reason: 'no_secret_configured' };
  }

  const signature = headers['x-webhook-secret'] || '';

  if (!signature) {
    return { valid: false, reason: 'missing_signature' };
  }

  const a = Buffer.from(String(signature), 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length) {
    return { valid: false, reason: 'invalid_signature' };
  }
  const valid = crypto.timingSafeEqual(a, b);
  return valid ? { valid: true } : { valid: false, reason: 'invalid_signature' };
}

/**
 * Generic webhook verification — auto-detects source
 */
function verifyWebhook(source, rawBody, headers) {
  switch (source) {
    case 'xreserve':
      return verifyXReserveWebhook(rawBody, headers);
    case 'yellowcard':
      return verifyYellowCardWebhook(rawBody, headers);
    case 'flutterwave':
      return verifyFlutterwaveWebhook(rawBody, headers);
    case 'breet':
      return verifyBreetWebhook(rawBody, headers);
    default:
      return { valid: false, reason: `unknown_source: ${source}` };
  }
}

export {
  verifyHmac,
  verifyXReserveWebhook,
  verifyYellowCardWebhook,
  verifyFlutterwaveWebhook,
  verifyBreetWebhook,
  verifyWebhook,
};