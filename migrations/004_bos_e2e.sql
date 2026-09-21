-- 004_bos_e2e.sql
-- payout-rail BOS E2E Orchestration tables
-- Origin: CineX backend/src/migrations/010_bos_e2e.sql
--   https://github.com/OmenaiVIC/CineX.git (MIT, (c) 2026 Victor Omenai)
-- Adds disbursement_evidence for audit trail and external_status_snapshots improvements

-- Evidence artifacts per disbursement
CREATE TABLE IF NOT EXISTS disbursement_evidence (
  id TEXT PRIMARY KEY,
  disbursement_id UUID NOT NULL REFERENCES disbursements(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL, -- api_response, tx_hash, webhook_payload, manual_note, gate_result, poll_result
  evidence_data JSONB NOT NULL DEFAULT '{}',
  recorded_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disbursement_evidence_disbursement
  ON disbursement_evidence(disbursement_id);

CREATE INDEX IF NOT EXISTS idx_disbursement_evidence_type
  ON disbursement_evidence(evidence_type);

-- Improve external_status_snapshots with additional columns
ALTER TABLE external_status_snapshots
  ADD COLUMN IF NOT EXISTS response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add last_polled_at to disbursements for fallback poller tracking
ALTER TABLE disbursements
  ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS poll_count INTEGER DEFAULT 0;

-- Add attestation_id and release_id to disbursements for xReserve tracking
ALTER TABLE disbursements
  ADD COLUMN IF NOT EXISTS attestation_id TEXT,
  ADD COLUMN IF NOT EXISTS release_id TEXT,
  ADD COLUMN IF NOT EXISTS payout_id TEXT;