import { pathToFileURL } from 'node:url';

function config() {
  return {
    baseUrl: (process.env.PAYOUT_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, ''),
    token: process.env.BOS_API_TOKEN,
  };
}

export class ApiError extends Error {
  constructor(status, errorCode, message, details) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.error_code = errorCode;
    this.details = details;
  }
}

async function request({ method = 'GET', path, token, body }) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${config().baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    throw new ApiError(res.status, parsed?.error_code, parsed?.error, parsed?.details);
  }
  return parsed;
}

export async function createPayout(body) {
  return request({ method: 'POST', path: '/api/v1/disbursements', token: config().token, body });
}

export async function advancePayout(id, steps = 1) {
  return request({ method: 'POST', path: `/api/v1/disbursements/${encodeURIComponent(id)}/advance?steps=${steps}`, token: config().token });
}

export async function getReceipt(id) {
  return request({ method: 'GET', path: `/api/v1/disbursements/${encodeURIComponent(id)}/receipt`, token: config().token });
}

const DEMO_BODY = {
  source_reference: 'demo-001',
  source_application: 'example-client',
  amount_usd: 25,
  amount_usdcx: 25_000_000,
  creator_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
  creator_btc_address: 'bc1qexample000000000000000000000000000000000',
  recipient_bank_account: '0123456789',
  recipient_bank_code: '044',
  ngn_recipient: { bankCode: '044', accountNumber: '0123456789' },
};

function pad(label, value) {
  console.log(`${label.padEnd(12)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

export async function main() {
  const { token } = config();
  if (!token) {
    console.error('BOS_API_TOKEN is required (set it to the same value the server enforces).');
    console.error('Leave PAYOUT_API_BASE_URL unset to hit http://localhost:3001.');
    return 1;
  }

  console.log('simple-payout-client demo');
  console.log(`base: ${config().baseUrl}`);
  console.log('');

  let created;
  try {
    created = await createPayout(DEMO_BODY);
  } catch (err) {
    console.error('demo failed at create:', err.message);
    return 1;
  }
  pad('create', { id: created.disbursement.id, status: created.disbursement.status });
  pad('idempotency_key', created.disbursement.idempotency_key);

  const advanced = await advancePayout(created.disbursement.id, 1);
  pad('advance', { success: advanced.result.success, new_state: advanced.result.new_state });

  const receipt = await getReceipt(created.disbursement.id);
  pad('receipt', { final_status: receipt.receipt.final_status, gaps: receipt.receipt.gaps.length });

  console.log('');
  console.log('error path: GET receipt for an unknown id');
  try {
    await getReceipt('00000000-0000-0000-0000-000000000000');
  } catch (err) {
    if (err instanceof ApiError) {
      console.log(`  -> ${err.status} ${err.error_code} — ${err.message}`);
    } else {
      throw err;
    }
  }
  console.log('error path: request with a wrong token');
  try {
    await request({ method: 'GET', path: '/api/v1/disbursements', token: 'not-the-token' });
  } catch (err) {
    if (err instanceof ApiError) {
      console.log(`  -> ${err.status} ${err.error_code} — ${err.message}`);
    } else {
      throw err;
    }
  }

  console.log('');
  console.log('demo complete');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error('demo failed:', err.message);
    process.exitCode = 1;
  });
}