-- ============================================================================
-- 修好 mtc_deduct_atomic（自建立起从未成功执行过一次）
-- + 收回 4 个 SECURITY DEFINER 函数对匿名 / 登录用户的执行权
-- 2026-08-03
-- ============================================================================
--
-- 已于 2026-08-03 经 PM `go apply` 应用到生产，migration 版本
-- 20260803094500 / 20260803094900。本文件为归档，重复执行安全（幂等）。
--
--
-- ── 一、mtc_deduct_atomic 的两个 bug ────────────────────────────────────────
--
-- 20260626000006 引入这个函数，目的是把 MTC 扣费变成原子操作，消除
-- SELECT-then-UPDATE 的并发竞争。**它从上线那天起就没有成功执行过一次。**
-- 两个 bug 叠在一起，第二个被第一个挡住，说明作者从未真正运行过它。
--
-- bug ①（原第 13 行）—— 行锁与聚合写在同一句：
--
--     SELECT COALESCE(SUM(mtc_remaining), 0) INTO v_total_remaining
--       FROM mtc_purchases WHERE ... FOR UPDATE;
--
--   Postgres 不允许 FOR UPDATE 与聚合函数共存 → `0A000`。
--   任何调用者、任何入参，必炸。
--
-- bug ②（原第 42 行，修好 ① 之后才暴露）—— 类型不匹配：
--
--     mtc_ledger.reference_id 是 uuid，而 p_reference_id 是 text
--     → `42804 column "reference_id" is of type uuid but expression is of type text`
--
--   这是计划期错误，与传值无关（传 NULL 也一样炸）。
--
-- ── 实际影响 ───────────────────────────────────────────────────────────────
--
-- 金额没有出错。src/lib/mtc/deduct.ts:58 有兜底分支，RPC 一失败就回落到
-- 旧的非原子 JS 实现，5 周来 21 笔扣费全部由它完成，账目正确。
--
-- 但：
--   * Phase X.S6 M-1 声称修好的并发竞争 **一直是活的**（兜底分支自己的注释
--     就写着 "Documented race"）。
--   * deduct.ts:11-15 的注释写着「跑一周稳定后就可以删掉兜底」——
--     **真删了，MTC 扣费会全线中断。**
--   * 每次扣费都打一条 console.warn，5 周无人察觉。
--
-- 目前用量极低（30 天仅 1 笔扣费），实际撞上竞争的概率接近零，
-- 未发现任何账目损失。
--
-- ── 修法 ───────────────────────────────────────────────────────────────────
--
-- ① 先 PERFORM ... FOR UPDATE 锁行，再单独求和 —— 锁的语义与原意图一致。
-- ② INSERT 时 p_reference_id::uuid 转型。NULL 安全（唯一调用方
--    src/app/api/clients/[id]/ai-factory/fan-out/route.ts:124 不传该参数，
--    恒为 NULL）；合法 uuid 正常；非 uuid 字符串报错 —— 该列本就是 uuid。
--
-- 不改函数签名，避免连带失效下方的 REVOKE / GRANT。其余逻辑逐字未动。
--
-- ── 验证（真客户真扣，事务内跑完 ROLLBACK）─────────────────────────────────
--
--     扣前余额 500 → 函数返回 490 → 批次表实际 490 → 账本记 10 点  ✅
--     回滚后生产总余额仍为 5137、账本仍为 24 条，未被改动  ✅
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mtc_deduct_atomic(
  p_client_id uuid,
  p_service_key text,
  p_mtc_amount integer,
  p_reference_id text DEFAULT NULL::text,
  p_source text DEFAULT 'auto'::text,
  p_notes text DEFAULT NULL::text
)
RETURNS TABLE(ok boolean, ledger_entry_id uuid, balance_remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_remaining INTEGER;
  v_first_batch_id  UUID;
  v_ledger_id       UUID;
  v_to_consume      INTEGER;
  v_batch RECORD;
BEGIN
  IF p_mtc_amount <= 0 THEN
    RAISE EXCEPTION 'mtc_amount must be positive (got %)', p_mtc_amount;
  END IF;

  -- bug ① 修复：锁行与求和必须拆成两句。
  -- FOR UPDATE 不能和聚合函数写在一起（0A000）。
  PERFORM 1
    FROM mtc_purchases
   WHERE client_id  = p_client_id
     AND status     = 'completed'
     AND expires_at > NOW()
   FOR UPDATE;

  SELECT COALESCE(SUM(mtc_remaining), 0)
    INTO v_total_remaining
    FROM mtc_purchases
   WHERE client_id  = p_client_id
     AND status     = 'completed'
     AND expires_at > NOW();

  IF v_total_remaining < p_mtc_amount THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, v_total_remaining;
    RETURN;
  END IF;

  SELECT id INTO v_first_batch_id
    FROM mtc_purchases
   WHERE client_id  = p_client_id
     AND status     = 'completed'
     AND expires_at > NOW()
   ORDER BY expires_at ASC
   LIMIT 1;

  INSERT INTO mtc_ledger (
    client_id, purchase_id, direction, service_key,
    mtc_amount, reference_id, source, notes
  ) VALUES (
    p_client_id, v_first_batch_id, 'debit', p_service_key,
    p_mtc_amount, p_reference_id::uuid, p_source, p_notes   -- bug ② 修复：转型
  )
  RETURNING id INTO v_ledger_id;

  v_to_consume := p_mtc_amount;
  FOR v_batch IN
    SELECT id, mtc_remaining
      FROM mtc_purchases
     WHERE client_id  = p_client_id
       AND status     = 'completed'
       AND expires_at > NOW()
       AND mtc_remaining > 0
     ORDER BY expires_at ASC
  LOOP
    EXIT WHEN v_to_consume <= 0;
    DECLARE
      v_take INTEGER := LEAST(v_batch.mtc_remaining, v_to_consume);
    BEGIN
      UPDATE mtc_purchases
         SET mtc_remaining = mtc_remaining - v_take
       WHERE id = v_batch.id;
      v_to_consume := v_to_consume - v_take;
    END;
  END LOOP;

  RETURN QUERY SELECT TRUE, v_ledger_id, (v_total_remaining - p_mtc_amount);
END;
$function$;


-- ── 二、收回 4 个 SECURITY DEFINER 函数的对外执行权 ─────────────────────────
--
-- 这类函数以定义者身份运行、天生绕过 RLS，所以 20260803020716 那轮把 RLS
-- 收回 service_role 挡不住它们。实测匿名调用返回的是函数内部的业务错误
-- 而非权限拒绝 —— 证明确实可执行。
--
-- 全部调用方均为 supabaseAdmin(service_role)，收权不影响任何功能：
--   activate_geo_directive         src/app/api/clients/[id]/geo/[directiveId]/activate/route.ts:40
--   mtc_deduct_atomic              src/lib/mtc/deduct.ts:24
--   zhangqian_rate_limit_consume   src/lib/zhangqian/rate-limiter.ts:154
--   sync_execution_item_on_post_published
--       触发器函数（20260518000003 建的 trg_sync_execution_item_on_post_published），
--       本就不该经 /rest/v1/rpc 暴露。
--
-- 先从 PUBLIC 收 —— Postgres 建函数默认授予 PUBLIC，anon/authenticated 由此继承；
-- 再显式授回 service_role，否则服务端自己也会被一并收掉。

REVOKE EXECUTE ON FUNCTION public.activate_geo_directive(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.activate_geo_directive(uuid, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.mtc_deduct_atomic(uuid, text, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mtc_deduct_atomic(uuid, text, integer, text, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_execution_item_on_post_published()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_execution_item_on_post_published()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.zhangqian_rate_limit_consume(text, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.zhangqian_rate_limit_consume(text, text, timestamptz, integer)
  TO service_role;


-- ── 三、自检：任一条不通过则整体回滚 ───────────────────────────────────────

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('activate_geo_directive','mtc_deduct_atomic',
                       'sync_execution_item_on_post_published','zhangqian_rate_limit_consume')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF n <> 0 THEN
    RAISE EXCEPTION '仍有 % 个函数对 anon/authenticated 开放，已整体回滚', n;
  END IF;

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('activate_geo_directive','mtc_deduct_atomic',
                       'sync_execution_item_on_post_published','zhangqian_rate_limit_consume')
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF n <> 0 THEN
    RAISE EXCEPTION '有 % 个函数连 service_role 都被收掉了，已整体回滚', n;
  END IF;

  RAISE NOTICE '✅ mtc_deduct_atomic 已修复；4 个函数已收权，service_role 仍可执行';
END $$;


-- ── 回退 ───────────────────────────────────────────────────────────────────
-- 函数体：重新执行 20260626000006（但那是坏的，回退等于把 bug 装回去）。
-- 权限：GRANT EXECUTE ON FUNCTION <签名> TO anon, authenticated;
--       （不建议 —— 等于把 RPC 重新对外敞开）
