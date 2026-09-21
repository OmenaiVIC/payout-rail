/**
 * BOS Disbursement Service — Orchestrator
 * Public API: initiate, advance, retry, recover, get, list, metrics
 * All operations are idempotent under duplicate worker execution
 */

import { createHash, randomUUID } from 'crypto';
import { DisbursementState, TERMINAL_STATES } from './types.js';
import { executeTransition, getValidNextStates } from './stateMachine.js';
import { recordWebhookPayload } from './evidenceCollector.js';

// USDCx has 6 decimal places; amount_usdcx is expressed in base units.
const USDCX_DECIMALS = 6;
const NGN_MINOR_UNITS_PER_NAIRA = 100;

/**
 * Convert a USDCx base-unit amount into the expected NGN payout in minor
 * units (kobo) at a given USDCx/NGN rate.
 *
 * amount_ngn_kobo = round(amount_usdcx_base_units / 1e6 × rate × 100)
 * This matches Yellow Card's `amount` convention (currency's smallest unit).
 *
 * @param {Object} p
 * @param {number} p.amount_usdcx_base_units — USDCx amount in 6-dp base units
 * @param {number} p.rate — USDCx/NGN rate (e.g. 1650 → 1 USDCx = 1650 NGN)
 * @returns {number} expected NGN payout in kobo, rounded to the nearest integer
 */
export function computeAmountNgnExpected({ amount_usdcx_base_units, rate }) {
  const usdcxAmount = Number(amount_usdcx_base_units) / 10 ** USDCX_DECIMALS;
  const ngn = usdcxAmount * Number(rate);
  return Math.round(ngn * NGN_MINOR_UNITS_PER_NAIRA);
}

/**
 * Derive the deterministic idempotency key for a disbursement.
 *
 * Stable across retries: a digest over fixed inputs only, never a timestamp.
 * Identical inputs always collide, so a duplicate create is recognised as the
 * same disbursement and rejected by the UNIQUE(idempotency_key) constraint.
 */
export function deriveDisbursementIdempotencyKey({
  source_reference,
  source_application = 'campaign',
  amount_usdcx,
  recipient_bank_account,
}) {
  const canonical = [source_reference, source_application, amount_usdcx, recipient_bank_account]
    .map((v) => String(v ?? '').trim())
    .join('|');
  return `disbursement:${createHash('sha256').update(canonical).digest('hex')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging & DB helpers (passed via context, not imported directly)
// ─────────────────────────────────────────────────────────────────────────────

let _ctx = null;

/**
 * Initialize the service with runtime context
 * Must be called once at server startup
 * Seeds a default exchange rate if none exists (MVP: static rate)
 */
export async function init(ctx) {
  _ctx = ctx;

  // Seed default exchange rate if table is empty
  try {
    const db = ctx.getDb();
    const existing = await db.get(
      `SELECT id FROM exchange_rates WHERE pair = 'USDCx/NGN' LIMIT 1`
    );
    if (!existing) {
      const defaultRate = parseFloat(process.env.DEFAULT_USDCX_NGN_RATE || '1650');
      await db.run(
        `INSERT INTO exchange_rates (source, pair, rate, created_at, updated_at)
         VALUES ('seed', 'USDCx/NGN', $1, NOW(), NOW())`,
        [defaultRate]
      );
      ctx.getLogger('disbursement')?.info({ rate: defaultRate }, 'Seeded default USDCx/NGN exchange rate');
    }
  } catch (err) {
    ctx.getLogger('disbursement')?.warn({ error: err.message }, 'Failed to seed exchange rate (non-fatal)');
  }
}

function ctx() {
  if (!_ctx) throw new Error('disbursementService not initialized — call init(ctx) first');
  return _ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new disbursement record and submit the first transition (burn)
 * Idempotent: if idempotency_key already exists, returns existing record
 *
 * @param {Object} params
 * @param {string} params.source_reference   — originating campaign/payout reference id
 * @param {string} [params.source_application] — originating application (default 'campaign')
 * @param {number} params.amount_usd         — stable USD value
 * @param {number} params.amount_usdcx       — base units (6 decimals)
 * @param {string} params.creator_address    — recipient Stacks address
 * @param {string} [params.creator_btc_address] — BTC address for xReserve release
 * @param {string} params.recipient_bank_account — NGN payout account number (required)
 * @param {string} params.recipient_bank_code    — NGN payout bank code (required)
 * @param {Object} [params.ngn_recipient]    — Yellow Card recipient details
 * @param {Object} [params.metadata]         — arbitrary JSONB
 * @returns {Promise<Object>} — the created (or existing) disbursement record
 */
export async function initiateDisbursement({
  source_reference,
  source_application = 'campaign',
  amount_usd,
  amount_usdcx,
  creator_address,
  creator_btc_address = null,
  recipient_bank_account,
  recipient_bank_code,
  ngn_recipient = null,
  metadata = {},
}) {
  const log = ctx().getLogger('disbursement:initiate');
  const db = ctx().getDb();

  // ── Validate required payout destination (fail closed) ────────────────
  const missing = [];
  if (!recipient_bank_account || String(recipient_bank_account).trim() === '') {
    missing.push('recipient_bank_account');
  }
  if (!recipient_bank_code || String(recipient_bank_code).trim() === '') {
    missing.push('recipient_bank_code');
  }
  if (missing.length > 0) {
    const err = new Error(`Missing required recipient bank details: ${missing.join(', ')}`);
    err.error_code = 'missing_recipient_bank_details';
    err.statusCode = 400;
    err.details = { missing };
    throw err;
  }

  // ── Resolve the USDCx/NGN rate at create time (fail closed) ─────────
  // A disbursement with no rate can never reach the payout leg, so reject
  // creation rather than insert a row that is doomed from the start.
  const rateRow = await db.get(
    `SELECT rate FROM exchange_rates
     WHERE pair = 'USDCx/NGN'
     ORDER BY updated_at DESC LIMIT 1`
  );
  const exchangeRate = Number(rateRow?.rate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    const err = new Error(`No valid USDCx/NGN exchange rate on file (got ${rateRow?.rate ?? 'none'})`);
    err.error_code = 'missing_exchange_rate';
    err.statusCode = 400;
    err.details = { rate: rateRow?.rate ?? null, pair: 'USDCx/NGN' };
    throw err;
  }
  const amount_ngn_expected = computeAmountNgnExpected({
    amount_usdcx_base_units: amount_usdcx,
    rate: exchangeRate,
  });

  const idempotency_key = deriveDisbursementIdempotencyKey({
    source_reference,
    source_application,
    amount_usdcx,
    recipient_bank_account,
  });

  // ── Idempotency check ────────────────────────────────────────────────
  const existing = await db.get(
    `SELECT * FROM disbursements WHERE idempotency_key = $1`,
    [idempotency_key]
  );
  if (existing) {
    log.info({ id: existing.id }, 'Disbursement already exists (idempotent)');
    return existing;
  }

  // ── Insert disbursement ───────────────────────────────────────────────
  const id = randomUUID();
  await db.run(
    `INSERT INTO disbursements (
       id, idempotency_key, source_reference, source_application,
       amount_usd, amount_usdcx,
       creator_address, creator_btc_address, recipient_bank_account, recipient_bank_code,
       ngn_recipient, status, metadata,
       amount_ngn_expected, exchange_rate,
       last_heartbeat_at, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW(),NOW())`,
    [
      id, idempotency_key, source_reference, source_application,
      amount_usd, amount_usdcx,
      creator_address, creator_btc_address, recipient_bank_account, recipient_bank_code,
      ngn_recipient ? JSON.stringify(ngn_recipient) : null,
      DisbursementState.DISBURSEMENT_INITIATED,
      JSON.stringify(metadata),
      amount_ngn_expected, exchangeRate,
    ]
  );

  // ── Emit creation event ───────────────────────────────────────────────
  await ctx().emitEvent({
    disbursement_id: id,
    old_status: null,
    new_status: DisbursementState.DISBURSEMENT_INITIATED,
    action: 'disbursement_created',
    details: { source_reference, source_application, amount_usd, amount_usdcx, creator_address },
    triggered_by: 'worker',
  });

  log.info({ id, source_reference, amount_usd }, 'Disbursement created');

  // ── Fetch the record to pass to the state machine ─────────────────────
  const disbursement = await db.get(`SELECT * FROM disbursements WHERE id = $1`, [id]);

  // ── Execute first transition: initiated → preflight_check ──────────────
  const result = await executeTransition(
    disbursement,
    DisbursementState.PREFLIGHT_CHECK,
    ctx(),
    {},
    'worker'
  );

  if (!result.success) {
    log.warn({ id, error: result.error, error_code: result.error_code }, 'First transition failed');
  }

  return db.get(`SELECT * FROM disbursements WHERE id = $1`, [id]);
}

/**
 * Advance a disbursement by one step
 * Determines the next valid state from current state and executes it
 * Returns null if the disbursement is already in a terminal state
 *
 * @param {string} disbursementId
 * @returns {Promise<TransitionResult|null>}
 */
export async function advanceDisbursement(disbursementId) {
  const log = ctx().getLogger('disbursement:advance');
  const db = ctx().getDb();

  const disbursement = await db.get(
    `SELECT * FROM disbursements WHERE id = $1`,
    [disbursementId]
  );
  if (!disbursement) {
    return { success: false, error: 'Disbursement not found', new_state: null };
  }

  if (TERMINAL_STATES.has(disbursement.status)) {
    return null; // nothing to advance
  }

  const nextStates = getValidNextStates(disbursement.status);
  if (nextStates.length === 0) {
    log.warn({ id: disbursementId, status: disbursement.status }, 'No valid next states');
    return null;
  }

  // Pick the first valid next state (deterministic order)
  const targetState = nextStates[0].to;
  log.info({ id: disbursementId, from: disbursement.status, to: targetState }, 'Advancing disbursement');

  return executeTransition(disbursement, targetState, ctx(), {}, 'worker');
}

/**
 * Retry a failed disbursement: reset to the last non-terminal state and re-attempt
 * Only allowed if retry_count < max_retries
 *
 * @param {string} disbursementId
 * @returns {Promise<TransitionResult>}
 */
export async function retryDisbursement(disbursementId) {
  const log = ctx().getLogger('disbursement:retry');
  const db = ctx().getDb();

  const disbursement = await db.get(
    `SELECT * FROM disbursements WHERE id = $1`,
    [disbursementId]
  );
  if (!disbursement) {
    return { success: false, error: 'Disbursement not found', new_state: null };
  }

  if (disbursement.status !== DisbursementState.FAILED) {
    return { success: false, error: `Can only retry from failed state, current: ${disbursement.status}`, new_state: null };
  }

  const maxRetries = disbursement.max_retries ?? 3;
  if (disbursement.retry_count >= maxRetries) {
    return { success: false, error: `Retry budget exhausted (${disbursement.retry_count}/${maxRetries})`, new_state: null };
  }

  // ── Find the last non-failed state from audit log ─────────────────────
  const lastState = await db.get(
    `SELECT old_status FROM disbursement_audit
     WHERE disbursement_id = $1 AND new_status = 'failed'
     ORDER BY created_at DESC LIMIT 1`,
    [disbursementId]
  );

  const resetTo = lastState?.old_status || DisbursementState.DISBURSEMENT_INITIATED;
  log.info({ id: disbursementId, reset_to: resetTo, retry_count: disbursement.retry_count + 1 }, 'Retrying disbursement');

  // ── Increment retry count and reset status ────────────────────────────
  await db.run(
    `UPDATE disbursements
     SET status = $1,
         retry_count = retry_count + 1,
         error_message = NULL,
         last_error = NULL,
         last_heartbeat_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [resetTo, disbursementId]
  );

  await ctx().emitEvent({
    disbursement_id: disbursementId,
    old_status: DisbursementState.FAILED,
    new_status: resetTo,
    action: 'retry',
    details: { reset_to: resetTo, retry_count: disbursement.retry_count + 1 },
    triggered_by: 'worker',
  });

  // ── Re-fetch and advance from the reset state ─────────────────────────
  const refreshed = await db.get(`SELECT * FROM disbursements WHERE id = $1`, [disbursementId]);
  return advanceDisbursement(disbursementId);
}

/**
 * Recover a stuck disbursement: transition to manual_review
 * Called by the reaper or by explicit operator action
 */
export async function recoverStuckDisbursement(disbursementId, reason = 'stuck') {
  const log = ctx().getLogger('disbursement:recover');
  const db = ctx().getDb();

  const disbursement = await db.get(
    `SELECT * FROM disbursements WHERE id = $1`,
    [disbursementId]
  );
  if (!disbursement) {
    return { success: false, error: 'Disbursement not found', new_state: null };
  }

  if (TERMINAL_STATES.has(disbursement.status)) {
    return null;
  }

  log.warn({ id: disbursementId, status: disbursement.status, reason }, 'Recovering stuck disbursement');

  return executeTransition(
    disbursement,
    DisbursementState.MANUAL_REVIEW,
    ctx(),
    { recovery_reason: reason },
    'reaper'
  );
}

/**
 * Get a single disbursement with its external refs
 */
export async function getDisbursement(disbursementId) {
  const db = ctx().getDb();

  const disbursement = await db.get(
    `SELECT * FROM disbursements WHERE id = $1`,
    [disbursementId]
  );
  if (!disbursement) return null;

  const externalRefs = await db.all(
    `SELECT * FROM external_refs WHERE disbursement_id = $1 ORDER BY created_at`,
    [disbursementId]
  );

  const auditLog = await db.all(
    `SELECT * FROM disbursement_audit WHERE disbursement_id = $1 ORDER BY created_at`,
    [disbursementId]
  );

  return { ...disbursement, external_refs: externalRefs, audit_log: auditLog };
}

/**
 * List disbursements with optional filters
 */
export async function listDisbursements({
  status = null,
  source_reference = null,
  source_application = null,
  limit = 50,
  offset = 0,
} = {}) {
  const db = ctx().getDb();
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }
  if (source_reference) {
    conditions.push(`source_reference = $${paramIdx++}`);
    params.push(source_reference);
  }
  if (source_application) {
    conditions.push(`source_application = $${paramIdx++}`);
    params.push(source_application);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const rows = await db.all(
    `SELECT * FROM disbursements ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
    params
  );

  const countRow = await db.get(
    `SELECT COUNT(*) as total FROM disbursements ${where}`,
    params.slice(0, -2)
  );

  return { disbursements: rows, total: countRow?.total ?? 0 };
}

/**
 * Get pipeline summary metrics for the dashboard
 */
export async function getPipelineSummary() {
  const db = ctx().getDb();

  const byStatus = await db.all(
    `SELECT status, COUNT(*) as count FROM disbursements GROUP BY status`
  );

  const recent24h = await db.get(
    `SELECT COUNT(*) as count FROM disbursements WHERE created_at > NOW() - INTERVAL '24 hours'`
  );

  const failedNoRetry = await db.get(
    `SELECT COUNT(*) as count FROM disbursements
     WHERE status = 'failed' AND retry_count >= (max_retries ?? 3)`
  );

  return {
    by_status: Object.fromEntries(byStatus.map(r => [r.status, Number(r.count)])),
    recent_24h: Number(recent24h?.count ?? 0),
    failed_exhausted: Number(failedNoRetry?.count ?? 0),
  };
}

/**
 * Handle a Yellow Card webhook (payout status update)
 * Idempotent: processes the webhook and advances the disbursement if applicable.
 *
 * A `completed` webhook only advances from `yellowcard_payout_submitted`; any
 * later delivery for the same payout is acknowledged but does NOT advance again
 * (no double-transition on duplicates).
 *
 * @param {Object} payload
 * @param {Object} [options]
 * @param {boolean} [options.signatureValid] — set true only after HMAC verification
 */
export async function handleYellowCardWebhook(payload, { signatureValid = false } = {}) {
  const log = ctx().getLogger('disbursement:webhook');
  const db = ctx().getDb();

  const payoutId = payload.payout_id;
  if (!payoutId) {
    log.warn({ payload }, 'Webhook missing payout_id');
    return { processed: false, reason: 'missing payout_id' };
  }

  // ── Find disbursement by external ref ─────────────────────────────────
  const ref = await db.get(
    `SELECT er.*, d.id as disbursement_id, d.status
     FROM external_refs er
     JOIN disbursements d ON d.id = er.disbursement_id
     WHERE er.external_system = 'yellowcard'
       AND er.identifier_type = 'payout_id'
       AND er.identifier_value = $1`,
    [payoutId]
  );

  if (!ref) {
    log.warn({ payout_id: payoutId }, 'No disbursement found for payout_id');
    return { processed: false, reason: 'unknown payout_id' };
  }

  // ── Record the verified payload into the evidence chain ────────────────
  recordWebhookPayload({
    db,
    disbursementId: ref.disbursement_id,
    source: 'yellowcard',
    payload,
    signatureValid,
  }).catch((err) => log.warn({ id: ref.disbursement_id, error: err.message }, 'Evidence recording failed'));

  if (TERMINAL_STATES.has(ref.status)) {
    log.info({ payout_id: payoutId, status: ref.status }, 'Disbursement already terminal');
    return { processed: false, reason: 'already terminal' };
  }

  // ── Process based on webhook status ───────────────────────────────────
  const webhookStatus = payload.status?.toLowerCase();

  if (webhookStatus === 'completed') {
    // Idempotent: only a payout that is still awaiting confirmation advances.
    if (ref.status !== DisbursementState.YELLOWCARD_PAYOUT_SUBMITTED) {
      log.info({ payout_id: payoutId, status: ref.status }, 'Webhook already applied — ignoring delivery');
      return { processed: false, reason: `already applied (status: ${ref.status})` };
    }
    const result = await advanceDisbursement(ref.disbursement_id);
    log.info({ payout_id: payoutId, result }, 'Webhook processed (completed)');
    return { processed: true, result };
  }

  if (webhookStatus === 'failed') {
    await db.run(
      `UPDATE disbursements SET error_message = $1, last_error = $2, updated_at = NOW() WHERE id = $3`,
      [`Yellow Card payout failed: ${JSON.stringify(payload)}`, 'yellowcard_payout_failed', ref.disbursement_id]
    );

    const result = await executeTransition(
      { ...ref, status: ref.status },
      DisbursementState.FAILED,
      ctx(),
      { webhook_payload: payload },
      'webhook'
    );

    log.warn({ payout_id: payoutId }, 'Webhook processed (failed)');
    return { processed: true, result };
  }

  log.info({ payout_id: payoutId, status: webhookStatus }, 'Webhook status not actionable');
  return { processed: false, reason: `unhandled status: ${webhookStatus}` };
}
