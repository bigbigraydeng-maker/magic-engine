-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。          ║
-- ║                                                                          ║
-- ║ WP3 熔断器运行时调用方：                                                  ║
-- ║   client_automation_policies.mode 的 deny 档，此前在                     ║
-- ║   20260926000001_ads_autonomy_sync.sql 里被 ads_sync_autonomy_policy     ║
-- ║   显式排除（"deny 为未来管理员 / 熔断预留"）。本文件补上那个"未来"：       ║
-- ║   熔断器判定触发时写 deny，PM 核实无误后解除写回 require_approval。      ║
-- ║   两个函数都只认/只碰自己写的 deny（updated_by 前缀 circuit-breaker:），  ║
-- ║   管理员手动设的 deny 两个函数都不覆盖、不解除。                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ────────────────────────────────────────────────────────────────────────────
-- 1. 触发熔断：唯一允许把 mode 写成 'deny' 的入口
--
-- 🔴 为什么必须走函数：跟 ads_sync_autonomy_policy 同一个理由——
--    client_automation_policies 的部分唯一索引（WHERE effective_to IS NULL）
--    让 ON CONFLICT 用不了，SELECT 再 INSERT/UPDATE 这段竞态必须收在
--    SECURITY DEFINER 函数里。
--
-- 🔴 幂等：已经是本函数自己写的 deny（updated_by 前缀 circuit-breaker:）→
--    直接返回 already_tripped，不重复 UPDATE、不再次触发 policy_version+1
--    （不然每天熔断计算都在跑，会让在途授权反复作废）。
--
-- 🔴 不覆盖管理员的判断：当前是 deny 但不是本函数写的（人工设的）→
--    locked_by_other_deny，原样让路。熔断器只负责"我判定要熔断"，
--    不负责"覆盖别人已经决定的更严格状态"。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ads_trip_circuit_breaker_policy(
  p_client_id  uuid,
  p_action_key text,
  p_reason     text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_mode text;
  v_current_by   text;
  v_updated_by   text;
BEGIN
  v_updated_by := 'circuit-breaker:' || left(coalesce(p_reason, ''), 200) || ':' || now()::text;

  SELECT mode, updated_by INTO v_current_mode, v_current_by
    FROM public.client_automation_policies
   WHERE client_id = p_client_id
     AND action_key = p_action_key
     AND effective_to IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    -- spend_cap_per_run_usd = 1.00 固定小常数，跟 ads_sync_autonomy_policy 同一理由
    -- （绕开"NULL = 不许花钱"；广告花费不走这一列）。
    INSERT INTO public.client_automation_policies (
      client_id, action_key, mode, updated_by, spend_cap_per_run_usd
    ) VALUES (
      p_client_id, p_action_key, 'deny', v_updated_by, 1.00
    );
    RETURN 'tripped';
  END IF;

  IF v_current_mode = 'deny' AND v_current_by LIKE 'circuit-breaker:%' THEN
    RETURN 'already_tripped';
  END IF;

  IF v_current_mode = 'deny' THEN
    RETURN 'locked_by_other_deny';
  END IF;

  UPDATE public.client_automation_policies
     SET mode       = 'deny',
         updated_by = v_updated_by
   WHERE client_id = p_client_id
     AND action_key = p_action_key
     AND effective_to IS NULL;

  IF FOUND THEN
    RETURN 'tripped';
  END IF;

  -- 上面 SELECT 到行、这里 UPDATE 却 0 行：并发把这行 effective_to 掉了，极罕见，原样报告。
  RETURN 'race_lost';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ads_trip_circuit_breaker_policy(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ads_trip_circuit_breaker_policy(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.ads_trip_circuit_breaker_policy(uuid, text, text) IS
  '熔断器运行时调用方唯一写入口：把 (client_id, action_key) 的策略设为 deny。返回 tripped/already_tripped/locked_by_other_deny/race_lost。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. 解除熔断：唯一允许把熔断器自己写的 deny 解回 require_approval 的入口
--
-- 解到 require_approval（不是 auto_approve）——解除只是把安全阀放回"需要人批"，
-- 不是替 PM 决定恢复全自动；PM 要恢复 bounded_auto 得自己在 Settings 面板再拨一次，
-- 那条路径本来就有 ads_sync_autonomy_policy 接着。
--
-- 🔴 p_updated_by 由调用方（route）从 requireGlobalAdmin 的 email 拼，不接受
--    调用方直接传原始 email 字符串当身份来源——route 层负责拼审计标签，本函数
--    只管写。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ads_release_circuit_breaker_policy(
  p_client_id  uuid,
  p_action_key text,
  p_updated_by text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_mode text;
  v_current_by   text;
BEGIN
  SELECT mode, updated_by INTO v_current_mode, v_current_by
    FROM public.client_automation_policies
   WHERE client_id = p_client_id
     AND action_key = p_action_key
     AND effective_to IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'no_policy_row';
  END IF;

  IF NOT (v_current_mode = 'deny' AND v_current_by LIKE 'circuit-breaker:%') THEN
    RETURN 'not_circuit_tripped';
  END IF;

  UPDATE public.client_automation_policies
     SET mode       = 'require_approval',
         updated_by = p_updated_by
   WHERE client_id = p_client_id
     AND action_key = p_action_key
     AND effective_to IS NULL
     AND mode = 'deny';

  IF FOUND THEN
    RETURN 'released';
  END IF;

  RETURN 'race_lost';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ads_release_circuit_breaker_policy(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ads_release_circuit_breaker_policy(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.ads_release_circuit_breaker_policy(uuid, text, text) IS
  '熔断解除唯一写入口：只解除本机制自己写的 deny（updated_by 前缀 circuit-breaker:），解回 require_approval。管理员手动设的 deny 不碰。';

NOTIFY pgrst, 'reload schema';
