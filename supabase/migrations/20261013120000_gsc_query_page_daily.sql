-- ===========================================================================
-- gsc_query_page_daily / gsc_query_page_fetch_receipts
-- ===========================================================================
--
-- This file ships with the PR but is NOT applied by the PR. Applying it needs
-- the PM's explicit go in chat.
--
-- Purpose: store Google Search Console (GSC) clicks / impressions / position for
-- every (query, page) pair for every day. gsc_page_daily answers "which page got
-- how much"; it cannot answer "which query is that page ranking for". Google keeps
-- only about 16 months, so history that is not stored is lost.
-- Design: docs/specs/2026-10-13-gsc-query-page-daily-design.md
--
-- Two tables, same shape as the per-page pair (gsc_page_daily /
-- gsc_page_fetch_receipts, migration 20260926200000):
--   * gsc_query_page_daily          — one row per (query, page) per day.
--   * gsc_query_page_fetch_receipts — one receipt per pull order.
--
-- `day` is Google's own date (US Pacific time), not the NZ date.
-- Access: both tables are service_role only; anon / authenticated are revoked.
-- ===========================================================================

-- The primary key is (client, day, query exactly as Google returned it, page URL
-- exactly as Google returned it). Nothing is case-folded on write: folding would
-- merge two keys and one row would overwrite the other's clicks. `page_key` is the
-- normalised page key (gscPageKey in src/lib/url/page-key.ts) used to match a page
-- against gsc_page_daily. Rows whose query + URL (or page_key) are longer than
-- 2000 bytes are not written by the application (btree index entry limit) and are
-- only counted on the receipt. `ctr` is not stored: it is clicks / impressions.
CREATE TABLE IF NOT EXISTS public.gsc_query_page_daily (
  client_id    uuid    NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  day          date    NOT NULL,
  query        text    NOT NULL,
  page_url     text    NOT NULL,
  page_key     text    NOT NULL,
  clicks       integer NOT NULL,
  impressions  integer NOT NULL,
  position     numeric NOT NULL,
  PRIMARY KEY (client_id, day, query, page_url)
);

-- (client_id, day) needs no index of its own: it is a prefix of the primary key.
CREATE INDEX IF NOT EXISTS gsc_query_page_daily_client_key_day_idx
  ON public.gsc_query_page_daily (client_id, page_key, day);

-- Same columns as gsc_page_fetch_receipts on purpose (the shared pull code writes
-- the same receipt fields); `skipped_long_urls` counts rows skipped for key length.
CREATE TABLE IF NOT EXISTS public.gsc_query_page_fetch_receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  site_url           text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('daily', 'backfill')),
  request_start_day  date NOT NULL,
  request_end_day    date NOT NULL,
  data_from_day      date,
  data_through_day   date,
  status             text NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'complete', 'truncated', 'failed')),
  failure_kind       text CHECK (failure_kind IN ('auth', 'quota', 'other')),
  row_count          integer NOT NULL DEFAULT 0,
  request_count      integer NOT NULL DEFAULT 0,
  skipped_long_urls  integer NOT NULL DEFAULT 0,
  inngest_run_id     text,
  inngest_event_id   text,
  error              text,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  CONSTRAINT gsc_query_page_fetch_receipts_range_chk CHECK (request_end_day >= request_start_day)
);

CREATE INDEX IF NOT EXISTS gsc_query_page_fetch_receipts_client_status_finished_idx
  ON public.gsc_query_page_fetch_receipts (client_id, status, finished_at DESC);

ALTER TABLE public.gsc_query_page_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_query_page_fetch_receipts ENABLE ROW LEVEL SECURITY;

-- Policies must say `TO service_role`; leaving it out opens the table to
-- anonymous visitors (docs/DECISIONS.md, 2026-08-03).
DO $do$
BEGIN
  CREATE POLICY gsc_query_page_daily_service_role ON public.gsc_query_page_daily
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

DO $do$
BEGIN
  CREATE POLICY gsc_query_page_fetch_receipts_service_role ON public.gsc_query_page_fetch_receipts
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

REVOKE ALL ON public.gsc_query_page_daily FROM anon, authenticated;
REVOKE ALL ON public.gsc_query_page_fetch_receipts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_query_page_daily TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_query_page_fetch_receipts TO service_role;

COMMENT ON TABLE public.gsc_query_page_daily IS 'Google Search Console per-(query, page) daily metrics: one row per query per page per day; day is Google''s date (US Pacific). Written by service_role only. query and page_url are kept exactly as Google returns them and can carry personal data (a search query typed by a person, or a page URL with an email in its query string). Google hides anonymised queries, so query-level clicks sum to at most the page-level total. Retention: at most 16 months (Google''s own window); pruning is not automated yet.';
COMMENT ON COLUMN public.gsc_query_page_daily.page_key IS 'gscPageKey: same normalisation as gsc_page_daily.page_key, so a page can be matched across both tables. Several raw page_url values can share one page_key — aggregate before joining.';
COMMENT ON COLUMN public.gsc_query_page_daily.query IS 'The search query exactly as Google returned it (no case folding on write). Part of the primary key.';
COMMENT ON COLUMN public.gsc_query_page_daily.position IS 'Average position (Google''s number, 1 = top). Not additive: weight by impressions when combining rows.';
COMMENT ON TABLE public.gsc_query_page_fetch_receipts IS 'Pull receipts for gsc_query_page_daily: one per order. id is also the id of the matching cron_run_logs row; both are derived from the Inngest run id.';
COMMENT ON COLUMN public.gsc_query_page_fetch_receipts.skipped_long_urls IS 'Rows not written because query + page_url (or page_key) is longer than 2000 bytes (the column name is shared with gsc_page_fetch_receipts, where it counts URLs).';
COMMENT ON COLUMN public.gsc_query_page_fetch_receipts.status IS 'running / complete (whole range pulled) / truncated (some day reached Google''s 50,000-rows-per-day export cap, so only Google''s top rows exist for it; counts as covered and is never re-pulled) / failed.';
COMMENT ON COLUMN public.gsc_query_page_fetch_receipts.failure_kind IS 'Only set when failed: auth / quota / other.';
