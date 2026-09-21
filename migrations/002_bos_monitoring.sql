-- 002_bos_monitoring.sql
-- payout-rail BOS monitoring alerts table
-- Origin: CineX backend/src/migrations/007_bos_monitoring.sql
--   https://github.com/OmenaiVIC/CineX.git (MIT, (c) 2026 Victor Omenai)
-- Tracks deduplicated alerts for monitoring dashboard and notifications

CREATE TABLE IF NOT EXISTS bos_alerts (
  id SERIAL PRIMARY KEY,
  alert_key TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  disbursement_id UUID,
  details JSONB DEFAULT '{}',
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Dedup index: suppress duplicate alerts within dedup window
-- Composite unique constraint prevents duplicate inserts for same key within time window
CREATE UNIQUE INDEX IF NOT EXISTS idx_bos_alerts_dedup
  ON bos_alerts (alert_key, created_at);

-- Query indexes
CREATE INDEX IF NOT EXISTS idx_bos_alerts_type
  ON bos_alerts (alert_type);

CREATE INDEX IF NOT EXISTS idx_bos_alerts_unacknowledged
  ON bos_alerts (acknowledged, created_at DESC)
  WHERE acknowledged = false;

CREATE INDEX IF NOT EXISTS idx_bos_alerts_severity
  ON bos_alerts (severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bos_alerts_disbursement
  ON bos_alerts (disbursement_id)
  WHERE disbursement_id IS NOT NULL;