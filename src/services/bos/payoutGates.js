import { DisbursementState } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Gate: perDisbursementCap
// §7.6 — Maximum-per-disbursement cap (env: BOS_MAX_PER_DISBURSEMENT_USD)
// Rejects if amount_usd exceeds the configured per-disbursement maximum.
// Returns ok:true (no-op) when env var is unset or zero (gate disabled).
// ─────────────────────────────────────────────────────────────────────────────
export async function perDisbursementCap(disbursement, ctx) {
  const log = ctx.getLogger('gate:perDisbursementCap');
  const cap = Number(process.env.BOS_MAX_PER_DISBURSEMENT_USD);

  if (!cap || cap <= 0) {
    return { ok: true, warning: 'per_disbursement_cap_disabled', details: { cap_usd: null } };
  }

  const amountUsd = Number(disbursement.amount_usd);
  if (!amountUsd || amountUsd <= 0) {
    return { ok: false, error_code: 'u824B', reason: 'amount_usd is zero or negative', details: { amount_usd: disbursement.amount_usd } };
  }

  if (amountUsd > cap) {
    log?.warn({ id: disbursement.id, amount_usd: amountUsd, cap_usd: cap }, 'Per-disbursement cap exceeded');
    return {
      ok: false,
      error_code: 'u824B',
      reason: `amount_usd ${amountUsd} exceeds per-disbursement cap ${cap}`,
      details: { amount_usd: amountUsd, cap_usd: cap },
    };
  }

  return { ok: true, details: { amount_usd: amountUsd, cap_usd: cap } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate: dailyPayoutCap
// §7.6 — Configurable daily payout cap (env: BOS_DAILY_PAYOUT_CAP_USD)
// Aggregates all non-failed/cancelled payouts in the last 24h and rejects
// if adding the current disbursement would exceed the daily cap.
// Returns ok:true (no-op) when env var is unset or zero (gate disabled).
// ─────────────────────────────────────────────────────────────────────────────
export async function dailyPayoutCap(disbursement, ctx) {
  const log = ctx.getLogger('gate:dailyPayoutCap');
  const cap = Number(process.env.BOS_DAILY_PAYOUT_CAP_USD);

  if (!cap || cap <= 0) {
    return { ok: true, warning: 'daily_payout_cap_disabled', details: { cap_usd: null } };
  }

  const amountUsd = Number(disbursement.amount_usd);
  if (!amountUsd || amountUsd <= 0) {
    return { ok: false, error_code: 'u824C', reason: 'amount_usd is zero or negative', details: { amount_usd: disbursement.amount_usd } };
  }

  try {
    const db = ctx.getDb();
    const row = await db.get(
      `SELECT COALESCE(SUM(amount_usd), 0) as daily_total
       FROM disbursements
       WHERE status NOT IN ($1, $2, $3)
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [DisbursementState.FAILED, DisbursementState.CANCELLED, DisbursementState.MANUAL_REVIEW]
    );

    const dailyTotal = Number(row?.daily_total || 0);
    const projected = dailyTotal + amountUsd;

    if (projected > cap) {
      log?.warn({ id: disbursement.id, daily_total: dailyTotal, projected, cap_usd: cap }, 'Daily payout cap would be exceeded');
      return {
        ok: false,
        error_code: 'u824C',
        reason: `Projected daily total ${projected} would exceed daily cap ${cap}`,
        details: { daily_total_so_far: dailyTotal, adding: amountUsd, projected, cap_usd: cap },
      };
    }

    return { ok: true, details: { daily_total_so_far: dailyTotal, projected, cap_usd: cap } };
  } catch (err) {
    log?.error({ id: disbursement.id, error: err.message }, 'Daily payout cap check failed');
    return { ok: false, error_code: 'u824C', reason: `Daily cap check failed: ${err.message}` };
  }
}

export async function amountTolerance(disbursement, ctx) {
  const log = ctx.getLogger('gate:amountTolerance');
  const amountUsd = Number(disbursement.amount_usd);

  if (!amountUsd || amountUsd <= 0) {
    return { ok: false, error_code: 'u8241', reason: 'amount_usd is zero or negative', details: { amount_usd: disbursement.amount_usd } };
  }

  try {
    const db = ctx.getDb();
    const milestone = await db.get(
      `SELECT amount_usd as expected_amount FROM disbursements WHERE source_reference = $1 AND id != $2 AND amount_usd IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [disbursement.source_reference, disbursement.id]
    );

    if (!milestone) {
      log?.warn({ id: disbursement.id }, 'No milestone amount found for campaign — passing with warning');
      return { ok: true, warning: 'no_milestone_amount_found', details: { source_reference: disbursement.source_reference } };
    }

    const expected = Number(milestone.expected_amount);
    if (!expected || expected <= 0) {
      return { ok: true, warning: 'milestone_amount_invalid', details: { expected } };
    }

    const deviation = Math.abs(amountUsd - expected) / expected;
    if (deviation > 0.02) {
      return {
        ok: false,
        error_code: 'u8242',
        reason: `Amount deviation ${(deviation * 100).toFixed(2)}% exceeds 2% tolerance`,
        details: { expected, actual: amountUsd, deviation_pct: (deviation * 100).toFixed(4) },
      };
    }

    return { ok: true, details: { expected, actual: amountUsd, deviation_pct: (deviation * 100).toFixed(4) } };
  } catch (err) {
    log?.error({ id: disbursement.id, error: err.message }, 'Amount tolerance check failed');
    return { ok: false, error_code: 'u8241', reason: `Amount check failed: ${err.message}` };
  }
}

export async function attributableFunds(disbursement, ctx) {
  const log = ctx.getLogger('gate:attributableFunds');
  const amountUsdcx = Number(disbursement.amount_usdcx);

  try {
    const db = ctx.getDb();

    const escrowRow = await db.get(
      `SELECT d.id FROM disbursements d WHERE d.source_reference = $1 AND d.id != $2 LIMIT 1`,
      [disbursement.source_reference, disbursement.id]
    );

    if (!escrowRow) {
      return {
        ok: false,
        error_code: 'u8244',
        reason: `Campaign ${disbursement.source_reference} not found in escrow`,
        details: { source_reference: disbursement.source_reference },
      };
    }

    const campaignDisbursements = await db.get(
      `SELECT COALESCE(SUM(amount_usdcx), 0) as total_disbursed FROM disbursements WHERE source_reference = $1 AND status NOT IN ($2, $3, $4)`,
      [disbursement.source_reference, DisbursementState.FAILED, DisbursementState.CANCELLED, DisbursementState.MANUAL_REVIEW]
    );

    const totalDisbursed = Number(campaignDisbursements?.total_disbursed || 0);

    const fundingRow = await db.get(
      `SELECT COALESCE(SUM(amount_usdcx), 0) as total_funded FROM disbursements WHERE source_reference = $1`,
      [disbursement.source_reference]
    );

    const totalFunded = Number(fundingRow?.total_funded || 0);

    if (totalFunded < amountUsdcx) {
      return {
        ok: false,
        error_code: 'u8243',
        reason: `Escrow balance ${totalFunded} < disbursement amount ${amountUsdcx}`,
        details: { escrow_balance: totalFunded, requested: amountUsdcx },
      };
    }

    if (totalFunded > 0 && totalFunded !== amountUsdcx) {
      return {
        ok: false,
        error_code: 'u8245',
        reason: `Escrow funds ${totalFunded} don't match disbursement amount ${amountUsdcx}`,
        details: { escrow_balance: totalFunded, requested: amountUsdcx },
      };
    }

    return { ok: true, details: { escrow_balance: totalFunded, requested: amountUsdcx } };
  } catch (err) {
    log?.error({ id: disbursement.id, error: err.message }, 'Attributable funds check failed');
    return { ok: false, error_code: 'u8243', reason: `Attributable funds check failed: ${err.message}` };
  }
}

export function beneficiaryPayload(disbursement, _ctx) {
  const creatorAddress = disbursement.creator_address;
  const amountUsdcx = Number(disbursement.amount_usdcx);
  const sourceReference = disbursement.source_reference;

  if (!creatorAddress || typeof creatorAddress !== 'string' || creatorAddress.trim().length === 0) {
    return { ok: false, error_code: 'u8246', reason: 'creator_address is missing or empty' };
  }

  if (!/^(SP|ST)[A-Z0-9]{38,}$/.test(creatorAddress)) {
    return {
      ok: false,
      error_code: 'u8246',
      reason: `Invalid Stacks address format: ${creatorAddress}`,
      details: { creator_address: creatorAddress },
    };
  }

  if (!amountUsdcx || amountUsdcx <= 0) {
    return {
      ok: false,
      error_code: 'u8247',
      reason: `amount_usdcx must be > 0, got ${disbursement.amount_usdcx}`,
      details: { amount_usdcx: disbursement.amount_usdcx },
    };
  }

  if (sourceReference === null || sourceReference === undefined) {
    return { ok: false, error_code: 'u8248', reason: 'source_reference is null or undefined' };
  }

  return { ok: true };
}

export async function whitelistPrerequisite(disbursement, ctx) {
  const log = ctx.getLogger('gate:whitelistPrerequisite');

  try {
    const registry = ctx.recipientRegistry;
    if (!registry) {
      return {
        ok: false,
        error_code: 'u8249',
        reason: 'No recipient registry configured',
        details: { creator_address: disbursement.creator_address },
      };
    }

    const verdict = await registry.check({
      address: disbursement.creator_address,
      application: disbursement.source_application || null,
      disbursement,
    });

    if (!verdict.eligible) {
      return {
        ok: false,
        error_code: verdict.error_code || 'u8249',
        reason: verdict.reason || `Creator ${disbursement.creator_address} is not an eligible recipient`,
        details: { creator_address: disbursement.creator_address, ...(verdict.details || {}) },
      };
    }

    return { ok: true, details: { verified: true, ...(verdict.details || {}) } };
  } catch (err) {
    log?.error({ id: disbursement.id, error: err.message }, 'Whitelist check failed');
    return { ok: false, error_code: 'u8249', reason: `Whitelist check failed: ${err.message}` };
  }
}

export async function runAllGates(disbursement, ctx) {
  const log = ctx.getLogger('gate:runAll');
  const gateResults = [];

  const gates = [
    { name: 'per_disbursement_cap', fn: perDisbursementCap },
    { name: 'daily_payout_cap', fn: dailyPayoutCap },
    { name: 'amount_tolerance', fn: amountTolerance },
    { name: 'attributable_funds', fn: attributableFunds },
    { name: 'beneficiary_payload', fn: beneficiaryPayload },
    { name: 'whitelist', fn: whitelistPrerequisite },
  ];

  for (const gate of gates) {
    const result = await gate.fn(disbursement, ctx);
    gateResults.push({
      gate: gate.name,
      ok: result.ok,
      error_code: result.error_code || null,
      reason: result.reason || null,
      warning: result.warning || null,
      details: result.details || null,
    });

    if (!result.ok) {
      log?.warn(
        { id: disbursement.id, gate: gate.name, error_code: result.error_code },
        `Gate failed: ${result.reason}`
      );
      break;
    }
  }

  const allPassed = gateResults.every(r => r.ok);
  return { ok: allPassed, gate_results: gateResults };
}
