-- 005_sprint_0_5.sql
-- payout-rail BOS Sprint 0.5 — fail-closed preflight
-- Persists the preflight verdict so the state machine can gate the burn phase
-- on the *result* of the safety gates rather than merely on the record existing.

-- Structured preflight outcome: { ok: boolean, action: string|null, gate_results: [...] }
ALTER TABLE disbursements
  ADD COLUMN IF NOT EXISTS preflight_result JSONB;
