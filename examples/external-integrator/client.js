/**
 * A marketplace application's Payout Rail client (Sprint 7.5 example).
 *
 * Zero dependencies — plain `fetch` (Node 18+). The four service functions are
 * the whole integration surface: create, advance, receipt, plus a convenience
 * `paySeller` that drives one order from create to a settled receipt.
 *
 * Run the self-contained demo with:
 *     cd examples/external-integrator && npm start
 *
 * A real integration instead points PAYOUT_API_BASE_URL at a deployed instance
 * (and BOS_API_TOKEN at its bearer token). See README.md.
 */

import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'http://localhost:3001';
const MAX_ADVANCE_HOPS = 15;
const TERMINAL_STATUSES = new Set(['settled', 'failed', 'cancelled', 'manual_review']);

export class ApiError extends Error {
  constructor(status, errorCode, message, details) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.error_code = errorCode;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }
}

function config() {
  return {
    baseUrl: (process.env.PAYOUT_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    token: process.env.BOS_API_TOKEN,
  };
}

export async function apiRequest({ method = 'GET', path, token = config().token, body }) {
  const { baseUrl } = config();
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`could not reach Payout Rail at ${baseUrl}: ${err.message}`);
  }

  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      parsed?.error_code || null,
      parsed?.error || `HTTP ${res.status}`,
      parsed?.details,
    );
  }
  return parsed;
}

export async function createPayout(body) {
  return apiRequest({ method: 'POST', path: '/api/v1/disbursements', body });
}

export async function advancePayout(id, steps = 1) {
  return apiRequest({
    method: 'POST',
    path: `/api/v1/disbursements/${encodeURIComponent(id)}/advance?steps=${steps}`,
  });
}

export async function getReceipt(id) {
  return apiRequest({ method: 'GET', path: `/api/v1/disbursements/${encodeURIComponent(id)}/receipt` });
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Create an order and march it to settled, one hop at a time, then return the
 * settlement receipt. Throws if it cannot reach a terminal state in budget.
 */
export async function paySeller(order) {
  const { disbursement: created } = await createPayout(order);
  const id = created.id;
  const states = [created.status];
  let current = created;

  for (let i = 0; i < MAX_ADVANCE_HOPS; i += 1) {
    if (isTerminalStatus(current.status)) break;
    const { result, disbursement: next } = await advancePayout(id, 1);
    if (next && next.status !== states[states.length - 1]) states.push(next.status);
    if (next) current = next;
    if (result && result.success === false) break;
  }

  if (current.status !== 'settled') {
    throw new Error(
      `payout ${id} did not reach settled (current status: ${current.status}; trail: ${states.join(' → ')})`,
    );
  }

  const { receipt } = await getReceipt(id);
  return { disbursement: current, states, receipt };
}

/** The application's real order for seller 2041 (fake sample data). */
export const SELLER_ORDER = {
  source_reference: 'order-2041',
  source_application: 'marketplace-example',
  amount_usd: 25,
  amount_usdcx: 25_000_000,
  creator_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
  creator_btc_address: 'bc1qexample000000000000000000000000000000000',
  recipient_bank_account: '0123456789',
  recipient_bank_code: '044',
  ngn_recipient: {
    type: 'bank_account',
    bankName: 'GTBank',
    bankCode: '044',
    accountName: 'Adaeze Okafor',
    accountNumber: '0123456789',
  },
};

/** The demo runs a second, distinct order so the lifecycle is shown fresh. */
const DEMO_ORDER = { ...SELLER_ORDER, source_reference: 'order-2042' };

async function runDemo() {
  const { token, baseUrl } = config();
  if (!token) {
    console.error('BOS_API_TOKEN is required — set it to the token your deployment enforces.');
    return 1;
  }

  console.log('marketplace-seller payout demo');
  console.log(`base          ${baseUrl}`);
  console.log('');

  let firstId;
  try {
    const { disbursement, states, receipt } = await paySeller(DEMO_ORDER);
    firstId = disbursement.id;
    console.log(`create        ${DEMO_ORDER.source_reference} -> ${states[0]}`);
    console.log(`payout        ${firstId}`);
    console.log(`advance       ${states.join(' -> ')}`);
    console.log(`receipt       final_status=${receipt.final_status} ngn_kobo=${receipt.provider_leg.ngn_amount} provider=${receipt.settlement_reference.provider_payout_id} gaps=${receipt.gaps.length}`);
  } catch (err) {
    console.error(`happy path failed: ${err.message}`);
    return 1;
  }

  try {
    const { disbursement: duplicate } = await createPayout(DEMO_ORDER);
    const same = duplicate.id === firstId;
    console.log(`idempotency   re-created ${DEMO_ORDER.source_reference} -> ${same ? 'SAME disbursement' : 'DIFFERENT row'} (${duplicate.status})`);
  } catch (err) {
    console.error(`idempotency failed: ${err.message}`);
    return 1;
  }

  const errors = { missingBank: false, unauthorized: false };
  try {
    await createPayout({ ...DEMO_ORDER, recipient_bank_account: '', recipient_bank_code: '' });
  } catch (err) {
    if (err instanceof ApiError) {
      errors.missingBank = true;
      console.log(`error          missing bank fields -> ${err.status} ${err.error_code}`);
    }
  }
  try {
    await apiRequest({ method: 'POST', path: '/api/v1/disbursements', token: 'wrong-token', body: DEMO_ORDER });
  } catch (err) {
    if (err instanceof ApiError) {
      errors.unauthorized = true;
      console.log(`error          bad bearer token -> ${err.status} ${err.error_code}`);
    }
  }
  if (!errors.missingBank || !errors.unauthorized) {
    console.error('error paths did not surface the expected failures; refusing to report success.');
    return 1;
  }

  console.log('');
  console.log('demo complete');
  return 0;
}

export async function main() {
  if (!process.env.PAYOUT_API_BASE_URL) {
    console.log('PAYOUT_API_BASE_URL unset — booting the in-repo demo harness (FakeDb + mock');
    console.log('adapters; no network, no real funds). Point the env var at your deployment to');
    console.log('exercise the real API instead.');
    console.log('');
    try {
      const { bootDemoHarness } = await import('./harness.js');
      const harness = await bootDemoHarness({ totalFundedUsdcx: DEMO_ORDER.amount_usdcx });
      process.env.PAYOUT_API_BASE_URL = harness.base;
      if (!process.env.BOS_API_TOKEN) process.env.BOS_API_TOKEN = 'demo-token';
      try {
        return await runDemo();
      } finally {
        await harness.close();
      }
    } catch (err) {
      console.error(`could not start the demo harness: ${err.message}`);
      return 1;
    }
  }
  return runDemo();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`demo failed: ${err.message}`);
      process.exitCode = 1;
    });
}