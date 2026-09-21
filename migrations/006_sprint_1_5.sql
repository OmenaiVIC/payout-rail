-- 006_sprint_1_5.sql
-- Deterministic idempotency key: make uniqueness explicit and self-documenting.
--
-- 001 already declared `idempotency_key TEXT UNIQUE NOT NULL` (which auto-creates
-- a unique constraint index). This migration drops the redundant non-unique
-- index that 001 also added (`idx_disbursements_idempotency`) and replaces it
-- with a named UNIQUE index, so the double-payout invariant is enforceable and
-- introspectable by name.
--
-- Sprint 1.5 (G-11): the key itself is now derived deterministically from stable
-- inputs (source_reference + source_application + amount_usdcx +
-- recipient_bank_account) instead of a timestamp, so retries collide with the
-- original and are rejected by this constraint.

DROP INDEX IF EXISTS idx_disbursements_idempotency;

CREATE UNIQUE INDEX IF NOT EXISTS idx_disbursements_idempotency_unique
  ON disbursements(idempotency_key);