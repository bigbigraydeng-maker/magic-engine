-- client_site_pages index-status columns (22.E.S15 后半 · R5 收录检查).
--
-- Filled by the daily URL-inspection rotation (oldest index_checked_at
-- first, NULLs first — full coverage over time, 魏征 M6):
--   index_verdict        — raw-ish Google coverageState (TEXT deliberately,
--                          not an enum: Google adds values, and enum changes
--                          need migration + frontend sync, 魏征 m3)
--   index_checked_at     — when this URL was last inspected
--   first_not_indexed_at — first time we saw it not indexed; cleared when it
--                          flips back to indexed. Drives R5's daysNotIndexed.

ALTER TABLE client_site_pages
  ADD COLUMN IF NOT EXISTS index_verdict        text,
  ADD COLUMN IF NOT EXISTS index_checked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS first_not_indexed_at timestamptz;
