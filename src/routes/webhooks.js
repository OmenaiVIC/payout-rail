/**
 * BOS Webhook Routes — External callback receivers
 *
 * Handles Yellow Card payout status callbacks with verify-first ordering:
 *   1. Verify the HMAC over the RAW body (req.rawBody from express.json verify)
 *   2. Reject unsigned / invalid payloads with 401, touching no state
 *   3. Handle the payload idempotently (no double-advance on duplicates)
 *
 * When no webhook secret is configured, verification FAILS CLOSED — an
 * unauthenticated callback is rejected rather than trusted.
 */

import { Router } from 'express';
import { handleYellowCardWebhook } from '../services/bos/disbursementService.js';
import { verifyYellowCardWebhook } from '../services/bos/webhookVerifier.js';
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

export default router;