-- 003_payout_gates.sql
-- payout-rail BOS Payout Gates — §8 SAFE Forwarding
-- Origin: CineX backend/src/migrations/009_payout_gates.sql
--   https://github.com/OmenaiVIC/CineX.git (MIT, (c) 2026 Victor Omenai)
-- Financial safety gates that check every disbursement BEFORE the burn/bridge phase

CREATE TABLE IF NOT EXISTS payout_gates (
  id SERIAL PRIMARY KEY,
  disbursement_id UUID NOT NULL REFERENCES disbursements(id),
  gate_name TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  error_code TEXT,
  reason TEXT,
  warning TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_gates_disbursement ON payout_gates(disbursement_id);
CREATE INDEX IF NOT EXISTS idx_payout_gates_name ON payout_gates(gate_name);
CREATE INDEX IF NOT EXISTS idx_payout_gates_passed ON payout_gates(passed);

CREATE TABLE IF NOT EXISTS two_person_approvals (
  id SERIAL PRIMARY KEY,
  disbursement_id UUID NOT NULL REFERENCES disbursements(id),
  approver_address TEXT NOT NULL,
  approved_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(disbursement_id, approver_address)
);

CREATE INDEX IF NOT EXISTS idx_2pa_disbursement ON two_person_approvals(disbursement_id);

CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  id SERIAL PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMP,
  last_success_at TIMESTAMP,
  tripped_at TIMESTAMP,
  trip_reason TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO circuit_breaker_state (state) VALUES ('closed') ON CONFLICT DO NOTHING;