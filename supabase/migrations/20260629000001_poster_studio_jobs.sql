-- Poster Studio internal tool: Magic Lab content repurposing + image generation jobs
-- ⚠️  PM must apply this migration — workers must NOT call apply_migration directly.

CREATE TABLE IF NOT EXISTS poster_studio_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Input
  mode TEXT NOT NULL CHECK (mode IN ('magic_lab_class', 'ray_perspective')),
  platform TEXT NOT NULL DEFAULT 'xiaohongshu'
    CHECK (platform IN ('xiaohongshu', 'instagram', 'linkedin', 'wechat')),
  input_type TEXT NOT NULL
    CHECK (input_type IN ('url', 'text', 'image_url')),
  input_url          TEXT,
  input_text         TEXT,
  input_image_url    TEXT,
  scraped_content    TEXT,
  source_label       TEXT,

  -- Generated output
  generated_copy     JSONB,   -- { headline, body, hashtags[], platform_note }
  image_prompt       TEXT,

  -- Image generation (Atlas async)
  atlas_job_id       TEXT,
  image_url          TEXT,
  image_status       TEXT NOT NULL DEFAULT 'none'
    CHECK (image_status IN ('none', 'pending', 'processing', 'completed', 'failed')),

  -- Job lifecycle
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message      TEXT,
  trigger_type       TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual', 'cron')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE poster_studio_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON poster_studio_jobs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_poster_studio_jobs_created_at
  ON poster_studio_jobs (created_at DESC);
