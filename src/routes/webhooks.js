/**
 * Webhooks Router
 * Handles incoming webhooks from external providers (xReserve, Yellow Card, Flutterwave, Breet)
 */

import express from 'express';
import { handleXReserveWebhook, handleYellowCardWebhook, handleFlutterwaveWebhook } from '../services/bos/webhookHandlers.js';
import { verifyWebhook } from '../services/bos/webhookVerifier.js';

const router = express.Router();

/**
 * POST /xreserve - Handle xReserve webhooks
 */
router.post('/xreserve', (req, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const verification = verifyWebhook('xreserve', rawBody, req.headers);

    if (!verification.valid) {
      console.error('xReserve webhook verification failed:', verification.reason);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    handleXReserveWebhook(req.body, req.headers)
      .then((result) => {
        res.json({ status: 'processed', result });
      })
      .catch((error) => {
        console.error('Error processing xReserve webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
      });
  } catch (error) {
    console.error('Error in xReserve webhook endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /yellowcard - Handle Yellow Card webhooks
 */
router.post('/yellowcard', (req, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const verification = verifyWebhook('yellowcard', rawBody, req.headers);

    if (!verification.valid) {
      console.error('Yellow Card webhook verification failed:', verification.reason);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    handleYellowCardWebhook(req.body, req.headers)
      .then((result) => {
        res.json({ status: 'processed', result });
      })
      .catch((error) => {
        console.error('Error processing Yellow Card webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
      });
  } catch (error) {
    console.error('Error in Yellow Card webhook endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /flutterwave - Handle Flutterwave webhooks
 */
router.post('/flutterwave', (req, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const verification = verifyWebhook('flutterwave', rawBody, req.headers);

    if (!verification.valid) {
      console.error('Flutterwave webhook verification failed:', verification.reason);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    handleFlutterwaveWebhook(req.body, req.headers)
      .then((result) => {
        res.json({ status: 'processed', result });
      })
      .catch((error) => {
        console.error('Error processing Flutterwave webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
      });
  } catch (error) {
    console.error('Error in Flutterwave webhook endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /breet - Handle Breet webhooks
 */
router.post('/breet', (req, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const verification = verifyWebhook('breet', rawBody, req.headers);

    if (!verification.valid) {
      console.error('Breet webhook verification failed:', verification.reason);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Breet webhooks: for now, acknowledge receipt
    res.json({ status: 'processed' });
  } catch (error) {
    console.error('Error in Breet webhook endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;