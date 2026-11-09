-- ============================================================================
-- Magic Engine 2.0 · Kernel 恢复白名单前向迁移（K-WP02 · 广告受限自治）
--
-- ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。
--
-- 🔴 已合并进 main 的历史迁移一律不可变 —— `20260808000003_me2_execution_kernel_v1.sql`
--    在已经 apply 过它的环境（开发 / 预览 / 更早启用的生产）里不会因为文件内容
--    变化而重新执行；直接改写那份历史文件只对「从未 apply 过」的环境生效，
--    已 apply 过的环境仍然停在旧白名单上，永远拿不到新行为。
--    同理，`20260811040000_kernel_recovery_outward_requires_human_policy.sql`
--    也已经合并进 main，不再改动。
--
-- 本迁移用 CREATE OR REPLACE FUNCTION 重新声明 `kernel_claim_run_recovery`——
-- 不管目标环境有没有 apply 过前面那两份迁移，这条语句都会把函数体换成
-- 最新版本。函数体与 20260811040000 里的版本逐字相同，唯一改动是
-- `v_recoverable` 白名单新增一个码：`outside_autonomy_envelope`
-- （广告受限自治：这一次的改动越出信封 / 信封事实读不到。PM 调高日预算上限、
--   过了 72 小时冷却、或单位退出学习期之后，同一件事理应能做 —— 所以它是
--   环境类、可恢复的。结构性的 `outward_side_effect_blocked` 不在此列 ——
--   动作定义本身不合规，改条件救不了，故意留在白名单外）。
--
-- 见 src/lib/kernel/runner.ts 的 RECOVERABLE_DENY_CODES ——
-- 架构测试盯着两边一字不差（src/lib/kernel/__tests__/architecture.test.ts）。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kernel_claim_run_recovery(
  p_run_id               uuid,
  p_expected_decision_id uuid,
  p_recovery_kind        text,     -- 'denied' | 'dead_letter'
  p_actor                text,
  p_reason               text
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      public.action_runs%ROWTYPE;
  v_decision public.authorization_decisions%ROWTYPE;
  -- 🔴 可恢复的拒绝码白名单。必须跟 runner.ts 的 RECOVERABLE_DENY_CODES 一字不差，
  --    有一条架构测试专门盯着两边不许分家（两处各写一份清单必然分家）。
  v_recoverable text[] := ARRAY[
    -- 客户还没配规则 —— 配好就能做
    'no_policy',
    -- 广告受限自治：这一次的改动越出信封 / 信封事实读不到 ——
    -- 调高日预算上限、过 72 小时冷却、退出学习期之后同一件事就能做
    'outside_autonomy_envelope',
    -- 对外动作被配成「自动执行」= 规则配错了，改成「要审批」之后同一件事就能做。
    -- 🔴 结构性的 outward_side_effect_blocked 不在此列（动作定义本身不合规，改条件救不了）。
    'outward_requires_human_policy',
    -- 这一次的估算超过单次花费上限 —— 上限提高就能做
    'over_cost_cap',
    -- 提交之后规则被改过 —— 重新授权即可
    'policy_changed_since_request',
    -- 规则过了有效期 —— 续期即可
    'policy_expired'
  ];
BEGIN
  IF p_recovery_kind NOT IN ('denied', 'dead_letter') THEN
    RETURN QUERY SELECT false, 'bad_recovery_kind'; RETURN;
  END IF;

  -- ① 锁 run —— 两次恢复、以及恢复与正常执行，全在这把锁上排队
  SELECT * INTO v_run FROM public.action_runs
   WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found'; RETURN;
  END IF;

  -- ② 状态 CAS：必须**仍然**停在那个可恢复的终态。
  --    running / succeeded / 已被别人恢复成 queued 的，一律不许覆盖。
  IF v_run.status <> p_recovery_kind THEN
    RETURN QUERY SELECT false, 'not_recoverable:' || v_run.status; RETURN;
  END IF;

  -- ③ 指针 CAS：run 当前指着的必须还是调用方看到的那条决策
  --    （防拿旧页面 / 旧快照上的过期决策来恢复）
  IF v_run.authorization_decision_id IS DISTINCT FROM p_expected_decision_id THEN
    RETURN QUERY SELECT false, 'decision_not_current'; RETURN;
  END IF;

  IF p_expected_decision_id IS NOT NULL THEN
    SELECT * INTO v_decision FROM public.authorization_decisions
     WHERE id = p_expected_decision_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'decision_not_found'; RETURN;
    END IF;
    IF v_decision.action_run_id <> v_run.id THEN
      RETURN QUERY SELECT false, 'decision_run_mismatch'; RETURN;
    END IF;
  END IF;

  -- ④ denied 恢复：只能恢复**机器**因环境问题拒掉的那几种。
  IF p_recovery_kind = 'denied' THEN
    IF p_expected_decision_id IS NULL THEN
      RETURN QUERY SELECT false, 'deny_decision_missing'; RETURN;
    END IF;
    IF v_decision.verdict <> 'deny' THEN
      RETURN QUERY SELECT false, 'not_a_deny'; RETURN;
    END IF;
    -- 🔴 人明确点过「不做」的永远不可恢复 —— 系统不替人改主意
    IF v_decision.decided_by = 'human' THEN
      RETURN QUERY SELECT false, 'human_reject_not_recoverable'; RETURN;
    END IF;
    IF v_decision.deny_code IS NULL OR NOT (v_decision.deny_code = ANY(v_recoverable)) THEN
      RETURN QUERY SELECT false,
        'deny_code_not_recoverable:' || COALESCE(v_decision.deny_code, 'null'); RETURN;
    END IF;
  END IF;

  -- ⑤ 步骤重置与状态转换在**同一个事务**里。
  --    只碰没跑成的那些；cost_actual_usd / output / verification 一概不动。
  -- 🔴 F1：恢复同样是**换人**，代际必须 +1 并推到所有步骤上。
  --    不推的话，恢复之前那个执行者醒过来还能拿着旧 step_id 写进来。
  --    已成功的步骤也要推代际（否则旧执行者能把它改回失败），
  --    但它们的 status / output / cost 一概不动。
  UPDATE public.action_run_steps
     SET status          = CASE WHEN status <> 'succeeded' THEN 'pending' ELSE status END,
         last_error      = CASE WHEN status <> 'succeeded' THEN NULL ELSE last_error END,
         next_attempt_at = CASE WHEN status <> 'succeeded' THEN NULL ELSE next_attempt_at END,
         finished_at     = CASE WHEN status <> 'succeeded' THEN NULL ELSE finished_at END,
         claim_generation = v_run.claim_generation + 1,
         updated_at      = now()
   WHERE run_id = v_run.id;

  UPDATE public.action_runs
     SET status = 'queued',
         authorization_decision_id = NULL,
         needs_human = false,
         last_error  = NULL,
         finished_at = NULL,
         -- 🔴 T1：放回 queued 的同时**把租约清干净**。
         --    恢复只是把这件事重新变成「可做」，并不代表恢复的那个进程
         --    一定能活到把它跑完 —— 恢复提交之后、重新授权之前崩掉，
         --    留着旧 owner 会让这条 run 再也没人接得走。
         --    清空之后它就是一条无主的 queued，谁先领租约谁推进。
         claimed_by       = NULL,
         claimed_at       = NULL,
         heartbeat_at     = NULL,
         lease_expires_at = NULL,
         -- 🔴 F1：恢复是**换人**，代际必须 +1（上面已经把它推到所有步骤上了）。
         --    不换代的话，恢复之前那个执行者醒过来还能继续写。
         claim_generation = claim_generation + 1,
         evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
           'last_recovered_by',        p_actor,
           'last_recovered_at',        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'recovery_reason',          p_reason,
           'recovery_kind',            p_recovery_kind,
           'recovered_from_deny_code', COALESCE(v_decision.deny_code, NULL)
         ),
         updated_at = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'claimed';
END;
$$;

-- 🔴 REVOKE/GRANT 是幂等的，每次 apply 都重新声明一遍，跟历史迁移里的授权
--    保持一致 —— 不依赖它们之前有没有被执行过。
REVOKE EXECUTE ON FUNCTION public.kernel_claim_run_recovery(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_claim_run_recovery(uuid, uuid, text, text, text)
  TO service_role;
