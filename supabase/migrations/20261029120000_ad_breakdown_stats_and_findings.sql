-- =============================================================================
-- 20261029120000_ad_breakdown_stats_and_findings.sql
--
-- 目的：
--   广告机会挖掘（IMPACT · Check）的数据底座，两张表：
--     * public.ad_breakdown_stats      —— Meta 各种切法（小时 / 版位设备 / 年龄性别 / 地区）
--                                         按「广告 × 账户时区日期 × 切法值」存一行，长期保留。
--     * public.ad_opportunity_findings —— 统计筛选 + AI 解读后的「机会发现」与对照测试状态。
--   设计依据：docs/specs/2026-10-29-ads-opportunity-mining-design-v0.2.md §4.2 / §4.6，
--             docs/specs/2026-10-29-ads-opportunity-mining-design-v0.3.md §1.4 / §3。
--   本迁移不创建任何定时任务，不写入任何数据。
--
-- 幂等性：
--   可重复执行（CREATE TABLE/INDEX IF NOT EXISTS、CREATE OR REPLACE FUNCTION、
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER、策略与断言包裹在 DO 块中）。
--
-- 状态：
--   尚未 apply，等 PM 授权（「go apply」）。
--
-- 回滚：
--   DROP TABLE public.ad_opportunity_findings;
--   DROP TABLE public.ad_breakdown_stats;
--   （仅在 PM 授权后执行。）
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 表 1：ad_breakdown_stats
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_breakdown_stats (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    client_id       uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    ad_account_id   text        NOT NULL,
    level           text        NOT NULL DEFAULT 'ad',
    entity_id       text        NOT NULL,
    campaign_id     text        NULL,
    adset_id        text        NULL,
    stat_date       date        NOT NULL,
    breakdown_key   text        NOT NULL,
    breakdown_value jsonb       NOT NULL,
    breakdown_sig   text        NOT NULL,
    spend           numeric     NOT NULL DEFAULT 0,
    currency        text        NULL,
    impressions     bigint      NOT NULL DEFAULT 0,
    clicks          bigint      NOT NULL DEFAULT 0,
    link_clicks     bigint      NULL,
    meta_leads      integer     NULL,
    meta_messaging  integer     NULL,
    fetched_at      timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ad_breakdown_stats_pkey PRIMARY KEY (id),

    CONSTRAINT ad_breakdown_stats_level_check
        CHECK (level IN ('ad')),

    CONSTRAINT ad_breakdown_stats_breakdown_key_check
        CHECK (breakdown_key IN ('hour_account_tz', 'placement_device', 'age_gender', 'region')),

    CONSTRAINT ad_breakdown_stats_nonnegative_check
        CHECK (
            spend >= 0 AND impressions >= 0 AND clicks >= 0
            AND (link_clicks IS NULL OR link_clicks >= 0)
            AND (meta_leads IS NULL OR meta_leads >= 0)
            AND (meta_messaging IS NULL OR meta_messaging >= 0)
        ),

    CONSTRAINT ad_breakdown_stats_cell_key
        UNIQUE (ad_account_id, level, entity_id, stat_date, breakdown_key, breakdown_sig)
);

CREATE INDEX IF NOT EXISTS ad_breakdown_stats_client_key_date_idx
    ON public.ad_breakdown_stats (client_id, breakdown_key, stat_date);

CREATE INDEX IF NOT EXISTS ad_breakdown_stats_account_date_idx
    ON public.ad_breakdown_stats (ad_account_id, stat_date);

-- -----------------------------------------------------------------------------
-- 表 2：ad_opportunity_findings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_opportunity_findings (
    id                uuid        NOT NULL DEFAULT gen_random_uuid(),
    layer             text        NOT NULL,
    client_id         uuid        NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    industry_key      text        NULL,
    ad_account_id     text        NULL,
    finding_type      text        NOT NULL,
    window_start      date        NOT NULL,
    window_end        date        NOT NULL,
    cells             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    statistics        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    narrative         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    status            text        NOT NULL DEFAULT 'proposed',
    test_plan         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    pm_authorization  jsonb       NULL,
    verification      jsonb       NULL,
    receipt           jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ad_opportunity_findings_pkey PRIMARY KEY (id),

    CONSTRAINT ad_opportunity_findings_layer_check
        CHECK (
            (layer = 'client' AND client_id IS NOT NULL)
            -- 行业层不得带任何能认出具体客户的编号（客户 ID、广告账户号都不行）
            OR (layer = 'industry' AND client_id IS NULL AND ad_account_id IS NULL AND industry_key IS NOT NULL)
        ),

    CONSTRAINT ad_opportunity_findings_type_check
        CHECK (finding_type IN ('spend_leak', 'underfunded', 'interaction', 'time_of_day', 'quality_mismatch')),

    CONSTRAINT ad_opportunity_findings_status_check
        CHECK (status IN ('proposed', 'accepted', 'testing', 'verified', 'failed', 'dismissed')),

    CONSTRAINT ad_opportunity_findings_window_check
        CHECK (window_end >= window_start)
);

CREATE INDEX IF NOT EXISTS ad_opportunity_findings_client_status_idx
    ON public.ad_opportunity_findings (client_id, status, created_at DESC)
    WHERE layer = 'client';

CREATE INDEX IF NOT EXISTS ad_opportunity_findings_industry_idx
    ON public.ad_opportunity_findings (industry_key, created_at DESC)
    WHERE layer = 'industry';

-- -----------------------------------------------------------------------------
-- updated_at 触发器（两张表共用一个函数）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_opportunity_touch_updated_at()
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

REVOKE EXECUTE ON FUNCTION public.ad_opportunity_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ad_breakdown_stats_touch_updated_at ON public.ad_breakdown_stats;
CREATE TRIGGER ad_breakdown_stats_touch_updated_at
    BEFORE UPDATE ON public.ad_breakdown_stats
    FOR EACH ROW
    EXECUTE FUNCTION public.ad_opportunity_touch_updated_at();

DROP TRIGGER IF EXISTS ad_opportunity_findings_touch_updated_at ON public.ad_opportunity_findings;
CREATE TRIGGER ad_opportunity_findings_touch_updated_at
    BEFORE UPDATE ON public.ad_opportunity_findings
    FOR EACH ROW
    EXECUTE FUNCTION public.ad_opportunity_touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS：两张表都只许 service_role 访问
-- -----------------------------------------------------------------------------
ALTER TABLE public.ad_breakdown_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_opportunity_findings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    CREATE POLICY "service_role_full"
        ON public.ad_breakdown_stats
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END;
$$;

DO $$
BEGIN
    CREATE POLICY "service_role_full"
        ON public.ad_opportunity_findings
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END;
$$;

REVOKE ALL ON public.ad_breakdown_stats FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.ad_opportunity_findings FROM anon, authenticated, PUBLIC;

-- 不授予 TRUNCATE，并显式收回（Supabase 默认权限可能已给 service_role 全权限）。
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.ad_breakdown_stats FROM service_role;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.ad_opportunity_findings FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_breakdown_stats TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_opportunity_findings TO service_role;

-- -----------------------------------------------------------------------------
-- 注释（中文）
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.ad_breakdown_stats IS
    '广告机会挖掘数据底座：Meta 各切法按「广告 × 账户时区日期 × 切法值」一行；重拉同一格子覆盖；只读 Meta 写入，从不写回 Meta。';
COMMENT ON COLUMN public.ad_breakdown_stats.stat_date IS
    '广告账户时区的日期（Meta 按账户时区切天）。';
COMMENT ON COLUMN public.ad_breakdown_stats.breakdown_key IS
    '切法：hour_account_tz=账户时区小时；placement_device=版位+具体位置+设备；age_gender=年龄+性别；region=地区。';
COMMENT ON COLUMN public.ad_breakdown_stats.breakdown_value IS
    '切法取值，例 {"hour":21}、{"platform":"facebook","position":"feed","device":"iphone"}。';
COMMENT ON COLUMN public.ad_breakdown_stats.breakdown_sig IS
    '程序生成的切法取值文本键（固定键顺序），参与唯一键；避免 jsonb 写法差异被当成两个格子。';
COMMENT ON COLUMN public.ad_breakdown_stats.meta_leads IS
    'Meta 自报留资（lead 优先、lead_grouped 次之，取第一个出现的，不相加）；该切法 Meta 不给留资时为 NULL，不是 0。';
COMMENT ON COLUMN public.ad_breakdown_stats.meta_messaging IS
    'Meta 自报私信开聊数（取第一个出现的，不相加）；该切法 Meta 不给时为 NULL。';

COMMENT ON TABLE public.ad_opportunity_findings IS
    '广告机会发现与对照测试状态。layer=client 为客户私有；layer=industry 为同行业汇总，client_id 必须为空、只存相对指数。本表任何状态都不构成改广告的授权。';
COMMENT ON COLUMN public.ad_opportunity_findings.pm_authorization IS
    'PM 本人对开对照测试的逐条授权记录（谁、何时、绑定哪个测试方案）；为空 = 未授权。';

-- -----------------------------------------------------------------------------
-- 断言：迁移后自检（两张表逐一核对）
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_table        text;
    v_rls_enabled  boolean;
    v_bad_policy   text;
    v_bad_grant    text;
    v_missing_priv text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['ad_breakdown_stats', 'ad_opportunity_findings']
    LOOP
        -- 1) RLS 必须已启用
        SELECT c.relrowsecurity
          INTO v_rls_enabled
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = v_table;

        IF v_rls_enabled IS DISTINCT FROM true THEN
            RAISE EXCEPTION '%: RLS 未启用', v_table;
        END IF;

        -- 2) 不允许存在作用于 service_role 之外角色的策略（role_oid = 0 即 PUBLIC，同样算违规）
        v_bad_policy := NULL;
        SELECT p.polname
          INTO v_bad_policy
          FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = v_table
           AND EXISTS (
               SELECT 1
                 FROM unnest(p.polroles) AS r(role_oid)
                WHERE r.role_oid <> (SELECT oid FROM pg_roles WHERE rolname = 'service_role')
           )
         LIMIT 1;

        IF v_bad_policy IS NOT NULL THEN
            RAISE EXCEPTION '%: 存在作用于非 service_role 的策略 %', v_table, v_bad_policy;
        END IF;

        -- 3) anon / authenticated 不得拥有任何权限
        v_bad_grant := NULL;
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
           AND c.relname = v_table
           AND has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         LIMIT 1;

        IF v_bad_grant IS NOT NULL THEN
            RAISE EXCEPTION '%: 角色 % 仍拥有表权限', v_table, v_bad_grant;
        END IF;

        -- 4) service_role 必须拥有 SELECT / INSERT / UPDATE / DELETE
        v_missing_priv := NULL;
        SELECT priv
          INTO v_missing_priv
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN LATERAL (
              SELECT 'SELECT' AS priv
              UNION ALL SELECT 'INSERT'
              UNION ALL SELECT 'UPDATE'
              UNION ALL SELECT 'DELETE'
          ) p
         WHERE n.nspname = 'public'
           AND c.relname = v_table
           AND NOT has_table_privilege('service_role', c.oid, p.priv)
         LIMIT 1;

        IF v_missing_priv IS NOT NULL THEN
            RAISE EXCEPTION '%: service_role 缺少 % 权限', v_table, v_missing_priv;
        END IF;

        -- 5) service_role 不得拥有 TRUNCATE
        IF has_table_privilege('service_role', format('public.%I', v_table), 'TRUNCATE') THEN
            RAISE EXCEPTION '%: service_role 仍拥有 TRUNCATE 权限', v_table;
        END IF;

        -- 6) service_role_full 必须确为 FOR ALL TO service_role USING (true) WITH CHECK (true)
        IF NOT EXISTS (
            SELECT 1
              FROM pg_policy p
              JOIN pg_class c ON c.oid = p.polrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname = v_table
               AND p.polname = 'service_role_full'
               AND p.polcmd = '*'
               AND pg_get_expr(p.polqual, p.polrelid) = 'true'
               AND pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
               AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'service_role')]
        ) THEN
            RAISE EXCEPTION '%: service_role_full 策略缺失或定义不是 FOR ALL TO service_role USING (true) WITH CHECK (true)', v_table;
        END IF;
    END LOOP;
END;
$$;

COMMIT;
