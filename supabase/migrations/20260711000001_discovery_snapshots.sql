-- DAPE-Discovery Phase 1 · me-client-discovery plugin server-side landing
-- ============================================================================
-- Spec:
--   - Plugin: plugins/me-client-discovery/ v0.1.0（Roman Hu 案例首次跑通 2026-07-10）
--   - Data contract: plugins/me-client-discovery/schemas/*.schema.json
--   - Compat doc: plugins/me-client-discovery/docs/FUTURE-ME-COMPAT.md
--   - SOP: docs/sops/client-discovery-scan.md
--
-- 建 3 张表 · 承接 me-client-discovery plugin 输出 · 未来 Q1 2027 后司马徽 agent
-- 写同 schema · 客户详情页 Discovery tab（Phase 2）读同表 · 华佗（Analysis）+
-- 诸葛亮（Prescription）agent 也读这几张表。
--
-- 数据 shape 已经在 Phase 0 用 Roman 真数据压力测试过（8 份 JSON 全部通过 schema
-- 校验 · sanity-check 抓到 2 red + 6 yellow 已修）· 微调风险低。
--
-- Backwards compatible:
--   - 全新 3 张表 · 无历史数据 · 无 breaking change
--   - service_role 模板 RLS（CLAUDE.md 强约束 · 2026-06-05 schema 漂移事故教训）
--   - 全部 client_id ON DELETE CASCADE · 删客户时自动清理
--
-- Non-destructive:
--   - No DROP · 只 CREATE IF NOT EXISTS
--   - 无 backfill · 数据从 plugin sync-to-me 或 FDE 手动导入
--
-- Rollback:
--   若需回滚 · 依次执行：
--     DROP TABLE public.local_media_channels CASCADE;
--     DROP TABLE public.market_context_snapshots CASCADE;
--     DROP TABLE public.competitor_snapshots CASCADE;
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. competitor_snapshots
-- ────────────────────────────────────────────────────────────────────────────
-- 每客户 × 每竞对 × 每次扫描 = 一行
-- snapshot_json 存完整 CompetitorSnapshot 结构（见 competitor-snapshot.schema.json）
-- 用 JSONB 而非拆列 · 因为不同行业竞对形态差异大（律所/中介/私教/餐厅字段差异大）·
-- 顶层字段固定用于 filter/join · 详情弹性存 JSONB。

CREATE TABLE IF NOT EXISTS public.competitor_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 关联
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 顶层字段（供 filter/join · 与 snapshot_json 内保持同步）
  competitor_name TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('plugin_manual', 'simatai_auto', 'manual_import')),

  -- 详情
  snapshot_json JSONB NOT NULL,

  -- 审计
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 幂等 · (client_id, competitor_name, scanned_at) 复合唯一
  -- 同一分钟内重复 sync 同一客户+同一竞对+同一 scan 时间 · upsert 覆盖
  UNIQUE (client_id, competitor_name, scanned_at)
);

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_client_time
  ON public.competitor_snapshots(client_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_source
  ON public.competitor_snapshots(source);

-- GIN index 让 snapshot_json 内部字段可高效查询（例：找所有"无个人域名"竞对）
CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_json
  ON public.competitor_snapshots USING GIN (snapshot_json);

COMMENT ON TABLE public.competitor_snapshots IS
  'me-client-discovery plugin + 未来司马徽 agent 输出的竞对快照 · JSONB 存完整 CompetitorSnapshot 结构 · 详见 plugins/me-client-discovery/schemas/competitor-snapshot.schema.json';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. market_context_snapshots
-- ────────────────────────────────────────────────────────────────────────────
-- 每客户 × 每目标区域 × 每次扫描 = 一行
-- 通常 1 客户对应 1 区域 · 但客户跨区域扩张时可有多行

CREATE TABLE IF NOT EXISTS public.market_context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 顶层字段
  geography_region_name TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('plugin_manual', 'simatai_auto', 'manual_import')),

  -- 详情
  snapshot_json JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, geography_region_name, scanned_at)
);

CREATE INDEX IF NOT EXISTS idx_market_context_client_time
  ON public.market_context_snapshots(client_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_context_json
  ON public.market_context_snapshots USING GIN (snapshot_json);

COMMENT ON TABLE public.market_context_snapshots IS
  'me-client-discovery plugin + 未来司马徽 agent 输出的市场速写 · 房价/学区/华人占比/市场热度 · 详见 plugins/me-client-discovery/schemas/market-context.schema.json';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. local_media_channels
-- ────────────────────────────────────────────────────────────────────────────
-- 每客户 × 每媒体渠道 = 一行（渠道级持久记录 · 非快照）
-- 与 competitor / market_context 不同 · 这张是"可迭代的目录" ·
-- 同一渠道多次 sync 会 upsert · 不产生多行历史。
-- 历史追溯靠 updated_at + discovered_at 双时间戳。

CREATE TABLE IF NOT EXISTS public.local_media_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 顶层字段
  media_name TEXT NOT NULL,
  category TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('plugin_manual', 'simatai_auto', 'manual_import')),

  -- 详情
  channel_json JSONB NOT NULL,

  -- 常用 filter 字段（提到顶层供快速查询 · 与 channel_json 同步）
  roi_rank INT CHECK (roi_rank BETWEEN 1 AND 5),
  chinese_relevant BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 同一客户下 · 同一渠道名唯一
  UNIQUE (client_id, media_name)
);

CREATE INDEX IF NOT EXISTS idx_local_media_client_rank
  ON public.local_media_channels(client_id, roi_rank NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_local_media_client_chinese
  ON public.local_media_channels(client_id, chinese_relevant)
  WHERE chinese_relevant = true;

CREATE INDEX IF NOT EXISTS idx_local_media_json
  ON public.local_media_channels USING GIN (channel_json);

COMMENT ON TABLE public.local_media_channels IS
  'me-client-discovery plugin + 未来司马徽 agent 发现的本地媒体/newsletter/社区渠道 · 诸葛亮 agent（Prescription 段）从此表选投放 · 详见 plugins/me-client-discovery/schemas/local-media-channel.schema.json';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. updated_at 触发器（3 张表共用）
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.discovery_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_competitor_snapshots_updated_at ON public.competitor_snapshots;
CREATE TRIGGER trg_competitor_snapshots_updated_at
  BEFORE UPDATE ON public.competitor_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.discovery_touch_updated_at();

DROP TRIGGER IF EXISTS trg_market_context_snapshots_updated_at ON public.market_context_snapshots;
CREATE TRIGGER trg_market_context_snapshots_updated_at
  BEFORE UPDATE ON public.market_context_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.discovery_touch_updated_at();

DROP TRIGGER IF EXISTS trg_local_media_channels_updated_at ON public.local_media_channels;
CREATE TRIGGER trg_local_media_channels_updated_at
  BEFORE UPDATE ON public.local_media_channels
  FOR EACH ROW EXECUTE FUNCTION public.discovery_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS · service_role_full 模板（CLAUDE.md 强约束）
-- ────────────────────────────────────────────────────────────────────────────
-- ME 的数据访问模型是 service-role + Bearer-token API（supabaseAdmin） ·
-- 从不走 end-user RLS · 所有新表一律用 service_role_full 模板 · 禁止引用
-- clients.workspace_id / client_team / auth.uid() / auth.jwt()
-- （2026-06-05 schema 漂移事故 · 13 处 · 19 客户 cron 全瘫的教训）

ALTER TABLE public.competitor_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.competitor_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.market_context_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.market_context_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.local_media_channels ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.local_media_channels FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Grant
-- ────────────────────────────────────────────────────────────────────────────

GRANT ALL ON public.competitor_snapshots TO service_role;
GRANT ALL ON public.market_context_snapshots TO service_role;
GRANT ALL ON public.local_media_channels TO service_role;

-- ============================================================================
-- End of migration
-- ============================================================================
