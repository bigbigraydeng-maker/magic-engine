-- ============================================================================
-- 「满意·去发布」的 check-then-write 竞态 → 收成一条原子 SQL（Codex 第8轮复审，
-- 跟进任务 task_ead5f370，见 PR #1091 commit 99493d3 的拆分说明）
--
-- ⚠️ **本文件只提交代码，尚未 apply。** apply 是单独授权的运维动作，
--    绝不夹带进任何 PR（CLAUDE.md 铁律 2 的不可逆操作例外）。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 为什么必须有这个函数
-- ────────────────────────────────────────────────────────────────────────────
--
-- [postId]/route.ts 的 schedule action 原来是「查一次再写」：先
-- hasActiveRenderJob(postId) 查有没有活跃做片任务，查完再单独发一条 UPDATE 把
-- content_posts.status 改成 scheduled。这两步不在同一个事务里，中间有窗口——
-- 如果另一个标签页在这个窗口里通过 save_captions 触发了一次重排任务，schedule
-- 请求查的时候还没有活跃任务，等它真去写的时候任务已经建了，但它已经过了检查，
-- 照样把状态标成 scheduled。reel-render.ts 做完片回写时靠 status='approved' 这
-- 个原子条件保护，命不中会拒绝覆盖（20260819 那次 Codex 复审加的），于是发布出去
-- 的是校对字幕前的旧版本，界面不报任何错误。
--
-- 走 PostgREST 的 .update().eq() 做不到「查+写在一条语句里」——那是两条独立请求。
-- 唯一能把「检查活跃任务」和「写入 scheduled」焊死在同一个原子操作里的办法，是把
-- NOT EXISTS 子查询放进 UPDATE 的 WHERE 里，一条 SQL 语句本身就是一个事务。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 权限设计：SECURITY DEFINER + 单授 service_role
-- ────────────────────────────────────────────────────────────────────────────
--
-- 跟 factory_claim_work_order / factory_balance_usd（20260711000002）同一个模式：
-- SECURITY DEFINER 函数默认把 EXECUTE 授予 PUBLIC，而 anon key 是印在浏览器
-- bundle 里的——不收口 = 任何人经 PostgREST 直调这个函数就能绕过
-- requireDashboardClientAccess 把任意客户的内容标成 scheduled。
-- 用 SECURITY DEFINER（而不是像 geo_persist_batch_v1 那样用 INVOKER）是因为
-- content_factory_render_jobs 表现在的 RLS policy 漏了 `TO service_role`
-- （见 20260731081328_content_factory_render_jobs.sql:26，已拆出独立任务
-- task_36472c84 去修）——DEFINER 让这个函数的读不依赖那条本该收紧但还没收紧
-- 的 policy，同时 REVOKE/GRANT 把「谁能调这个函数」收到只有 service_role，
-- 两层限制不互相打架。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.factory_schedule_content_post(
  p_client_id uuid,
  p_post_id   uuid
)
RETURNS TABLE (
  ok             boolean,
  post_id        uuid,
  status         text,
  format         text,
  blocked_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  -- 🔴 这条 UPDATE 本身就是一个事务：NOT EXISTS 子查询和状态写入在同一条语句里
  --    执行，Postgres 保证不会有第三方在「查完」到「写完」之间插进来改
  --    content_factory_render_jobs——不是「尽量缩短窗口」，是没有窗口。
  UPDATE public.content_posts cp
     SET status = 'scheduled'
   WHERE cp.id = p_post_id
     AND cp.client_id = p_client_id
     AND NOT EXISTS (
       SELECT 1
         FROM public.content_factory_render_jobs rj
        WHERE rj.content_post_id = cp.id
          AND rj.status IN ('queued', 'planning', 'rendering', 'assembling')
     )
   RETURNING cp.id, cp.status, cp.format
    INTO v_row;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_row.id, v_row.status, v_row.format, NULL::text;
    RETURN;
  END IF;

  -- 没更新到：分清是「根本没这条内容/不是这个客户的」还是「被活跃做片任务挡住」，
  -- 好让上层给出准确的错误信息。这一步的读不需要跟上面焊在同一个原子操作里——
  -- 上面已经确定写没有发生，这里只是解释原因；哪怕这一刻状态又变了，最坏后果
  -- 只是错误文案有一瞬间不够新鲜，不是「发布了不该发布的版本」那种正确性问题。
  SELECT cp.id, cp.status, cp.format
    INTO v_row
    FROM public.content_posts cp
   WHERE cp.id = p_post_id AND cp.client_id = p_client_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text, 'not_found'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, v_row.id, v_row.status, v_row.format, 'active_render_job'::text;
END;
$$;

COMMENT ON FUNCTION public.factory_schedule_content_post(uuid, uuid) IS
  '「满意·去发布」的原子写：检查活跃做片任务 + 写 scheduled 状态焊在同一条 UPDATE 里，'
  '不再是"查一次再写"。ok=false 时 blocked_reason 区分 not_found / active_render_job。';

-- 🔴 EXECUTE 先全撤再单授 —— 不留 PUBLIC 默认可执行，理由见文件头。
REVOKE EXECUTE ON FUNCTION public.factory_schedule_content_post(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.factory_schedule_content_post(uuid, uuid)
  TO service_role;

-- 🔴 不发这一句，PostgREST 的 schema 缓存里没有这个函数，第一次 .rpc() 会拿到
--    「function does not exist」——那个报错看起来像「migration 没 apply」，
--    能把人带偏很久（20260812000001 踩过同一个坑）。
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- apply 之后必须自验的几条（文件名不是 apply 证据）：
--
--   -- 函数在，且是 DEFINER（prosecdef = true）
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'factory_schedule_content_post';
--   -- prosecdef 必须是 t；proconfig 必须含 search_path=public
--
--   -- 只有 service_role 能执行
--   SELECT grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_name = 'factory_schedule_content_post';
--   -- 只应看到 service_role 的 EXECUTE
--
--   -- 行为自验：造一条 approved 内容 + 一条 queued 的做片任务，
--   -- select * from factory_schedule_content_post('<client_id>', '<post_id>')
--   -- 应该拿到 ok=false, blocked_reason='active_render_job'，content_posts.status
--   -- 保持 approved 不变；把做片任务标成 ready_for_review 后再跑一次应该
--   -- ok=true, status='scheduled'。
-- ============================================================================
