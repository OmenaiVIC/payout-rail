/**
 * In-memory mock adapters for the BOS ctx.adapters seam.
 *
 * These are TEST-ONLY doubles. They are injected into a hand-built ctx; the
 * production adapter selection in src/services/bos/bridgeAdapterFactory.js is
 * never touched (see SPRINT_0_5_PLAN D6).
 *
 * Shapes mirror the real adapters exactly as consumed by
 * transitionGuards.js / transitionActions.js:
 *   stacks     : burnUsdcx, getTransactionStatus
 *   xreserve   : requestAttestation, getAttestationStatus, releaseDestination,
 *                getReleaseStatus, healthCheck
 *   yellowcard : submitSend, lookupSend, healthCheck, verifyWebhookSignature
 *
 * Every mock records its calls so tests can assert on the side-effect.
 */

const ZERO_HASH = `0x${'ab'.repeat(32)}`;

export function createMockStacks() {
  const calls = { burnUsdcx: [], getTransactionStatus: [] };
  let txCounter = 0;

  return {
    calls,
    /** Override for a specific test (e.g. to simulate a failed/reverted burn). */
    txStatusResult: { tx_status: 'success', block_height: 1 },
    burnResult: null,

    async burnUsdcx(params) {
      calls.burnUsdcx.push(params);
      if (this.burnResult) return this.burnResult;
      txCounter += 1;
      return `0x${String(txCounter).padStart(64, '0')}`;
    },

    async getTransactionStatus(txHash) {
      calls.getTransactionStatus.push(txHash);
      return this.txStatusResult;
    },
  };
}

export function createMockXReserve() {
  const calls = {
    requestAttestation: [],
    getAttestationStatus: [],
    releaseDestination: [],
    getReleaseStatus: [],
    healthCheck: [],
  };
  let attestationCounter = 0;
  let releaseCounter = 0;

  return {
    calls,

    async requestAttestation(params) {
      calls.requestAttestation.push(params);
      attestationCounter += 1;
      return {
        attestation_id: `att-mock-${attestationCounter}`,
        status: 'pending',
        tx_id: params?.tx_id,
      };
    },

    async getAttestationStatus(attestationId) {
      calls.getAttestationStatus.push(attestationId);
      return { attestation_id: attestationId, status: 'complete' };
    },

    async releaseDestination(params) {
      calls.releaseDestination.push(params);
      releaseCounter += 1;
      return { release_id: `rel-mock-${releaseCounter}`, status: 'complete' };
    },

    async getReleaseStatus(releaseId) {
      calls.getReleaseStatus.push(releaseId);
      return { release_id: releaseId, status: 'complete' };
    },

    async healthCheck() {
      calls.healthCheck.push(true);
      return { healthy: true };
    },
  };
}

export function createMockYellowCard() {
  const calls = { submitSend: [], lookupSend: [], healthCheck: [], verifyWebhookSignature: [] };
  let sendCounter = 0;

  return {
    calls,
    /** Override to simulate an unconfirmed payout lookup. */
    lookupResult: null,

    async submitSend(params) {
      calls.submitSend.push(params);
      sendCounter += 1;
      return { send_id: `yc-mock-${sendCounter}`, status: 'processing' };
    },

    async lookupSend(sendId) {
      calls.lookupSend.push(sendId);
      if (this.lookupResult) return this.lookupResult;
      return { status: 'completed', data: { id: sendId } };
    },

    async healthCheck() {
      calls.healthCheck.push(true);
      return { healthy: true };
    },

    async verifyWebhookSignature(payload, signature, secret) {
      calls.verifyWebhookSignature.push({ payload, signature, secret });
      return true;
    },
  };
}

export function createMockAdapters() {
  return {
    stacks: createMockStacks(),
    xreserve: createMockXReserve(),
    yellowcard: createMockYellowCard(),
  };
}

export { ZERO_HASH };
