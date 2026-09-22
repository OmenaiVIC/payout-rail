/**
 * Settlement receipt — deterministic JSON reconstructed from stored evidence only
 * (Sprint 4 plan §7).
 *
 * - No wall-clock / `generated_at` fields: identical stored state ⇒ identical
 *   output, so receipts can be reproduced byte-for-byte for audit/review.
 * - Never fabricates a leg: each field is read from `disbursements`, the audit
 *   log, evidence rows, external refs, snapshots, on-chain events or the webhook
 *   journal. Anything absent produces an explicit `gaps` entry with the evidence
 *   ids that were inspected for that leg.
 * - A non-`settled` final status is reported as fact (the row's own status) with
 *   the terminal evidence that explains where the disbursement stopped.
 */

import { getEvidence } from './evidenceCollector.js';

const STATE_ORDER = [
  'disbursement_initiated',
  'preflight_check',
  'burn_submitted',
  'burn_confirmed',
  'attestation_requested',
  'attestation_confirmed',
  'destination_release_unobserved',
  'destination_release_observed',
  'destination_release_confirmed',
  'yellowcard_payout_submitted',
  'yellowcard_payout_confirmed',
  'settled',
];

function toIso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value);
}

function asObject(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function ids(rows) {
  return (rows || []).map((r) => String(r.id));
}

function idx(state) {
  const i = STATE_ORDER.indexOf(state);
  return i === -1 ? STATE_ORDER.indexOf('settled') : i;
}

function reached(rowStatus, state) {
  return idx(rowStatus) >= idx(state);
}

export async function generateSettlementReceipt({ db, disbursementId }) {
  const row = await db.get(`SELECT * FROM disbursements WHERE id = $1`, [disbursementId]);
  if (!row) throw new Error(`Disbursement not found: ${disbursementId}`);

  const refs = await db.all(
    `SELECT * FROM external_refs WHERE disbursement_id = $1 ORDER BY id ASC`,
    [disbursementId]
  );
  const snapshots = await db.all(
    `SELECT * FROM external_status_snapshots WHERE disbursement_id = $1 ORDER BY captured_at ASC, id ASC`,
    [disbursementId]
  );
  const onChain = await db.all(
    `SELECT * FROM on_chain_events WHERE disbursement_id = $1 ORDER BY created_at ASC, id ASC`,
    [disbursementId]
  );
  const webhooks = await db.all(
    `SELECT * FROM yellow_card_webhook_events WHERE disbursement_id = $1 ORDER BY created_at ASC, id ASC`,
    [disbursementId]
  );
  const evidence = await getEvidence({ db, disbursementId });

  const payRef = (refs || []).find(
    (r) => r.external_system === 'yellowcard' && r.identifier_type === 'payout_id'
  ) || null;
  const attestationRef = (refs || []).find(
    (r) => r.external_system === 'xreserve' && r.identifier_type === 'attestation_id'
  ) || null;

  const broadcast = (onChain || []).find((e) => e.event_type === 'broadcast') || null;
  const confirmation = (onChain || []).find((e) => e.event_type === 'confirmation') || null;

  const transitionEvidence = (evidence || []).filter((e) => e.type === 'transition');
  const confirmTransition = transitionEvidence.find((e) => e.data?.status?.to === 'yellowcard_payout_confirmed') || null;
  const attestAttestation = transitionEvidence.find((e) =>
    ['attestation_requested', 'attestation_confirmed'].includes(e.data?.status?.to)
  ) || null;
  const releaseTransition = transitionEvidence.find((e) =>
    ['destination_release_observed', 'destination_release_confirmed'].includes(e.data?.status?.to)
  ) || null;
  const settledTransition = transitionEvidence.find((e) => e.data?.status?.to === 'settled') || null;

  const attestationCompleted = transitionEvidence.some((e) => e.data?.status?.to === 'attestation_confirmed');

  const attestationSnapshot = (snapshots || []).filter((s) => /xreserve|attestation/i.test(s.source)).at(-1) || null;
  const releaseSnapshot = (snapshots || []).filter((s) => /release|observeDestination/i.test(s.source)).at(-1) || null;
  const payoutSnapshot = (snapshots || []).filter(
    (s) => /yellowcard|lookupSend/i.test(s.source) && /complete|confirmed/i.test(String(s.status))
  ).at(-1) || null;

  const webhookCompleted = (webhooks || []).some((w) => {
    const payload = asObject(w.payload);
    return String(payload?.status || '').toLowerCase() === 'completed'
      || String(w.event_type || '').toLowerCase() === 'completed';
  });

  // ── Stacks leg ────────────────────────────────────────────────────────────
  const burnTxHash = row.external_tx_id || broadcast?.tx_hash || null;
  const attestationId = row.attestation_id || attestationRef?.identifier_value || null;
  let attestationStatus = null;
  if (attestationSnapshot) {
    attestationStatus = String(attestationSnapshot.status);
  } else if (attestationCompleted || (attestationId && reached(row.status, 'attestation_confirmed'))) {
    attestationStatus = 'confirmed';
  }

  // ── Release leg ───────────────────────────────────────────────────────────
  const releaseStatusRaw = row.release_status || releaseSnapshot?.status || null;
  const releaseObservedAt = toIso(releaseSnapshot?.captured_at ?? null)
    || (releaseTransition?.createdAt ? toIso(releaseTransition.createdAt) : null);

  // ── Provider leg ──────────────────────────────────────────────────────────
  const payRefMetadata = payRef ? asObject(payRef.metadata) : null;
  const providerStatus =
    (webhookCompleted || payoutSnapshot || confirmTransition || reached(row.status, 'yellowcard_payout_confirmed'))
      ? 'confirmed'
      : payRef ? 'submitted' : null;

  const payoutSubmittedAt = payRefMetadata?.submitted_at || toIso(payRef?.created_at ?? null);
  const payoutConfirmedAt = payRefMetadata?.confirmed_at
    || (payoutSnapshot?.captured_at ? toIso(payoutSnapshot.captured_at) : null)
    || (confirmTransition?.createdAt ? toIso(confirmTransition.createdAt) : null);

  // ── Settlement reference ──────────────────────────────────────────────────
  const lastWebhook = (webhooks || []).at(-1) || null;
  const externalSettlementReference = payRefMetadata?.['external_settlement_reference']
    || lastWebhook?.payment_id
    || (lastWebhook ? asObject(lastWebhook.payload).reference : null)
    || null;

  // ── Gaps ──────────────────────────────────────────────────────────────────
  const gaps = [];
  if (!burnTxHash) {
    gaps.push({ leg: 'stacks', reason: 'no burn tx hash on file', evidence_ids_checked: ids(onChain) });
  }
  if (reached(row.status, 'attestation_requested') && !attestationId) {
    gaps.push({
      leg: 'release',
      reason: 'no attestation_id persisted',
      evidence_ids_checked: (evidence || [])
        .filter((e) => ['attestation_requested', 'attestation_confirmed'].includes(e.data?.status?.to))
        .map((e) => e.id),
    });
  }
  if (reached(row.status, 'destination_release_unobserved') && !releaseStatusRaw) {
    gaps.push({
      leg: 'release',
      reason: 'no release status persisted',
      evidence_ids_checked: [
        ...ids(snapshots.filter((s) => /release|observeDestination/i.test(s.source))),
        ...(releaseTransition ? [releaseTransition.id] : []),
      ],
    });
  }
  if (reached(row.status, 'yellowcard_payout_submitted') && !payRef) {
    gaps.push({
      leg: 'provider',
      reason: 'no payout_id persisted',
      evidence_ids_checked: [...ids(webhooks), ...ids(snapshots)],
    });
  }
  if (row.status === 'settled' && !externalSettlementReference) {
    gaps.push({
      leg: 'provider',
      reason: 'no external settlement reference on file',
      evidence_ids_checked: ids(webhooks),
    });
  }
  if (row.status === 'settled' && !payoutConfirmedAt) {
    gaps.push({
      leg: 'provider',
      reason: 'no payout confirmation evidence',
      evidence_ids_checked: [
        ...ids(snapshots.filter((s) => /yellowcard|lookupSend/i.test(s.source))),
        ...(confirmTransition ? [confirmTransition.id] : []),
      ],
    });
  }

  return {
    schema_version: 1,
    receipt_version: 1,
    reconstructed_from: 'evidence',
    bos_payout_id: String(row.id),
    final_status: row.status,
    settlement_reference: {
      provider: 'yellowcard',
      provider_payout_id: payRef?.identifier_value || row.payout_id || null,
      external_settlement_reference: externalSettlementReference,
    },
    stacks_leg: {
      burn_tx_hash: burnTxHash,
      usdcx_amount_base_units: row.amount_usdcx != null ? String(row.amount_usdcx) : null,
      burn_status: confirmation?.status || (burnTxHash ? 'submitted' : null),
      burn_confirmed_at: confirmation ? toIso(confirmation.created_at) : null,
      attestation_id: attestationId,
      attestation_status: attestationStatus,
    },
    release_leg: {
      release_status: releaseStatusRaw,
      observed_at: releaseObservedAt,
    },
    provider_leg: {
      status: providerStatus,
      payout_submitted_at: payoutSubmittedAt,
      payout_confirmed_at: payoutConfirmedAt,
      ngn_amount: row.amount_ngn_expected != null ? String(row.amount_ngn_expected) : null,
    },
    timeline: {
      initiated_at: toIso(row.created_at),
      settled_at: row.status === 'settled'
        ? toIso(row.settled_at) || (settledTransition?.createdAt ? toIso(settledTransition.createdAt) : null)
        : null,
    },
    evidence_refs: (evidence || []).map((e) => ({
      id: e.id,
      event_type: e.type,
      status: e.data?.status ?? null,
      payload_hash: e.data?.payload_hash ?? null,
    })),
    gaps,
  };
}