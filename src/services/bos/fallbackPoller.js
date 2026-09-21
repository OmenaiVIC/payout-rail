/**
 * BOS Fallback Poller — polls external APIs when webhooks fail or are delayed
 *
 * Runs periodically to check status of disbursements stuck in states that
 * depend on external confirmation (xReserve attestation, destination release,
 * Yellow Card payout).
 *
 * Fallback intervals are configurable via env vars.
 */

const POLL_INTERVAL_MS = parseInt(process.env.BOS_POLL_INTERVAL_MS || '60000', 10); // 60s default
const MAX_POLL_ATTEMPTS = parseInt(process.env.BOS_MAX_POLL_ATTEMPTS || '30', 10);

/**
 * Determine which external system to poll based on disbursement state
 * @param {string} state
 * @returns {{ adapter: string, method: string, idField: string } | null}
 */
function pollTarget(state) {
  switch (state) {
    case 'burn_submitted':
      return { adapter: 'stacks', method: 'getTransactionStatus', idField: 'external_tx_id' };
    case 'attestation_requested':
      return { adapter: 'xreserve', method: 'getAttestationStatus', idField: 'attestation_id' };
    case 'destination_release_submitted':
      return { adapter: 'xreserve', method: 'getReleaseStatus', idField: 'release_id' };
    case 'yellowcard_payout_submitted':
      return { adapter: 'yellowcard', method: 'getPayoutStatus', idField: 'payout_id' };
    default:
      return null;
  }
}

/**
 * Map external status to BOS transition outcome
 * @param {string} externalStatus
 * @param {string} currentState
 * @returns {{ action: 'advance' | 'retry' | 'fail', reason?: string }}
 */
function mapExternalStatus(externalStatus, currentState) {
  const status = (externalStatus || '').toLowerCase();

  switch (currentState) {
    case 'burn_submitted':
      if (status === 'confirmed' || status === 'success') return { action: 'advance' };
      if (status === 'failed' || status === 'error') return { action: 'fail', reason: 'burn_failed' };
      return { action: 'retry' };

    case 'attestation_requested':
      if (status === 'confirmed' || status === 'completed') return { action: 'advance' };
      if (status === 'failed') return { action: 'fail', reason: 'attestation_failed' };
      return { action: 'retry' };

    case 'destination_release_submitted':
      if (status === 'confirmed' || status === 'completed') return { action: 'advance' };
      if (status === 'failed') return { action: 'fail', reason: 'release_failed' };
      return { action: 'retry' };

    case 'yellowcard_payout_submitted':
      if (status === 'completed' || status === 'successful') return { action: 'advance' };
      if (status === 'failed') return { action: 'fail', reason: 'payout_failed' };
      return { action: 'retry' };

    default:
      return { action: 'retry' };
  }
}

/**
 * Check if a disbursement is eligible for polling
 * @param {Object} disbursement
 * @returns {boolean}
 */
function isEligible(disbursement) {
  if (!disbursement || disbursement.status === 'settled' || disbursement.status === 'failed' || disbursement.status === 'cancelled') {
    return false;
  }
  if (disbursement.manual_review_at) return false;

  const target = pollTarget(disbursement.status);
  if (!target) return false;

  // Check retry budget
  if ((disbursement.retry_count || 0) >= MAX_POLL_ATTEMPTS) return false;

  return true;
}

/**
 * Create a fallback poller instance
 * @param {Object} deps
 * @param {Object} deps.db — database handle exposing get/all/run
 * @param {Object} deps.adapters — { stacks, xreserve, yellowcard }
 * @param {Object} deps.pipelineWorker — for calling advanceDisbursement
 * @param {Function} deps.logger — logging function
 */
function createFallbackPoller({ db, adapters, pipelineWorker, logger }) {
  let intervalId = null;
  let running = false;

  async function pollOnce() {
    if (running) return;
    running = true;

    try {
      // Find eligible disbursements
      const disbursements = await db.all(`
        SELECT id, status, external_tx_id, attestation_id, release_id, payout_id,
               retry_count, last_polled_at
        FROM disbursements
        WHERE status NOT IN ('settled', 'failed', 'cancelled', 'manual_review_required')
          AND manual_review_at IS NULL
          AND (retry_count IS NULL OR retry_count < $1)
          AND (last_polled_at IS NULL OR last_polled_at < NOW() - INTERVAL '30 seconds')
        ORDER BY updated_at ASC
        LIMIT 50
      `, [MAX_POLL_ATTEMPTS]);

      if (disbursements.length === 0) {
        running = false;
        return;
      }

      logger?.info?.(`Fallback poller: checking ${disbursements.length} disbursements`);

      for (const d of disbursements) {
        try {
          const target = pollTarget(d.status);
          if (!target) continue;

          const adapter = adapters[target.adapter];
          if (!adapter || !adapter[target.method]) {
            logger?.warn?.(`No adapter/method for ${target.adapter}.${target.method}`);
            continue;
          }

          const externalId = d[target.idField];
          if (!externalId) {
            logger?.warn?.(`Missing ${target.idField} for disbursement ${d.id}`);
            continue;
          }

          // Query external status
          const result = await adapter[target.method](externalId);
          const externalStatus = result?.status || result?.tx_status || 'pending';
          const outcome = mapExternalStatus(externalStatus, d.status);

          // Update retry count and last_polled_at
          await db.run(`
            UPDATE disbursements
            SET retry_count = COALESCE(retry_count, 0) + 1,
                last_polled_at = NOW()
            WHERE id = $1
          `, [d.id]);

          if (outcome.action === 'advance') {
            logger?.info?.(`Poller: disbursement ${d.id} confirmed (${d.status} → advancing)`);
            await pipelineWorker.advanceDisbursement(d.id);
          } else if (outcome.action === 'fail') {
            logger?.warn?.(`Poller: disbursement ${d.id} failed externally: ${outcome.reason}`);
            await db.run(`
              UPDATE disbursements
              SET status = 'failed', last_error = $2, failed_at = NOW()
              WHERE id = $1
            `, [d.id, outcome.reason]);
          } else {
            logger?.debug?.(`Poller: disbursement ${d.id} still pending`);
          }
        } catch (err) {
          logger?.error?.(`Poller error for disbursement ${d.id}: ${err.message}`);
        }
      }
    } catch (err) {
      logger?.error?.(`Fallback poller batch error: ${err.message}`);
    } finally {
      running = false;
    }
  }

  function start() {
    if (intervalId) return;
    logger?.info?.(`Fallback poller started (interval: ${POLL_INTERVAL_MS}ms)`);
    intervalId = setInterval(pollOnce, POLL_INTERVAL_MS);
    // Run immediately
    pollOnce();
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      logger?.info?.('Fallback poller stopped');
    }
  }

  return { start, stop, pollOnce };
}

module.exports = { createFallbackPoller, pollTarget, mapExternalStatus, isEligible };
