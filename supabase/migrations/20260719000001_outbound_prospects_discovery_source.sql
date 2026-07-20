-- Phase 35 · job-signal ingest: distinguish how a prospect was discovered.
--
-- Existing discovery source = Google Places (industry × city sweep). The new
-- job-board adapter feeds the SAME outbound_prospects.discovered stage from a
-- different signal (companies hiring marketing roles). Downstream audit/score/
-- analyze/outreach is reused unchanged, but the two sources need to be told
-- apart for: (a) differentiated scoring/filtering — a company hiring an
-- in-house marketer scores differently from a leaking local SMB; (b) a
-- separate admin board view; (c) attribution of which source converts.
--
-- Detecting the source via raw_listing->hiring_signal would be a fragile JSON
-- probe; a first-class column keeps queue/board/dedup logic simple.
--
-- Backfill: every existing row predates job-signal ingest, so 'places' is the
-- correct default for all current data.

ALTER TABLE public.outbound_prospects
  ADD COLUMN IF NOT EXISTS discovery_source TEXT NOT NULL DEFAULT 'places'
    CHECK (discovery_source IN ('places', 'job_board'));

CREATE INDEX IF NOT EXISTS idx_outbound_prospects_discovery_source
  ON public.outbound_prospects (discovery_source);

COMMENT ON COLUMN public.outbound_prospects.discovery_source IS
  'How this prospect entered the pipeline: places (Google Places industry×city sweep) | job_board (hiring-signal ingest from Seek/Indeed/TradeMe). Phase 35 job-signal adapter.';

-- RLS: table already has service_role_full policy from the base migration;
-- adding a column needs no policy change.
