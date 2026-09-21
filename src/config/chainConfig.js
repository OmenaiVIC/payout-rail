// chainConfig.js — Payout Rail chain configuration
// Single source of truth for network-aware Stacks configuration in the
// standalone payout-rail repository.
//
// Reads PAYOUT_NETWORK (falling back to shared STACKS_NETWORK, default "testnet")
// and exports:
//   - USDCX_CONTRACT        — SIP-010 USDCx contract on current network
//   - HIRO_API_URL          — Hiro API base URL
//   - STACKS_NETWORK        — "testnet" | "mainnet"
//   - networkInstance       — pre-configured StacksTestnet / StacksMainnet
//   - txVersion             — TransactionVersion (Testnet | Mainnet)
//   - NATIVE_STX_PRINCIPAL  — native STX token principal (network-aware)
//   - DEPLOYER_ADDRESS      — USDCx deployer (network-aware)
//   - explorerUrl(txHash)   — network-aware explorer link builder
//   - PAYOUT_API_BASE_URL   — backend public URL for relay/webhook callbacks
//   - getBurnTarget()       — USDCx burn contract.function (GAP-09 seam, UNVERIFIED)
//
// Derived from CineX backend/src/config/chain.js, scoped to the BOS/payout
// subsystem and re-prefixed with PAYOUT_ so the two repos share no runtime config.

import { StacksTestnet, StacksMainnet } from '@stacks/network';
import { TransactionVersion } from '@stacks/transactions';

const NETWORK = process.env.PAYOUT_NETWORK || process.env.STACKS_NETWORK || 'testnet';

const CONFIGS = {
  testnet: {
    usdcx: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx',
    hiroApi: 'https://api.testnet.hiro.so',
    deployer: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
    boot: 'ST000000000000000000002AMW42H',
  },
  mainnet: {
    usdcx: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
    hiroApi: 'https://api.mainnet.hiro.so',
    deployer: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE',
    boot: 'SP000000000000000000002Q6VF78',
  },
};

if (!Object.prototype.hasOwnProperty.call(CONFIGS, NETWORK)) {
  throw new Error(
    `[chain] Unknown STACKS_NETWORK "${NETWORK}". Supported: testnet, mainnet.`
  );
}

const cfg = CONFIGS[NETWORK];

export const USDCX_CONTRACT = process.env.PAYOUT_USDCX_CONTRACT || cfg.usdcx;
export const HIRO_API_URL = process.env.PAYOUT_HIRO_API_URL || cfg.hiroApi;
export const STACKS_NETWORK = NETWORK;
// Deployer is derived from the USDCx contract principal (its owner), so a
// PAYOUT_USDCX_CONTRACT override also moves the derived deployer address.
export const DEPLOYER_ADDRESS = USDCX_CONTRACT.split('.')[0];
export const EXPLORER_URL = 'https://explorer.hiro.so/txid';

// Native STX token contract principal (boot address + .stx-token), network-aware.
export const NATIVE_STX_PRINCIPAL = `${cfg.boot}.stx-token`;

// Build a network-aware explorer link for a tx hash.
export function explorerUrl(txHash) {
  return `${EXPLORER_URL}/${txHash}?chain=${NETWORK}`;
}

// Pre-configured network instance for @stacks/transactions
export const networkInstance = NETWORK === 'mainnet'
  ? new StacksMainnet({ url: cfg.hiroApi })
  : new StacksTestnet({ url: cfg.hiroApi });

// TransactionVersion enum for getAddressFromPrivateKey
export const txVersion = NETWORK === 'mainnet'
  ? TransactionVersion.Mainnet
  : TransactionVersion.Testnet;

// Backend public URL for relay / webhook callbacks (used by BOS transition actions).
export const PAYOUT_API_BASE_URL = process.env.PAYOUT_API_BASE_URL || 'http://localhost:3001';

/**
 * Burn target for the USDCx burn leg (GAP-09 — UNVERIFIED).
 *
 * Seam for the burn mechanism: which contract.function actually destroys
 * USDCx on Stacks has NOT been verified against a reviewed contract ABI or a
 * testnet integration (docs describe burning via the `usdcx-v1` protocol
 * entrypoint, not necessarily `burn` on the token contract). Every caller
 * resolves the target through here so that a single correction can re-point
 * the whole leg once GAP-09 is closed. Do not treat `verified: false` targets
 * (or spread tx hashes) as proof USDCx was destroyed.
 *
 * @returns {{ contract: string, function: string, verified: boolean, note: string }}
 */
export function getBurnTarget() {
  return {
    contract: USDCX_CONTRACT,
    function: 'burn',
    verified: false,
    note: 'UNVERIFIED — assumes a SIP-010-style burn entrypoint; see docs/GAP_REGISTER.md (GAP-09)',
  };
}

if (!process.env.PAYOUT_API_BASE_URL) {
  console.warn(`[chain] PAYOUT_API_BASE_URL not set — defaulting to ${PAYOUT_API_BASE_URL}`);
}

console.log(`[chain] Network: ${NETWORK} | API: ${HIRO_API_URL} | USDCx: ${USDCX_CONTRACT}`);