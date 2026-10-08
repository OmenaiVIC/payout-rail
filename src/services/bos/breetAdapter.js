/**
 * BOS Breet Bridge Adapter — REST client for Breet API (v1)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BREET_BASE_URL = process.env.BREET_BASE_URL || 'https://api.breet.io/v1';
const BREET_APP_ID = process.env.BREET_APP_ID || '';
const BREET_APP_SECRET = process.env.BREET_APP_SECRET || '';
const BREET_MERCHANT_REF = process.env.BREET_MERCHANT_REF || '';
const BREET_WEBHOOK_SECRET = process.env.BREET_WEBHOOK_SECRET || '';
const BREET_ENV = process.env.BREET_ENV || 'sandbox';
const BREET_WITHDRAWAL_PIN = process.env.BREET_WITHDRAWAL_PIN || '';

const BANK_CACHE_TTL_MS = 5 * 60 * 1000;
let bankCache = { data: null, ts: 0 };

export class MissingBreetWithdrawalPinError extends Error {
  constructor() {
    super('BREET_WITHDRAWAL_PIN is not configured');
    this.name = 'MissingBreetWithdrawalPinError';
  }
}

export class BankNotFoundError extends Error {
  constructor(code) {
    super('Bank not found for code: ' + code);
    this.name = 'BankNotFoundError';
  }
}

export function classifyError(error) {
  if (error && error.name === 'AbortError') return 'transient';
  if (error && error.name === 'TypeError' && error.message && error.message.includes('fetch')) return 'transient';
  const status = error && (error.status || error.statusCode);
  if (status) {
    if (status === 429) return 'transient';
    if (status >= 500) return 'transient';
    if (status >= 400 && status < 500) return 'permanent';
  }
  return 'unknown';
}

function _headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'x-app-id': BREET_APP_ID,
    'x-app-secret': BREET_APP_SECRET,
    'X-Breet-Env': BREET_ENV,
    ...extra,
  };
}

async function _fetch(url, options = {}, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    err._classification = classifyError(err);
    throw err;
  }
}

export function verifyWebhookSignature(payload, signature, secret = BREET_WEBHOOK_SECRET) {
  if (!secret || !signature) return false;
  const a = Buffer.from(String(signature), 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function loadBankMapping() {
  try {
    const p = path.join(process.cwd(), 'config', 'breet-banks.json');
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { ngn: {}, ghs: {} };
  }
}

async function resolveBreetBankId(recipient) {
  const mapping = loadBankMapping();
  const currency = (recipient && recipient.currency) ? String(recipient.currency).toLowerCase() : 'ngn';
  const code = recipient && (recipient.bankCode || recipient.code || recipient.nibssCode);
  if (code && mapping[currency] && mapping[currency][String(code)]) {
    return mapping[currency][String(code)];
  }
  throw new BankNotFoundError(code);
}

async function addBank(breetBankId, recipient) {
  const body = {
    id: String(breetBankId),
    accountNumber: recipient && recipient.accountNumber ? String(recipient.accountNumber) : '',
  };
  if (recipient && recipient.currency) body.currency = String(recipient.currency).toLowerCase();
  if (recipient && recipient.narration) body.narration = String(recipient.narration);
  const url = BREET_BASE_URL + '/payments/banks/add';
  const resp = await _fetch(url, { method: 'POST', headers: _headers(), body: JSON.stringify(body) });
  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error('Breet add bank failed (' + resp.status + '): ' + text.substring(0, 200));
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }
  const data = await resp.json();
  return (data && data.data && data.data.id) ? data.data.id : (data.id || null);
}

export async function submitSend({ idempotency_key, amount, currency, recipient_type, recipient }) {
  if (!BREET_WITHDRAWAL_PIN) {
    throw new MissingBreetWithdrawalPinError();
  }
  const breetBankId = await resolveBreetBankId(recipient);
  const savedBankId = await addBank(breetBankId, recipient);
  const body = { amount: Number(amount), pin: BREET_WITHDRAWAL_PIN };
  if (idempotency_key) body.externalId = String(idempotency_key);
  if (recipient && recipient.narration) body.narration = String(recipient.narration);
  const url = BREET_BASE_URL + '/payments/withdraw/bank/' + encodeURIComponent(savedBankId);
  const resp = await _fetch(url, { method: 'POST', headers: _headers(), body: JSON.stringify(body) });
  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error('Breet withdraw failed (' + resp.status + '): ' + text.substring(0, 200));
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }
  const data = await resp.json();
  const wid = (data && data.data && data.data.id) ? data.data.id : (data.id || '');
  return { send_id: wid, status: 'pending', sequence_id: idempotency_key || undefined };
}

export async function lookupSend(sendId) {
  const url = BREET_BASE_URL + '/payments/withdrawal/' + encodeURIComponent(sendId);
  const resp = await _fetch(url, { method: 'GET', headers: _headers() });
  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error('Breet lookup failed (' + resp.status + '): ' + text.substring(0, 200));
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }
  const data = await resp.json();
  const st = (data && data.data && data.data.status) ? data.data.status : (data.status || 'pending');
  return { status: st, data };
}

export async function healthCheck() {
  const start = Date.now();
  try {
    const url = BREET_BASE_URL + '/trades/wallets?page=1&size=1';
    const resp = await _fetch(url, { method: 'GET', headers: _headers() }, { timeoutMs: 5000 });
    const data = resp.ok ? await resp.json().catch(() => null) : null;
    return { healthy: resp.ok, latencyMs: Date.now() - start, data };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err.message };
  }
}

export async function initiatePayout(params) { return submitSend(params); }
export async function getPayoutStatus(id) { return lookupSend(id); }

export default { submitSend, lookupSend, healthCheck, verifyWebhookSignature, classifyError, initiatePayout, getPayoutStatus };
