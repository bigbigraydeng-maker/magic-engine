-- 把 118 条「名字叫 service_role、实际授权给所有人」的 RLS 策略收回给 service_role。
--
-- ── 事故 ────────────────────────────────────────────────────────────────────
-- CLAUDE.md 长期强制的建表模板漏了 `TO service_role`：
--
--   CREATE POLICY "service_role_full" ON <t> FOR ALL USING (true);   -- ← 缺 TO
--
-- Postgres 里 CREATE POLICY 不写 TO 子句 = `TO PUBLIC` = 对**所有角色**生效，
-- 包含 anon。而 Supabase 默认给 anon/authenticated GRANT 了 public schema 下
-- 所有表的增删改查，平时全靠 RLS 兜着 —— 这个模板等于把兜底拆了。
--
-- 2026-08-03 用生产环境的公开 anon key 实测确认（anon key 随浏览器 bundle
-- 公开分发，任何访问过站点的人都能拿到）：
--
--   outbound_prospects       2,678 行  可读
--   conversation_messages    2,135 行  可读
--   contact_identities       1,260 行  可读
--   PATCH outbound_prospects  HTTP 204  可写（探针 WHERE 匹配 0 行，未改动数据）
--
-- 未受影响（策略写法正确或无策略）：platform_oauth_connections（第三方令牌）、
-- mtc_purchases / mtc_ledger（充值与消费）、client_portal_users、clients、
-- master_briefs、client_assets。
--
-- ── 做法 ────────────────────────────────────────────────────────────────────
-- 用 ALTER POLICY 只改角色，不动条件：
--   * 不 DROP 再 CREATE —— 中间没有「表裸奔」的时间窗
--   * 条件原样保留，行为除角色外零变化
--   * 回退就是把 service_role 换回 public（见文件末尾）
--
-- ── 为什么安全（改前已逐条核实）────────────────────────────────────────────
-- 1. 全仓只有 2 个文件用匿名客户端碰业务表（facebook-publisher.ts /
--    xiaohongshu-publisher.ts），二者**无任何调用方**，只有自己的测试文件引用，
--    是死代码。
-- 2. 所有对外路径（/api/discover/register、/api/public-scan/status/[jobId]、
--    /auth/callback）读写这些表用的都是 supabaseAdmin(service_role)。
-- 3. 遗留多租户表簇（projects / social_sources / content_topics / collected_posts
--    / feedback_data / generation_logs / generation_params / trending_reports）
--    另有 owner 维度的 {authenticated} 策略，本迁移不匹配、不触碰。
-- 4. local_cities_read_all 刻意保留公开只读 —— 城市名参考数据，非客户信息。
--
-- 预期改动：118 条策略（105 ALL + 10 INSERT + 2 UPDATE + 1 SELECT）。

DO $$
DECLARE
  r         RECORD;
  n_changed INT := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'public'
       AND roles::text = '{public}'
       -- 只收「无条件放行」的策略。带真实条件的（owner 维度、
       -- auth.role()='service_role' 之类）不在此列，保持原样。
       AND COALESCE(qual, 'true')       = 'true'
       AND COALESCE(with_check, 'true') = 'true'
       -- 刻意公开的参考数据，保留
       AND policyname <> 'local_cities_read_all'
     ORDER BY tablename, policyname
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I TO service_role',
      r.policyname, r.tablename
    );
    n_changed := n_changed + 1;
    RAISE NOTICE '收紧 %.% (%)', r.tablename, r.policyname, r.cmd;
  END LOOP;

  RAISE NOTICE '共收紧 % 条策略', n_changed;

  -- 数量对不上就整体回滚，不留半吊子状态
  IF n_changed <> 118 THEN
    RAISE EXCEPTION
      '预期收紧 118 条，实际 % 条 —— 库状态与审计时不一致，已回滚。请重新核对后再跑。',
      n_changed;
  END IF;
END $$;

-- ── 验证（迁移内自检，不通过即整体回滚）──────────────────────────────────
DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT count(*) INTO leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND roles::text = '{public}'
     AND COALESCE(qual, 'true')       = 'true'
     AND COALESCE(with_check, 'true') = 'true'
     AND policyname <> 'local_cities_read_all';

  IF leftover <> 0 THEN
    RAISE EXCEPTION '仍有 % 条无条件公开策略未收紧，已回滚', leftover;
  END IF;

  RAISE NOTICE '✅ 验证通过：已无「无条件对所有角色放行」的策略（local_cities 除外）';
END $$;

-- ── 回退 ────────────────────────────────────────────────────────────────────
-- 如需恢复原状（不建议，会重新打开对外读写）：
--
--   DO $$
--   DECLARE r RECORD;
--   BEGIN
--     FOR r IN
--       SELECT tablename, policyname FROM pg_policies
--        WHERE schemaname='public' AND roles::text='{service_role}'
--          AND COALESCE(qual,'true')='true' AND COALESCE(with_check,'true')='true'
--     LOOP
--       EXECUTE format('ALTER POLICY %I ON public.%I TO public', r.policyname, r.tablename);
--     END LOOP;
--   END $$;
--
-- 注意：回退脚本会把本来就正确的 41 条 service_role 策略一并放开，
-- 真要回退请先用 pg_policies 快照精确指定策略名。
