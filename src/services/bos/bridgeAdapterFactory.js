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
import * as flutterwaveAdapter from './flutterwaveAdapter.js';
import * as StacksAdapter from './StacksAdapter.js';

const ADAPTER_ENV = process.env.BRIDGE_ADAPTER_ENV || 'xreserve';

/**
 * Get the configured xReserve adapter.
 * Currently only xreserve adapter exists; stubs for 'cctp-v2' can be added here.
 *
 * @returns {Object} adapter implementing { requestAttestation, getAttestationStatus, observeDestinationRelease, healthCheck }
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
 *
 * Yellow Card remains the PRIMARY NGN payout provider. Nothing in this factory
 * changes which provider the pipeline uses — see the note on the provider
 * selector below.
 * @returns {Object} adapter implementing { initiatePayout, getPayoutStatus, healthCheck }
 */
export function getYellowCardAdapter() {
  return yellowcardAdapter;
}

/**
 * Get the Flutterwave adapter.
 *
 * Returns the real v3 REST client. ⚠ The documented transfer body is a
 * USDC-to-wallet disbursement, NOT an NGN bank payout — see the module header in
 * flutterwaveAdapter.js and docs/flutterwave-api-reference.md §0.
 *
 * Exposing it here does NOT route anything to it. The payout leg resolves
 * `ctx.adapters.yellowcard` at 14 hard-coded call sites, so this adapter is
 * reachable but unused; actual provider routing is backlog P-1.
 *
 * @returns {Object} adapter implementing { submitSend, lookupSend, healthCheck, verifyWebhookSignature, classifyError }
 */
export function getFlutterwaveAdapter() {
  return flutterwaveAdapter;
}

/**
 * Payout provider selection — CONFIG LAYER ONLY.
 *
 * `PAYOUT_PROVIDER` names the adapter the context is built with. It defaults to
 * 'yellowcard' and the default is the only path the pipeline executes today.
 *
 * Setting `PAYOUT_PROVIDER=flutterwave` changes which adapter is published on
 * the context; it does NOT change the payout leg, because that leg is hard-wired
 * to `ctx.adapters.yellowcard` at 14 sites. Resolving the provider per corridor
 * at runtime is backlog **P-1** and needs explicit re-authorization (it touches
 * the state machine's action layer and the evidence chain).
 *
 * Read at call time, not module scope, so it is testable without cache-busted
 * re-imports.
 *
 * @returns {string} the configured provider name
 */
export function getPayoutProvider() {
  return process.env.PAYOUT_PROVIDER || 'yellowcard';
}

/**
 * Resolve the configured payout adapter.
 * @returns {Object} the adapter for getPayoutProvider()
 */
export function getPayoutAdapter() {
  return getPayoutProvider() === 'flutterwave' ? flutterwaveAdapter : yellowcardAdapter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock adapter — returns canned responses for testing
// ─────────────────────────────────────────────────────────────────────────────

function _mockAdapter() {
  const _attestations = new Map();
  const _observations = new Map();

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
    async observeDestinationRelease({ disbursement_id }) {
      // Fail-closed like the real adapter: report only what is latched.
      const rec = _observations.get(disbursement_id);
      if (!rec) {
        return { release_status: 'unobserved', source: 'mock', evidence: null, observed_at: new Date().toISOString() };
      }
      return rec;
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
  getFlutterwaveAdapter,
  getPayoutProvider,
  getPayoutAdapter,
};
