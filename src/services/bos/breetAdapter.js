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
