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
import * as breetAdapter from './breetAdapter.js';
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

export function getBreetAdapter() {
  return breetAdapter;
}

/**
 * Payout provider selection and the payout-leg capability seam.
 *
 * `PAYOUT_PROVIDER` names the provider for this process (default yellowcard).
 * The payout leg resolves its adapter through this seam instead of reaching for
 * `ctx.adapters.yellowcard` directly, so a provider can be swapped without
 * editing every call site (backlog P-1, staged C1–C4).
 *
 * One active provider per process: `ctx.payoutProvider` is fixed at init. Per
 * corridor selection is a later change.
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
  const p = getPayoutProvider();
  if (p === 'flutterwave') return flutterwaveAdapter;
  if (p === 'breet') return breetAdapter;
  return yellowcardAdapter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payout-leg capability seam
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which payout legs each provider can actually serve. A provider absent from this
 * map has no declared capability.
 *
 * `flutterwave` is deliberately empty: flutterwaveAdapter.js disburses USDC to a
 * wallet, not NGN to a bank account (F-1). Publishing the adapter must never make
 * the payout leg routable to it.
 *
 * `breet` is declared but UNVERIFIED — the payload shape is confirmed later in
 * C5; the capability claim itself is still structural only.
 */
export const PAYOUT_LEGS = Object.freeze({
  yellowcard: Object.freeze(['ngn_bank']),
  breet: Object.freeze(['ngn_bank']),
  flutterwave: Object.freeze([]),
});

export const PAYOUT_LEG_NGN_BANK = 'ngn_bank';

/**
 * A provider that was selected but cannot serve the requested payout leg.
 * Thrown at startup and at resolution time — never swallowed into "advance".
 */
export class ProviderCapabilityError extends Error {
  constructor(provider, leg, detail) {
    super(
      `Payout provider "${provider}" cannot serve the ${leg} payout leg` +
        (detail ? `: ${detail}` : '')
    );
    this.name = 'ProviderCapabilityError';
    this.code = 'PROVIDER_CAPABILITY_UNSUPPORTED';
    this.provider = provider;
    this.leg = leg;
  }
}

/**
 * Normalize a provider name to one the seam can resolve.
 *
 * Unknown values fall back to 'yellowcard', matching getPayoutAdapter() — pinned
 * by flutterwave-provider-config.test.js:58. Name and adapter must never diverge:
 * that is exactly the silent-routing failure P-1 exists to prevent.
 *
 * @param {string} [value] provider name; defaults to getPayoutProvider()
 * @returns {string} a key of PAYOUT_LEGS
 */
export function resolvePayoutProvider(value = getPayoutProvider()) {
  const name = String(value ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PAYOUT_LEGS, name) ? name : 'yellowcard';
}

/**
 * @returns {boolean} whether the provider (after normalization) can serve the leg
 */
export function supportsPayoutLeg(provider, leg = PAYOUT_LEG_NGN_BANK) {
  return PAYOUT_LEGS[resolvePayoutProvider(provider)].includes(leg);
}

/**
 * Fail closed unless the provider can serve the leg.
 * @returns {string} the normalized provider name
 * @throws {ProviderCapabilityError}
 */
export function assertPayoutLeg(provider, leg = PAYOUT_LEG_NGN_BANK) {
  const name = resolvePayoutProvider(provider);
  if (!PAYOUT_LEGS[name].includes(leg)) {
    throw new ProviderCapabilityError(name, leg);
  }
  return name;
}

/**
 * Startup gate: the configured provider must be able to serve the NGN bank leg.
 * Called by ensureInit() before any adapter is published.
 * @returns {string} the normalized provider name
 * @throws {ProviderCapabilityError}
 */
export function assertPayoutProviderCapable(provider = getPayoutProvider()) {
  return assertPayoutLeg(provider, PAYOUT_LEG_NGN_BANK);
}

/**
 * Resolve the payout adapter for a ctx through the seam.
 *
 * Precedence: ctx.getPayoutAdapter() (production and test contexts both supply
 * it), then ctx.adapters[provider], and never a silent fallback to yellowcard
 * when the ctx named a provider that has no published adapter.
 *
 * @param {Object} ctx
 * @returns {Object} the payout adapter
 * @throws {ProviderCapabilityError} when the provider cannot serve the leg
 */
export function resolvePayoutAdapter(ctx) {
  const provider = assertPayoutLeg(ctx?.payoutProvider, PAYOUT_LEG_NGN_BANK);
  const adapter =
    typeof ctx?.getPayoutAdapter === 'function'
      ? ctx.getPayoutAdapter()
      : ctx?.adapters?.[provider];

  if (!adapter) {
    throw new Error(`No payout adapter published for provider "${provider}"`);
  }
  return adapter;
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
  getBreetAdapter,
  getPayoutProvider,
  getPayoutAdapter,
  PAYOUT_LEGS,
  PAYOUT_LEG_NGN_BANK,
  ProviderCapabilityError,
  resolvePayoutProvider,
  supportsPayoutLeg,
  assertPayoutLeg,
  assertPayoutProviderCapable,
  resolvePayoutAdapter,
};
