/**
 * Test helper — a latched mock settlement surface (G-08 evidence source).
 *
 * The corrected model never fabricates a destination release: the app can only
 * record evidence the external settlement surface produces. This helper
 * emulates that surface entirely off-network — a test scripts evidence with
 * emit(disbursementId, status) and observe() replays the latched status
 * (default 'unobserved'). Wiring this source in for observeDestinationRelease
 * is the ONLY way observation evidence exists in a test; nothing below ever
 * issues a network call.
 */
export function createMockEvidenceSource(seed = []) {
  const evidenceByDisbursement = new Map(seed);

  return {
    /** Script the settlement surface to report a release status. */
    emit(disbursementId, releaseStatus) {
      evidenceByDisbursement.set(disbursementId, releaseStatus);
      return { disbursementId, releaseStatus };
    },

    /** Replay the latched evidence for the disbursement (fail-closed default). */
    observe({ disbursement_id, external_tx_id, attestation_id } = {}) {
      return {
        release_status: evidenceByDisbursement.get(disbursement_id) || 'unobserved',
        source: 'mock-evidence',
        evidence: null,
        observed_at: new Date().toISOString(),
        request: { disbursement_id, external_tx_id, attestation_id },
      };
    },

    /** What evidence is latched for a disbursement right now. */
    statusOf(disbursementId) {
      return evidenceByDisbursement.get(disbursementId) || 'unobserved';
    },
  };
}

export default createMockEvidenceSource;