/**
 * BOS xReserve Bridge Adapter — On-chain Clarity contract calls via Hiro RPC
 *
 * Implements the adapter interface consumed by transitionGuards.js and transitionActions.js.
 *
 * xReserve is an ON-CHAIN protocol (not REST). Key contracts on mainnet:
 *   - USDCx token:  SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
 *   - Protocol:     SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx-v1
 *
 * The burn transaction IS the attestation trigger. xReserve monitors Stacks for burn
 * events and releases USDC on Ethereum off-chain. This adapter maps that flow to the
 * 5-method interface the BOS state machine expects.
 *
 * Option A mapping (backward-compatible with state machine):
 *   requestAttestation({tx_id})  → verify burn tx exists on-chain via Hiro tx status API
 *   getAttestationStatus(id)     → poll Hiro GET /extended/v1/tx/{id}
 *   releaseDestination({})       → no-op (xReserve handles off-chain), returns confirmed
 *   getReleaseStatus(id)         → same as getAttestationStatus (both track the burn tx)
 *   healthCheck()                → verify Hiro API reachable
 */

import { HIRO_API_URL, USDCX_CONTRACT, DEPLOYER_ADDRESS } from '../../config/chainConfig.js';

// xReserve protocol contract (same deployer as USDCx token)
const XRESERVE_PROTOCOL_CONTRACT = process.env.XRESERVE_PROTOCOL_CONTRACT
  || `${DEPLOYER_ADDRESS}.usdcx-v1`;

const HIRO_API = HIRO_API_URL;

const TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────────────────────
// Error taxonomy — consistent with original adapter
// ─────────────────────────────────────────────────────────────

export function classifyError(error) {
  if (error && error.name === 'AbortError') return 'transient';
  if (error && error.name === 'TypeError' && error.message?.includes('fetch')) return 'transient';
  const status = error?.status || error?.statusCode;
  if (status) {
    if (status === 429) return 'transient';
    if (status >= 500) return 'transient';
    if (status >= 400 && status < 500) return 'permanent';
  }
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

/**
 * Fetch with timeout and error classification
 */
async function _fetch(url, options = {}, { timeoutMs = TIMEOUT_MS } = {}) {
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

/**
 * Get transaction status from Hiro API.
 * Maps Hiro tx_status to adapter status: 'pending' | 'confirmed' | 'failed'
 *
 * @param {string} txid — Stacks transaction ID (with or without 0x prefix)
 * @returns {Promise<{ status: string, tx_status?: string, block_height?: number, error?: string }>}
 */
async function _getTxStatus(txid) {
  const cleanTxid = txid.startsWith('0x') ? txid.slice(2) : txid;
  const url = `${HIRO_API}/extended/v1/tx/${cleanTxid}`;

  const resp = await _fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, { timeoutMs: 8000 });

  if (!resp.ok) {
    // 404 = tx not yet indexed, treat as pending
    if (resp.status === 404) {
      return { status: 'pending', tx_status: 'not_found' };
    }
    const err = new Error(`Hiro tx status failed (${resp.status}) for ${cleanTxid}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  const data = await resp.json();

  if (data.tx_status === 'success') {
    return {
      status: 'confirmed',
      tx_status: 'success',
      block_height: data.block_height,
      burn_block_time: data.burn_block_time,
    };
  }

  if (data.tx_status === 'pending' || data.tx_status === 'queued') {
    return { status: 'pending', tx_status: data.tx_status };
  }

  // Terminal failure: drop_off_grid, replace_by_fee, etc.
  return {
    status: 'failed',
    tx_status: data.tx_status,
    error: data.tx_result?.repr || data.tx_status,
  };
}

/**
 * Read-only call to a Clarity contract via Hiro RPC.
 * Used for querying xReserve protocol state.
 *
 * @param {string} contractId — e.g. "SP120...CNE.usdcx-v1"
 * @param {string} functionName — Clarity function name
 * @param {string[]} hexArgs — hex-encoded Clarity values (cvToHex)
 * @returns {Promise<Object>} — Hiro call-read response
 */
async function _readOnlyCall(contractId, functionName, hexArgs = []) {
  const [addr, name] = contractId.split('.');
  const url = `${HIRO_API}/v2/contracts/call-read/${addr}/${name}/${functionName}`;

  const resp = await _fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: DEPLOYER_ADDRESS,
      arguments: hexArgs,
    }),
  }, { timeoutMs: 8000 });

  if (!resp.ok) {
    const err = new Error(`Hiro read-only call failed (${resp.status}) for ${contractId}.${functionName}`);
    err.status = resp.status;
    err._classification = classifyError(err);
    throw err;
  }

  return resp.json();
}

// ─────────────────────────────────────────────────────────────
// Exported adapter methods — 5-method interface
// ─────────────────────────────────────────────────────────────

/**
 * Request attestation for a Stacks burn tx.
 *
 * In xReserve's on-chain model, the burn transaction IS the attestation trigger.
 * There is no separate "request attestation" API call — xReserve monitors Stacks
 * for burn events. This method verifies the burn tx exists on-chain and returns
 * its current confirmation status.
 *
 * @param {Object} params
 * @param {string} params.tx_id         — Stacks burn tx hash
 * @param {string} params.token_contract — USDCx contract principal (unused, for logging)
 * @param {number} params.amount_base_units — USDCx amount in base units (6 decimals; unused, for logging)
 * @returns {Promise<{ attestation_id: string, status: string }>}
 */
export async function requestAttestation({ tx_id, token_contract, amount_base_units }) {
  console.log(`[xreserve] requestAttestation: tx=${tx_id} amount=${amount_base_units}`);

  const txStatus = await _getTxStatus(tx_id);

  return {
    attestation_id: tx_id,
    status: txStatus.status, // 'pending' | 'confirmed' | 'failed'
  };
}

/**
 * Poll attestation status by burn tx ID.
 *
 * Maps directly to Hiro tx status API. The burn tx's confirmation status IS
 * the attestation status in xReserve's on-chain model.
 *
 * @param {string} attestationId — the burn tx hash (used as attestation_id)
 * @returns {Promise<{ status: string, attestation_data?: Object }>}
 *   status: 'pending' | 'confirmed' | 'failed'
 */
export async function getAttestationStatus(attestationId) {
  const txStatus = await _getTxStatus(attestationId);

  return {
    status: txStatus.status,
    attestation_data: {
      tx_id: attestationId,
      tx_status: txStatus.tx_status,
      block_height: txStatus.block_height,
      burn_block_time: txStatus.burn_block_time,
      error: txStatus.error,
    },
  };
}

/**
 * Request destination release.
 *
 * In xReserve's on-chain model, there is no on-chain "release" call.
 * xReserve monitors Stacks burns off-chain and releases USDC on Ethereum
 * automatically. This method returns immediately with a synthetic release_id
 * (the attestation_id/burn txid) and status 'confirmed'.
 *
 * @param {Object} params
 * @param {string} params.attestation_id  — burn tx hash
 * @param {string} params.recipient_btc   — BTC address (logged, not used on-chain)
 * @param {number} params.amount_base_units — USDCx amount in base units (logged)
 * @param {string} params.idempotencyKey  — idempotency key (logged)
 * @returns {Promise<{ release_id: string, status: string }>}
 */
export async function releaseDestination({ attestation_id, recipient_btc, amount_base_units, idempotencyKey }) {
  console.log(`[xreserve] releaseDestination: attestation=${attestation_id} recipient=${recipient_btc} amount=${amount_base_units}`);

  // xReserve handles release off-chain — no on-chain call needed.
  // The burn tx being confirmed is sufficient for xReserve to process the release.
  return {
    release_id: attestation_id,
    status: 'confirmed',
  };
}

/**
 * Poll destination release status.
 *
 * In xReserve's model, release status tracks the same burn tx. Once the burn is
 * confirmed, xReserve processes the release off-chain. This polls the burn tx
 * status as a proxy for release confirmation.
 *
 * @param {string} releaseId — the burn tx hash (release_id == attestation_id)
 * @returns {Promise<{ status: string, release_data?: Object }>}
 *   status: 'pending' | 'confirmed' | 'failed'
 */
export async function getReleaseStatus(releaseId) {
  const txStatus = await _getTxStatus(releaseId);

  return {
    status: txStatus.status,
    release_data: {
      tx_id: releaseId,
      tx_status: txStatus.tx_status,
      block_height: txStatus.block_height,
      burn_block_time: txStatus.burn_block_time,
      error: txStatus.error,
    },
  };
}

/**
 * Health check — verify Hiro API is reachable and xReserve contracts exist.
 *
 * @returns {Promise<{ healthy: boolean, latencyMs?: number, error?: string }>}
 */
export async function healthCheck() {
  const start = Date.now();
  try {
    // Verify Hiro API root is reachable
    const resp = await _fetch(`${HIRO_API}/`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, { timeoutMs: 5000 });

    if (!resp.ok) {
      return { healthy: false, latencyMs: Date.now() - start, error: `Hiro API ${resp.status}` };
    }

    // Optional: verify xReserve protocol contract exists on-chain
    // This is a lightweight read-only call
    try {
      const contractInfo = await _fetch(
        `${HIRO_API}/extended/v1/contract/${USDCX_CONTRACT}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        { timeoutMs: 5000 }
      );
      const contractOk = contractInfo.ok;
      return {
        healthy: contractOk,
        latencyMs: Date.now() - start,
        ...(contractOk ? {} : { error: `USDCx contract not found` }),
      };
    } catch {
      // Contract check failed, but Hiro API is reachable — still healthy
      return { healthy: true, latencyMs: Date.now() - start };
    }
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err.message };
  }
}

export default {
  requestAttestation,
  getAttestationStatus,
  releaseDestination,
  getReleaseStatus,
  healthCheck,
  classifyError,
};
