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

-- ── 不变量 5：策略已锁 service_role（或零策略）的表，不残留 anon/authenticated/PUBLIC 表级授权 ──
-- Supabase 建表默认会给 anon/authenticated GRANT 表级增删改查，平时全靠 RLS 兜着。
-- 一张表如果所有策略都已经精确锁在 {service_role}（或压根没有策略，RLS 默认拒绝），
-- 这些表级 GRANT 现在是死的，但只要以后谁加一条漏写 TO 的新策略、或有人把这张表
-- 的 RLS 关掉，它们会立刻复活成真实的匿名读写口子 —— 是 2026-08-03 事故的存量
-- 版本，只是这次是表级 GRANT 而不是策略角色。2026-09-24 全库审计发现 197 张表
-- 中招，20260925010000 批量收回；这里断言末态，防止以后再冒出新的残留
-- （新表照抄旧模板忘了 REVOKE，或者谁往已锁死的表上新 GRANT 了一次）。
-- 跳过策略角色不是「恰好只有 service_role」的表（混了 anon/authenticated/public
-- 的遗留多租户表簇）—— 那些是刻意设计的业务需求，不是本不变量要管的残留。
DO $$
DECLARE n INT; detail text;
BEGIN
  WITH policy_roles AS (
    SELECT tablename,
           bool_and(roles::text = '{service_role}') AS locked_to_service_role
      FROM pg_policies
     WHERE schemaname = 'public'
     GROUP BY tablename
  ),
  rls_tables AS (
    SELECT c.relname AS tablename
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
  )
  SELECT count(DISTINCT g.table_name), string_agg(DISTINCT g.table_name, ', ' ORDER BY g.table_name)
    INTO n, detail
    FROM information_schema.role_table_grants g
    JOIN rls_tables rt ON rt.tablename = g.table_name
    LEFT JOIN policy_roles pr ON pr.tablename = rt.tablename
   WHERE g.table_schema = 'public'
     AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
     AND COALESCE(pr.locked_to_service_role, true);
  IF n <> 0 THEN
    RAISE EXCEPTION E'[不变量5] 有 % 张已锁 service_role（或零策略）的表仍残留 anon/authenticated/PUBLIC 表级授权：\n  %', n, detail;
  END IF;
  RAISE NOTICE '✅ 不变量5：已锁 service_role（或零策略）的表均无 anon/authenticated/PUBLIC 残留表级授权';
END $$;

\echo ''
\echo '✅ 全部数据库安全不变量通过'
