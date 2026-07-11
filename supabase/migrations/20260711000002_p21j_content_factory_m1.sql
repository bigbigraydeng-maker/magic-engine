-- ============================================================================
-- P21.J M1 · Content Factory foundation (Meta Ads creative closed loop)
-- Spec: docs/superpowers/specs/2026-07-11-content-factory-ads-loop-v0.1.md §4
--
-- 7 tables + clients.brand_redline_phrases + claim RPC + storage bucket.
-- RLS: service-role only (ME accesses via supabaseAdmin; no end-user Auth).
-- 🔴 PM 拍板后才 apply,worker 严禁自行 apply_migration。
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- §4.1 content_demand_signals — 信号落库
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_demand_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id),
  signal_type   text NOT NULL CHECK (signal_type IN
                  ('creative_fatigue','scale_winner','new_campaign','asset_gap')),
  source        text NOT NULL DEFAULT 'cts-meta-ads-operator',
  dedupe_key    text,
  confidence    numeric,
  evidence      jsonb NOT NULL DEFAULT '{}',
  request       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'received' CHECK (status IN
                  ('received','evaluating','accepted','rejected','expired')),
  reject_reason text,
  work_order_id uuid,            -- 接受后回填
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cds_dedupe
  ON public.content_demand_signals(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cds_client_status
  ON public.content_demand_signals(client_id, status);

ALTER TABLE public.content_demand_signals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.content_demand_signals FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- §4.2 video_clips — ① Clip 库(视频原子素材,A/B 轨物理分离)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_clips (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES public.clients(id),
  title               text,
  scene_tag           text NOT NULL,
  motion_type         text,
  duration_seconds    numeric NOT NULL,
  track               text NOT NULL CHECK (track IN ('a_real','b_generated')),
  source_meta         jsonb NOT NULL DEFAULT '{}',
  storage_url         text NOT NULL,
  aspect_ratio        text NOT NULL DEFAULT '9:16',
  usage_count         int NOT NULL DEFAULT 0,
  last_used_at        timestamptz,
  generation_cost_usd numeric NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','archived','quarantined')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vc_pick
  ON public.video_clips(client_id, scene_tag, track, status);

ALTER TABLE public.video_clips ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.video_clips FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- §4.3 winner_structures — ② Winner 结构库(hook/middle/CTA 骨架 + 表现数据)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.winner_structures (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES public.clients(id),
  source_ad_id         text,
  source_work_order_id uuid,
  entry_channel        text NOT NULL DEFAULT 'auto'
                         CHECK (entry_channel IN ('auto','manual_intake')),
  hook_segment         jsonb NOT NULL,
  middle_segment       jsonb NOT NULL,
  cta_segment          jsonb NOT NULL,
  win_reason_tags      text[] NOT NULL DEFAULT '{}',
  performance          jsonb NOT NULL DEFAULT '{}',
  cost_per_thruplay    numeric,
  ctr                  numeric,
  budget_share_pct     numeric,
  current_frequency    numeric,
  times_reused         int NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','fatigued','retired')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ws_pick
  ON public.winner_structures(client_id, status, cost_per_thruplay);

ALTER TABLE public.winner_structures ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.winner_structures FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- §4.4 content_work_orders — 工单(兼 job queue)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_work_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id),
  signal_id             uuid REFERENCES public.content_demand_signals(id),
  goal_id               uuid NOT NULL REFERENCES public.goals(id),
  master_brief_id       uuid NOT NULL REFERENCES public.master_briefs(id),
  winner_structure_id   uuid REFERENCES public.winner_structures(id),
  order_type            text NOT NULL CHECK (order_type IN
                          ('variant_from_winner','fresh_angle','clip_generation')),
  angle                 text NOT NULL,
  angle_source          jsonb NOT NULL,
  rationale_one_liner   text NOT NULL,
  brief                 jsonb NOT NULL,
  budget_cap_usd        numeric NOT NULL DEFAULT 2.00,
  actual_cost_usd       numeric NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'queued' CHECK (status IN
                          ('queued','claimed','producing','rendered','in_review',
                           'review_rejected','approved','publishing','publish_failed',
                           'published','measuring','closed','failed','dead_letter',
                           'archived','superseded')),
  claimed_by            text,
  claimed_at            timestamptz,
  heartbeat_at          timestamptz,
  attempt_count         smallint NOT NULL DEFAULT 0,
  reclaim_count         smallint NOT NULL DEFAULT 0,
  max_attempts          smallint NOT NULL DEFAULT 2,
  publish_attempt_count smallint NOT NULL DEFAULT 0,
  output                jsonb NOT NULL DEFAULT '{}',
  review_ref            jsonb NOT NULL DEFAULT '{}',
  reject_category       text CHECK (reject_category IN
                          ('brand_redline','quality','wrong_angle','budget','other')),
  reject_reason         text,
  published_ad_id       text,
  source_ad_id          text,  -- 触发信号的 evidence.ad_id 冗余(护栏 11 语义去重直查本表,魏征 M1-F2)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cwo_queue  ON public.content_work_orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_cwo_client ON public.content_work_orders(client_id, status);
CREATE INDEX IF NOT EXISTS idx_cwo_source_ad ON public.content_work_orders(client_id, source_ad_id)
  WHERE source_ad_id IS NOT NULL;

ALTER TABLE public.content_work_orders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.content_work_orders FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- signals.work_order_id 的回填 FK(信号表先建,此处补约束)
DO $$ BEGIN
  ALTER TABLE public.content_demand_signals
    ADD CONSTRAINT fk_cds_work_order
    FOREIGN KEY (work_order_id) REFERENCES public.content_work_orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- §4.5 content_work_order_clips — 工单 ↔ clip 关联
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_work_order_clips (
  work_order_id uuid NOT NULL REFERENCES public.content_work_orders(id) ON DELETE CASCADE,
  clip_id       uuid NOT NULL REFERENCES public.video_clips(id),
  segment_role  text NOT NULL CHECK (segment_role IN ('hook','middle','cta')),
  position      smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (work_order_id, clip_id, segment_role)
);

ALTER TABLE public.content_work_order_clips ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.content_work_order_clips FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- §4.6a factory_angle_blocklist — 角度负面清单(红线类 permanent 永不过期)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.factory_angle_blocklist (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES public.clients(id),
  angle                text NOT NULL,
  reason               text,
  source_work_order_id uuid,
  permanent            boolean NOT NULL DEFAULT false,
  expires_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fab_client ON public.factory_angle_blocklist(client_id, angle);

ALTER TABLE public.factory_angle_blocklist ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.factory_angle_blocklist FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- §4.6b factory_balance_ledger — muapi 成本记账(护栏 10 余额停机的事实源)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.factory_balance_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type    text NOT NULL CHECK (entry_type IN ('topup','spend','adjustment')),
  amount_usd    numeric NOT NULL,      -- topup 正数, spend 负数
  work_order_id uuid,
  clip_id       uuid,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.factory_balance_ledger ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.factory_balance_ledger FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- §4.6c clients.brand_redline_phrases — 品牌红线库(闸 1 副闸数据源)
--        seed CTS 已知红线(来源: agent memory「CTS 1928 vs NZ 25 年」)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS brand_redline_phrases text[] NOT NULL DEFAULT '{}';

UPDATE public.clients
SET brand_redline_phrases = ARRAY[
  'Auckland since 1928',
  'NZ since 1928',
  'New Zealand since 1928'
]
WHERE id = 'c0000000-0000-0000-0000-000000000000'
  AND brand_redline_phrases = '{}';

-- 客户级工厂配置(附录 A: PM 显式接受风险,CTS 放开 B 轨地标进广告;他客默认收紧)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS factory_config jsonb NOT NULL DEFAULT '{}';

UPDATE public.clients
SET factory_config = jsonb_set(factory_config, '{allow_b_track_landmark_ads}', 'true')
WHERE id = 'c0000000-0000-0000-0000-000000000000';

-- ────────────────────────────────────────────────────────────────────────────
-- §4.6d factory_claim_work_order — 原子认领 RPC(魏征 F13)
--        FOR UPDATE SKIP LOCKED,杜绝「先 SELECT 再 UPDATE」竞态。
--        Pattern: 20260626000006_mtc_atomic_deduct_rpc.sql
-- ────────────────────────────────────────────────────────────────────────────
-- p_client_ids: worker 客户白名单(spec §6.1 F9 收权;NULL = 不限,魏征 M1-F7 一次拍板避免二轮 migration)
CREATE OR REPLACE FUNCTION public.factory_claim_work_order(
  p_worker_id  text,
  p_client_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  ok            boolean,
  work_order_id uuid,
  client_id     uuid,
  brief         jsonb,
  budget_cap_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT cwo.id, cwo.client_id, cwo.brief, cwo.budget_cap_usd
    INTO v_order
    FROM public.content_work_orders cwo
   WHERE cwo.status = 'queued'
     AND (p_client_ids IS NULL OR cwo.client_id = ANY(p_client_ids))
   ORDER BY cwo.created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_order.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::numeric;
    RETURN;
  END IF;

  UPDATE public.content_work_orders
     SET status       = 'claimed',
         claimed_by   = p_worker_id,
         claimed_at   = now(),
         heartbeat_at = now(),
         updated_at   = now()
   WHERE id = v_order.id;

  RETURN QUERY SELECT true, v_order.id, v_order.client_id, v_order.brief, v_order.budget_cap_usd;
END;
$$;

-- 🔴 权限收口(魏征 M1-F1 P0):SECURITY DEFINER 函数默认 EXECUTE 授予 anon/authenticated,
-- anon key 在浏览器 bundle 里 —— 不收口 = 任何人可经 PostgREST 认领工单并读走 brief。
REVOKE EXECUTE ON FUNCTION public.factory_claim_work_order(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.factory_claim_work_order(text, uuid[]) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- §4.6e factory_balance_usd — 余额聚合 RPC(护栏 10;魏征 M1-F9:
--        JS 全表 select 有 1000 行静默截断,聚合必须发生在 SQL 层)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.factory_balance_usd()
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount_usd), 0) FROM public.factory_balance_ledger;
$$;

REVOKE EXECUTE ON FUNCTION public.factory_balance_usd() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.factory_balance_usd() TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- §4.7 Storage bucket: content-factory(公开读;路径前缀做 A/B 轨物理分离)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('content-factory', 'content-factory', true)
ON CONFLICT (id) DO NOTHING;
