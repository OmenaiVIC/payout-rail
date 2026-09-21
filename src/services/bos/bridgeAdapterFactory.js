/**
 * BOS Bridge Adapter Factory
 * Returns the correct BridgeAdapter implementation based on env config.
 *
 * BRIDGE_ADAPTER_ENV values:
 *   'xreserve' — xReserve attestation + release (default)
 *   'mock'     — mock adapter for testing
 */

import * as xreserveAdapter from './xreserveAdapter.js';
import * as yellowcardAdapter from './yellowcardAdapter.js';
import * as StacksAdapter from './StacksAdapter.js';

const ADAPTER_ENV = process.env.BRIDGE_ADAPTER_ENV || 'xreserve';

/**
 * Get the configured xReserve adapter.
 * Currently only xreserve adapter exists; stubs for 'cctp-v2' can be added here.
 *
 * @returns {Object} adapter implementing { requestAttestation, getAttestationStatus, releaseDestination, getReleaseStatus }
 */
export function getXReserveAdapter() {
  switch (ADAPTER_ENV) {
    case 'mock':
      return _mockAdapter();
    case 'xreserve':
    default:
      return xreserveAdapter;
  }
}

/**
 * Get the stacks (chain) adapter.
 * Standalone StacksAdapter keyed from chainConfig.js + PAYOUT_TX_SIGNING_KEY.
 * @returns {Object} adapter implementing { burnUsdcx, getTransactionStatus }
 */
export function getStacksAdapter() {
  return StacksAdapter;
}

/**
 * Get the Yellow Card adapter.
 * Returns real REST client for NGN payout via Yellow Card API.
 * @returns {Object} adapter implementing { initiatePayout, getPayoutStatus, healthCheck }
 */
export function getYellowCardAdapter() {
  return yellowcardAdapter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock adapter — returns canned responses for testing
// ─────────────────────────────────────────────────────────────────────────────

function _mockAdapter() {
  const _attestations = new Map();
  const _releases = new Map();

  return {
    async requestAttestation({ tx_id }) {
      const attId = `mock-att-${Date.now()}`;
      _attestations.set(attId, { status: 'confirmed', tx_id });
      return { attestation_id: attId, status: 'confirmed' };
    },
    async getAttestationStatus(attId) {
      const record = _attestations.get(attId);
      if (!record) return { status: 'failed', error: 'not found' };
      return { status: record.status };
    },
    async releaseDestination({ attestation_id }) {
      const relId = `mock-rel-${Date.now()}`;
      _releases.set(relId, { status: 'confirmed', attestation_id });
      return { release_id: relId, status: 'confirmed' };
    },
    async getReleaseStatus(relId) {
      const record = _releases.get(relId);
      if (!record) return { status: 'failed', error: 'not found' };
      return { status: record.status };
    },
    async healthCheck() {
      return { healthy: true, latencyMs: 0 };
    },
  };
}

export default {
  getXReserveAdapter,
  getStacksAdapter,
  getYellowCardAdapter,
};
