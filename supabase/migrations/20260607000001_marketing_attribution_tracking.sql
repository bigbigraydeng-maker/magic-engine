-- Marketing attribution tracking for website discovery + contact flows.

ALTER TABLE discovery_leads
  ADD COLUMN IF NOT EXISTS market             text,
  ADD COLUMN IF NOT EXISTS findings           jsonb,
  ADD COLUMN IF NOT EXISTS no_website_answers jsonb,
  ADD COLUMN IF NOT EXISTS consent_at         timestamptz,
  ADD COLUMN IF NOT EXISTS utm_source         text,
  ADD COLUMN IF NOT EXISTS utm_medium         text,
  ADD COLUMN IF NOT EXISTS utm_campaign       text,
  ADD COLUMN IF NOT EXISTS utm_term           text,
  ADD COLUMN IF NOT EXISTS utm_content        text,
  ADD COLUMN IF NOT EXISTS entry_offer        text,
  ADD COLUMN IF NOT EXISTS entry_page         text,
  ADD COLUMN IF NOT EXISTS referrer           text,
  ADD COLUMN IF NOT EXISTS attribution        jsonb;

ALTER TABLE public_scan_jobs
  ADD COLUMN IF NOT EXISTS utm_source   text,
  ADD COLUMN IF NOT EXISTS utm_medium   text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_term     text,
  ADD COLUMN IF NOT EXISTS utm_content  text,
  ADD COLUMN IF NOT EXISTS entry_offer  text,
  ADD COLUMN IF NOT EXISTS entry_page   text,
  ADD COLUMN IF NOT EXISTS referrer     text,
  ADD COLUMN IF NOT EXISTS attribution  jsonb;

CREATE INDEX IF NOT EXISTS idx_discovery_leads_utm_campaign
  ON discovery_leads (utm_campaign);

CREATE INDEX IF NOT EXISTS idx_public_scan_jobs_utm_campaign
  ON public_scan_jobs (utm_campaign);

COMMENT ON COLUMN discovery_leads.attribution IS
  'Normalized attribution payload captured from website entrypoints such as /ads, /discover, and /contact.';

COMMENT ON COLUMN public_scan_jobs.attribution IS
  'Normalized attribution payload copied from the discovery lead when a public scan job is created.';
