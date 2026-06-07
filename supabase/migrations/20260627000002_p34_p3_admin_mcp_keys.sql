-- Phase 34 P3 — FDE cross-client Admin MCP keys (2 审通过版)
--
-- 子牙架构 + 魏征第一轮 + 第二轮反馈全部落地。这是 MCP 系统最高敏感的一次变更:
-- admin key 跨所有客户,一把泄漏 = 全公司客户数据泄漏。设计原则:
--
--   1) 物理隔离:独立表 admin_api_keys(不复用 client_api_keys 的 NOT NULL client_id)
--   2) 前缀防呆:CHECK key_prefix LIKE 'me_admin_%' 防未来重构串库 [魏征 R1]
--   3) 双 FK 审计:mcp_access_log 加 client_key_id/admin_key_id 互斥列,不 drop 老 FK [魏征 R2]
--   4) Kill-switch DB 层:api_key_settings.admin_revoke_all_before 单行表(全局元数据,
--      PM UI 一键吊销所有 admin key 无需逐行 update,无需 Render 重启)[魏征 R3 层 1]
--   5) IP allowlist 软启用:cidr[] 默认空,UI 红警 + SOP 24h 必须补,GIN 索引 [Y1 + M1]
--   6) 90 天过期 DB CHECK:防 UI bug 颁发 10 年期 key [Y2]
--   7) name UNIQUE per owner (active only):防 UI 混淆 [Y6]
--   8) last_used_ip / created_by_ip:取证字段 [Y6]
--   9) admin_key_issue_confirms 表:colleague-confirm 字段先建好,首把降级 web 端 confirm 弹窗 [Z2]
--  10) api_key_settings singleton index:防手抖 INSERT 出第二行让 kill-switch 变薛定谔 [魏征 M2]
--  11) mcp_access_log.source_ip 用 inet 类型(支持 cidr 运算符,可索引)[魏征 M3]
--
-- RLS: 沿用 ME 既有 service_role 模板(CLAUDE.md 强约束)
-- 不引用 workspace_id / client_team / auth.uid / auth.jwt(grep 自证见 commit message)


-- ============================================================
-- 1) 现有 client_api_keys 加前缀防呆 CHECK (R1)
-- ============================================================
ALTER TABLE public.client_api_keys
  ADD CONSTRAINT client_api_keys_prefix_check
    CHECK (key_prefix LIKE 'me_live_%');


-- ============================================================
-- 2) admin_api_keys — 物理隔离的 admin key 表
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_api_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash         text NOT NULL UNIQUE,
  key_prefix       text NOT NULL,
  name             text NOT NULL,
  owner_email      text NOT NULL,
  scopes           text[] NOT NULL DEFAULT ARRAY['admin:read:all']::text[],

  -- Y1: IP 软启用 — 空数组放行 + UI 红警,SOP 24h 必须补,下个 PR 提硬约束
  ip_allowlist     cidr[] NOT NULL DEFAULT ARRAY[]::cidr[],

  -- Y2: DB 层强制有效期上下限(防 UI bug 颁发 10 年期 key)
  expires_at       timestamptz NOT NULL,

  last_used_at     timestamptz,
  last_used_ip     inet,                              -- Y6 取证
  created_by_email text NOT NULL,
  created_by_ip    inet,                              -- Y6 起源
  revoked_at       timestamptz,
  revoked_by_email text,
  revoked_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- R1 前缀防呆
  CONSTRAINT admin_api_keys_prefix_check
    CHECK (key_prefix LIKE 'me_admin_%'),

  -- Y2 有效期上下限 (1 秒 ~ 180 天)
  CONSTRAINT admin_api_keys_expires_window
    CHECK (expires_at > created_at
       AND expires_at <= created_at + interval '180 days')
);

-- Y6 同人同名活跃唯一(已吊销不算)
CREATE UNIQUE INDEX IF NOT EXISTS admin_api_keys_owner_name_active_unique
  ON public.admin_api_keys (owner_email, name)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_api_keys_hash
  ON public.admin_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_admin_api_keys_active
  ON public.admin_api_keys(expires_at)
  WHERE revoked_at IS NULL;

-- M1 (魏征二审): IP 匹配查询将来要用 cidr 运算符(<<=),必须 GIN 索引
CREATE INDEX IF NOT EXISTS idx_admin_api_keys_ip_allowlist_gin
  ON public.admin_api_keys USING GIN (ip_allowlist);

ALTER TABLE public.admin_api_keys ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.admin_api_keys FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE public.admin_api_keys IS
  'Phase 34 P3 - FDE cross-client MCP keys. NEVER reuse for client access. '
  'Different prefix (me_admin_), different table, different endpoint '
  '(/api/mcp-admin/[transport]), different scoped-queries module. '
  'Hard ceilings: 180-day expiry, ip_allowlist filled within 24h SOP, '
  'kill-switch via api_key_settings.admin_revoke_all_before.';
COMMENT ON COLUMN public.admin_api_keys.ip_allowlist IS
  'Empty array = unrestricted (allowed at MVP for first key only - UI shows red '
  'warning). Production keys MUST be CIDR-restricted within 24h per SOP. '
  'verifyApiKey enforces x-forwarded-for first segment when non-empty.';


-- ============================================================
-- 3) api_key_settings — 全局 kill-switch 元数据(R3 层 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.api_key_settings (
  id                       int  PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  admin_revoke_all_before  timestamptz NOT NULL DEFAULT 'epoch',
  client_revoke_all_before timestamptz NOT NULL DEFAULT 'epoch',
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by_email         text
);
INSERT INTO public.api_key_settings(id) VALUES (1) ON CONFLICT DO NOTHING;

-- M2 (魏征二审): 单行表防御 — 防手抖 INSERT 第二行让 kill-switch 变薛定谔
CREATE UNIQUE INDEX IF NOT EXISTS api_key_settings_singleton
  ON public.api_key_settings ((true));

ALTER TABLE public.api_key_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.api_key_settings FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE public.api_key_settings IS
  'Singleton row (id=1, also forced via PARTIAL unique index). Holds global '
  'kill-switches. verifyApiKey treats any admin key with '
  'created_at < admin_revoke_all_before as revoked (no need to UPDATE every row). '
  'Audit trail preserved. UI button at /dashboard/admin/mcp-keys.';


-- ============================================================
-- 4) admin_key_issue_confirms — Z2 colleague-confirm 字段先建好
-- ============================================================
-- 首把降级:web 端二次确认弹窗,不查这张表
-- 下个 PR 切到真 colleague flow(同事 email + 6 位 code)只动 API,不动 schema
CREATE TABLE IF NOT EXISTS public.admin_key_issue_confirms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email text NOT NULL,
  confirmer_email text NOT NULL,
  code_hash       text NOT NULL,                      -- sha256(6-digit code)
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT confirm_window
    CHECK (expires_at > created_at
       AND expires_at <= created_at + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_admin_key_issue_confirms_lookup
  ON public.admin_key_issue_confirms (requester_email, confirmer_email, consumed_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.admin_key_issue_confirms ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.admin_key_issue_confirms FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE public.admin_key_issue_confirms IS
  'Z2 (Phase 34 P3) - colleague-confirm code for admin key issuance. '
  'MVP first issuance uses web-side confirm() dialog only - this table empty. '
  'Future PR enables full colleague flow without schema change.';


-- ============================================================
-- 5) mcp_access_log — R2 双 FK 互斥 + 取证字段 + key_kind
-- ============================================================
ALTER TABLE public.mcp_access_log
  ADD COLUMN IF NOT EXISTS key_kind      text,                                                              -- 'client'|'admin'|NULL(老数据)
  ADD COLUMN IF NOT EXISTS client_key_id uuid REFERENCES public.client_api_keys(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS admin_key_id  uuid REFERENCES public.admin_api_keys(id)  ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_ip     inet;                                                              -- M3: inet 支持 cidr 运算符

-- 老 key_id 列保留 NULL-able,本 PR 不 drop(等数据完全切流后下个 PR 处理)
ALTER TABLE public.mcp_access_log ALTER COLUMN key_id DROP NOT NULL;
-- admin 调用 client_id 可空(me_admin_list_clients 等不针对单客户的工具)
ALTER TABLE public.mcp_access_log ALTER COLUMN client_id DROP NOT NULL;

-- R2 三分支 CHECK(魏征二审:每个分支必须显式声明另外两列 NULL,否则 admin 行可能
-- 同时写老 key_id + 新 admin_key_id,数据脏)
ALTER TABLE public.mcp_access_log
  ADD CONSTRAINT mcp_access_log_key_ref_xor CHECK (
    -- 老数据:key_kind IS NULL,只走老 key_id,新双 FK 全 NULL
    (key_kind IS NULL  AND key_id IS NOT NULL
      AND client_key_id IS NULL AND admin_key_id IS NULL)
    OR
    -- 新 client:走 client_key_id,admin_key_id 和老 key_id 都 NULL
    (key_kind = 'client' AND client_key_id IS NOT NULL
      AND admin_key_id IS NULL AND key_id IS NULL)
    OR
    -- 新 admin:走 admin_key_id,client_key_id 和老 key_id 都 NULL
    (key_kind = 'admin'  AND admin_key_id IS NOT NULL
      AND client_key_id IS NULL AND key_id IS NULL)
  );

-- backfill 老数据 key_kind(魏征二审要求:本 PR 一次性补,避免下个 PR 还要再迁)
-- Phase 34 上线后到 P3 之前所有 log 都只可能是 client(没有 admin 表)
UPDATE public.mcp_access_log
  SET key_kind = 'client',
      client_key_id = key_id
  WHERE key_kind IS NULL AND key_id IS NOT NULL;

-- 然后把老分支收紧:经过 backfill 后理论上没有 key_kind IS NULL 的行了,但 CHECK
-- 保留容忍老分支,留个台阶给未来数据库恢复场景。下个 PR 老 key_id 真正下线时,
-- 重写 CHECK 只保留 client/admin 两分支。

CREATE INDEX IF NOT EXISTS idx_mcp_access_log_admin_ts
  ON public.mcp_access_log(admin_key_id, created_at DESC)
  WHERE admin_key_id IS NOT NULL;

COMMENT ON COLUMN public.mcp_access_log.key_kind IS
  '''client''|''admin''|NULL(legacy pre-backfill, never NULL after this migration). '
  'Used by R2 三分支 CHECK + audit queries.';
COMMENT ON COLUMN public.mcp_access_log.source_ip IS
  'M3: inet type (supports cidr operators like <<=). Filled by verifyApiKey side-effect.';
