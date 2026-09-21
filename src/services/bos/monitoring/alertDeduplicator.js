import { getDb } from '../../../database.js';
import thresholdConfig from './thresholdConfig.js';

/**
 * Alert Deduplicator — prevents duplicate alerts within the dedup window.
 *
 * Uses the `bos_alerts` table as the source of truth:
 * - INSERT with dedup check (unique constraint on alert_key + created_at)
 * - SELECT to check recent alerts for same alert_key
 * - UPDATE to acknowledge alerts
 */

/**
 * Check if an alert should be suppressed (duplicate within dedup window).
 * @param {string} alertKey — composite key (e.g. `burn_timeout:${disbursementId}`)
 * @returns {boolean} true if alert should be suppressed
 */
export async function shouldSuppress(alertKey) {
  const db = await getDb();
  try {
    const row = await db.get(
      `SELECT id FROM bos_alerts
       WHERE alert_key = $1
         AND created_at > NOW() - INTERVAL '1 millisecond' * $2
       LIMIT 1`,
      [alertKey, thresholdConfig.DEDUP_WINDOW_MS]
    );
    return !!row;
  } finally {
    db.release();
  }
}

/**
 * Record a new alert. Returns true if inserted, false if suppressed by dedup.
 */
export async function recordAlert({ alertKey, alertType, severity, disbursementId, details }) {
  if (await shouldSuppress(alertKey)) {
    return false;
  }

  const db = await getDb();
  try {
    await db.run(
      `INSERT INTO bos_alerts (alert_key, alert_type, severity, disbursement_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [alertKey, alertType, severity, disbursementId, JSON.stringify(details || {})]
    );
    return true;
  } finally {
    db.release();
  }
}

/**
 * Acknowledge an alert by id.
 */
export async function acknowledgeAlert(alertId) {
  const db = await getDb();
  try {
    await db.run(
      `UPDATE bos_alerts SET acknowledged = true, acknowledged_at = NOW() WHERE id = $1`,
      [alertId]
    );
  } finally {
    db.release();
  }
}

/**
 * Get unacknowledged alerts, optionally filtered by type.
 */
export async function getUnacknowledgedAlerts(alertType = null) {
  const db = await getDb();
  try {
    const sql = alertType
      ? `SELECT * FROM bos_alerts WHERE alert_type = $1 AND acknowledged = false ORDER BY created_at DESC`
      : `SELECT * FROM bos_alerts WHERE acknowledged = false ORDER BY created_at DESC`;
    const params = alertType ? [alertType] : [];
    return await db.all(sql, params);
  } finally {
    db.release();
  }
}

/**
 * Get alert statistics — counts by type and severity.
 */
export async function getAlertStats(since = null) {
  const db = await getDb();
  try {
    const sinceClause = since
      ? `AND created_at > NOW() - INTERVAL '1 millisecond' * $1`
      : '';
    const params = since ? [since] : [];
    return await db.all(
      `SELECT alert_type, severity, COUNT(*) as count,
              MAX(created_at) as latest
       FROM bos_alerts
       WHERE acknowledged = false ${sinceClause}
       GROUP BY alert_type, severity
       ORDER BY count DESC`,
      params
    );
  } finally {
    db.release();
  }
}

export default {
  shouldSuppress,
  recordAlert,
  acknowledgeAlert,
  getUnacknowledgedAlerts,
  getAlertStats,
};
