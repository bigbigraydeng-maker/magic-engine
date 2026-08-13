-- ============================================================================
-- Magic Engine 2.0 · kernel_record_fenced_deny 补一道决策指针 CAS（PR #961 Codex P2 整改）
--
-- 🔴 已合并进 main 的历史迁移一律不可变 —— `20260808000003_me2_execution_kernel_v1.sql`
--    在已经 apply 过它的环境里不会因为文件内容变化而重新执行；本迁移用
--    DROP + CREATE 把 `kernel_record_fenced_deny` 换成新签名，对「apply 过」
--    和「没 apply 过」的环境都生效。
--
-- 问题：approveRun 的失败分支（政策变了 / 超预算 / 契约升版……）最终都走
-- `recordFencedDeny`，它原来只校验 run 是否**仍然**停在 `pending_approval`，
-- 没有校验 `authorization_decision_id` 是否仍然等于审批人当时在页面上看到
-- 的那份请求。如果这段 preflight 期间同一个 run 已经被重新排成另一份
-- 待审批请求（状态仍是 pending_approval，只是指针换了），旧页面上的批准
-- 操作在失败分支里会把新请求直接覆盖成 denied —— 这不是本人要拒绝的那件事。
--
-- 修复：新增 `p_expected_decision_id`（可选，默认 NULL = 不做这道校验，
-- 兼容 authorizeRun 等本来就没有「审批人看到的那份」概念的调用方）。
-- 传了就必须跟 `kernel_resolve_pending_approval` 第 ③ 步一样，在同一把
-- 行锁里比对 run 当前的 `authorization_decision_id`。
-- ============================================================================

DROP FUNCTION IF EXISTS public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.kernel_record_fenced_deny(
  p_run_id                uuid,
  p_expected_generation   bigint,
  p_expected_status       text,
  p_decision              jsonb,
  p_reason                text,
  p_expected_decision_id  uuid DEFAULT NULL
)
RETURNS TABLE (ok boolean, reason text, decision_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run    public.action_runs%ROWTYPE;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::uuid; RETURN;
  END IF;

  -- 🔴 代际闸：过期的执行者不许把别人已经推进的 run 写成 denied。
  IF p_expected_generation IS NOT NULL
     AND v_run.claim_generation <> p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text, NULL::uuid;
    RETURN;
  END IF;

  -- 🔴 跨客户：决策必须属于这条 run 的客户，否则会往审计表里写一条串台的记录。
  --    kernel_ensure_run_steps 有这道闸，这里以前没有 —— 同一类漏洞要一起堵。
  IF (p_decision->>'client_id')::uuid IS DISTINCT FROM v_run.client_id THEN
    RETURN QUERY SELECT false, 'cross_client', NULL::uuid; RETURN;
  END IF;

  -- 状态闸（人工批准失败落地用）：只在仍停在那个状态时才写。
  IF p_expected_status IS NOT NULL AND v_run.status <> p_expected_status THEN
    RETURN QUERY SELECT false, 'not_' || p_expected_status || ':' || v_run.status, NULL::uuid;
    RETURN;
  END IF;

  -- 🔴 指针闸：run 当前指着的必须还是调用方（审批人）看到的那份请求 ——
  --    防止 preflight 期间它已经被重新排成另一份待审批请求，
  --    失败分支把新请求错误地覆盖成 denied。跟
  --    kernel_resolve_pending_approval 第 ③ 步同一道闸，NULL = 不检查。
  IF p_expected_decision_id IS NOT NULL
     AND v_run.authorization_decision_id IS DISTINCT FROM p_expected_decision_id THEN
    RETURN QUERY SELECT false, 'decision_not_current', NULL::uuid; RETURN;
  END IF;

  INSERT INTO public.authorization_decisions
    (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
     policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
     cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
  VALUES
    (v_run.id,
     (p_decision->>'client_id')::uuid,
     p_decision->>'action_key',
     (p_decision->>'action_version')::integer,
     'deny',
     p_decision->>'deny_code',
     p_reason,
     COALESCE(p_decision->'policy_snapshot', '{}'::jsonb),
     NULLIF(p_decision->>'policy_id','')::uuid,
     NULLIF(p_decision->>'policy_version','')::integer,
     COALESCE(p_decision->>'decided_by','policy'),
     NULLIF(p_decision->>'decided_by_user',''),
     NULLIF(p_decision->>'cost_cap_usd','')::numeric,
     NULLIF(p_decision->>'cost_estimate_usd','')::numeric,
     p_decision->>'idempotency_key',
     NULL)
  RETURNING id INTO v_new_id;

  UPDATE public.action_runs
     SET status = 'denied',
         authorization_decision_id = v_new_id,
         needs_human = true,
         last_error  = p_reason,
         finished_at = now(),
         updated_at  = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'denied', v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text, uuid)
  TO service_role;
