-- Add missing instagram_handle column on clients table.
--
-- Drift discovered 2026-06-05: social-collector.ts reads row.instagram_handle
-- but the column was never created. With it null, all 3 social handle inputs
-- (instagram_handle / facebook_page_url / tiktok_handle) are null on every
-- client → social diagnostic dimension permanently returns score=null
-- (skipped), blocking social score for all clients across the platform.
--
-- Mirror pattern: facebook_page_url, tiktok_handle (both already exist as text).
-- New Settings → Social Handles panel uses GET/PATCH on
-- /api/clients/[id]/social-handles to write all three.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS instagram_handle text;

COMMENT ON COLUMN clients.instagram_handle IS
  'Instagram handle (without @). Drives social-collector diagnostic dimension. '
  'Configured via Settings → Social Handles panel.';
