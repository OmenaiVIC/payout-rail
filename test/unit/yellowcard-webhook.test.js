/**
 * Sprint 3 contract tests — Yellow Card webhook verification (G-05/G-06).
 *
 * Yellow Card signs webhooks with x-yc-signature carrying a BASE64 HMAC digest
 * (docs example 'fakno+9epoa/obe='). Tests: the documented header resolves
 * first, base64 digests verify, hex + sha256= prefixes still verify for legacy
 * callers, tampering fails, unconfigured secret fails closed, and the adapter's
 * signWebhook emits a base64 signature its own verifier accepts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const SECRET = 'webhook-test-secret';
const PAYLOAD = '{"paymentId":"yc-payout-1","status":"successful"}';

function base64Sig(payload = PAYLOAD, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}
function hexSig(payload = PAYLOAD, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

let verified;
let adapter;
let verifier;

test.before(async () => {
  process.env.YELLOW_CARD_WEBHOOK_SECRET = SECRET;
  process.env.XRESERVE_WEBHOOK_SECRET = SECRET;
  verifier = await import('../../src/services/bos/webhookVerifier.js');
  adapter = await import('../../src/services/bos/yellowcardAdapter.js?case=webhook-1');
});

test.after(() => {
  delete process.env.YELLOW_CARD_WEBHOOK_SECRET;
  delete process.env.XRESERVE_WEBHOOK_SECRET;
});

test('x-yc-signature (base64) verifies', () => {
  verified = verifier.verifyYellowCardWebhook(PAYLOAD, { 'x-yc-signature': base64Sig() });
  assert.deepEqual(verified, { valid: true });
});

test('x-yc-signature with sha256= prefix verifies', () => {
  const withPrefix = `sha256=${base64Sig()}`;
  assert.deepEqual(verifier.verifyYellowCardWebhook(PAYLOAD, { 'x-yc-signature': withPrefix }), { valid: true });
});

test('legacy header candidates still verify (hex via x-yellowcard-signature, signed hex prefix via x-signature)', () => {
  assert.deepEqual(verifier.verifyYellowCardWebhook(PAYLOAD, { 'x-yellowcard-signature': hexSig() }), { valid: true });
  assert.deepEqual(verifier.verifyYellowCardWebhook(PAYLOAD, { 'x-hub-signature-256': `sha256=${hexSig()}` }), { valid: true });
});

test('base64 signature is accepted even though a strict hex parser would reject it', () => {
  const weirdButValid = base64Sig(); // contains '+' and/or '/' — invalid hex chars
  assert.match(weirdButValid, /[+/]/, 'base64 HMAC digests carry non-hex chars by construction');
  assert.deepEqual(verifier.verifyYellowCardWebhook(PAYLOAD, { 'x-yc-signature': weirdButValid }), { valid: true });
});

test('xreserve verifier accepts hex and sha256= hex too', () => {
  assert.deepEqual(verifier.verifyXReserveWebhook(PAYLOAD, { 'x-signature': hexSig() }), { valid: true });
  assert.deepEqual(verifier.verifyXReserveWebhook(PAYLOAD, { 'x-hub-signature-256': `sha256=${hexSig()}` }), { valid: true });
});

test('tampered body rejects regardless of encoding', () => {
  const tampered = '{"paymentId":"yc-payout-1","status":"successful","extra":1}';
  assert.deepEqual(
    verifier.verifyYellowCardWebhook(tampered, { 'x-yc-signature': base64Sig() }),
    { valid: false, reason: 'invalid_signature' },
  );
  assert.deepEqual(
    verifier.verifyYellowCardWebhook(PAYLOAD, { 'x-yc-signature': base64Sig('other') }),
    { valid: false, reason: 'invalid_signature' },
  );
});

test('wrong secret rejects', () => {
  assert.deepEqual(
    verifier.verifyYellowCardWebhook(PAYLOAD, { 'x-yc-signature': base64Sig(PAYLOAD, 'other-secret') }),
    { valid: false, reason: 'invalid_signature' },
  );
});

test('missing signature -> missing_signature', () => {
  assert.deepEqual(verifier.verifyYellowCardWebhook(PAYLOAD, {}), { valid: false, reason: 'missing_signature' });
});

test('unconfigured secret fails closed even with a valid signature', async () => {
  delete process.env.YELLOW_CARD_WEBHOOK_SECRET;
  try {
    assert.deepEqual(
      verifier.verifyYellowCardWebhook(PAYLOAD, { 'x-yc-signature': base64Sig() }),
      { valid: false, reason: 'no_secret_configured' },
    );
  } finally {
    process.env.YELLOW_CARD_WEBHOOK_SECRET = SECRET;
  }
});

test('adapter.signWebhook emits base64 that its own verifyWebhookSignature accepts', () => {
  const sig = adapter.signWebhook(PAYLOAD);
  assert.match(sig, /^[A-Za-z0-9+/]+={0,2}$/, 'signWebhook must be base64 (docs example shape)');
  assert.equal(adapter.verifyWebhookSignature(PAYLOAD, sig, SECRET), true);
  assert.equal(adapter.verifyWebhookSignature('tampered', sig, SECRET), false);
});

test('verifyHmac accepts hex, base64, and base64url encodings, rejects noise', () => {
  assert.equal(verifier.verifyHmac(PAYLOAD, hexSig(), SECRET), true);
  assert.equal(verifier.verifyHmac(PAYLOAD, base64Sig(), SECRET), true);
  assert.equal(verifier.verifyHmac(PAYLOAD, Buffer.from(base64Sig(), 'base64').toString('base64url').replace(/=+$/, ''), SECRET), true);
  assert.equal(verifier.verifyHmac(PAYLOAD, 'not-a-signature', SECRET), false);
  assert.equal(verifier.verifyHmac(PAYLOAD, '', SECRET), false);
  assert.equal(verifier.verifyHmac(PAYLOAD, base64Sig(), ''), false);
});