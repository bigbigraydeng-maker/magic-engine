-- 批量收回「策略已锁 service_role，但表级 GRANT 还留着 anon/authenticated/PUBLIC」的残留授权
--
-- ── 背景 ────────────────────────────────────────────────────────────────────
-- 20260803020000 用 ALTER POLICY 把 118 条「漏写 TO service_role」的策略角色改
-- 成了 service_role，但从没做过对应的批量表级 REVOKE —— Supabase 建表时默认会
-- 给 anon/authenticated GRANT 表级增删改查，这批授权当时残留了下来，一直没人收。
--
-- 2026-09-24 全库审计（project glbdnayojixmexgofbsd，实测当天数字，只作对账参
-- 考，**不是断言**——跟 20260803020000 里 118 条的教训一样，任何其他库（本地
-- 沙盘从零重放全部 migration、或生产后续再变动）算出来的数字都会不同，本迁移
-- 的判定逻辑是动态扫描，不依赖这个数字）：
--   · public schema 234 张表，全部已开 RLS
--   · 其中 214 张的策略已经 100% 锁死在 {service_role}（或压根没有策略）
--   · 这 214 张里有 197 张（含零策略、纯靠 RLS 默认拒绝的 group_tours）
--     在 information_schema.role_table_grants 里仍能查到 anon/authenticated 的
--     表级授权（本地从零重放全部 migration 复现时实测是 199 张，差异属正常
--     环境漂移，不代表逻辑有问题）
-- 这些残留授权**现在是死的**：策略已经锁死，RLS 会挡掉 anon/authenticated 的
-- 实际访问，不是当下能打穿的洞。但只要以后：
--   (a) 谁在这张表上新加一条策略、不小心漏写了 TO 子句，或
--   (b) 谁为了排查问题把这张表的 RLS 关掉（ALTER TABLE ... DISABLE ROW LEVEL SECURITY），
-- 这些授权会立刻复活成真实的匿名读写口子 —— 跟 2026-08-03 事故是同一类隐患的
-- 存量版本，只是这次是「表级 GRANT」而不是「策略角色」。
--
-- 不在本迁移范围内、刻意跳过的表：策略里混了 anon/{authenticated}/{public} 的
-- 表（生产 2026-09-24 实测约 20 张，例如 reels_drafts 混了 {anon}+{service_role}；
-- 具体是哪些表会随后续 migration 变动漂移，不写死清单——判定逻辑本身就是
-- 「roles 精确等于 {service_role} 才处理」，会自动跳过任何混合角色的表）。这些
-- 表的匿名/登录态访问是刻意设计的业务需求，不属于「残留授权」，动它们要走另
-- 一条 A 级 ticket 逐表核对每条策略的过滤条件，不能跟本次的死授权清理混在同
-- 一个迁移里。
--
-- ── 做法 ────────────────────────────────────────────────────────────────────
-- 动态扫描（跟随 20260803020000 同一模式，不写死表名清单）：对 public schema 下
-- 每一张
--   · 已开 RLS
--   · 现有策略要么一条都没有，要么全部**精确**锁在 {service_role}（不是「包含」
--     service_role，是恰好只有它 —— 避免把「service_role + 其他角色」混着的
--     策略误判成安全，那种表本轮不该碰，见上面"跳过"清单）
--   · information_schema.role_table_grants 里 anon / authenticated / PUBLIC
--     三者任一还有残留授权
-- 的表，执行 REVOKE ALL ... FROM PUBLIC, anon, authenticated。
--
-- 同时收 PUBLIC：如果这张表曾经被 GRANT ... TO PUBLIC 过，anon/authenticated
-- 会通过「所有角色隐含所属 PUBLIC」继续拿到权限，只撤 anon/authenticated 撤不掉
-- 这条继承路径（seo_patrol_findings 那次修复上真的踩过一次这条命，见
-- fix_seo_patrol_findings_grants.sql 系列迁移的复审记录）。生产实测目前
-- role_table_grants 里没有 grantee=PUBLIC 的记录，这里是纵深防御，不是修复
-- 已发现的活口子。
--
-- ── 为什么这里的收尾自检可以 RAISE EXCEPTION（不同于 20260803020000）────────
-- 20260803020000 后来把「数量不达标就整体回滚」改成了只 RAISE NOTICE，原因是：
-- 那次操作的对象是**当时仍在生效**、对所有角色放行的策略（roles={public}）——
-- 回滚方向是把已经收紧的策略重新打开，净效果是让当时仍可被公开 anon key 利用
-- 的通道重新暴露，是真实倒退，不该让一次"计数对不上"的假警报触发。
--
-- 本迁移不是这种情况：目标表的策略在迁移前后都锁死在 service_role，anon/
-- authenticated 从 RLS 层面本来就进不去（不满足上面的筛选条件根本不会被选
-- 中）。收尾自检不达标只回滚"表级 GRANT 还没撤"这一件事，末态跟迁移前一模
-- 一样，不产生任何新的可利用面——失败只说明扫描逻辑本身有 bug，需要真去看，
-- 而不是把已经收紧的东西又打开。所以这里保留 RAISE EXCEPTION，跟单表修复
-- （fix_seo_meta_log_grants.sql / fix_seo_patrol_findings_grants.sql）用同一个
-- fail-closed 方向。
--
-- ── 前提：执行者权限 ────────────────────────────────────────────────────────
-- 下面的扫描要看全 anon/authenticated 的表级授权，前提是执行这条迁移的数据库
-- 角色本身有权限看到 information_schema.role_table_grants 里这些行（Supabase/
-- CI 里默认用 postgres 这类超级用户跑 migration，天然可见）。如果以后 CI 或
-- 部署流程换成一个权限更小的角色执行 migration，这里的扫描可能「看不到=以为
-- 没有」，导致收尾自检假阳性通过——换执行角色时要重新确认这一点。

DO $$
DECLARE
  r RECORD;
  n_revoked INT := 0;
BEGIN
  FOR r IN
    WITH policy_roles AS (
      SELECT
        tablename,
        bool_and(roles::text = '{service_role}') AS locked_to_service_role
      FROM pg_policies
      WHERE schemaname = 'public'
      GROUP BY tablename
    ),
    rls_tables AS (
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
    ),
    residual_grants AS (
      SELECT DISTINCT table_name AS tablename
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated', 'PUBLIC')
    )
    SELECT rt.tablename
    FROM rls_tables rt
    JOIN residual_grants g ON g.tablename = rt.tablename
    LEFT JOIN policy_roles pr ON pr.tablename = rt.tablename
    -- 零策略的表 pr.locked_to_service_role 是 NULL（LEFT JOIN 没匹配到任何
    -- pg_policies 行）；RLS 已开 + 零策略 = 默认拒绝，跟"全部策略锁死
    -- service_role"是同一类安全状态，一并处理（group_tours 就是这种表）。
    WHERE COALESCE(pr.locked_to_service_role, true)
    ORDER BY rt.tablename
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', r.tablename);
    n_revoked := n_revoked + 1;
  END LOOP;

  RAISE NOTICE '共收回 % 张表的残留 anon/authenticated/PUBLIC 表级授权', n_revoked;
END $$;

-- ── 收尾自检（事务内，不达标即整体回滚；理由见文件顶部）─────────────────────
DO $$
DECLARE
  leftover INT;
  detail text;
BEGIN
  WITH policy_roles AS (
    SELECT
      tablename,
      bool_and(roles::text = '{service_role}') AS locked_to_service_role
    FROM pg_policies
    WHERE schemaname = 'public'
    GROUP BY tablename
  ),
  rls_tables AS (
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
  )
  SELECT count(DISTINCT g.table_name), string_agg(DISTINCT g.table_name, ', ' ORDER BY g.table_name)
    INTO leftover, detail
  FROM information_schema.role_table_grants g
  JOIN rls_tables rt ON rt.tablename = g.table_name
  LEFT JOIN policy_roles pr ON pr.tablename = rt.tablename
  WHERE g.table_schema = 'public'
    AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
    AND COALESCE(pr.locked_to_service_role, true);

  IF leftover <> 0 THEN
    RAISE EXCEPTION E'仍有 % 张策略已锁 service_role 的表残留 anon/authenticated/PUBLIC 表级授权，已回滚：\n  %', leftover, detail;
  END IF;

  RAISE NOTICE '✅ 已锁 service_role（或零策略）的表均已收回 anon/authenticated/PUBLIC 表级授权';
END $$;
