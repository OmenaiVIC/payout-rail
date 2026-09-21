import { getDb } from '../../../database.js';

/**
 * BOS Monitoring — Dashboard Queries
 *
 * Dashboard-friendly read queries for the monitoring UI.
 * All queries are paginated and indexed for fast reads.
 */

/**
 * Pipeline summary — counts by status, total volume, success rate.
 */
export async function getPipelineSummary() {
  const db = await getDb();
  try {
    const [counts, totals] = await Promise.all([
      db.all(
        `SELECT status, COUNT(*) AS count
         FROM disbursements
         GROUP BY status
         ORDER BY count DESC`
      ),
      db.get(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'settled') AS settled,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed,
           COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
           COALESCE(SUM(amount_usdcx) FILTER (WHERE status = 'settled'), 0) AS total_volume_usdcx,
           COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)))
             FILTER (WHERE status = 'settled'), 0) AS avg_settlement_seconds
         FROM disbursements`
      ),
    ]);

    return {
      byStatus: counts,
      totals: totals || {},
      successRate: totals?.total > 0
        ? ((totals.settled / totals.total) * 100).toFixed(1)
        : '0.0',
    };
  } finally {
    db.release();
  }
}

/**
 * Active disbursements — in-flight, not terminal.
 */
export async function getActiveDisbursements({ limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  try {
    const rows = await db.all(
      `SELECT id, status, creator_address, amount_usdcx, amount_ngn_expected,
              created_at, updated_at,
              EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000 AS ms_in_state
       FROM disbursements
       WHERE status NOT IN ('settled', 'failed', 'cancelled')
       ORDER BY updated_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = await db.get(
      `SELECT COUNT(*) AS count
       FROM disbursements
       WHERE status NOT IN ('settled', 'failed', 'cancelled')`
    );

    return { disbursements: rows, total: total?.count || 0 };
  } finally {
    db.release();
  }
}

/**
 * Recent alerts — unacknowledged, newest first.
 */
export async function getRecentAlerts({ limit = 50, offset = 0, alertType = null } = {}) {
  const db = await getDb();
  try {
    const whereClause = alertType ? 'AND alert_type = $3' : '';
    const params = alertType ? [limit, offset, alertType] : [limit, offset];

    const rows = await db.all(
      `SELECT id, alert_key, alert_type, severity, disbursement_id,
              details, acknowledged, created_at
       FROM bos_alerts
       WHERE acknowledged = false ${whereClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const countParams = alertType ? [alertType] : [];
    const countWhere = alertType ? 'WHERE alert_type = $1' : '';
    const total = await db.get(
      `SELECT COUNT(*) AS count FROM bos_alerts ${countWhere} AND acknowledged = false`,
      countParams
    );

    return { alerts: rows, total: total?.count || 0 };
  } finally {
    db.release();
  }
}

/**
 * Alert statistics — counts by type and severity.
 */
export async function getAlertStats({ sinceMs = null } = {}) {
  const db = await getDb();
  try {
    const sinceClause = sinceMs
      ? `AND created_at > NOW() - INTERVAL '1 millisecond' * $1`
      : '';
    const params = sinceMs ? [sinceMs] : [];

    const stats = await db.all(
      `SELECT alert_type, severity, COUNT(*) AS count,
              MAX(created_at) AS latest
       FROM bos_alerts
       WHERE acknowledged = false ${sinceClause}
       GROUP BY alert_type, severity
       ORDER BY count DESC`,
      params
    );

    return stats;
  } finally {
    db.release();
  }
}

/**
 * Disbursement timeline — full lifecycle of a single disbursement.
 */
export async function getDisbursementTimeline(disbursementId) {
  const db = await getDb();
  try {
    const [disbursement, audit, alerts] = await Promise.all([
      db.get(
        `SELECT * FROM disbursements WHERE id = $1`,
        [disbursementId]
      ),
      db.all(
        `SELECT * FROM disbursement_audit
         WHERE disbursement_id = $1
         ORDER BY created_at ASC`,
        [disbursementId]
      ),
      db.all(
        `SELECT * FROM bos_alerts
         WHERE disbursement_id = $1
         ORDER BY created_at DESC`,
        [disbursementId]
      ),
    ]);

    return { disbursement, audit, alerts };
  } finally {
    db.release();
  }
}

/**
 * Manual review queue — disbursements stuck in manual_review.
 */
export async function getManualReviewQueue({ limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  try {
    const rows = await db.all(
      `SELECT d.id, d.status, d.creator_address, d.amount_usdcx, d.amount_ngn_expected,
              d.created_at, d.updated_at,
              EXTRACT(EPOCH FROM (NOW() - d.updated_at)) * 1000 AS ms_in_review
       FROM disbursements d
       WHERE d.status = 'manual_review'
       ORDER BY d.updated_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return { disbursements: rows };
  } finally {
    db.release();
  }
}

export default {
  getPipelineSummary,
  getActiveDisbursements,
  getRecentAlerts,
  getAlertStats,
  getDisbursementTimeline,
  getManualReviewQueue,
};
