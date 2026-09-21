/**
 * Disbursement API — create / read / advance / retry / recover.
 *
 * Auth is fail-closed: every route requires a bearer token matching
 * BOS_API_TOKEN. If BOS_API_TOKEN is unset, requests are rejected unless the
 * operator explicitly opts into local development with
 * BOS_ALLOW_UNAUTHENTICATED_DEV=true.
 */

import express from 'express';
import crypto from 'crypto';
import {
  initiateDisbursement,
  getDisbursement,
  advanceDisbursement,
  retryDisbursement,
  recoverStuckDisbursement,
  listDisbursements,
} from '../services/bos/disbursementService.js';

const router = express.Router();

const MAX_ADVANCE_STEPS = 25;

/** Constant-time compare that never leaks length via early return. */
function tokenMatches(presented, configured) {
  const a = crypto.createHash('sha256').update(String(presented)).digest();
  const b = crypto.createHash('sha256').update(String(configured)).digest();
  return crypto.timingSafeEqual(a, b);
}

export function requireApiToken(req, res, next) {
  const configured = process.env.BOS_API_TOKEN;

  if (configured) {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const presented = match ? match[1] : '';
    if (presented && tokenMatches(presented, configured)) {
      return next();
    }
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (process.env.BOS_ALLOW_UNAUTHENTICATED_DEV === 'true') {
    return next();
  }

  return res.status(401).json({ error: 'unauthorized' });
}

router.use(requireApiToken);

function parseSteps(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_ADVANCE_STEPS);
}

function sendError(res, next, err) {
  if (err && err.error_code) {
    return res.status(err.statusCode || 400).json({
      error: err.message,
      error_code: err.error_code,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  return next(err);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/disbursements — create
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const disbursement = await initiateDisbursement({
      source_reference: b.source_reference,
      source_application: b.source_application,
      amount_usd: b.amount_usd,
      amount_usdcx: b.amount_usdcx,
      creator_address: b.creator_address,
      creator_btc_address: b.creator_btc_address ?? null,
      recipient_bank_account: b.recipient_bank_account,
      recipient_bank_code: b.recipient_bank_code,
      ngn_recipient: b.ngn_recipient ?? null,
      metadata: b.metadata ?? {},
    });
    return res.status(201).json({ disbursement });
  } catch (err) {
    return sendError(res, next, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/disbursements — bounded list
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const result = await listDisbursements({
      status: req.query.status || null,
      source_reference: req.query.source_reference || null,
      source_application: req.query.source_application || null,
      limit,
      offset,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/disbursements/:id — read one (with external refs + audit log)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const disbursement = await getDisbursement(req.params.id);
    if (!disbursement) return res.status(404).json({ error: 'not found' });
    return res.json({ disbursement });
  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/disbursements/:id/advance?steps=n — advance one (or n) step(s)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/advance', async (req, res, next) => {
  try {
    const existing = await getDisbursement(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const steps = parseSteps(req.query.steps);
    let result = null;
    for (let i = 0; i < steps; i += 1) {
      result = await advanceDisbursement(req.params.id);
      if (!result || !result.success) break;
    }

    const disbursement = await getDisbursement(req.params.id);
    const status = result && !result.success ? 409 : 200;
    return res.status(status).json({ result, disbursement });
  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/disbursements/:id/retry — retry a failed disbursement
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/retry', async (req, res, next) => {
  try {
    const existing = await getDisbursement(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const result = await retryDisbursement(req.params.id);
    const disbursement = await getDisbursement(req.params.id);
    const status = result && !result.success ? 409 : 200;
    return res.status(status).json({ result, disbursement });
  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/disbursements/:id/recover — escalate a stuck disbursement
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/recover', async (req, res, next) => {
  try {
    const existing = await getDisbursement(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const reason = (req.body && req.body.reason) || 'stuck';
    const result = await recoverStuckDisbursement(req.params.id, reason);
    const disbursement = await getDisbursement(req.params.id);
    const status = result && !result.success ? 409 : 200;
    return res.status(status).json({ result, disbursement });
  } catch (err) {
    return next(err);
  }
});

export default router;
