/**
 * BOS Evidence Collector — collects proof artifacts per disbursement
 *
 * Collects and stores evidence at each transition: API responses, transaction IDs,
 * webhook payloads, observation polls, and manual review notes. Used for audit
 * trail and dispute resolution.
 *
 * Sprint 4 evidence model:
 *  - Every evidence record carries a standardized envelope (v, event_type, source,
 *    external_ref, observed_at, status, payload_hash, verification, details).
 *  - Records NEVER store raw PII / sensitive financial payloads: the full payload
 *    is compressed into `payload_hash` (sha256 over a stable canonical form) and
 *    only a sanitized summary is retained in `details`.
 *  - Ids are crypto.randomUUID() (no clock/random suffix collision surface).
 *  - Recorders that observe EXTERNAL systems also append a row to
 *    `external_status_snapshots` (best-effort, logged via an optional `log`).
 */

import { createHash, randomUUID } from 'crypto';

/**
 * Evidence types
 */
const EVIDENCE_TYPES = {
  API_RESPONSE: 'api_response',
  TX_HASH: 'tx_hash',
  WEBHOOK_PAYLOAD: 'webhook_payload',
  MANUAL_NOTE: 'manual_note',
  GATE_RESULT: 'gate_result',
  POLL_RESULT: 'poll_result',
  TRANSITION: 'transition',
  RECONCILIATION_DETECTION: 'reconciliation_detection',
};

/**
 * Keys that are NEVER retained in a sanitized evidence summary.
 * These identify or grant access to a recipient, an account, or credentials.
 */
const SENSITIVE_KEYS = new Set([
  'recipient',
  'recipient_name',
  'recipient_type',
  'account_number',
  'accountNumber',
  'account_name',
  'accountName',
  'bank_code',
  'bankCode',
  'bank_name',
  'bankName',
  'sort_code',
  'sortCode',
  'routing_number',
  'routingNumber',
  'bvn',
  'bv_number',
  'nin',
  'mobile_number',
  'mobileNumber',
  'phone',
  'phone_number',
  'phoneNumber',
  'email',
  'address',
  'card_number',
  'cardNumber',
  'token',
  'api_key',
  'apiKey',
  'secret',
  'password',
]);

const SANITIZE_MAX_STRING = 1000;
const SANITIZE_MAX_ARRAY = 50;
const SANITIZE_MAX_DEPTH = 6;

/** Stable (canonical) JSON form: object keys sorted recursively. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',')}}`;
}

/**
 * Deterministic sha256 over the stable canonical form of a payload.
 * Used for `payload_hash` — the payload itself is never stored.
 */
function hashPayload(value) {
  return createHash('sha256').update(stableStringify(value ?? null)).digest('hex');
}

/**
 * Strip sensitive keys, truncate junk, cap depth/width so a summary is safe to
 * keep alongside `payload_hash`. Returns a fresh plain object.
 */
export function sanitize(value, depth = SANITIZE_MAX_DEPTH) {
  if (depth <= 0) return undefined;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > SANITIZE_MAX_STRING) {
      return `${value.slice(0, SANITIZE_MAX_STRING)}…[truncated]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, SANITIZE_MAX_ARRAY).map((v) => sanitize(v, depth - 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = sanitize(v, depth - 1);
  }
  return out;
}

/**
 * Stable webhook event id across redeliveries of the same event.
 * Yellow Card payloads may carry `event_id` or `reference`; falls back to null.
 */
function deriveWebhookEventId(payload) {
  return payload?.event_id || payload?.reference || null;
}

/**
 * Build the canonical evidence envelope.
 * @param {Object} parts
 * @param {string} parts.eventType
 * @param {string} parts.source
 * @param {Object|null} parts.externalRef
 * @param {Object} parts.status
 * @param {string} parts.payloadHash
 * @param {Object|null} parts.verification
 * @param {Object} parts.details
 * @returns {Object} the envelope record
 */
function buildEnvelope({ eventType, source, externalRef, status, payloadHash, verification, details, now = new Date() }) {
  return {
    v: 1,
    event_type: eventType,
    source,
    external_ref: externalRef || null,
    observed_at: now.toISOString(),
    status: status || {},
    payload_hash: payloadHash,
    verification: verification || null,
    details: details || {},
  };
}

/** Best-effort snapshot append; never fails the evidence write that called it. */
async function trySnapshot({ db, log, disbursementId, source, status, responseTimeMs, errorMessage, payloadHash }) {
  try {
    await recordStatusSnapshot({ db, disbursementId, source, status, responseTimeMs, errorMessage, payloadHash });
  } catch (err) {
    if (log?.error) {
      log.error({ disbursementId, source, error: err.message }, 'Failed to record external status snapshot');
    }
  }
}

/**
 * Record evidence for a disbursement transition
 *
 * @param {Object} deps
 * @param {Object} deps.db — database client
 * @param {string} deps.disbursementId
 * @param {string} deps.evidenceType — from EVIDENCE_TYPES
 * @param {Object|string} deps.evidenceData — the evidence envelope (or string)
 * @param {string} [deps.recordedBy] — 'system' | 'worker' | user address
 * @returns {Promise<{ id: string }>}
 */
async function recordEvidence({ db, disbursementId, evidenceType, evidenceData, recordedBy = 'system' }) {
  const id = randomUUID();
  const dataStr = typeof evidenceData === 'string' ? evidenceData : JSON.stringify(evidenceData);

  await db.run(`
    INSERT INTO disbursement_evidence (id, disbursement_id, evidence_type, evidence_data, recorded_by, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
  `, [id, disbursementId, evidenceType, dataStr, recordedBy]);

  return { id };
}

/**
 * Append an immutable point-in-time snapshot of an EXTERNAL system's reported
 * status. The evidence chain holds the hash; this table holds the structured
 * status summary consumed by auditTimeline and reconciliation.
 */
async function recordStatusSnapshot({
  db,
  disbursementId,
  source,
  status,
  responseTimeMs = null,
  errorMessage = null,
  payloadHash = null,
}) {
  const rawResponse = payloadHash ? JSON.stringify({ payload_hash: payloadHash }) : null;
  await db.run(
    `INSERT INTO external_status_snapshots
       (disbursement_id, source, status, raw_response, captured_at, response_time_ms, error_message)
     VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
    [disbursementId, source, status, rawResponse, responseTimeMs, errorMessage]
  );
}

/**
 * Record an API response as evidence (payload hashed, never stored raw).
 */
async function recordApiResponse({ db, disbursementId, adapter, method, response, error, log }) {
  const full = { response: response || null, error: error || null };
  const payloadHash = `sha256:${hashPayload(full)}`;
  const evidenceData = buildEnvelope({
    eventType: EVIDENCE_TYPES.API_RESPONSE,
    source: `api:${adapter}.${method}`,
    externalRef: null,
    status: { adapter, method, ok: !error, error_code: error?.code || error?.error_code || null },
    payloadHash,
    verification: null,
    details: { response_summary: sanitize(full) },
  });
  await trySnapshot({
    db,
    log,
    disbursementId,
    source: `${adapter}.${method}`,
    status: error ? 'error' : 'ok',
    errorMessage: error?.message || error?.error_message || null,
    payloadHash,
  });
  return recordEvidence({ db, disbursementId, evidenceType: EVIDENCE_TYPES.API_RESPONSE, evidenceData, recordedBy: 'worker' });
}

/**
 * Record a transaction hash as evidence.
 */
async function recordTxHash({ db, disbursementId, chain, txHash, details, status = 'broadcast', log }) {
  const full = { chain, txHash, details: details || null };
  const payloadHash = `sha256:${hashPayload(full)}`;
  const evidenceData = buildEnvelope({
    eventType: EVIDENCE_TYPES.TX_HASH,
    source: `chain:${chain}`,
    externalRef: txHash ? { system: chain, type: 'tx_id', value: txHash } : null,
    status: { chain, tx_hash: txHash, tx_status: status },
    payloadHash,
    verification: null,
    details: sanitize(details || {}),
  });
  await trySnapshot({
    db,
    log,
    disbursementId,
    source: `chain:${chain}`,
    status,
    payloadHash,
  });
  return recordEvidence({ db, disbursementId, evidenceType: EVIDENCE_TYPES.TX_HASH, evidenceData, recordedBy: 'worker' });
}

/**
 * Record a verified webhook payload as evidence (hash + sanitized summary only,
 * never the raw body).
 */
async function recordWebhookPayload({ db, disbursementId, source, payload, signatureValid, log }) {
  const payoutId = payload?.payout_id || null;
  const eventId = deriveWebhookEventId(payload);
  const webhookStatus = String(payload?.status || '').toLowerCase();
  const full = { payload, signatureValid };
  const payloadHash = `sha256:${hashPayload(full)}`;
  const evidenceData = buildEnvelope({
    eventType: EVIDENCE_TYPES.WEBHOOK_PAYLOAD,
    source: `webhook:${source}`,
    externalRef: payoutId ? { system: source, type: 'payout_id', value: payoutId } : null,
    status: { event_id: eventId, webhook_status: webhookStatus || null, verified: signatureValid === true },
    payloadHash,
    verification: { ok: signatureValid === true, method: 'hmac-sha256' },
    details: sanitize({ source, webhook_status: webhookStatus, event_id: eventId }),
  });
  await trySnapshot({
    db,
    log,
    disbursementId,
    source: `webhook:${source}`,
    status: webhookStatus || 'unknown',
    payloadHash,
  });
  return recordEvidence({ db, disbursementId, evidenceType: EVIDENCE_TYPES.WEBHOOK_PAYLOAD, evidenceData, recordedBy: 'system' });
}

/**
 * Record a manual review note (operator input — the note itself is the point).
 */
async function recordManualNote({ db, disbursementId, reviewer, note }) {
  const full = { reviewer, note };
  const evidenceData = buildEnvelope({
    eventType: EVIDENCE_TYPES.MANUAL_NOTE,
    source: 'operator.manual_review',
    externalRef: null,
    status: { reviewer },
    payloadHash: `sha256:${hashPayload(full)}`,
    verification: null,
    details: { reviewer, note },
  });
  return recordEvidence({ db, disbursementId, evidenceType: EVIDENCE_TYPES.MANUAL_NOTE, evidenceData, recordedBy: reviewer || 'operator' });
}

/**
 * Record a preflight gate result.
 */
async function recordGateResult({ db, disbursementId, gateName, passed, reason, details }) {
  const full = { gateName, passed, reason, details };
  const evidenceData = buildEnvelope({
    eventType: EVIDENCE_TYPES.GATE_RESULT,
    source: 'bos.preflight',
    externalRef: null,
    status: { gate_name: gateName, passed: passed === true },
    payloadHash: `sha256:${hashPayload(full)}`,
    verification: { ok: passed === true, method: 'preflight_gate' },
    details: sanitize({ reason, details: details || null }),
  });
  return recordEvidence({ db, disbursementId, evidenceType: EVIDENCE_TYPES.GATE_RESULT, evidenceData, recordedBy: 'worker' });
}

/**
 * Record a fallback/observation poll result. Every poll of an external surface
 * leaves a trace in the evidence chain.
 */
async function recordPollResult({ db, disbursementId, adapter, method, externalId, externalIdType = 'id', status, advanceAction, log }) {
  const full = { adapter, method, externalId, status, advanceAction };
  const payloadHash = `sha256:${hashPayload(full)}`;
  const evidenceData = buildEnvelope({
    eventType: EVIDENCE_TYPES.POLL_RESULT,
    source: `poll:${adapter}.${method}`,
    externalRef: externalId ? { system: adapter, type: externalIdType, value: externalId } : null,
    status: { adapter, method, external_id: externalId, poll_status: status, advance_action: advanceAction || null },
    payloadHash,
    verification: null,
    details: sanitize({ adapter, method, advance_action: advanceAction || null }),
  });
  await trySnapshot({
    db,
    log,
    disbursementId,
    source: `${adapter}.${method}`,
    status: status || 'unknown',
    payloadHash,
  });
  return recordEvidence({ db, disbursementId, evidenceType: EVIDENCE_TYPES.POLL_RESULT, evidenceData, recordedBy: 'worker' });
}

/**
 * Relation between a successful transition and the leg-producing external id,
 * so the canonical record links to the leg's artifact.
 */
function pickTransitionExternalRef(details) {
  if (details?.payout_id) return { system: 'yellowcard', type: 'payout_id', value: details.payout_id };
  if (details?.attestation_id) return { system: 'xreserve', type: 'attestation_id', value: details.attestation_id };
  if (details?.external_tx_id) return { system: 'stacks', type: 'tx_id', value: details.external_tx_id };
  return null;
}

/**
 * Canonical evidence record for a state-machine transition — exactly one is
 * written per successful transition (executeTransition).
 */
async function recordTransitionEvidence({ db, disbursementId, fromState, toState, triggeredBy, details }) {
  const canonical = {
    disbursement_id: disbursementId,
    from: fromState,
    to: toState,
    action: `${fromState}→${toState}`,
    triggered_by: triggeredBy,
    details: details || {},
  };
  const payloadHash = `sha256:${hashPayload(canonical)}`;
  const evidenceData = buildEnvelope({
    eventType: EVIDENCE_TYPES.TRANSITION,
    source: 'bos.state_machine',
    externalRef: pickTransitionExternalRef(details || {}),
    status: { from: fromState, to: toState },
    payloadHash,
    verification: { ok: true, method: 'guard' },
    details: { triggered_by: triggeredBy, action: `${fromState}→${toState}` },
  });
  return recordEvidence({ db, disbursementId, evidenceType: EVIDENCE_TYPES.TRANSITION, evidenceData, recordedBy: 'system' });
}

/**
 * Evidence record describing a reconciliation detection (written only when the
 * worker routes a row — evidence before any state flip).
 */
async function recordReconciliationDetection({ db, disbursementId, mode, details, log }) {
  const full = { mode, details };
  const evidenceData = buildEnvelope({
    eventType: EVIDENCE_TYPES.RECONCILIATION_DETECTION,
    source: 'bos.reconciliation',
    externalRef: null,
    status: { mode },
    payloadHash: `sha256:${hashPayload(full)}`,
    verification: null,
    details: sanitize(details || {}),
  });
  if (log?.info) log.info({ disbursementId, mode }, 'Recording reconciliation detection evidence');
  return recordEvidence({ db, disbursementId, evidenceType: EVIDENCE_TYPES.RECONCILIATION_DETECTION, evidenceData, recordedBy: 'worker' });
}

/**
 * Fetch all evidence for a disbursement, oldest first (created_at, then id for
 * a total order under identical timestamps).
 */
async function getEvidence({ db, disbursementId }) {
  const rows = await db.all(`
    SELECT id, evidence_type, evidence_data, recorded_by, created_at
    FROM disbursement_evidence
    WHERE disbursement_id = $1
    ORDER BY created_at ASC, id ASC
  `, [disbursementId]);

  return (rows || []).map((row) => ({
    id: row.id,
    type: row.evidence_type,
    data: typeof row.evidence_data === 'string' ? JSON.parse(row.evidence_data) : row.evidence_data,
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
  }));
}

export {
  EVIDENCE_TYPES,
  recordEvidence,
  recordApiResponse,
  recordTxHash,
  recordWebhookPayload,
  recordManualNote,
  recordGateResult,
  recordPollResult,
  recordTransitionEvidence,
  recordReconciliationDetection,
  recordStatusSnapshot,
  getEvidence,
  deriveWebhookEventId,
  hashPayload,
};