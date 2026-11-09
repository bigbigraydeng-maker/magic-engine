-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。          ║
-- ║                                                                          ║
-- ║ WP3.1a 自治开关同步：                                                     ║
-- ║   ad_strategy_configs.autonomy_mode（意向）                              ║
-- ║     → client_automation_policies.mode（Kernel 权威）                     ║
-- ║   单向同步。Kernel 一行不动，deny 永不覆盖。                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ────────────────────────────────────────────────────────────────────────────
-- 1. 意向侧：谁最后一次在 Settings 面板改了 autonomy_mode
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ad_strategy_configs
  ADD COLUMN IF NOT EXISTS autonomy_mode_updated_by text;

COMMENT ON COLUMN public.ad_strategy_configs.autonomy_mode_updated_by IS '谁最后一次在 Settings 面板改了 autonomy_mode 的邮箱。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. 同步回执：每次 worker 尝试同步写一行，便于排查「为什么没同步过去」
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_autonomy_sync_receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action_key         text NOT NULL,
  source_updated_at  timestamptz NOT NULL,
  from_mode          text,
  to_mode            text,
  skipped_reason     text,
  synced_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ads_autonomy_sync_receipts_client_key_idx
  ON public.ads_autonomy_sync_receipts (client_id, action_key, synced_at DESC);

ALTER TABLE public.ads_autonomy_sync_receipts ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  CREATE POLICY ads_autonomy_sync_receipts_service_role ON public.ads_autonomy_sync_receipts
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON TABLE public.ads_autonomy_sync_receipts IS '自治开关同步回执：worker 每次尝试把 autonomy_mode 同步到 Kernel 策略表都写一行。';
COMMENT ON COLUMN public.ads_autonomy_sync_receipts.skipped_reason IS '值域：NULL=写了 / ''already_synced'' / ''unchanged'' / ''locked_by_deny'' / ''sync_failed:<msg>''。';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. 同步 worker 唯一写策略表的入口
--
-- 🔴 为什么必须走函数而不是直接 UPDATE：
--    client_automation_policies 的「同一客户 + 同一动作只有一条未过期政策」
--    是**部分唯一索引**（WHERE effective_to IS NULL），所以 ON CONFLICT 用不了，
--    只能 SELECT 再 UPDATE / INSERT —— 这段竞态必须收在一个 SECURITY DEFINER
--    函数里，不能让 worker 自己拼。
--
-- 🔴 为什么 deny 永不覆盖：
--    deny 是管理员/熔断预留的硬闸。worker 只负责把「意向」翻译成
--    auto_approve / require_approval，一旦库里是 deny，worker 必须让路。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ads_sync_autonomy_policy(
  p_client_id  uuid,
  p_action_key text,
  p_mode       text,
  p_updated_by text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current text;
BEGIN
  -- deny 不是同步 worker 的目标态，传进来就是调用方写错了。
  IF p_mode NOT IN ('auto_approve','require_approval') THEN
    RAISE EXCEPTION 'ads_sync_autonomy_policy: mode % is not allowed (deny is never written by the sync worker)', p_mode;
  END IF;

  SELECT mode INTO v_current
    FROM public.client_automation_policies
   WHERE client_id = p_client_id
     AND action_key = p_action_key
     AND effective_to IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    -- spend_cap_per_run_usd = 1.00 固定小常数，只为绕开「NULL = 不许花钱」；
    -- 广告花费不走这一列。其余列用表默认。
    INSERT INTO public.client_automation_policies (
      client_id, action_key, mode, updated_by, spend_cap_per_run_usd
    ) VALUES (
      p_client_id, p_action_key, p_mode, p_updated_by, 1.00
    );
    RETURN 'inserted';
  END IF;

  -- deny 为管理员/熔断预留，worker 永不覆盖。
  IF v_current = 'deny' THEN
    RETURN 'locked_by_deny';
  END IF;

  -- 同值不 UPDATE，避免触发器无谓 policy_version+1 让在途授权作废。
  IF v_current = p_mode THEN
    RETURN 'unchanged';
  END IF;

  UPDATE public.client_automation_policies
     SET mode       = p_mode,
         updated_by = p_updated_by
   WHERE client_id = p_client_id
     AND action_key = p_action_key
     AND effective_to IS NULL
     AND mode <> 'deny';

  IF FOUND THEN
    RETURN 'updated';
  END IF;

  RETURN 'locked_by_deny';
END;
$$;

-- 🔴 SECURITY DEFINER 函数默认把 EXECUTE 授予 anon/authenticated，而 anon key
--    在浏览器 bundle 里 —— 不收口 = 任何人可经 PostgREST 改客户自治策略。
REVOKE EXECUTE ON FUNCTION public.ads_sync_autonomy_policy(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ads_sync_autonomy_policy(uuid, text, text, text) TO service_role;

COMMENT ON FUNCTION public.ads_sync_autonomy_policy(uuid, text, text, text) IS '同步 worker 唯一写策略表的入口；返回 inserted/updated/unchanged/locked_by_deny。';

NOTIFY pgrst, 'reload schema';
