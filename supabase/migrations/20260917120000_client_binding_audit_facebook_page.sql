-- ============================================================================
-- 绑定审计表加上「Facebook 主页」这一种（AD-SEC-4 · 2026-09-17）
--
-- ── 为什么 ───────────────────────────────────────────────────────────────
-- clients.facebook_page_id 决定每小时私信同步、表单线索同步去读哪个主页。
-- 令牌可能回落到能看到多家客户主页的共享令牌，所以把别家主页号填进来
-- = 把别家的私信和线索拉进自己名下。修复后只有内部员工能改，改之前先让
-- Meta 确认读得到这个主页、查它有没有绑在别的客户名下，并在本表留痕；
-- 同步任务只在「有核实记录」的主页上跑（src/lib/meta/page-sync-authorization.ts）。
--
-- ── 改了什么 ─────────────────────────────────────────────────────────────
-- 1. binding_kind 允许 'facebook_page'
-- 2. token_source 允许 'client_oauth'（客户在「连接 Meta」里授权后存下来的主页令牌）
-- 不动任何数据。依赖 20260913120000_client_binding_audit.sql 先 apply。
-- ============================================================================

ALTER TABLE public.client_binding_audit
  DROP CONSTRAINT IF EXISTS client_binding_audit_binding_kind_check;
ALTER TABLE public.client_binding_audit
  ADD CONSTRAINT client_binding_audit_binding_kind_check
  CHECK (binding_kind IN ('meta_ad_account', 'facebook_page'));

ALTER TABLE public.client_binding_audit
  DROP CONSTRAINT IF EXISTS client_binding_audit_token_source_check;
ALTER TABLE public.client_binding_audit
  ADD CONSTRAINT client_binding_audit_token_source_check
  CHECK (token_source IN ('client_domain', 'client_page', 'shared_fallback', 'client_oauth'));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- apply 之后人工自验
-- 1. 内部员工在设置页保存一次主页 → 本表出现 binding_kind='facebook_page'、
--    outcome authorized→applied 一行。
-- 2. apply 之前保存主页会返回 500「审计记录写不进去」—— 预期行为（fail closed）。
-- ============================================================================
