-- ME2 Product Map — 收口 product_map_commit_sync_v1 的 EXECUTE 权限
--
-- 背景:Supabase 生产库 security advisor 报 product_map_commit_sync_v1 是 SECURITY DEFINER,
-- 但 anon / authenticated 都有 EXECUTE —— 可经 /rest/v1/rpc/product_map_commit_sync_v1 直调。
--
-- 根因:20260815000001_product_map_sync_v1.sql 只写了
--   REVOKE ALL ON FUNCTION ... FROM PUBLIC;
-- 这只撤销「授予给 PUBLIC 那份」权限。Supabase 对 public schema 新建对象默认走
-- ALTER DEFAULT PRIVILEGES,会单独把 EXECUTE 显式授予 anon / authenticated ——
-- 那份是独立的授权记录,REVOKE ... FROM PUBLIC 撤不掉,必须显式点名撤销
-- (同仓库 factory_claim_work_order 那条,见 20260711000002_p21j_content_factory_m1.sql,
-- 当初就是这么写的:FROM PUBLIC, anon, authenticated)。
--
-- 调用方核查:全仓库唯一调用点是 SupabaseSyncStore.commitSync()
-- (src/lib/product-map-sync/store.ts),三处 route 全部用 supabaseAdmin(service_role)
-- 初始化 —— cron/product-map-sync、admin/product-map/refresh、cms/github/webhook。
-- 没有任何前端 / 匿名会话路径调用它,设计上就该 service_role-only。
--
-- PM 拍板后才 apply,worker 严禁自行 apply_migration。

REVOKE EXECUTE ON FUNCTION public.product_map_commit_sync_v1(jsonb, jsonb, jsonb, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.product_map_commit_sync_v1(jsonb, jsonb, jsonb, jsonb, text, jsonb)
  TO service_role;
