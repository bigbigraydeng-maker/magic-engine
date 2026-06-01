-- P29.SEO.7: website lead event tracking

CREATE TABLE IF NOT EXISTS website_lead_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_path    TEXT NOT NULL,
  cta_key      TEXT NOT NULL,
  destination  TEXT NOT NULL,
  target_href  TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'training',
  referrer     TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_website_lead_events_page_path
  ON website_lead_events(page_path);

CREATE INDEX IF NOT EXISTS idx_website_lead_events_cta_key
  ON website_lead_events(cta_key);

CREATE INDEX IF NOT EXISTS idx_website_lead_events_created_at
  ON website_lead_events(created_at DESC);

ALTER TABLE website_lead_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON website_lead_events FOR ALL USING (true);

COMMENT ON TABLE website_lead_events IS
  'Lightweight tracking for website CTA clicks and handoff sources, starting with /training.';
