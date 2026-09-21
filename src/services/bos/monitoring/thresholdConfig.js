/**
 * BOS Monitoring — Threshold Configuration
 *
 * SLA values derived from BOS state machine design document §6.
 * Reaper multipliers from BOS design doc §10.
 * Dedup windows tuned for 5-minute monitor interval.
 */

const THRESHOLDS_MS = {
  burn_timeout: 600_000,        // 10 minutes — BTC burn should anchor within ~2 blocks
  attestation_timeout: 900_000, // 15 minutes — xReserve attestation after burn confirms
  destination_release_failure: 3_600_000, // 60 minutes — Yellow Card payout
  yellowcard_api_failure: 900_000,        // 15 minutes — Yellow Card API unreachable
  webhook_timeout: 900_000,               // 15 minutes — Yellow Card callback pending
  payout_timeout: 1_800_000,              // 30 minutes — total end-to-end
  stuck_in_state: 1_800_000,              // 30 minutes — any non-terminal state
};

const REAPER_MULTIPLIER = {
  default: 2,         // 2x SLA threshold flags as stuck
  manual_review: 7,   // 7x SLA before flagging manual review as stuck (humans resolving)
};

const DEDUP_WINDOW_MS = 30 * 60_000; // 30 minutes — suppress duplicate alerts within window

const MONITOR_INTERVAL_MS = 5 * 60_000; // 5 minutes between monitor runs

const EXCHANGE_RATE_STALE_MS = 5 * 60_000; // 5 minutes — exchange rate considered stale

const ALERT_SEVERITY = {
  burn_timeout: 'critical',
  attestation_timeout: 'critical',
  destination_release_failure: 'critical',
  yellowcard_api_failure: 'critical',
  webhook_timeout: 'warning',
  stuck_in_state: 'warning',
  rate_stale: 'warning',
  monitor_failure: 'critical',
  notifier_failure: 'warning',
};

function getStateThresholdMs(state) {
  const base = THRESHOLDS_MS[state];
  if (base) return base;
  return THRESHOLDS_MS.stuck_in_state;
}

function getReaperThresholdMs(state, baseThresholdMs) {
  const multiplier = state === 'manual_review'
    ? REAPER_MULTIPLIER.manual_review
    : REAPER_MULTIPLIER.default;
  return baseThresholdMs * multiplier;
}

export {
  THRESHOLDS_MS,
  REAPER_MULTIPLIER,
  DEDUP_WINDOW_MS,
  MONITOR_INTERVAL_MS,
  EXCHANGE_RATE_STALE_MS,
  ALERT_SEVERITY,
  getStateThresholdMs,
  getReaperThresholdMs,
};

export default {
  THRESHOLDS_MS,
  REAPER_MULTIPLIER,
  DEDUP_WINDOW_MS,
  MONITOR_INTERVAL_MS,
  EXCHANGE_RATE_STALE_MS,
  ALERT_SEVERITY,
  getStateThresholdMs,
  getReaperThresholdMs,
};
