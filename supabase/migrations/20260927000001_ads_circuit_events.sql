-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。          ║
-- ║                                                                          ║
-- ║ WP3.1b 熔断事件账本：                                                     ║
-- ║   熔断器每一轮判定，五条判据各写一行（只插不改不删）。                      ║
-- ║   「为什么今天没出动作」「为什么自治被切回只观察」的唯一可查来源。          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ────────────────────────────────────────────────────────────────────────────
-- append-only 事件表
--
-- 🔴 为什么是 append-only 而不是「一个当前状态字段」：
--    熔断状态如果只存「现在是不是被熔断了」，那么「今天为什么不出动作」这个问题
--    在第二轮判定之后就永远查不回来了 —— 同一个坑本仓踩过：回执被重跑覆盖，
--    记下来的只剩最后一次尝试（memory feedback-receipt-overwritten-shows-last-attempt-not-first）。
--    所以这里每一轮每一条判据各留一行，谁也不覆盖谁。
--
-- 🔴 为什么没有 UNIQUE(client_id, occurred_on, trigger_code)：
--    同一天同一条判据**可以**被判多次（一天跑多轮、或人工补跑），每一次都是
--    一条独立事实。加唯一约束等于强迫后来的那次覆盖前一次，正是上面要防的事。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_circuit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  occurred_on  date NOT NULL,
  trigger_code text NOT NULL,
  outcome      text NOT NULL,
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ads_circuit_events_trigger_code_chk CHECK (
    trigger_code IN (
      'spend_spike',
      'account_over_daily_cap',
      'kernel_rollback_failed',
      'jev_low_scores',
      'data_incomplete'
    )
  ),
  CONSTRAINT ads_circuit_events_outcome_chk CHECK (
    outcome IN (
      'switched_to_observe',
      'frozen_for_day',
      'no_trigger',
      'unknown_data_partial'
    )
  )
);

-- 待办通道按「这个客户最近一轮」查，看板按日期倒序查 —— 同一个索引都能覆盖。
CREATE INDEX IF NOT EXISTS ads_circuit_events_client_day_idx
  ON public.ads_circuit_events (client_id, occurred_on DESC, created_at DESC);

ALTER TABLE public.ads_circuit_events ENABLE ROW LEVEL SECURITY;

-- 🔴 必须写 `TO service_role`。漏掉 TO 子句 = 这张表对匿名访客敞开读写
--    （2026-08-03 实测泄露 118 条策略）。照抄 ads_autonomy_sync_receipts 的形状。
DO $do$
BEGIN
  CREATE POLICY ads_circuit_events_service_role ON public.ads_circuit_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON TABLE public.ads_circuit_events IS 'append-only 熔断事件账本：熔断器每轮判定，五条判据各写一行。只插不改不删。';
COMMENT ON COLUMN public.ads_circuit_events.trigger_code IS '哪一条判据：spend_spike / account_over_daily_cap / kernel_rollback_failed / jev_low_scores / data_incomplete。';
COMMENT ON COLUMN public.ads_circuit_events.outcome IS 'switched_to_observe=切回只观察（前四条）/ frozen_for_day=当日冻结（第五条，次日自动恢复）/ no_trigger=没触发 / unknown_data_partial=数据不全，这一条本轮没判。';
COMMENT ON COLUMN public.ads_circuit_events.evidence IS '判定当时用到的数字，供人复核；形状随 trigger_code 不同。';

NOTIFY pgrst, 'reload schema';
