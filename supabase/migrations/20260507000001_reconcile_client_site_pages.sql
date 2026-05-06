-- P8.D.6: Reconcile client_site_pages schema between Car Scout's P8.0 migration
-- and the Phase 8.D extended schema currently live in production.
--
-- Background: Two parallel agents implemented site-audit independently.
--   • main branch:    Car Scout migration (20260504) — markdown_content, crawled_at
--   • feature branch: Phase 8.D migration (20260505) — content_summary, crawl_status,
--                                                     last_crawled_at, path, h1, etc.
-- Production DB ran the Phase 8.D migration first, so it lacks Car Scout's columns.
--
-- This migration is idempotent (ADD COLUMN IF NOT EXISTS) and runs in any order
-- to leave the table with the union of both column sets.
--
-- Reference: ROADMAP.md P8.D.6

-- Columns from Car Scout's P8.0 migration (missing from Phase 8.D production)
alter table client_site_pages
  add column if not exists markdown_content text;
alter table client_site_pages
  add column if not exists crawled_at timestamp with time zone;

-- Columns from Phase 8.D migration (missing on Car Scout-only deployments)
alter table client_site_pages
  add column if not exists path text;
alter table client_site_pages
  add column if not exists h1 text;
alter table client_site_pages
  add column if not exists meta_description text;
alter table client_site_pages
  add column if not exists content_summary text;
alter table client_site_pages
  add column if not exists geo_block_version text;
alter table client_site_pages
  add column if not exists crawl_status text;
alter table client_site_pages
  add column if not exists last_crawled_at timestamp with time zone;
alter table client_site_pages
  add column if not exists crawl_error text;

-- Backfill: keep both timestamp columns in sync going forward
update client_site_pages
  set crawled_at = coalesce(crawled_at, last_crawled_at)
  where crawled_at is null and last_crawled_at is not null;

update client_site_pages
  set last_crawled_at = coalesce(last_crawled_at, crawled_at)
  where last_crawled_at is null and crawled_at is not null;

-- crawl_status NOT NULL default for Car Scout deployments
update client_site_pages
  set crawl_status = case
    when crawled_at is not null then 'crawled'
    else 'pending'
  end
  where crawl_status is null;

alter table client_site_pages
  alter column crawl_status set default 'pending';
