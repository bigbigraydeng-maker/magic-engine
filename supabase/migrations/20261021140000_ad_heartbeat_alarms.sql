-- =============================================================================
-- 20261021140000_ad_heartbeat_alarms.sql
--
-- 目的：
--   为广告心跳（ad heartbeat）功能创建单表 public.ad_heartbeat_alarms。
--   该表同时存放两类行（由 row_kind 区分）：
--     * 'state' —— 每小时心跳写入的“当前状态”行（每个 client 一行，按 dedupe_key 去重）；
--     * 'alarm' —— 告警行（按 dedupe_key 去重，记录首次/最近出现、是否已恢复、出现次数等）。
--   设计依据：docs/specs/2026-10-21-ad-heartbeat-design-v0.2.md §3 / §9。
--   7 天清理（purge）由心跳函数自身完成，本迁移不创建任何定时任务。
--
-- 幂等性：
--   本迁移可重复执行（CREATE TABLE/INDEX IF NOT EXISTS、CREATE OR REPLACE FUNCTION、
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER、策略与断言均包裹在 DO 块中）。
--
-- 状态：
--   尚未 apply，等 PM 授权。
--
-- 回滚：
--   DROP TABLE public.ad_heartbeat_alarms;
--   （仅在 PM 授权后执行；会一并删除其索引、触发器与策略。）
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 表
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_heartbeat_alarms (
    id            uuid        NOT NULL DEFAULT gen_random_uuid(),
    client_id     uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    ad_account_id text        NOT NULL,
    row_kind      text        NOT NULL,
    dedupe_key    text        NOT NULL,
    alarm_type    text        NULL,
    object_id     text        NULL,
    severity      text        NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at   timestamptz NULL,
    occurrences   integer     NOT NULL DEFAULT 1,
    last_state    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    evidence      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ad_heartbeat_alarms_pkey PRIMARY KEY (id),

    CONSTRAINT ad_heartbeat_alarms_row_kind_check
        CHECK (row_kind IN ('state', 'alarm')),

    CONSTRAINT ad_heartbeat_alarms_alarm_type_check
        CHECK (
            (row_kind = 'state' AND alarm_type IS NULL)
            OR (row_kind = 'alarm' AND alarm_type IN (
                'zero_spend',
                'overspend',
                'status_change',
                'account_status',
                'read_failed',
                'heartbeat_stalled'
            ))
        ),

    CONSTRAINT ad_heartbeat_alarms_severity_check
        CHECK (severity IS NULL OR severity IN ('yellow', 'red')),

    CONSTRAINT ad_heartbeat_alarms_occurrences_check
        CHECK (occurrences >= 1),

    CONSTRAINT ad_heartbeat_alarms_client_id_dedupe_key_key
        UNIQUE (client_id, dedupe_key)
);

-- -----------------------------------------------------------------------------
-- 索引
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ad_heartbeat_alarms_client_kind_seen_idx
    ON public.ad_heartbeat_alarms (client_id, row_kind, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS ad_heartbeat_alarms_client_open_alarms_idx
    ON public.ad_heartbeat_alarms (client_id, last_seen_at DESC)
    WHERE row_kind = 'alarm' AND resolved_at IS NULL;

-- -----------------------------------------------------------------------------
-- updated_at 触发器
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_heartbeat_alarms_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ad_heartbeat_alarms_touch_updated_at
    ON public.ad_heartbeat_alarms;

CREATE TRIGGER ad_heartbeat_alarms_touch_updated_at
    BEFORE UPDATE ON public.ad_heartbeat_alarms
    FOR EACH ROW
    EXECUTE FUNCTION public.ad_heartbeat_alarms_touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS：仅 service_role 可访问
-- -----------------------------------------------------------------------------
ALTER TABLE public.ad_heartbeat_alarms ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    CREATE POLICY "service_role_full"
        ON public.ad_heartbeat_alarms
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END;
$$;

REVOKE ALL ON public.ad_heartbeat_alarms FROM anon, authenticated, PUBLIC;

-- Supabase 默认权限通常已覆盖 service_role，但这里显式声明，避免依赖环境默认值。
-- 注意：不授予 TRUNCATE。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_heartbeat_alarms TO service_role;

-- -----------------------------------------------------------------------------
-- 注释（中文）
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.ad_heartbeat_alarms IS
    '广告心跳单表：同时存放每小时状态行（row_kind=state）与告警行（row_kind=alarm），按 (client_id, dedupe_key) 去重；7 天清理由心跳函数自身完成。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.id IS
    '主键，uuid，默认 gen_random_uuid()。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.client_id IS
    '所属客户 ID，外键引用 public.clients(id)，客户删除时级联删除。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.ad_account_id IS
    '广告账户 ID（外部系统标识，文本）。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.row_kind IS
    '行类型：state=每小时状态行；alarm=告警行。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.dedupe_key IS
    '去重键，与 client_id 组成唯一约束，用于 upsert 合并同一状态/告警。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.alarm_type IS
    '告警类型：state 行必须为 NULL；alarm 行取值 zero_spend/overspend/status_change/account_status/read_failed/heartbeat_stalled。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.object_id IS
    '告警关联对象 ID（如广告系列/广告组/广告 ID），可为空。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.severity IS
    '告警严重级别：yellow 或 red；可为空。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.first_seen_at IS
    '首次出现时间。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.last_seen_at IS
    '最近一次出现/更新时间。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.resolved_at IS
    '恢复（解除）时间；NULL 表示仍未恢复。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.occurrences IS
    '累计出现次数，最小为 1。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.last_state IS
    '最近一次状态快照（jsonb），默认空对象。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.evidence IS
    '证据数据（jsonb），如原始响应片段、阈值等，默认空对象。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.created_at IS
    '创建时间。';

COMMENT ON COLUMN public.ad_heartbeat_alarms.updated_at IS
    '更新时间，由 BEFORE UPDATE 触发器自动维护。';

-- -----------------------------------------------------------------------------
-- 断言：迁移后自检
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_rls_enabled boolean;
    v_bad_policy  text;
    v_bad_grant   text;
    v_missing_priv text;
BEGIN
    -- 1) RLS 必须已启用
    SELECT c.relrowsecurity
      INTO v_rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'ad_heartbeat_alarms';

    IF v_rls_enabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'ad_heartbeat_alarms: RLS 未启用';
    END IF;

    -- 2) 不允许存在作用于 service_role 之外角色的策略
    SELECT p.polname
      INTO v_bad_policy
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'ad_heartbeat_alarms'
       AND EXISTS (
           SELECT 1
             FROM unnest(p.polroles) AS r(role_oid)
            WHERE r.role_oid <> 0
              AND r.role_oid <> (SELECT oid FROM pg_roles WHERE rolname = 'service_role')
       )
     LIMIT 1;

    IF v_bad_policy IS NOT NULL THEN
        RAISE EXCEPTION 'ad_heartbeat_alarms: 存在作用于非 service_role 的策略 %', v_bad_policy;
    END IF;

    -- 3) anon / authenticated 不得拥有任何权限
    SELECT r.rolname
      INTO v_bad_grant
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL (
          SELECT 'anon' AS rolname
          UNION ALL
          SELECT 'authenticated'
      ) r
     WHERE n.nspname = 'public'
       AND c.relname = 'ad_heartbeat_alarms'
       AND has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     LIMIT 1;

    IF v_bad_grant IS NOT NULL THEN
        RAISE EXCEPTION 'ad_heartbeat_alarms: 角色 % 仍拥有表权限', v_bad_grant;
    END IF;

    -- 4) service_role 必须拥有 SELECT / INSERT / UPDATE / DELETE
    SELECT priv
      INTO v_missing_priv
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL (
          SELECT 'SELECT' AS priv
          UNION ALL
          SELECT 'INSERT'
          UNION ALL
          SELECT 'UPDATE'
          UNION ALL
          SELECT 'DELETE'
      ) p
     WHERE n.nspname = 'public'
       AND c.relname = 'ad_heartbeat_alarms'
       AND NOT has_table_privilege('service_role', c.oid, p.priv)
     LIMIT 1;

    IF v_missing_priv IS NOT NULL THEN
        RAISE EXCEPTION 'ad_heartbeat_alarms: service_role 缺少 % 权限', v_missing_priv;
    END IF;
END;
$$;

COMMIT;
