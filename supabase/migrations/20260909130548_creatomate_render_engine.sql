-- Creatomate connector（spec docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.6）
-- 给 content_factory_render_jobs 加"走哪个引擎"的开关 + Creatomate 侧的 render id。
-- 纯加列带默认值，向后兼容：不加这两列的旧行行为不变（render_engine 默认 'ffmpeg'）。
ALTER TABLE content_factory_render_jobs
  ADD COLUMN IF NOT EXISTS render_engine text NOT NULL DEFAULT 'ffmpeg'
    CHECK (render_engine IN ('ffmpeg', 'creatomate')),
  ADD COLUMN IF NOT EXISTS creatomate_render_id text;

-- webhook 端点靠这个索引反查是哪个 job 在等这条 render_id（spec §4.5）。
CREATE INDEX IF NOT EXISTS idx_cfrj_creatomate_render_id
  ON content_factory_render_jobs (creatomate_render_id)
  WHERE creatomate_render_id IS NOT NULL;
