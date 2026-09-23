-- =============================================================================
-- 数据库安全不变量断言（#1326）
--
-- 这是**事务外**的持续护栏。为什么必须放在事务外：
-- 对「收紧类」migration，任何放在同一事务里的闸门在语义上都不可能 fail-safe ——
-- 它唯一的补救手段是回滚，而回滚方向永远是「重新暴露」。2026-08-03 那个
-- 20260803020000 就是活例：断言不过 → 整体回滚 → 101 条对匿名放行的策略
-- 一条都没收紧，守卫失败的后果是**更不安全**。
--
-- 所以真正的护栏只能是：重放完 migration 之后，独立断言末态属性。
-- 本文件就是那些断言。任一不满足即 exit 1。
--
-- 用法（CI 里由 postgres service + 重放脚本调用）：
--   psql -v ON_ERROR_STOP=1 -f scripts/db-invariants.sql -d <db>
-- =============================================================================

\set ON_ERROR_STOP on

-- ── 不变量 1：不存在「无条件对所有角色放行」的策略 ─────────────────────────
-- Postgres 里 CREATE POLICY 不写 TO 子句 = TO PUBLIC = 对所有角色生效（含 anon）。
-- 而 Supabase 默认给 anon/authenticated GRANT 了 public schema 全部表的增删改查，
-- 平时全靠 RLS 兜着 —— 漏写 TO 等于把兜底拆了。
-- 例外：local_cities_read_all 是刻意公开的城市名参考数据。
--   按 (表名, 策略名) 匹配，不按策略名全局豁免 —— 否则别的表上同名策略会被放过。
DO $$
DECLARE n INT; detail text;
BEGIN
  SELECT count(*), string_agg(tablename||'.'||policyname, ', ' ORDER BY tablename, policyname)
    INTO n, detail
    FROM pg_policies
   WHERE schemaname = 'public'
     AND roles::text = '{public}'
     AND COALESCE(qual, 'true')       = 'true'
     AND COALESCE(with_check, 'true') = 'true'
     AND NOT (tablename = 'local_cities' AND policyname = 'local_cities_read_all');
  IF n <> 0 THEN
    RAISE EXCEPTION E'[不变量1] 有 % 条 roles={public} 的无条件放行策略：\n  %', n, detail;
  END IF;
  RAISE NOTICE '✅ 不变量1：无 roles={public} 无条件放行策略';
END $$;

-- ── 不变量 2：不存在无条件放行的 {authenticated} 策略 ──────────────────────
-- ME 用 Supabase Auth，任何人走 /api/auth/self-register 的 signInWithOtp
-- 即可拿到 authenticated 身份，配公开分发的 anon key 直连 PostgREST。
-- 所以 {authenticated} + USING(true) 等于跨客户全开。
-- 带真实条件（owner 维度等）的 {authenticated} 策略不在此列，不受影响。
DO $$
DECLARE n INT; detail text;
BEGIN
  SELECT count(*), string_agg(tablename||'.'||policyname, ', ' ORDER BY tablename, policyname)
    INTO n, detail
    FROM pg_policies
   WHERE schemaname = 'public'
     AND roles::text = '{authenticated}'
     AND COALESCE(qual, 'true')       = 'true'
     AND COALESCE(with_check, 'true') = 'true';
  IF n <> 0 THEN
    RAISE EXCEPTION E'[不变量2] 有 % 条 {authenticated} 无条件放行策略：\n  %', n, detail;
  END IF;
  RAISE NOTICE '✅ 不变量2：无 {authenticated} 无条件放行策略';
END $$;

-- ── 不变量 3：public schema 下不存在 RLS 未开启的表 ────────────────────────
-- 「没有策略」不等于安全 —— RLS 未开 + 无策略 + Supabase 默认 GRANT = 完全敞开。
-- 这个方向的认知错误正是 2026-08-03 事故迁移原注释里犯过的。
DO $$
DECLARE n INT; detail text;
BEGIN
  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname) INTO n, detail
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;
  IF n <> 0 THEN
    RAISE EXCEPTION E'[不变量3] 有 % 张表未开启 RLS：\n  %', n, detail;
  END IF;
  RAISE NOTICE '✅ 不变量3：所有表已开启 RLS';
END $$;

-- ── 不变量 4：不存在 anon/authenticated 可执行的 SECURITY DEFINER 函数 ─────
-- SECURITY DEFINER 以定义者身份执行，**完全绕过 RLS** —— 表锁了也挡不住这条路。
-- ⚠️ 关键：`REVOKE ... FROM PUBLIC` 在 Supabase 上收不干净。
--   真实 Supabase 用 ALTER DEFAULT PRIVILEGES 给 anon/authenticated 配了**独立**
--   授权，不经过 PUBLIC。必须 `FROM PUBLIC, anon, authenticated`。
--   2026-09-03 实测：20260815000001 只写 FROM PUBLIC，就是这样漏掉的。
DO $$
DECLARE n INT; detail text;
BEGIN
  SELECT count(*), string_agg(sig, ', ' ORDER BY sig) INTO n, detail
  FROM (
    SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prosecdef
       AND ( p.proacl IS NULL          -- NULL = 默认 PUBLIC 可执行
             OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                         WHERE a.privilege_type = 'EXECUTE'
                           AND ( a.grantee = 0
                                 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname='anon')
                                 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname='authenticated'))) )
  ) s;
  IF n <> 0 THEN
    RAISE EXCEPTION E'[不变量4] 有 % 个 SECURITY DEFINER 函数对 anon/authenticated/PUBLIC 可执行：\n  %', n, detail;
  END IF;
  RAISE NOTICE '✅ 不变量4：无 anon/authenticated 可执行的 SECURITY DEFINER 函数';
END $$;

-- ── 不变量 5：seo_patrol_findings 对 anon/authenticated/PUBLIC 无表级授权，策略锁死 service_role ──
-- 20260924000000 把这张表的收紧断言从迁移事务内移到了这里（事务内 RAISE EXCEPTION
-- 会连同已经成功的 REVOKE/ALTER POLICY 一起回滚，见该 migration 顶部注释）。
-- 2026-09-23 修正：只按策略名 'service_role_full' 精确匹配会漏掉两种后续退化——
--   (a) 该策略被重命名后仍锁着 service_role，旧名匹配不到 → 误报「未锁死」；
--   (b) 之后新增一条给 anon/authenticated 放行的同表策略（名字不叫 service_role_full）
--       → 旧检查看不到它，不变量却宣告通过。
-- 所以这里既确认目标策略确实存在且锁到 service_role，也额外扫描这张表上
-- 是否存在任何 roles ≠ {service_role} 的策略，堵住改名 / 新增两条退化路径。
DO $$
DECLARE leftover_grants INT; target_policy_count INT; wrong_roles_count INT; wrong_roles_detail text;
BEGIN
  SELECT count(*) INTO leftover_grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'seo_patrol_findings'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF leftover_grants <> 0 THEN
    RAISE EXCEPTION '[不变量5] seo_patrol_findings 仍有 % 条 anon/authenticated/PUBLIC 的表级授权', leftover_grants;
  END IF;

  SELECT count(*) INTO target_policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'seo_patrol_findings'
     AND policyname = 'service_role_full'
     AND roles::text = '{service_role}';
  IF target_policy_count <> 1 THEN
    RAISE EXCEPTION '[不变量5] seo_patrol_findings."service_role_full" 未锁到 TO service_role，或策略缺失/被改名';
  END IF;

  SELECT count(*), string_agg(policyname||':'||roles::text, ', ' ORDER BY policyname)
    INTO wrong_roles_count, wrong_roles_detail
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'seo_patrol_findings'
     AND roles::text <> '{service_role}';
  IF wrong_roles_count <> 0 THEN
    RAISE EXCEPTION E'[不变量5] seo_patrol_findings 上存在 % 条非 {service_role} 策略：\n  %', wrong_roles_count, wrong_roles_detail;
  END IF;

  RAISE NOTICE '✅ 不变量5：seo_patrol_findings 已收回 anon/authenticated/PUBLIC 授权，策略已锁到 TO service_role，且表上无其他角色策略';
END $$;

\echo ''
\echo '✅ 全部数据库安全不变量通过'
