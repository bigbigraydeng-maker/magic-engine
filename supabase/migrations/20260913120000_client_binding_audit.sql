-- ============================================================================
-- 客户外部账户绑定审计表（AD-SEC-3 · 2026-09-13）
--
-- ── 为什么需要 ───────────────────────────────────────────────────────────
-- `PATCH /api/clients/[id]/meta-ad-account` 原先任何能进这个客户后台的人
-- （包括客户自己的员工）都能改广告账户号，且不留痕。而广告写路径的归属校验
-- （src/lib/meta/campaign-ownership.ts）核对的正是这份登记 —— 改了登记就等于
-- 拿到了别家客户广告的写权限。修复后只有内部员工能改，这张表记下：
--   · 谁、什么时候、把哪个客户的账户从什么改成什么、结果如何；
--   · 客户在自助向导里提交、等 FDE 核实的账户号（requested_by_client），
--     由每日「需要你动手」待办读出来下发，不会死在表里。
--
-- ── 为什么是通用表而不是 meta 专名 ─────────────────────────────────────
-- 同类「客户可改的外部身份绑定」还有 Facebook 主页、Google Ads 客户号、
-- WhatsApp 号码，后续修复直接用 binding_kind 区分复用这张表。本迁移只允许
-- 'meta_ad_account' 一种；新增种类时改 CHECK。
--
-- ── 不做的事 ─────────────────────────────────────────────────────────────
-- 不加「同一广告账户只能属于一个客户」的数据库唯一约束：生产里 CTS/Oztop
-- 历史上共用过账户，当前是否仍共用未核实，加约束可能让本迁移 apply 失败。
-- 重复登记在应用层拒绝（需内部员工显式覆盖并写原因，记入本表）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_binding_audit (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES public.clients(id),
  binding_kind        text        NOT NULL CHECK (binding_kind IN ('meta_ad_account')),
  actor_email         text        NOT NULL CHECK (char_length(actor_email) <= 320),
  action              text        NOT NULL CHECK (action IN ('bind', 'clear', 'request', 'dismiss_request')),
  previous_value      text        CHECK (char_length(previous_value) <= 64),
  requested_value     text        CHECK (char_length(requested_value) <= 64),
  outcome             text        NOT NULL CHECK (outcome IN (
                        'authorized',          -- 已通过鉴权/核实/重复检查，正在写
                        'applied',             -- 写成功
                        'write_failed',        -- 写到一半失败（见 detail）
                        'requested_by_client', -- 客户提交，等 FDE 核实
                        'request_dismissed',   -- FDE 看过，决定不采用
                        'rejected_graph',      -- Meta 读不到这个账户 / 返回的账户号对不上
                        'rejected_no_token',   -- 这个客户没有可用的 Meta 令牌
                        'rejected_duplicate'   -- 已登记在别的客户名下，且没有显式覆盖
                      )),
  -- 'client_domain' | 'client_page' | 'shared_fallback'：核实用的是哪把令牌。
  -- shared_fallback 能看到多家客户的账户，所以核实通过 ≠ 账户属于这个客户。
  token_source        text        CHECK (token_source IN ('client_domain', 'client_page', 'shared_fallback')),
  graph_account       jsonb,
  shared_with_client_ids uuid[],
  override_reason     text        CHECK (char_length(override_reason) <= 500),
  detail              text        CHECK (char_length(detail) <= 500),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_binding_audit_client_kind_created
  ON public.client_binding_audit (client_id, binding_kind, created_at DESC);

-- 每日待办只扫「等 FDE 核实」的行。
CREATE INDEX IF NOT EXISTS idx_client_binding_audit_pending_requests
  ON public.client_binding_audit (binding_kind, created_at DESC)
  WHERE outcome = 'requested_by_client';

ALTER TABLE public.client_binding_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测教训）。
  CREATE POLICY "service_role_full" ON public.client_binding_audit
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- apply 之后要人工跑一遍的自验（测试只扫 SQL 文本，证明不了运行时行为）
-- ============================================================================
-- 1. 匿名读被拒：用 anon key 调 PostgREST GET /client_binding_audit → 期望 401/空。
-- 2. 内部员工在设置页改一次广告账户号 → 本表出现 authorized→applied 一行，
--    actor_email 是改的人。
-- 3. 在迁移 apply 之前，改广告账户号的接口会因为审计写不进去而拒绝写入
--    （fail closed，返回 500「审计记录写不进去」）—— 这是预期行为。
-- ============================================================================
