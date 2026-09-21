/**
 * BOS Audit Timeline — human-readable timeline of disbursement events
 *
 * Builds a chronological timeline from the disbursement_audit table,
 * enriched with external status snapshots and evidence references.
 */

/**
 * Human-readable labels for BOS states
 */
const STATE_LABELS = {
  disbursement_initiated: { label: 'Disbursement created', icon: '📋', category: 'start' },
  preflight_check: { label: 'Safety checks passed', icon: '✅', category: 'safety' },
  manual_review_required: { label: 'Sent for manual review', icon: '👀', category: 'safety' },
  burn_submitted: { label: 'Digital currency sent for burning', icon: '🔥', category: 'bridge' },
  burn_confirmed: { label: 'Burn confirmed on blockchain', icon: '✅', category: 'bridge' },
  attestation_requested: { label: 'Proof requested from xReserve', icon: '📝', category: 'bridge' },
  attestation_confirmed: { label: 'Proof confirmed by xReserve', icon: '✅', category: 'bridge' },
  destination_release_submitted: { label: 'Release requested on destination chain', icon: '🔗', category: 'bridge' },
  destination_release_confirmed: { label: 'Release confirmed', icon: '✅', category: 'bridge' },
  yellowcard_payout_submitted: { label: 'Bank transfer initiated', icon: '🏦', category: 'payout' },
  yellowcard_payout_confirmed: { label: 'Bank transfer completed', icon: '✅', category: 'payout' },
  settled: { label: 'Fully settled', icon: '🎉', category: 'end' },
  failed: { label: 'Disbursement failed', icon: '❌', category: 'end' },
  cancelled: { label: 'Disbursement cancelled', icon: '🚫', category: 'end' },
};

/**
 * Build a timeline for a disbursement
 *
 * @param {Object} deps
 * @param {Object} deps.db — database client
 * @param {string} deps.disbursementId
 * @returns {Promise<{ timeline: Array<Object>, summary: Object }>}
 */
async function buildTimeline({ db, disbursementId }) {
  // Fetch audit events
  const auditResult = await db.all(`
    SELECT from_state, to_state, reason, metadata, created_at
    FROM disbursement_audit
    WHERE disbursement_id = $1
    ORDER BY created_at ASC
  `, [disbursementId]);

  const auditEvents = auditResult || [];

  // Fetch external status snapshots
  const snapshotResult = await db.all(`
    SELECT external_system, status, raw_response, created_at
    FROM external_status_snapshots
    WHERE disbursement_id = $1
    ORDER BY created_at ASC
  `, [disbursementId]);

  const snapshots = snapshotResult || [];

  // Fetch evidence references
  const evidenceResult = await db.all(`
    SELECT evidence_type, evidence_data, created_at
    FROM disbursement_evidence
    WHERE disbursement_id = $1
    ORDER BY created_at ASC
  `, [disbursementId]).catch(() => []);

  const evidence = evidenceResult || [];

  // Build timeline entries
  const timeline = [];

  for (const event of auditEvents) {
    const stateInfo = STATE_LABELS[event.to_state] || {
      label: event.to_state,
      icon: '📌',
      category: 'other',
    };

    const entry = {
      state: event.to_state,
      label: stateInfo.label,
      icon: stateInfo.icon,
      category: stateInfo.category,
      timestamp: event.created_at,
      fromState: event.from_state,
      reason: event.reason || null,
      metadata: event.metadata || null,
    };

    // Attach matching snapshots
    const matchingSnapshots = snapshots.filter((s) => {
      const snapTime = new Date(s.created_at).getTime();
      const eventTime = new Date(event.created_at).getTime();
      return Math.abs(snapTime - eventTime) < 60000; // within 1 minute
    });
    if (matchingSnapshots.length > 0) {
      entry.externalStatuses = matchingSnapshots.map((s) => ({
        system: s.external_system,
        status: s.status,
      }));
    }

    timeline.push(entry);
  }

  // Attach evidence to relevant entries
  for (const ev of evidence) {
    const matchingEntry = timeline.find((t) => {
      const tTime = new Date(t.timestamp).getTime();
      const evTime = new Date(ev.created_at).getTime();
      return Math.abs(tTime - evTime) < 60000;
    });
    if (matchingEntry) {
      if (!matchingEntry.evidence) matchingEntry.evidence = [];
      matchingEntry.evidence.push({
        type: ev.evidence_type,
        data: ev.evidence_data,
      });
    }
  }

  // Build summary
  const firstEvent = auditEvents[0];
  const lastEvent = auditEvents[auditEvents.length - 1];
  const currentState = lastEvent?.to_state || 'unknown';
  const stateInfo = STATE_LABELS[currentState] || { label: currentState, category: 'other' };

  const summary = {
    disbursementId,
    currentState,
    currentStateLabel: stateInfo.label,
    category: stateInfo.category,
    startedAt: firstEvent?.created_at || null,
    lastUpdatedAt: lastEvent?.created_at || null,
    totalEvents: auditEvents.length,
    totalSnapshots: snapshots.length,
    totalEvidence: evidence.length,
    failed: currentState === 'failed',
    settled: currentState === 'settled',
    durationMs: firstEvent && lastEvent
      ? new Date(lastEvent.created_at).getTime() - new Date(firstEvent.created_at).getTime()
      : null,
  };

  return { timeline, summary };
}

/**
 * Format timeline for human-readable display
 * @param {Array} timeline
 * @returns {string}
 */
function formatTimelineText(timeline) {
  const lines = [];
  for (const entry of timeline) {
    const time = entry.timestamp
      ? new Date(entry.timestamp).toLocaleString()
      : 'unknown';
    let line = `${entry.icon} [${time}] ${entry.label}`;
    if (entry.reason) line += ` — ${entry.reason}`;
    if (entry.externalStatuses?.length) {
      const ext = entry.externalStatuses.map((s) => `${s.system}:${s.status}`).join(', ');
      line += ` (${ext})`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

module.exports = { buildTimeline, formatTimelineText, STATE_LABELS };
