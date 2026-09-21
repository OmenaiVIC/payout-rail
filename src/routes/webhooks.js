/**
 * BOS Webhook Routes — External callback receivers
 * Handles Yellow Card payout status callbacks
 */

import { Router } from 'express';
import { handleYellowCardWebhook } from '../services/bos/disbursementService.js';

const router = Router();

/**
 * POST /yellowcard — Yellow Card payout status webhook
 * Called by Yellow Card when a payout completes or fails.
 *
 * Expected body: { payout_id, status, reference, ... }
 */
router.post('/yellowcard', async (req, res) => {
  try {
    const result = await handleYellowCardWebhook(req.body);
    res.json(result);
  } catch (err) {
    console.error('[bos:webhook] Yellow Card webhook failed:', err.message);
    res.status(500).json({ processed: false, error: err.message });
  }
});

/**
 * POST /yellowcard/test — Manual webhook injection for testing
 * Accepts a disbursement_id + status and advances the disbursement.
 * Only available in non-production environments.
 */
router.post('/yellowcard/test', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Test webhook disabled in production' });
  }

  try {
    const { payout_id, status } = req.body;
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
