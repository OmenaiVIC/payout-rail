-- 007_sprint_2.sql
-- G-08: the destination release is an EXTERNAL outcome, observed not fabricated.
--
-- The previous model let the app call `releaseDestination()` and fabricate a
-- `confirmed` result. The corrected model only ever records what an external
-- settlement process reports; the app never manufactures a release confirmation.
--
-- This migration adds `release_status`, the persisted, gated observation:
--   unobserved         — waiting for external evidence (nothing observed yet)
--   observed_pending   — evidence says the release is in flight
--   observed_confirmed — evidence says the release completed
--   observed_failed    — evidence says the release failed
--
-- The payout leg only unlocks when the persisted value is `observed_confirmed`
-- AND a fresh observation still reports confirmed (see transitionGuards.js).
-- `release_id` is deliberately NOT written by any action (it was the synthetic
-- id of the fabricated call); the column remains, nullable and unused, so
-- historical rows and the schema stay untouched.

ALTER TABLE disbursements
  ADD COLUMN IF NOT EXISTS release_status TEXT;

ALTER TABLE disbursements
  ADD CONSTRAINT disbursements_release_status_check
  CHECK (release_status IS NULL
      OR release_status IN
        ('unobserved', 'observed_pending', 'observed_confirmed', 'observed_failed'));