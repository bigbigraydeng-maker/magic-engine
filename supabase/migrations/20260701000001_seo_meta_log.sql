-- seo_meta_log: tracks every AI-generated meta optimisation per page
-- Used by oztop-seo-optimizer loop to enforce 30-day cooldown per page slug

CREATE TABLE IF NOT EXISTS seo_meta_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL,
  page_slug     text NOT NULL,
  page_url      text NOT NULL,
  keyword       text NOT NULL,
  old_title     text,
  old_desc      text,
  new_title     text NOT NULL,
  new_desc      text NOT NULL,
  wp_updated    boolean NOT NULL DEFAULT false,
  optimised_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seo_meta_log_client_slug_idx
  ON seo_meta_log (client_id, page_slug, optimised_at DESC);

ALTER TABLE seo_meta_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON seo_meta_log FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
