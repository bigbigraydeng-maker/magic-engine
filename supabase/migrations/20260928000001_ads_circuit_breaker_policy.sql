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
-- 1. 触发熔断：唯一允许把 mode 写成 'deny' 的入口——一次调用把全部 ads.* 键
--    一起收进同一个事务
--
-- 🔴 为什么必须走函数：跟 ads_sync_autonomy_policy 同一个理由——
--    client_automation_policies 的部分唯一索引（WHERE effective_to IS NULL）
--    让 ON CONFLICT 用不了，SELECT 再 INSERT/UPDATE 这段竞态必须收在
--    SECURITY DEFINER 函数里。
--
-- 🔴 Codex P1 复审：为什么是一次调用传全部键的数组，不是调用方逐键循环
--    调用单键函数——一个客户的 ads.* 动作键不止一个（listAdsActionKeys()
--    动态读注册表），逐键循环调用意味着每次 RPC 各自独立提交：前面几个键
--    已经落地 deny，若某个靠后的键命中 race_lost，调用方只能整体重试
--    （Inngest retries），但已经成功的键在重试时只是幂等空转，真正卡住的
--    是那一个键——如果重试也持续失败（罕见但不是不可能：另一个并发写手
--    反复抢在这个键前面），重试耗尽后函数进 Inngest 失败态，此时"已经确认
--    异常花费"但只有部分键落了 deny，其余键仍是 auto_approve，真钱动作
--    照样能走。改成整个批次收在一个 PL/pgSQL 函数体里——任一键 race_lost
--    就 RAISE EXCEPTION，Postgres 自动回滚这次函数调用里全部已做的
--    INSERT/UPDATE，不会遗留"部分键已经 deny、部分还没"的中间态；Inngest
--    重试的是这一整批，要么全部成功要么完全不落地，不会有第三种状态。
--
-- 🔴 幂等但不冻结展示信息：已经是本函数自己写的 deny（updated_by 前缀
--    circuit-breaker:）→ 该键记 already_tripped，mode 不重复 UPDATE，但
--    updated_by 会刷新成这次评估的最新原因/触发账户（round 8 修正：只改
--    updated_by 不会碰 policy_version——见下方函数体注释，之前完全不刷新
--    是对 version_guard 触发器范围的误判）。
--
-- 🔴 不覆盖管理员的判断：当前是 deny 但不是本函数写的（人工设的）→
--    该键记 locked_by_other_deny，原样让路。熔断器只负责"我判定要熔断"，
--    不负责"覆盖别人已经决定的更严格状态"——这个结果不算失败，不触发回滚。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ads_trip_circuit_breaker_policy_batch(
  p_client_id   uuid,
  p_action_keys text[],
  p_reason      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_by   text;
  v_action_key   text;
  v_current_mode text;
  v_current_by   text;
  v_outcome      text;
  v_outcomes     jsonb := '[]'::jsonb;
BEGIN
  IF p_action_keys IS NULL OR array_length(p_action_keys, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_updated_by := 'circuit-breaker:' || left(coalesce(p_reason, ''), 200) || ':' || now()::text;

  FOREACH v_action_key IN ARRAY p_action_keys LOOP
    SELECT mode, updated_by INTO v_current_mode, v_current_by
      FROM public.client_automation_policies
     WHERE client_id = p_client_id
       AND action_key = v_action_key
       AND effective_to IS NULL
     LIMIT 1;

    IF NOT FOUND THEN
      -- spend_cap_per_run_usd = 1.00 固定小常数，跟 ads_sync_autonomy_policy 同一理由
      -- （绕开"NULL = 不许花钱"；广告花费不走这一列）。
      INSERT INTO public.client_automation_policies (
        client_id, action_key, mode, updated_by, spend_cap_per_run_usd
      ) VALUES (
        p_client_id, v_action_key, 'deny', v_updated_by, 1.00
      );
      v_outcome := 'tripped';

    ELSIF v_current_mode = 'deny' AND v_current_by LIKE 'circuit-breaker:%' THEN
      -- 🔴 Codex P2 复审（round 8）：已经是 deny 也要刷新 updated_by 到这次的
      -- 最新原因/账户，不能让第一次触发的账户信息冻结不变——账户 A 先触发、
      -- 账户 B 后来才出问题时，pm-todo 从 updated_by 里抠触发账户给 PM 看
      -- （见 pm-todo/ads-autonomy-items.ts 的 extractTriggeringAccount），旧值
      -- 冻结会一直让 PM 只查 A、不知道要看 B。之前不刷新是怕重复触发
      -- policy_version+1（原注释），但 version_guard 触发器明确把 updated_by
      -- 排除在"授权相关字段"之外（20260808000003_me2_execution_kernel_v1.sql:
      -- 118-132），只改这一列不会 bump 版本，这层顾虑本来就是可以避开的。
      -- WHERE 重申 SELECT 确认过的条件——刷新是纯展示信息，并发丢了这次刷新
      -- 不影响任何判定，不用回滚整批，下一轮评估会再刷新一次。
      UPDATE public.client_automation_policies
         SET updated_by = v_updated_by
       WHERE client_id = p_client_id
         AND action_key = v_action_key
         AND effective_to IS NULL
         AND mode = 'deny'
         AND updated_by LIKE 'circuit-breaker:%';
      v_outcome := 'already_tripped';

    ELSIF v_current_mode = 'deny' THEN
      v_outcome := 'locked_by_other_deny';

    ELSE
      -- 🔴 WHERE 重申 SELECT 已经确认过的 mode <> 'deny'，不能只靠上面的分支——
      -- 否则 SELECT 确认"当前不是 deny"之后、UPDATE 真正执行之前，如果管理员
      -- 并发把这一行设成人工 deny，这条 UPDATE 会照样命中，把 updated_by 覆盖
      -- 成 circuit-breaker:...，让后续 release 函数误以为这是熔断器自己设的、
      -- 能被自动解除——审计痕迹被冲掉，管理员的硬锁被悄悄接管。
      UPDATE public.client_automation_policies
         SET mode       = 'deny',
             updated_by = v_updated_by
       WHERE client_id = p_client_id
         AND action_key = v_action_key
         AND effective_to IS NULL
         AND mode <> 'deny';

      IF FOUND THEN
        v_outcome := 'tripped';
      ELSE
        -- 上面 SELECT 到行、这里 UPDATE 却 0 行：并发把这行改成了 deny（管理员
        -- 抢先，或另一次熔断计算先落地）或 effective_to 掉了，极罕见。整批回滚
        -- ——不留"这个键 deny 了、后面的键还没轮到"的中间态，调用方按失败重试
        -- 整批，已经成功的键在下一次调用里幂等空转，不会被重复计费或多算。
        RAISE EXCEPTION 'ads_trip_circuit_breaker_policy_batch: race_lost on action_key % for client %', v_action_key, p_client_id;
      END IF;
    END IF;

    v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object('key', v_action_key, 'outcome', v_outcome));
  END LOOP;

  RETURN v_outcomes;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ads_trip_circuit_breaker_policy_batch(uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ads_trip_circuit_breaker_policy_batch(uuid, text[], text) TO service_role;

COMMENT ON FUNCTION public.ads_trip_circuit_breaker_policy_batch(uuid, text[], text) IS
  '熔断器运行时调用方唯一写入口：一次事务把 (client_id, 全部 action_key) 的策略设为 deny，任一键 race_lost 就整批回滚。返回 jsonb 数组 [{key,outcome}]，outcome ∈ tripped/already_tripped/locked_by_other_deny。';

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

  -- 🔴 Codex P2 复审：UPDATE 的 WHERE 必须跟上面 SELECT 检查的条件完全一致
  -- （包含 updated_by），不能只查 mode = 'deny'——否则 SELECT 确认"这是熔断器
  -- 自己设的 deny"之后、UPDATE 真正执行之前，如果有管理员并发把这一行改成
  -- 人工 deny（换了原因），这条 UPDATE 只看 mode = 'deny' 还是会命中，把人工
  -- 刚设的硬锁当成熔断器的旧 deny 解掉。
  UPDATE public.client_automation_policies
     SET mode       = 'require_approval',
         updated_by = p_updated_by
   WHERE client_id = p_client_id
     AND action_key = p_action_key
     AND effective_to IS NULL
     AND mode = 'deny'
     AND updated_by LIKE 'circuit-breaker:%';

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
