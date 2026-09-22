/**
 * Versioned public disbursement API — `/api/v1/disbursements/*` (Sprint 5).
 *
 * The official integration surface for external Stacks applications. Auth is the
 * same fail-closed shared bearer token as v0 (`BOS_API_TOKEN`), but responses use
 * a normalized ErrorResponse body `{ error, error_code, details? }` so callers get
 * a machine-readable contract on every failure path.
 *
 * All schemas (request / response / error) are documented in `docs/SPRINT_5_PLAN.md`
 * §3 and mirrored in `README.md`. The Sprint 0.5 router (`./disbursements.js`) is
 * deprecated but kept functional.
 */

import express from 'express';
import {
  initiateDisbursement,
  getDisbursement,
  advanceDisbursement,
  retryDisbursement,
  recoverStuckDisbursement,
  listDisbursements,
  approveDisbursement,
  resolveDisbursement,
  getSettlementReceipt,
} from '../services/bos/disbursementService.js';
import { requireApiToken } from './disbursements.js';

const router = express.Router();

const MAX_ADVANCE_STEPS = 25;
const RESOLUTIONS = ['settled', 'failed', 'cancelled'];

router.use((req, res, next) => requireApiToken(req, res, next, { normalize: true }));

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

function notFound(res) {
  return res.status(404).json({ error: 'not found', error_code: 'not_found' });
}

/** Normalized 409 for a failed state-machine operation. */
function conflict(res, result, fallbackCode) {
  return res.status(409).json({
    error: (result && result.error) || 'operation not permitted in current state',
    error_code: (result && result.error_code) || fallbackCode,
    ...(result && result.details ? { details: result.details } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/disbursements — create (idempotent; §5 of docs/SPRINT_5_PLAN.md)
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
// GET /api/v1/disbursements — bounded, paginated list
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
// GET /api/v1/disbursements/:id — read one (with external refs + audit log)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const disbursement = await getDisbursement(req.params.id);
    if (!disbursement) return notFound(res);
    return res.json({ disbursement });
  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/disbursements/:id/receipt — settlement receipt (Sprint 4 generator,
// unmodified — the service layer guards existence before it is called)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/receipt', async (req, res, next) => {
  try {
    const receipt = await getSettlementReceipt({ disbursementId: req.params.id });
    return res.json({ receipt });
  } catch (err) {
    return sendError(res, next, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/disbursements/:id/advance?steps=n — advance one (or n) step(s)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/advance', async (req, res, next) => {
  try {
    const existing = await getDisbursement(req.params.id);
    if (!existing) return notFound(res);

    const steps = parseSteps(req.query.steps);
    let result = null;
    for (let i = 0; i < steps; i += 1) {
      result = await advanceDisbursement(req.params.id);
      if (!result || !result.success) break;
    }

    const disbursement = await getDisbursement(req.params.id);
    if (result && !result.success) return conflict(res, result, 'advance_conflict');
    return res.json({ result, disbursement });
  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/disbursements/:id/retry — retry a failed disbursement
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/retry', async (req, res, next) => {
  try {
    const existing = await getDisbursement(req.params.id);
    if (!existing) return notFound(res);

    const result = await retryDisbursement(req.params.id);
    const disbursement = await getDisbursement(req.params.id);
    if (result && !result.success) return conflict(res, result, 'retry_conflict');
    return res.json({ result, disbursement });
  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/disbursements/:id/recover — escalate a stuck disbursement
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/recover', async (req, res, next) => {
  try {
    const existing = await getDisbursement(req.params.id);
    if (!existing) return notFound(res);

    const reason = (req.body && req.body.reason) || 'stuck';
    const result = await recoverStuckDisbursement(req.params.id, reason);
    const disbursement = await getDisbursement(req.params.id);
    if (result && !result.success) return conflict(res, result, 'recover_conflict');
    return res.json({ result, disbursement });
  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/disbursements/:id/approve — two-person approval contribution
// Gated by the shared token (Option C, Sprint 5). `approver` is a caller-supplied
// recorded label; RBAC is deferred (see docs/POSTPONED_BACKLOG.md, P2 entry).
// Idempotent per (disbursement_id, approver).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/approve', async (req, res, next) => {
  try {
    const approver = String((req.body && req.body.approver) || '').trim();
    if (!approver) {
      const err = new Error('Missing required field: approver');
      err.error_code = 'invalid_body';
      err.statusCode = 400;
      err.details = { missing: ['approver'] };
      throw err;
    }
    const result = await approveDisbursement({ disbursementId: req.params.id, approver });
    return res.json(result);
  } catch (err) {
    return sendError(res, next, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/disbursements/:id/resolve — resolve a manual_review disbursement
// to a terminal state (`settled` | `failed` | `cancelled`). Maps onto the existing
// state-machine transitions; the open manual_review_queue row is resolved.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!RESOLUTIONS.includes(b.resolution)) {
      const err = new Error(`Invalid resolution: ${String(b.resolution || '').trim() || '(missing)'}`);
      err.error_code = 'invalid_body';
      err.statusCode = 400;
      err.details = { field: 'resolution', allowed: RESOLUTIONS };
      throw err;
    }
    const { result, disbursement } = await resolveDisbursement({
      disbursementId: req.params.id,
      resolution: b.resolution,
      reviewer: b.reviewer || null,
      note: b.note || null,
    });
    return res.json({ result, disbursement });
  } catch (err) {
    return sendError(res, next, err);
  }
});

export default router;