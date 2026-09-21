import { getDb } from '../../../database.js';
import thresholdConfig from './thresholdConfig.js';
import { recordAlert } from './alertDeduplicator.js';
import { buildNotifier } from './notifier.js';

/**
 * BOS Monitoring — Monitor Job
 *
 * Runs on a 5-minute interval inside the Express server process.
 * Checks: state-age thresholds, stuck disbursements, webhook timeouts,
 * exchange rate staleness, and manual review queue depth.
 */

let intervalId = null;
let notifier = null;
let running = false;

/**
 * Check disbursements that have exceeded their state-age SLA thresholds.
 */
export async function checkStateAgeThresholds() {
  const db = await getDb();
  try {
    const rows = await db.all(
      `SELECT id, status, created_at, updated_at,
              EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000 AS ms_in_state
       FROM disbursements
       WHERE status NOT IN ('settled', 'failed', 'cancelled')`
    );

    const alerts = [];
    for (const row of rows) {
      const thresholdMs = thresholdConfig.getStateThresholdMs(row.status);
      const reaperThreshold = thresholdConfig.getReaperThresholdMs(row.status, thresholdMs);

      if (row.ms_in_state > reaperThreshold) {
        const alertKey = `stuck_in_state:${row.status}:${row.id}`;
        const severity = row.status === 'manual_review'
          ? 'warning'
          : thresholdConfig.ALERT_SEVERITY.stuck_in_state;

        const inserted = await recordAlert({
          alertKey,
          alertType: 'stuck_in_state',
          severity,
          disbursementId: row.id,
          details: {
            status: row.status,
            ms_in_state: Math.round(row.ms_in_state),
            threshold_ms: reaperThreshold,
            created_at: row.created_at,
            updated_at: row.updated_at,
          },
        });

        if (inserted) {
          alerts.push({
            alertType: 'stuck_in_state',
            severity,
            disbursementId: row.id,
            message: `Disbursement ${row.id} stuck in ${row.status} for ${Math.round(row.ms_in_state / 60_000)} minutes (threshold: ${Math.round(reaperThreshold / 60_000)} min)`,
          });
        }
      }
    }
    return alerts;
  } finally {
    db.release();
  }
}

/**
 * Check for disbursements that exceeded burn confirmation timeout.
 */
export async function checkBurnTimeouts() {
  const db = await getDb();
  try {
    const rows = await db.all(
      `SELECT d.id, d.status, d.created_at,
              EXTRACT(EPOCH FROM (NOW() - d.created_at)) * 1000 AS ms_since_created
       FROM disbursements d
       WHERE d.status IN ('disbursement_initiated', 'burn_submitted')
         AND EXTRACT(EPOCH FROM (NOW() - d.created_at)) * 1000 > $1`,
      [thresholdConfig.THRESHOLDS_MS.burn_timeout]
    );

    const alerts = [];
    for (const row of rows) {
      const alertKey = `burn_timeout:${row.id}`;
      const inserted = await recordAlert({
        alertKey,
        alertType: 'burn_timeout',
        severity: 'critical',
        disbursementId: row.id,
        details: {
          status: row.status,
          ms_since_created: Math.round(row.ms_since_created),
          threshold_ms: thresholdConfig.THRESHOLDS_MS.burn_timeout,
        },
      });

      if (inserted) {
        alerts.push({
          alertType: 'burn_timeout',
          severity: 'critical',
          disbursementId: row.id,
          message: `Disbursement ${row.id} burn not confirmed after ${Math.round(row.ms_since_created / 60_000)} minutes (status: ${row.status})`,
        });
      }
    }
    return alerts;
  } finally {
    db.release();
  }
}

/**
 * Check for disbursements that exceeded attestation timeout.
 */
export async function checkAttestationTimeouts() {
  const db = await getDb();
  try {
    const rows = await db.all(
      `SELECT d.id, d.status, d.updated_at,
              EXTRACT(EPOCH FROM (NOW() - d.updated_at)) * 1000 AS ms_in_state
       FROM disbursements d
       WHERE d.status = 'burn_confirmed'
         AND EXTRACT(EPOCH FROM (NOW() - d.updated_at)) * 1000 > $1`,
      [thresholdConfig.THRESHOLDS_MS.attestation_timeout]
    );

    const alerts = [];
    for (const row of rows) {
      const alertKey = `attestation_timeout:${row.id}`;
      const inserted = await recordAlert({
        alertKey,
        alertType: 'attestation_timeout',
        severity: 'critical',
        disbursementId: row.id,
        details: {
          status: row.status,
          ms_in_state: Math.round(row.ms_in_state),
          threshold_ms: thresholdConfig.THRESHOLDS_MS.attestation_timeout,
        },
      });

      if (inserted) {
        alerts.push({
          alertType: 'attestation_timeout',
          severity: 'critical',
          disbursementId: row.id,
          message: `Disbursement ${row.id} attestation not received after ${Math.round(row.ms_in_state / 60_000)} minutes`,
        });
      }
    }
    return alerts;
  } finally {
    db.release();
  }
}

/**
 * Check for Yellow Card payout failures or timeouts.
 */
export async function checkDestinationReleaseFailures() {
  const db = await getDb();
  try {
    const rows = await db.all(
      `SELECT d.id, d.status, d.updated_at,
              EXTRACT(EPOCH FROM (NOW() - d.updated_at)) * 1000 AS ms_in_state
       FROM disbursements d
       WHERE d.status = 'attestation_confirmed'
         AND EXTRACT(EPOCH FROM (NOW() - d.updated_at)) * 1000 > $1`,
      [thresholdConfig.THRESHOLDS_MS.destination_release_failure]
    );

    const alerts = [];
    for (const row of rows) {
      const alertKey = `destination_release_failure:${row.id}`;
      const inserted = await recordAlert({
        alertKey,
        alertType: 'destination_release_failure',
        severity: 'critical',
        disbursementId: row.id,
        details: {
          status: row.status,
          ms_in_state: Math.round(row.ms_in_state),
          threshold_ms: thresholdConfig.THRESHOLDS_MS.destination_release_failure,
        },
      });

      if (inserted) {
        alerts.push({
          alertType: 'destination_release_failure',
          severity: 'critical',
          disbursementId: row.id,
          message: `Disbursement ${row.id} destination release not completed after ${Math.round(row.ms_in_state / 60_000)} minutes`,
        });
      }
    }
    return alerts;
  } finally {
    db.release();
  }
}

/**
 * Check exchange rate staleness.
 */
export async function checkExchangeRateStaleness() {
  const db = await getDb();
  try {
    const row = await db.get(
      `SELECT MAX(updated_at) AS last_update
       FROM exchange_rates
       WHERE pair = 'USDCx/NGN'`
    );

    if (!row?.last_update) {
      const alertKey = 'rate_stale:no_rate';
      const inserted = await recordAlert({
        alertKey,
        alertType: 'rate_stale',
        severity: 'warning',
        details: { pair: 'USDCx/NGN', reason: 'No exchange rate record found' },
      });

      return inserted ? [{
        alertType: 'rate_stale',
        severity: 'warning',
        message: 'No USDCx/NGN exchange rate found in exchange_rates table',
      }] : [];
    }

    const msSinceUpdate = Date.now() - new Date(row.last_update).getTime();
    if (msSinceUpdate > thresholdConfig.EXCHANGE_RATE_STALE_MS) {
      const alertKey = `rate_stale:USDCx_NGN`;
      const inserted = await recordAlert({
        alertKey,
        alertType: 'rate_stale',
        severity: 'warning',
        details: {
          pair: 'USDCx/NGN',
          last_update: row.last_update,
          ms_since_update: Math.round(msSinceUpdate),
          threshold_ms: thresholdConfig.EXCHANGE_RATE_STALE_MS,
        },
      });

      return inserted ? [{
        alertType: 'rate_stale',
        severity: 'warning',
        message: `USDCx/NGN rate stale for ${Math.round(msSinceUpdate / 60_000)} minutes (last update: ${row.last_update})`,
      }] : [];
    }
    return [];
  } finally {
    db.release();
  }
}

/**
 * Check webhook timeout — Yellow Card callbacks not received.
 */
export async function checkWebhookTimeouts() {
  const db = await getDb();
  try {
    const rows = await db.all(
      `SELECT d.id, d.status, d.updated_at,
              EXTRACT(EPOCH FROM (NOW() - d.updated_at)) * 1000 AS ms_in_state
       FROM disbursements d
       WHERE d.status = 'yellowcard_payout_submitted'
         AND EXTRACT(EPOCH FROM (NOW() - d.updated_at)) * 1000 > $1`,
      [thresholdConfig.THRESHOLDS_MS.webhook_timeout]
    );

    const alerts = [];
    for (const row of rows) {
      const alertKey = `webhook_timeout:${row.id}`;
      const inserted = await recordAlert({
        alertKey,
        alertType: 'webhook_timeout',
        severity: 'warning',
        disbursementId: row.id,
        details: {
          status: row.status,
          ms_in_state: Math.round(row.ms_in_state),
          threshold_ms: thresholdConfig.THRESHOLDS_MS.webhook_timeout,
        },
      });

      if (inserted) {
        alerts.push({
          alertType: 'webhook_timeout',
          severity: 'warning',
          disbursementId: row.id,
          message: `Disbursement ${row.id} webhook not received after ${Math.round(row.ms_in_state / 60_000)} minutes (status: ${row.status})`,
        });
      }
    }
    return alerts;
  } finally {
    db.release();
  }
}

/**
 * Run all monitoring checks and send alerts.
 */
export async function runChecks() {
  if (running) {
    console.warn('[bos:monitor] Previous run still in progress, skipping');
    return { skipped: true };
  }

  running = true;
  const startTime = Date.now();
  const allAlerts = [];

  try {
    const checkResults = await Promise.allSettled([
      checkStateAgeThresholds(),
      checkBurnTimeouts(),
      checkAttestationTimeouts(),
      checkDestinationReleaseFailures(),
      checkWebhookTimeouts(),
      checkExchangeRateStaleness(),
    ]);

    for (const result of checkResults) {
      if (result.status === 'fulfilled') {
        allAlerts.push(...result.value);
      } else {
        console.error('[bos:monitor] Check failed:', result.reason?.message || result.reason);
        allAlerts.push({
          alertType: 'monitor_failure',
          severity: 'critical',
          message: `Monitor check failed: ${result.reason?.message || 'unknown error'}`,
        });
      }
    }

    // Send all collected alerts through notifier
    if (allAlerts.length > 0 && notifier) {
      for (const alert of allAlerts) {
        await notifier.send(alert);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[bos:monitor] Completed in ${duration}ms — ${allAlerts.length} alerts`);

    return {
      alerts: allAlerts,
      duration,
      timestamp: new Date().toISOString(),
    };
  } finally {
    running = false;
  }
}

/**
 * Start the monitor job on a 5-minute interval.
 */
export function start() {
  if (intervalId) {
    console.warn('[bos:monitor] Already running');
    return;
  }

  notifier = buildNotifier();
  console.log(`[bos:monitor] Starting — interval ${thresholdConfig.MONITOR_INTERVAL_MS / 1000}s`);

  // Run immediately on start
  runChecks().catch((err) => {
    console.error('[bos:monitor] Initial run failed:', err.message);
  });

  intervalId = setInterval(() => {
    runChecks().catch((err) => {
      console.error('[bos:monitor] Run failed:', err.message);
    });
  }, thresholdConfig.MONITOR_INTERVAL_MS);
}

/**
 * Stop the monitor job.
 */
export function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[bos:monitor] Stopped');
  }
}

/**
 * Get current monitor status.
 */
export function getStatus() {
  return {
    running: !!intervalId,
    intervalMs: thresholdConfig.MONITOR_INTERVAL_MS,
    inProgress: running,
  };
}

export default {
  start,
  stop,
  getStatus,
  runChecks,
  checkStateAgeThresholds,
  checkBurnTimeouts,
  checkAttestationTimeouts,
  checkDestinationReleaseFailures,
  checkWebhookTimeouts,
  checkExchangeRateStaleness,
};
