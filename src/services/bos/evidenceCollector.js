/**
 * BOS Evidence Collector — collects proof artifacts per disbursement
 *
 * Captures and stores evidence at each transition: API responses, transaction IDs,
 * webhook payloads, and manual review notes. Used for audit trail and dispute resolution.
 */

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
};

/**
 * Record evidence for a disbursement transition
 *
 * @param {Object} deps
 * @param {Object} deps.db — database client
 * @param {string} deps.disbursementId
 * @param {string} deps.evidenceType — from EVIDENCE_TYPES
 * @param {Object|string} deps.evidenceData — the evidence payload
 * @param {string} [deps.recordedBy] — 'system' | 'worker' | user address
 * @returns {Promise<{ id: string }>}
 */
async function recordEvidence({ db, disbursementId, evidenceType, evidenceData, recordedBy = 'system' }) {
  const id = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dataStr = typeof evidenceData === 'string' ? evidenceData : JSON.stringify(evidenceData);

  await db.run(`
    INSERT INTO disbursement_evidence (id, disbursement_id, evidence_type, evidence_data, recorded_by, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
  `, [id, disbursementId, evidenceType, dataStr, recordedBy]);

  return { id };
}

/**
 * Record an API response as evidence
 */
async function recordApiResponse({ db, disbursementId, adapter, method, response, error }) {
  return recordEvidence({
    db,
    disbursementId,
    evidenceType: EVIDENCE_TYPES.API_RESPONSE,
    evidenceData: {
      adapter,
      method,
      response: response || null,
      error: error || null,
      timestamp: new Date().toISOString(),
    },
    recordedBy: 'worker',
  });
}

/**
 * Record a transaction hash as evidence
 */
async function recordTxHash({ db, disbursementId, chain, txHash, details }) {
  return recordEvidence({
    db,
    disbursementId,
    evidenceType: EVIDENCE_TYPES.TX_HASH,
    evidenceData: {
      chain,
      txHash,
      details: details || null,
      timestamp: new Date().toISOString(),
    },
    recordedBy: 'worker',
  });
}

/**
 * Record a webhook payload as evidence
 */
async function recordWebhookPayload({ db, disbursementId, source, payload, signatureValid }) {
  return recordEvidence({
    db,
    disbursementId,
    evidenceType: EVIDENCE_TYPES.WEBHOOK_PAYLOAD,
    evidenceData: {
      source,
      payload,
      signatureValid,
      timestamp: new Date().toISOString(),
    },
    recordedBy: 'system',
  });
}

/**
 * Record a manual review note
 */
async function recordManualNote({ db, disbursementId, reviewer, note }) {
  return recordEvidence({
    db,
    disbursementId,
    evidenceType: EVIDENCE_TYPES.MANUAL_NOTE,
    evidenceData: {
      reviewer,
      note,
      timestamp: new Date().toISOString(),
    },
    recordedBy: reviewer,
  });
}

/**
 * Record a preflight gate result
 */
async function recordGateResult({ db, disbursementId, gateName, passed, reason, details }) {
  return recordEvidence({
    db,
    disbursementId,
    evidenceType: EVIDENCE_TYPES.GATE_RESULT,
    evidenceData: {
      gateName,
      passed,
      reason: reason || null,
      details: details || null,
      timestamp: new Date().toISOString(),
    },
    recordedBy: 'worker',
  });
}

/**
 * Record a fallback poll result
 */
async function recordPollResult({ db, disbursementId, adapter, method, externalId, status, advanceAction }) {
  return recordEvidence({
    db,
    disbursementId,
    evidenceType: EVIDENCE_TYPES.POLL_RESULT,
    evidenceData: {
      adapter,
      method,
      externalId,
      status,
      advanceAction,
      timestamp: new Date().toISOString(),
    },
    recordedBy: 'worker',
  });
}

/**
 * Fetch all evidence for a disbursement
 */
async function getEvidence({ db, disbursementId }) {
  const rows = await db.all(`
    SELECT id, evidence_type, evidence_data, recorded_by, created_at
    FROM disbursement_evidence
    WHERE disbursement_id = $1
    ORDER BY created_at ASC
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
  getEvidence,
};
