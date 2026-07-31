-- 做片任务表：记录每条选题从「排队」到「待审」的做片进度。已 apply（PM go 建表），此文件纳入版本控制。
CREATE TABLE IF NOT EXISTS content_factory_render_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL,
  content_post_id  uuid NOT NULL,
  status           text NOT NULL DEFAULT 'queued',
  -- queued | planning | rendering | assembling | ready_for_review | failed
  scenes           jsonb,
  clip_urls        jsonb,
  vo_urls          jsonb,
  output_url       text,
  error            text,
  cost_usd         numeric NOT NULL DEFAULT 0,
  attempts         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfrj_status ON content_factory_render_jobs (status);
CREATE INDEX IF NOT EXISTS idx_cfrj_client ON content_factory_render_jobs (client_id);
CREATE INDEX IF NOT EXISTS idx_cfrj_post   ON content_factory_render_jobs (content_post_id);

-- ME 数据访问模型 = service-role + Bearer-token API，从不走 end-user RLS。
ALTER TABLE content_factory_render_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON content_factory_render_jobs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
