-- 修复 seo_patrol_findings 的权限漏洞：收回 anon/authenticated 的表级授权 +
-- 把 RLS 策略显式锁到 service_role。
--
-- ── 背景 ────────────────────────────────────────────────────────────────────
-- 20260604000002_phase22e_seo_patrol_findings.sql 建表用了旧模板：
--
--   CREATE POLICY "service_role_full" ON seo_patrol_findings FOR ALL USING (true);
--
-- 没写 TO service_role = TO PUBLIC，对所有角色生效（含 anon）。跟 20260920000001
-- 修 seo_meta_log 是同一个模式（CLAUDE.md §7 点名的事故：2026-08-03 实测泄露 118 条策略）。
--
-- ── 现状核实（2026-09-24 实测，project glbdnayojixmexgofbsd）────────────────
-- 生产库里活的 RLS 策略（pg_policy.polroles）已经被人手动改成只对
-- service_role 生效，不是活的漏洞。但两处没跟着改：
--   1. 本仓库这份建表迁移文件文本还写着旧的、没有 TO 子句的版本 ——
--      源码（未来任何人从零重建这张表时会读到的模板）跟生产现状对不上。
--   2. information_schema.role_table_grants 显示 anon / authenticated 仍有
--      表级 INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 授权。
--      RLS 已开（relrowsecurity=true）所以这些授权目前是死的。不是今天就能
--      打穿的洞，但只要以后 RLS 被关掉或加一条更宽的策略，这些授权立刻复活。
--
-- ── 做法 ────────────────────────────────────────────────────────────────────
-- 不改 20260604000002（已 apply 过的旧文件不动），新开一份：
--   1. REVOKE ALL 收掉 anon/authenticated 的表级授权（纵深防御）。
--   2. ALTER POLICY 只改角色、不动条件 —— 不 DROP 再 CREATE，中间没有
--      「表裸奔」的时间窗，策略名跟建表迁移里的原名对上。
--
-- 不需要任何 app 代码改动：写这张表的路径（src/lib/seo-patrol/job.ts 的每日巡检 cron）
-- 用的是 SUPABASE_SERVICE_ROLE_KEY 初始化的 client，本来就符合收紧后的策略。

REVOKE ALL ON public.seo_patrol_findings FROM anon, authenticated;

DO $$
BEGIN
  ALTER POLICY "service_role_full" ON public.seo_patrol_findings TO service_role;
END $$;

-- ── 验证（迁移内自检，不通过即整体回滚）──────────────────────────────────
DO $$
DECLARE
  leftover_grants INT;
  leftover_policy INT;
BEGIN
  SELECT count(*) INTO leftover_grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'seo_patrol_findings'
     AND grantee IN ('anon', 'authenticated');

  IF leftover_grants <> 0 THEN
    RAISE EXCEPTION 'seo_patrol_findings 仍有 % 条 anon/authenticated 的表级授权，已回滚', leftover_grants;
  END IF;

  SELECT count(*) INTO leftover_policy
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'seo_patrol_findings'
     AND policyname = 'service_role_full'
     AND roles::text <> '{service_role}';

  IF leftover_policy <> 0 THEN
    RAISE EXCEPTION 'seo_patrol_findings."service_role_full" 未锁到 TO service_role，已回滚';
  END IF;

  RAISE NOTICE '✅ seo_patrol_findings 已收回 anon/authenticated 授权，策略已锁到 TO service_role';
END $$;
