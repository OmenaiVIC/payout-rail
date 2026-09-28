/**
 * BOS Webhook Routes — External callback receivers
 *
 * Handles Yellow Card and Flutterwave payout status callbacks with verify-first
 * ordering:
 *   1. Verify the signature over the RAW body (req.rawBody from express.json verify)
 *   2. Reject unsigned / invalid payloads with 401, touching no state
 *   3. Handle the payload idempotently (no double-advance on duplicates)
 *
 * The two providers use different schemes and are therefore verified separately:
 * Yellow Card sends a per-body HMAC-SHA256; Flutterwave sends `verif-hash`, a
 * STATIC SHARED SECRET plain-string comparison that is not a function of the
 * body. The Flutterwave route's own verify-first guarantees are weaker for that
 * reason — see the security warning in handleFlutterwaveWebhook and in
 * flutterwaveAdapter.js.
 *
 * When no webhook secret is configured, verification FAILS CLOSED — an
 * unauthenticated callback is rejected rather than trusted.
 */

import { Router } from 'express';
import { handleYellowCardWebhook, handleFlutterwaveWebhook } from '../services/bos/disbursementService.js';
import { verifyYellowCardWebhook, verifyFlutterwaveWebhook } from '../services/bos/webhookVerifier.js';
import { requireApiToken } from './disbursements.js';

const router = Router();

/** Verify the raw body signature; never trusts req.body (parsed JSON). */
function verifyRequest(req) {
  const rawBody = req.rawBody;
  if (!Buffer.isBuffer(rawBody)) {
    return { valid: false, reason: 'raw_body_unavailable' };
  }
  return verifyYellowCardWebhook(rawBody, req.headers);
}

/** Same guard, Flutterwave scheme: requires a raw buffer, then the verif-hash compare. */
function verifyFlutterwaveRequest(req) {
  const rawBody = req.rawBody;
  if (!Buffer.isBuffer(rawBody)) {
    return { valid: false, reason: 'raw_body_unavailable' };
  }
  return verifyFlutterwaveWebhook(rawBody, req.headers);
}

/**
 * POST /yellowcard — Yellow Card payout status webhook
 * Called by Yellow Card when a payout completes or fails.
 *
 * Expected signed body: { payout_id, status, reference, ... }
 */
router.post('/yellowcard', async (req, res) => {
  try {
    const verification = verifyRequest(req);
    if (!verification.valid) {
      return res.status(401).json({ processed: false, reason: verification.reason || 'invalid_signature' });
    }

    const result = await handleYellowCardWebhook(req.body, { signatureValid: true });
    res.json(result);
  } catch (err) {
    console.error('[bos:webhook] Yellow Card webhook failed:', err.message);
    res.status(500).json({ processed: false, error: err.message });
  }
});

/**
 * POST /yellowcard/test — Manual webhook injection for testing
 * Accepts a payout_id + status and advances the disbursement.
 * Requires the same admin bearer token as the rest of the disbursement API.
 */
router.post('/yellowcard/test', requireApiToken, async (req, res) => {
  try {
    const { payout_id, status } = req.body || {};
    if (!payout_id || !status) {
      return res.status(400).json({ error: 'payout_id and status required' });
    }
    const result = await handleYellowCardWebhook({ payout_id, status });
    res.json(result);
  } catch (err) {
    console.error('[bos:webhook] Test webhook failed:', err.message);
    res.status(500).json({ processed: false, error: err.message });
  }
});

/**
 * POST /flutterwave — Flutterwave transfer status webhook
 * Called by Flutterwave when a transfer reaches a terminal state.
 *
 * Expected body: { event: 'transfer.completed', data: { id, status, reference, ... } }
 *
 * ⚠ Verified with `verif-hash`, a STATIC SHARED SECRET plain-string comparison —
 * NOT a per-body HMAC. It authenticates the sender only: it provides no payload
 * integrity, so anyone holding FLW_SECRET_HASH can forge an arbitrary
 * transfer.completed payload, and it provides no replay protection, so a
 * captured request is replayable forever.
 *
 * The load-bearing control is NOT this signature. It is the local
 * `idempotency_key` UNIQUE constraint (migrations/001_bos_schema.sql:43): the
 * handler resolves the target from data.reference, which carries the idempotency
 * key, so a replay collides there. As implemented this sprint the handler
 * additionally holds no state to corrupt — see handleFlutterwaveWebhook.
 *
 * Fails CLOSED: an unset FLW_SECRET_HASH rejects every delivery with 401.
 * Never log FLW_SECRET_HASH or the verif-hash header value.
 */
router.post('/flutterwave', async (req, res) => {
  try {
    const verification = verifyFlutterwaveRequest(req);
    if (!verification.valid) {
      return res.status(401).json({ processed: false, reason: verification.reason || 'invalid_signature' });
    }

    const result = await handleFlutterwaveWebhook(req.body, { signatureValid: true });
    res.json(result);
  } catch (err) {
    console.error('[bos:webhook] Flutterwave webhook failed:', err.message);
    res.status(500).json({ processed: false, error: err.message });
  }
});

export default router;