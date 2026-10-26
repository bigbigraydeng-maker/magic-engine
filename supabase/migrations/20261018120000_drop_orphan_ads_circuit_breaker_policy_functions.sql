-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ 删除两个孤立的熔断策略函数（2026-10-18，PM 说「删」，应用需 PM 另点头）  ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
--
-- 背景：生产库里有一份 9-28 应用的迁移（ads_circuit_breaker_policy），带出两个
-- SECURITY DEFINER 函数，能往 client_automation_policies 里写/解 deny 策略。
-- 迁移文件与调用它们的代码只存在于已关闭的 PR 2019 分支，主干没有；
-- 2026-10-18 核实无人调用（主干零引用、库内无别的函数/视图依赖、
-- 它们写过的策略行 = 0 条），熔断的现行设计是 ads_circuit_events（v2），与它们互斥。
-- 台账：docs/ledger/2026-10-18-prod-migration-applied-but-file-only-on-closed-pr.md
--
-- 只删这两个函数。不碰：
--   · client_automation_policies 表及其 version_guard 触发器（表的，不是函数的）
--   · ads_circuit_events 表及其 append-only 触发器函数
--   · supabase_migrations 里那条历史记录（历史不改写）

-- 🔴 安全闸：如果库里已经有它们写过的 deny 行（updated_by 以 circuit-breaker: 开头），
--    删掉 release 函数就没有现成办法解除了 —— 此时中止，不是静默继续。
DO $$
DECLARE
  v_stranded integer;
BEGIN
  SELECT count(*) INTO v_stranded
    FROM public.client_automation_policies
   WHERE updated_by LIKE 'circuit-breaker:%';
  IF v_stranded > 0 THEN
    RAISE EXCEPTION
      'abort: % policy row(s) written by the circuit-breaker functions still exist; release them first',
      v_stranded;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.ads_trip_circuit_breaker_policy_batch(uuid, text[], text);
DROP FUNCTION IF EXISTS public.ads_release_circuit_breaker_policy(uuid, text, text);
