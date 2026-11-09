#!/bin/bash
# =============================================================================
# 在真 postgres 上断言 GEO 预算账本 RPC 的行为（#1347）
#
# 为什么要这个:魏征复审 #3 —— 假件的 JS 单线程模拟不了 postgres 行锁,反转 SQL 判据
#   不会让任何测试变红。本脚本把 migration 应用到一次性库,用真 SQL 断言 reserve/settle/
#   幂等/回收/权限,任何一条不符即非零退出。反转 migration 判据 → 本脚本红。
#
# 用法(本机 brew postgresql@17):  bash scripts/geo-budget-ledger-check.sh
# =============================================================================
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
export LC_ALL="${LC_ALL:-en_US.UTF-8}" LANG="${LANG:-en_US.UTF-8}"
DB="${DB:-me_geo_budget_check}"
MIG="supabase/migrations/20260904000001_geo_client_budget_ledger_v1.sql"

dropdb --if-exists "$DB" 2>/dev/null || true
createdb "$DB"
trap 'dropdb --if-exists "$DB" 2>/dev/null || true' EXIT
P=(psql -v ON_ERROR_STOP=1 -q -d "$DB")

echo "==> 造角色桩 + auth schema"
"${P[@]}" <<'SQL'
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
alter default privileges in schema public grant execute on functions to anon, authenticated;
SQL

echo "==> 应用 migration"
"${P[@]}" -f "$MIG"

echo "==> 行为断言（任一不符即抛错退出）"
"${P[@]}" <<'SQL'
\set C '''c0000000-0000-0000-0000-000000000000'''
\set D '''d0000000-0000-0000-0000-000000000000'''
INSERT INTO public.geo_client_budgets (client_id, period_key, cap_usd) VALUES (:C,'2026-09',2.0);

DO $$
DECLARE r jsonb; b public.geo_client_budgets%ROWTYPE;
BEGIN
  -- 预留1 $1.8 应成功、剩 0.2
  r := public.geo_reserve_budget_v1('batch-a','c0000000-0000-0000-0000-000000000000','2026-09',1.8);
  IF (r->>'reserved')::bool IS NOT TRUE OR (r->>'remaining_usd')::numeric <> 0.2 THEN
    RAISE EXCEPTION '预留1 期望 reserved+remaining0.2, 实得 %', r; END IF;

  -- 预留2 别的批次 $1.8 应被拒(insufficient) —— 不双花
  r := public.geo_reserve_budget_v1('batch-b','c0000000-0000-0000-0000-000000000000','2026-09',1.8);
  IF (r->>'reserved')::bool IS NOT FALSE OR r->>'reason' <> 'insufficient' THEN
    RAISE EXCEPTION '预留2 期望 insufficient, 实得 %', r; END IF;

  -- 幂等:同一批次 batch-a 再 reserve → idempotent, reserved 不翻倍
  r := public.geo_reserve_budget_v1('batch-a','c0000000-0000-0000-0000-000000000000','2026-09',1.8);
  IF (r->>'idempotent')::bool IS NOT TRUE THEN RAISE EXCEPTION '重复reserve 期望 idempotent, 实得 %', r; END IF;
  SELECT * INTO b FROM public.geo_client_budgets WHERE client_id='c0000000-0000-0000-0000-000000000000';
  IF b.reserved_usd <> 1.8 THEN RAISE EXCEPTION '重复reserve 后 reserved 应仍=1.8, 实得 %', b.reserved_usd; END IF;

  -- 没批额度的客户 → no_budget_row (fail-closed)
  r := public.geo_reserve_budget_v1('batch-x','d0000000-0000-0000-0000-000000000000','2026-09',0.5);
  IF r->>'reason' <> 'no_budget_row' THEN RAISE EXCEPTION '无额度 期望 no_budget_row, 实得 %', r; END IF;

  -- worst_case ≤0 → invalid_worst_case
  r := public.geo_reserve_budget_v1('batch-z','c0000000-0000-0000-0000-000000000000','2026-09',0);
  IF r->>'reason' <> 'invalid_worst_case' THEN RAISE EXCEPTION '0额度 期望 invalid_worst_case, 实得 %', r; END IF;

  -- 结算 batch-a: 最坏1.8 实际0.63 → 扣0.63, reserved回0
  r := public.geo_settle_budget_v1('batch-a',0.63);
  IF (r->>'charged_usd')::numeric <> 0.63 THEN RAISE EXCEPTION '结算 期望 charged0.63, 实得 %', r; END IF;
  SELECT * INTO b FROM public.geo_client_budgets WHERE client_id='c0000000-0000-0000-0000-000000000000';
  IF b.reserved_usd <> 0 OR b.spent_usd <> 0.63 THEN RAISE EXCEPTION '结算后 reserved0/spent0.63, 实得 r=% s=%', b.reserved_usd, b.spent_usd; END IF;

  -- 🔴 幂等结算:再 settle 同一批次 → spent 不再变(魏征实测 0.63→1.26 的根治)
  r := public.geo_settle_budget_v1('batch-a',0.63);
  IF (r->>'idempotent')::bool IS NOT TRUE THEN RAISE EXCEPTION '重复settle 期望 idempotent, 实得 %', r; END IF;
  SELECT * INTO b FROM public.geo_client_budgets WHERE client_id='c0000000-0000-0000-0000-000000000000';
  IF b.spent_usd <> 0.63 THEN RAISE EXCEPTION '重复settle 后 spent 应仍=0.63, 实得 %', b.spent_usd; END IF;

  RAISE NOTICE '✅ reserve/settle/幂等 全部通过';
END $$;

-- 泄漏回收:新预留 → expire → reserved 释放
DO $$
DECLARE r jsonb; b public.geo_client_budgets%ROWTYPE;
BEGIN
  PERFORM public.geo_reserve_budget_v1('batch-leak','c0000000-0000-0000-0000-000000000000','2026-09',1.0);
  SELECT * INTO b FROM public.geo_client_budgets WHERE client_id='c0000000-0000-0000-0000-000000000000';
  IF b.reserved_usd <> 1.0 THEN RAISE EXCEPTION 'leak预留后 reserved应=1.0, 实得 %', b.reserved_usd; END IF;
  r := public.geo_expire_stale_reservations(now() + interval '1 second');
  IF (r->>'expired_count')::int <> 1 THEN RAISE EXCEPTION '回收 期望 expired_count1, 实得 %', r; END IF;
  SELECT * INTO b FROM public.geo_client_budgets WHERE client_id='c0000000-0000-0000-0000-000000000000';
  IF b.reserved_usd <> 0 THEN RAISE EXCEPTION '回收后 reserved应回0, 实得 %', b.reserved_usd; END IF;
  RAISE NOTICE '✅ 孤儿预留回收通过';
END $$;

-- within_cap CHECK 挡直接写穿
DO $$
BEGIN
  UPDATE public.geo_client_budgets SET reserved_usd = 99 WHERE period_key='2026-09';
  RAISE EXCEPTION 'BUG: 写穿cap竟成功';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '✅ within_cap 挡住写穿';
END $$;

-- anon 不能执行 reserve(REVOKE 生效)
DO $$
BEGIN
  SET LOCAL role anon;
  PERFORM public.geo_reserve_budget_v1('batch-anon','c0000000-0000-0000-0000-000000000000','2026-09',0.1);
  RESET role;
  RAISE EXCEPTION 'BUG: anon 竟能执行 reserve';
EXCEPTION WHEN insufficient_privilege THEN RESET role; RAISE NOTICE '✅ anon 被 REVOKE 挡住';
END $$;

-- reservation_id 身份核对（Codex P1）：换客户/窗口/金额复用同一 id 必须 fail-closed
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM public.geo_reserve_budget_v1('R-id','c0000000-0000-0000-0000-000000000000','2026-09',0.10);
  -- 换客户B(无预算行)+换月+换金额，期望 reservation_mismatch，绝不 idempotent 成功
  r := public.geo_reserve_budget_v1('R-id','b0000000-0000-0000-0000-000000000000','2026-10',100);
  IF r->>'reason' <> 'reservation_mismatch' THEN
    RAISE EXCEPTION '跨身份复用 期望 reservation_mismatch, 实得 %', r; END IF;
  -- 同身份重复 → 仍幂等成功
  r := public.geo_reserve_budget_v1('R-id','c0000000-0000-0000-0000-000000000000','2026-09',0.10);
  IF (r->>'idempotent')::bool IS NOT TRUE THEN RAISE EXCEPTION '同身份重复 期望 idempotent, 实得 %', r; END IF;
  RAISE NOTICE '✅ reservation_id 身份核对生效（跨客户/月/金额拒，同身份幂等）';
END $$;

-- 已结算/已回收的预留不再是执行授权（Codex P2）
DO $$
DECLARE r jsonb; v_spent_before numeric; v_spent_after numeric;
BEGIN
  PERFORM public.geo_reserve_budget_v1('P2A','c0000000-0000-0000-0000-000000000000','2026-09',0.5);
  PERFORM public.geo_settle_budget_v1('P2A', 0.3);
  SELECT spent_usd INTO v_spent_before FROM public.geo_client_budgets
    WHERE client_id='c0000000-0000-0000-0000-000000000000' AND period_key='2026-09';
  -- 关键回放：settle 后同身份再 reserve 必须 fail-closed，绝不返回 reserved:true
  r := public.geo_reserve_budget_v1('P2A','c0000000-0000-0000-0000-000000000000','2026-09',0.5);
  IF (r->>'reserved')::bool IS DISTINCT FROM FALSE OR r->>'reason' <> 'already_settled' THEN
    RAISE EXCEPTION 'settle 后回放 期望 reserved:false/already_settled, 实得 %', r; END IF;
  SELECT spent_usd INTO v_spent_after FROM public.geo_client_budgets
    WHERE client_id='c0000000-0000-0000-0000-000000000000' AND period_key='2026-09';
  IF v_spent_before <> v_spent_after THEN
    RAISE EXCEPTION 'settle 后回放不应改动账本, 但 spent 变了: % -> %', v_spent_before, v_spent_after; END IF;

  -- 回收后同身份再 reserve 也拒
  PERFORM public.geo_reserve_budget_v1('P2B','c0000000-0000-0000-0000-000000000000','2026-09',0.3);
  PERFORM public.geo_expire_stale_reservations(now() + interval '1 second');
  r := public.geo_reserve_budget_v1('P2B','c0000000-0000-0000-0000-000000000000','2026-09',0.3);
  IF (r->>'reserved')::bool IS DISTINCT FROM FALSE OR r->>'reason' <> 'reservation_expired' THEN
    RAISE EXCEPTION 'expire 后回放 期望 reservation_expired, 实得 %', r; END IF;

  RAISE NOTICE '✅ 已结算/已回收预留不再当授权（防重放 provider 双花）';
END $$;
SQL

"${P[@]}" <<'SQL'
-- settle 的 NaN/Infinity 护栏现在真生效（魏征复验：原本是死代码）
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM public.geo_reserve_budget_v1('batch-nan','c0000000-0000-0000-0000-000000000000','2026-09',0.1);
  r := public.geo_settle_budget_v1('batch-nan','NaN'::numeric);
  IF r->>'reason' <> 'invalid_actual' THEN RAISE EXCEPTION 'settle NaN 期望 invalid_actual, 实得 %', r; END IF;
  r := public.geo_settle_budget_v1('batch-nan','Infinity'::numeric);
  IF r->>'reason' <> 'invalid_actual' THEN RAISE EXCEPTION 'settle Inf 期望 invalid_actual, 实得 %', r; END IF;
  RAISE NOTICE '✅ settle NaN/Inf 护栏生效';
END $$;
SQL

echo "==> 并发同 reservation_id 探针（ON CONFLICT 修复 PK 撞车，魏征复验必改）"
# 给并发探针一个独立预算行
"${P[@]}" <<'SQL'
INSERT INTO public.geo_client_budgets (client_id, period_key, cap_usd)
VALUES ('e0000000-0000-0000-0000-000000000000','2026-09',10.0);
SQL
# 会话A：开事务、预留 dup、hold 1.5s 再提交（后台）
( "${P[@]}" -c "BEGIN; SELECT public.geo_reserve_budget_v1('dup','e0000000-0000-0000-0000-000000000000','2026-09',0.5); SELECT pg_sleep(1.5); COMMIT;" >/dev/null 2>&1 ) &
BGPID=$!
sleep 0.5
# 会话B：并发用同一个 dup 预留——应阻塞到A提交后返回幂等，绝不 PK 抛错
B_OUT=$("${P[@]}" -t -c "SELECT public.geo_reserve_budget_v1('dup','e0000000-0000-0000-0000-000000000000','2026-09',0.5);" 2>&1 || true)
wait $BGPID
echo "   会话B 返回: $(echo "$B_OUT" | tr -d ' \n')"
# 断言：B 没报 PK 错，且最终 reserved 只有 0.5（不双计）
FINAL=$("${P[@]}" -t -c "SELECT reserved_usd FROM public.geo_client_budgets WHERE client_id='e0000000-0000-0000-0000-000000000000';" | tr -d ' \n')
if echo "$B_OUT" | grep -qi "duplicate key\|ERROR"; then echo "   ❌ 会话B 报了 PK/ERROR：$B_OUT"; exit 1; fi
if [ "$FINAL" != "0.5000" ]; then echo "   ❌ 并发后 reserved 应=0.5000，实得 $FINAL（双计了）"; exit 1; fi
echo "   ✅ 并发同 id：B 幂等不报错，reserved 只 0.5（未双计）"

echo "==> ✅ 全部 GEO 预算账本行为断言通过"
