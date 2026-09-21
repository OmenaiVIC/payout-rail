/**
 * BOS (Bridge Orchestration Service) — Core Types
 * 15 disbursement states, TypeScript-style type documentation via JSDoc
 */

/**
 * Disbursement states — matches 007_bos_schema.sql + migrations table
 * Canonical order for flow visualization:
 *   initiated → burn_submitted → burn_confirmed →
 *   attestation_requested → attestation_confirmed →
 *   destination_release_unobserved → destination_release_observed →
 *   destination_release_confirmed →
 *   yellowcard_payout_submitted → yellowcard_payout_confirmed →
 *   settled | failed | cancelled | manual_review
 *
 * The destination release is OBSERVED, never app-controlled (G-08): the app
 * records release_status evidence only, and pays out on observed_confirmed.
 *
 * @typedef {string} DisbursementState
 * @enum {DisbursementState}
 */
export const DisbursementState = {
  DISBURSEMENT_INITIATED:       'disbursement_initiated',
  PREFLIGHT_CHECK:              'preflight_check',
  BURN_SUBMITTED:               'burn_submitted',
  BURN_CONFIRMED:               'burn_confirmed',
  ATTESTATION_REQUESTED:        'attestation_requested',
  ATTESTATION_CONFIRMED:        'attestation_confirmed',
  DESTINATION_RELEASE_UNOBSERVED:'destination_release_unobserved',
  DESTINATION_RELEASE_OBSERVED: 'destination_release_observed',
  DESTINATION_RELEASE_CONFIRMED:'destination_release_confirmed',
  YELLOWCARD_PAYOUT_SUBMITTED:  'yellowcard_payout_submitted',
  YELLOWCARD_PAYOUT_CONFIRMED:  'yellowcard_payout_confirmed',
  SETTLED:                      'settled',
  FAILED:                       'failed',
  CANCELLED:                    'cancelled',
  MANUAL_REVIEW:                'manual_review',
};

/**
 * Destination-release observation status — the external settlement outcome as
 * recorded by the app. The app fabricates NONE of these values; they come only
 * from observing the external process (`observeDestinationRelease`).
 *
 * 'unobserved'         — no external evidence seen yet (fail-closed default)
 * 'observed_pending'   — evidence exists, release in flight
 * 'observed_confirmed' — evidence exists, release completed
 * 'observed_failed'    — evidence exists, release failed
 *
 * @typedef {string} ReleaseStatus
 * @enum {ReleaseStatus}
 */
export const ReleaseStatus = {
  UNOBSERVED:          'unobserved',
  OBSERVED_PENDING:    'observed_pending',
  OBSERVED_CONFIRMED:  'observed_confirmed',
  OBSERVED_FAILED:     'observed_failed',
};

/** Terminal states — no further transitions possible */
export const TERMINAL_STATES = new Set([
  DisbursementState.SETTLED,
  DisbursementState.FAILED,
  DisbursementState.CANCELLED,
]);

/** Failed states — for reporting and reconciliation queries */
export const FAILED_STATES = new Set([
  DisbursementState.FAILED,
  DisbursementState.MANUAL_REVIEW,
]);

/**
 * @typedef {Object} DisbursementRecord
 * @property {string}  id                 — UUID PK
 * @property {string}  idempotency_key    — unique per-disbursement
 * @property {string}  source_reference   — originating campaign/payout reference id
 * @property {string}  source_application — originating application (e.g. 'campaign')
 * @property {number}  amount_usd         — stable USD value
 * @property {number}  amount_usdcx       — base units (6 decimals)
 * @property {string}  creator_address    — recipient Stacks address
 * @property {string}  status             — DisbursementState
 * @property {string|null} external_tx_id — Stacks tx ID for the burn
 * @property {string|null} release_status — release observation (ReleaseStatus); gates the payout leg
 * @property {string|null} error_message  — last failure detail
 * @property {number}  retry_count        — how many retries so far
 * @property {number|null} max_retries    — retry budget (default 3)
 * @property {string|null} last_error     — most recent error
 * @property {string}  last_heartbeat_at  — ISO timestamp
 * @property {string}  created_at         — ISO timestamp
 * @property {string}  updated_at         — ISO timestamp
 */

/**
 * @typedef {Object} TransitionResult
 * @property {boolean} success
 * @property {DisbursementState|null} new_state — if transition succeeded
 * @property {string|null} error               — if transition failed
 * @property {string|null} error_code          — machine-readable (u82xx range)
 * @property {Object|null} details            — transition-specific payload
 */

/**
 * @typedef {Object} Transition
 * @property {DisbursementState} from
 * @property {DisbursementState} to
 * @property {string}             description — for logging / docs
 * @property {Function}           guard       — (disbursement, context) => boolean
 * @property {Function}           action      — (disbursement, context) => Promise<Object>
 *   action must return an object that can be merged into the disbursement update
 */

/**
 * @typedef {Object} TransitionContext
 * @property {Function} getDb        — database handle getter
 * @property {Object}   adapters     — { stacks, xreserve, yellowcard }
 * @property {Function} emitEvent    — audit log emitter
 * @property {Function} getLogger    — scoped logger
 */

/**
 * @typedef {Object} ExternalRef
 * @property {string} disbursement_id
 * @property {string} external_system — 'stacks' | 'xreserve' | 'yellowcard' | 'neon_bos'
 * @property {string} identifier_type — 'tx_id' | 'request_id' | 'payout_id'
 * @property {string} identifier_value
 * @property {Object} metadata        — JSONB, arbitrary extra data
 */

/**
 * @typedef {Object} DisbursementAuditEntry
 * @property {string} disbursement_id
 * @property {string} old_status
 * @property {string} new_status
 * @property {string} action           — transition name
 * @property {Object|null} details     — payload logged
 * @property {string} triggered_by     — 'worker' | 'reaper' | 'reconciliation' | 'manual'
 */

/**
 * @typedef {Object} YellowCardInitRequest
 * @property {string} idempotency_key
 * @property {number} amount           — amount in target currency's smallest unit (e.g., NGN kobo)
 * @property {string} recipient_type   — 'bank_account' | 'mobile_money' | ...
 * @property {Object} recipient        — { account_number, bank_code, ... }
 * @property {string} currency         — 'NGN'
 * @property {string} callback_url     — webhook URL for status updates
 */

/**
 * @typedef {Object} YellowCardInitResponse
 * @property {string} payout_id
 * @property {string} status           — 'pending' | 'processing' | 'completed' | 'failed'
 * @property {string} idempotency_key
 */

/**
 * @typedef {Object} YellowCardStatusResponse
 * @property {string} payout_id
 * @property {string} status
 * @property {Object} details          — provider-level metadata
 */

/**
 * @typedef {Object} XReserveAttestationRequest
 * @property {string} tx_id            — Stacks burn tx ID
 * @property {string} token_contract   — USDCx contract
 * @property {string} recipient_btc    — destination BTC address
 * @property {number} amount_base_units — USDCx amount in base units (6 decimals)
 */

/**
 * @typedef {Object} XReserveAttestationResponse
 * @property {string} attestation_id
 * @property {string} status           — 'pending' | 'confirmed' | 'failed'
 * @property {Object} attestation_data
 */
