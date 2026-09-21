import { CircuitBreaker } from './circuitBreaker.js';
import { TwoPersonApproval } from './twoPersonApproval.js';
import { runAllGates } from './payoutGates.js';

const circuitBreaker = new CircuitBreaker();
const twoPersonApproval = new TwoPersonApproval();

export async function runPreflight(disbursement, ctx) {
  const log = ctx.getLogger('preflight');
  const gateResults = [];

  const cbResult = await circuitBreaker.check(disbursement, ctx);
  gateResults.push({
    gate: 'circuit_breaker',
    ok: cbResult.ok,
    error_code: cbResult.error_code || null,
    reason: cbResult.reason || null,
    warning: null,
    details: cbResult.details || null,
  });

  if (!cbResult.ok) {
    log?.warn({ id: disbursement.id, error_code: cbResult.error_code }, 'Preflight failed: circuit breaker');
    return { ok: false, action: 'MANUAL_REVIEW_REQUIRED', gate_results: gateResults };
  }

  const payoutGates = await runAllGates(disbursement, ctx);
  gateResults.push(...payoutGates.gate_results);

  if (!payoutGates.ok) {
    log?.warn({ id: disbursement.id }, 'Preflight failed: payout gate');
    return { ok: false, action: 'MANUAL_REVIEW_REQUIRED', gate_results: gateResults };
  }

  const tpResult = await twoPersonApproval.check(disbursement, ctx);
  gateResults.push({
    gate: 'two_person_approval',
    ok: tpResult.ok,
    error_code: tpResult.error_code || null,
    reason: tpResult.reason || null,
    warning: null,
    details: tpResult.details || null,
  });

  if (!tpResult.ok) {
    log?.warn({ id: disbursement.id, error_code: tpResult.error_code }, 'Preflight failed: two-person approval');
    return { ok: false, action: 'MANUAL_REVIEW_REQUIRED', gate_results: gateResults };
  }

  log?.info({ id: disbursement.id, gates: gateResults.length }, 'Preflight passed');
  return { ok: true, gate_results: gateResults };
}

export { circuitBreaker, twoPersonApproval };
