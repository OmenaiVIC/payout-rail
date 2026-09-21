/**
 * StacksAdapter — on-chain burn + transaction status for the BOS pipeline.
 *
 * Carved from CineX `contractService.js` (burnUsdcx, getTxStatus,
 * getTransactionStatus, callContract). In this standalone repository the
 * adapter is keyed from `src/config/chainConfig.js` and a single
 * `PAYOUT_TX_SIGNING_KEY` instead of the CineX CREATOR/BACKER keypair.
 *
 * Adapter interface consumed by BOS transition guards/actions:
 *   { burnUsdcx, getTransactionStatus }
 */

import {
  makeContractCall,
  AnchorMode,
  PostConditionMode,
  getAddressFromPrivateKey,
  uintCV,
  bufferCV,
  cvToHex,
} from '@stacks/transactions';
import {
  USDCX_CONTRACT,
  HIRO_API_URL,
  networkInstance,
  txVersion,
  explorerUrl,
} from '../../config/chainConfig.js';

const API_URL = HIRO_API_URL;

let _initialized = false;
let _wallet = null;
let _nonces = {};

function init() {
  if (_initialized) return;
  const signingKey = process.env.PAYOUT_TX_SIGNING_KEY;
  if (!signingKey) {
    console.warn('[StacksAdapter] PAYOUT_TX_SIGNING_KEY not set — all chain writes will fail');
    return;
  }
  try {
    _wallet = { privateKey: signingKey, address: getAddressFromPrivateKey(signingKey, txVersion) };
    console.log(`[StacksAdapter] Signer wallet initialized: ${_wallet.address}`);
  } catch (err) {
    console.warn(`[StacksAdapter] PAYOUT_TX_SIGNING_KEY invalid — skipping (${err.message})`);
  }
  _initialized = true;
}

function getState() {
  return {
    initialized: _initialized,
    hasWallet: _wallet !== null,
    signerAddress: _wallet?.address ?? null,
    nonces: { ..._nonces },
  };
}

async function ensureNonce(address) {
  let resp;
  try {
    resp = await fetch(`${API_URL}/v2/accounts/${address}?proof=0`, {
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    console.warn('[StacksAdapter] nonce fetch network error:', e.message);
    if (_nonces[address] !== undefined) return _nonces[address];
    throw new Error(`Nonce fetch network error: ${e.message}`);
  }
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    console.warn('[StacksAdapter] nonce fetch non-JSON:', text.substring(0, 200));
    if (_nonces[address] !== undefined) return _nonces[address];
    throw new Error(`Nonce fetch returned non-JSON (HTTP ${resp.status}): ${text.substring(0, 80)}`);
  }
  const chainNonce = Number(data.nonce);
  // Always trust the chain nonce over our internal counter.
  // The chain is the single source of truth for the account's next valid nonce.
  _nonces[address] = chainNonce;
  return chainNonce;
}

function advanceNonce(address) {
  _nonces[address] = (_nonces[address] || 0) + 1;
}

async function callContract(privateKey, contractName, functionName, functionArgs, contractAddress) {
  if (!_wallet) throw new Error('Signer not configured');
  const nonce = await ensureNonce(_wallet.address);
  let tx;
  try {
    tx = await makeContractCall({
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      senderKey: privateKey,
      network: networkInstance,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
      fee: 10000,
      nonce,
    });
  } catch (e) {
    throw new Error(`makeContractCall failed: ${e.message}`);
  }

  // Custom broadcast with robust error handling (bypass @stacks/transactions broadcastTransaction)
  const serializedTx = tx.serialize().toString('hex');
  const broadcastUrl = `${networkInstance.coreApiUrl}/v2/transactions`;
  let broadcastResp;
  try {
    console.error(`[StacksAdapter] POST ${broadcastUrl} (nonce=${nonce}, ${serializedTx.length} hex chars)`);
    broadcastResp = await fetch(broadcastUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: serializedTx,
    });
    console.error(`[StacksAdapter] response status=${broadcastResp.status}`);
  } catch (e) {
    console.error(`[StacksAdapter] network error:`, e.message);
    throw new Error(`broadcast network error: ${e.message}`);
  }

  const responseText = await broadcastResp.text();
  console.error(`[StacksAdapter] response body (first 300): ${responseText.substring(0, 300)}`);

  if (!broadcastResp.ok) {
    const snippet = responseText.substring(0, 200);
    throw new Error(`Hiro API ${broadcastResp.status}: ${snippet}`);
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    console.error(`[StacksAdapter] JSON parse error: ${e.message}; body: ${responseText.substring(0, 200)}`);
    // response was not JSON — might be plain txid or HTML
    if (/^[0-9a-f]{64}$/i.test(responseText.trim())) {
      result = { txid: responseText.trim() };
    } else {
      throw new Error(`broadcast non-JSON response: ${responseText.substring(0, 200)}`);
    }
  }

  advanceNonce(_wallet.address);
  if (result.error) {
    throw new Error(`transaction rejected: ${result.reason || result.error}`);
  }
  return `0x${result.txid}`;
}

/** Read-only call used for burn/attestation on-chain reads (kept for parity with source). */
async function readOnlyCall(contractName, functionName, functionArgs, contractAddress) {
  const sender = _wallet?.address ?? 'ST111111111111111111111111111111111111111';
  const resp = await fetch(
    `${API_URL}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender,
        arguments: functionArgs.map(cvToHex),
      }),
    }
  );
  if (!resp.ok) throw new Error(`Hiro API ${resp.status} for ${contractName}.${functionName}`);
  const text = await resp.text();
  try { return JSON.parse(text); } catch (e) {
    throw new Error(`Hiro API non-JSON response for ${contractName}.${functionName}: ${text.substring(0,100)}`);
  }
}

async function getTxStatus(txHash) {
  const resp = await fetch(`${API_URL}/extended/v1/tx/${txHash}`, {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) return { status: 'pending', tx_hash: txHash };
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return { status: 'pending', tx_hash: txHash };
  }
  if (data.tx_status === 'success') {
    return {
      status: 'confirmed',
      tx_hash: txHash,
      tx_status: 'success',
      block_height: data.block_height,
      explorer_url: explorerUrl(txHash),
    };
  }
  if (data.tx_status === 'pending' || data.tx_status === 'queued') {
    return { status: 'pending', tx_status: data.tx_status, tx_hash: txHash };
  }
  return {
    status: 'failed',
    tx_hash: txHash,
    tx_status: data.tx_status,
    error: data.tx_result?.repr || data.tx_status,
  };
}

/** Alias used by BOS transition guards/actions */
async function getTransactionStatus(txHash) {
  const result = await getTxStatus(txHash);
  return {
    tx_status: result.tx_status || result.status,
    block_height: result.block_height,
  };
}

/**
 * Burn USDCx on Stacks (SIP-010 burn)
 * @param {Object} params
 * @param {number} params.amount - amount in USDCx base units (6 decimals)
 * @param {string} [params.memo] - optional memo
 * @param {string} [params.idempotencyKey] - for idempotent burn submission
 * @returns {Promise<string>} txHash
 */
async function burnUsdcx({ amount, memo, idempotencyKey }) {
  init();
  if (!_wallet) throw new Error('PAYOUT_TX_SIGNING_KEY not configured');
  const pk = _wallet.privateKey;
  const [addr, name] = USDCX_CONTRACT.split('.');
  const args = [
    uintCV(amount),
  ];
  if (memo) {
    args.push(bufferCV(Buffer.from(memo.slice(0, 34), 'utf-8')));
  }
  const txHash = await callContract(pk, name, 'burn', args, addr);
  return txHash;
}

export {
  init,
  getState,
  burnUsdcx,
  getTxStatus,
  getTransactionStatus,
};

export default {
  init,
  getState,
  burnUsdcx,
  getTxStatus,
  getTransactionStatus,
};