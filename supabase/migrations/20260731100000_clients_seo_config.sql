-- clients.seo_config — per-client SEO automation switches (22.E.S16).
--
-- Shape (all keys optional):
--   { "weekly_blog": true }
--
-- weekly_blog: when true, the blog-weekly cron generates one draft per week
-- for this client (auto-topic from AI-visibility weak spots × keyword
-- opportunities). Drafts always await human review — the flag only controls
-- generation, never publishing.
--
-- Written exclusively via PATCH /api/clients/[id]/seo-config (Settings UI).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS seo_config jsonb NOT NULL DEFAULT '{}'::jsonb;
