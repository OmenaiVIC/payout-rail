-- 008_sprint_4.sql
-- Sprint 4 evidence foundation (4a)
--
-- 1. Drop dead write-dead tables that the Sprint 4 evidence model supersedes.
--    `relay_wallet_activity` and `config_snapshots` existed in the schema but were
--    never written by any code path (see docs/POSTPONED_BACKLOG.md, S4-1 / S4-2 for
--    the reasoned entries). Dropping removes the confusion of "schema says it exists,
--    code never writes it" and keeps the monitoring/evidence story singular.
--    IF EXISTS keeps this migration replayable on already-dropped databases and
--    harmless on fresh installs where the tables may already be gone.
--
-- 2. Add the partial unique index that backs the manual_review_queue guard
--    (enqueueManualReview ON CONFLICT (disbursement_id) WHERE resolved = FALSE).
--    At most one OPEN manual-review item may exist per disbursement; resolved items
--    may accumulate freely for history. This is the DB-level guarantee the guard
--    depends on — created before any Sprint 4 code that references it ships.

DROP TABLE IF EXISTS relay_wallet_activity;
DROP TABLE IF EXISTS config_snapshots;

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_open_per_disbursement
  ON manual_review_queue(disbursement_id)
  WHERE resolved = FALSE;