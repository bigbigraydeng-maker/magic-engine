-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。          ║
-- ║                                                                          ║
-- ║ 卫青巡察每天写一行「广告经营状态」（问题 + 机会 + 目标节奏），给看板和日报读。║
-- ║ payload 是 JSONB 全量，几个计数列提出来做索引/排序。                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.ads_growth_states (
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date                date NOT NULL,
  payload             jsonb NOT NULL,
  problems_count      integer NOT NULL DEFAULT 0,
  opportunities_count integer NOT NULL DEFAULT 0,
  goal_pace           jsonb,
  data_completeness   text NOT NULL DEFAULT 'complete',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, date)
);

DO $do$
BEGIN
  ALTER TABLE public.ads_growth_states
    ADD CONSTRAINT ads_growth_states_completeness_chk
    CHECK (data_completeness IN ('complete', 'partial'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

ALTER TABLE public.ads_growth_states ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  CREATE POLICY ads_growth_states_service_role ON public.ads_growth_states
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

CREATE INDEX IF NOT EXISTS ads_growth_states_client_date_idx
  ON public.ads_growth_states (client_id, date DESC);

COMMENT ON TABLE public.ads_growth_states IS '卫青巡察每天一行广告经营状态：问题 + 机会 + 目标节奏，供看板与日报读取。';
COMMENT ON COLUMN public.ads_growth_states.payload IS '当天广告经营状态全量 JSONB（问题、机会、目标节奏等原始结构）。';
COMMENT ON COLUMN public.ads_growth_states.goal_pace IS '目标节奏 JSONB：目标值、当前进度、节奏判断。';
COMMENT ON COLUMN public.ads_growth_states.data_completeness IS 'partial = 当天三级日数据或设置快照没拉全 → 只写诊断，不出机会、不提交任何动作。';

NOTIFY pgrst, 'reload schema';
