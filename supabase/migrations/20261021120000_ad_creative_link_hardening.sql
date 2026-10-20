-- =============================================================================
-- 广告素材补链 · 硬化迁移（schema 半边）
-- 119 号 · 2026-10-21 · 依据 docs/specs/2026-10-21-ad-creative-link-implementation-design-s1.md
-- （冲突时 s1 > v0.6 > v0.5 > v0.4 > v0.3）
--
-- WHAT
-- ----
-- 1) 给 public.ad_creative_links 补齐硬化所需列（link_source / attestation_id /
--    meta_creative_id / meta_created_time / creative_checked_at / stale_at /
--    retracted_* / source_video_id），并把现存 4 行标为 backfill_pre_hardening。
-- 2) 新建三张追加式表：creative_binding_attestations（签字）、link_swap_intents
--    （换创意意图）、link_stale_reasons（stale 原因追加）。
-- 3) 四张表全部 ENABLE ROW LEVEL SECURITY + `FOR ALL TO service_role USING (true)`，
--    并额外加 `ad_link_fn_owner_full` 策略（函数属主是唯一写入者，RLS 保持开启），
--    随后 REVOKE 掉 service_role/anon/authenticated/PUBLIC 的写权限 —— 写只能走
--    SECURITY DEFINER 函数。
-- 4) 六个 NOLOGIN 写入角色 + 一个 NOLOGIN 函数属主 ad_link_fn_owner。
-- 5) 七个窄函数（每个写入者一个），只授对应角色的 EXECUTE。
-- 6) ad_creative_links 上的 BEFORE UPDATE/DELETE/TRUNCATE 触发器：已解析行只放行
--    受审写入（stale_at 单向、retracted_* 经 link_retract_v1、creative_checked_at
--    经 link_touch_checked_v1），其余一律拒。
-- 7) 末尾 ASSERTIONS：权限矩阵逐格断言，多出的授权 = 红。
--
-- WHY
-- ---
-- 20260801000001 建了 ad_creative_links，但当时只有 service_role 直写（PostgREST
-- upsert），等于「谁都能改归因」。s1 §2 要求：RLS 只是行级兜底，列级/表级 REVOKE
-- 在 RLS 之上生效，service_role 只保留 SELECT；写只能经 DEFINER 函数。本迁移就是
-- 把这条规则落成 schema。
--
-- ⚠️ 尚未 apply，等 PM 授权。
--    库内版本以 supabase_migrations.schema_migrations 为准。
--    本文件只写文件，不应用；应用须 PM 明确授权（风险级 A）。
--
-- ROLLBACK（仅 PM 授权迁移可执行，单向原则不变）
-- ------------------------------------------------
-- 回滚 = 另写一条 PM 授权的迁移，按相反顺序：
--   DROP TRIGGER ... ON ad_creative_links;
--   DROP FUNCTION link_touch_checked_v1, link_mark_stale_v1, link_retract_v1,
--                 creative_binding_attest_v1, link_ad_backfill_v1,
--                 link_ad_registration_v1, link_ad_at_creation_v1,
--                 creative_link_has_pending_swap, creative_binding_is_valid;
--   DROP TABLE link_stale_reasons, link_swap_intents, creative_binding_attestations;
--   ALTER TABLE ad_creative_links DROP COLUMN ...（新增列）;
--   ALTER TABLE content_work_orders DROP COLUMN final_mp4_sha256;
--   REVOKE/GRANT 复原（service_role 写权限复原 = 回到硬化前的不安全状态，需 PM 书面同意）;
--   DROP ROLE ad_link_*（先 REASSIGN OWNED / DROP OWNED）。
-- 不提供「静默回滚」：任何回滚都必须带理由与授权记录。
--
-- 未核实（如实写，不假装）
-- ------------------------
-- · 各角色凭据落点与轮换：本迁移只建 NOLOGIN 角色，不建任何 LOGIN 凭据。
--   凭据放哪（Render 环境变量按服务拆分？Supabase 角色密码如何轮换？）是
--   实现设计第一节的核实项，核实前不假设可行。若自动登记与签字同属一个
--   Render 服务且共享环境变量 = 名义隔离，文档与 PR 描述须降级为
--   「生产方≠验收方只靠流程」，不得声称数据库层强制。
-- · content_work_orders.final_mp4_sha256 由本迁移新增，但本迁移不写入它。
--   出片管道渲染完成时写入是后续块的工作；在接线之前该列恒为 NULL，
--   因此所有签字一律视为无效（creative_binding_is_valid 返回 false）。
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0. 角色（NOLOGIN，无凭据）
-- =============================================================================
-- 六个写入角色 + 一个函数属主。全部 NOLOGIN：本迁移不创建任何登录凭据。
-- 凭据落点是单独的、未核实的步骤（见文件头「未核实」）。
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'ad_link_creation_rw',
    'ad_link_registration_rw',
    'ad_link_attest_rw',
    'ad_link_backfill_rw',
    'ad_link_retract_rw',
    'ad_link_stale_rw',
    'ad_link_fn_owner'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

-- 函数属主：不可登录专用角色。函数 SET search_path 钉死（见各函数）。
-- 注意：ad_link_fn_owner 必须能读 content_work_orders / ad_creative_links 等表，
-- 否则 DEFINER 函数读不到工单。这里只授 SELECT（写仍走函数体，函数体自己控制）。
GRANT USAGE ON SCHEMA public TO ad_link_fn_owner;
GRANT SELECT ON public.ad_creative_links TO ad_link_fn_owner;
-- content_work_orders 的 SELECT 授权：若表存在则授（幂等，缺表不报错）。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'content_work_orders'
  ) THEN
    EXECUTE 'GRANT SELECT ON public.content_work_orders TO ad_link_fn_owner';
  END IF;
END $$;

-- =============================================================================
-- 1. ad_creative_links 补列
-- =============================================================================
ALTER TABLE public.ad_creative_links
  ADD COLUMN IF NOT EXISTS link_source        text,
  ADD COLUMN IF NOT EXISTS source_video_id    text,
  ADD COLUMN IF NOT EXISTS attestation_id     uuid,
  ADD COLUMN IF NOT EXISTS meta_creative_id   text,
  ADD COLUMN IF NOT EXISTS meta_created_time  timestamptz,
  ADD COLUMN IF NOT EXISTS creative_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at           timestamptz,
  ADD COLUMN IF NOT EXISTS retracted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS retracted_by       text,
  ADD COLUMN IF NOT EXISTS retract_reason     text;

-- 现存 4 行（全部 link_method='unresolved', created_by='winner_reel_sync'）
-- 标为 backfill_pre_hardening：它们是硬化前写入的，来源不可考，如实留痕。
UPDATE public.ad_creative_links
   SET link_source = 'backfill_pre_hardening'
 WHERE link_source IS NULL;

COMMENT ON COLUMN public.ad_creative_links.link_source IS
  '这条关联行由哪条路径写入：ad_creation_path / registration_entry / backfill_<批次> / backfill_pre_hardening（硬化前存量）。真相源在 TypeScript，库里不加 CHECK。';
COMMENT ON COLUMN public.ad_creative_links.source_video_id IS
  'ME 出片管道侧的稳定视频 id（与 creative_ref 区分：creative_ref 指向工单/草稿行，source_video_id 指向视频资产本身）。可空。';
COMMENT ON COLUMN public.ad_creative_links.attestation_id IS
  '指向 creative_binding_attestations.id。已解析行一旦写入不可改（触发器拦）；重签后广告走新关联行，旧行标 stale，二者并存可追溯。';
COMMENT ON COLUMN public.ad_creative_links.meta_creative_id IS
  'Meta 侧当前创意编号。每日扫描读 Meta 后写入/刷新，用于对账（s1 §5）。';
COMMENT ON COLUMN public.ad_creative_links.meta_created_time IS
  'Meta 侧广告创建时间（原 ad_created_at 改名）。登记入口读 Meta 时写入。';
COMMENT ON COLUMN public.ad_creative_links.creative_checked_at IS
  '最近一次读 Meta 确认创意编号的时刻。只经 link_touch_checked_v1 写。台账要求距今 ≤ 30 小时（s1 §5）。';
COMMENT ON COLUMN public.ad_creative_links.stale_at IS
  '首次标 stale 的时刻。只能从 NULL 变有值，永不回退（触发器拦）。原因另存 link_stale_reasons（追加式）。';
COMMENT ON COLUMN public.ad_creative_links.retracted_at IS
  '撤回时刻。只经 link_retract_v1 写（会话标志 app.ad_link_fn=''retract''）。';
COMMENT ON COLUMN public.ad_creative_links.retracted_by IS
  '撤回操作人（管理员会话邮箱）。只经 link_retract_v1 写。';
COMMENT ON COLUMN public.ad_creative_links.retract_reason IS
  '撤回理由（PM 授权 + 理由）。只经 link_retract_v1 写。';

COMMENT ON COLUMN public.ad_creative_links.link_method IS
  '怎么认出来的。词表（真相源 src/lib/ads/creative-link.ts 的 LinkMethod，库里不加 CHECK）：published_post_id | asset_binding | asset_binding_provisional | unresolved。已解析 = 前三者；unresolved = 没认出来（原因见 unresolved_reason）。';

-- =============================================================================
-- 1.1 content_work_orders 补列：最终成片 mp4 的 sha256
-- =============================================================================
-- 签字有效性 = 签字哈希 == 工单此刻文件哈希（s1 §1）。工单表原本没有哈希列，
-- 本迁移补上。本迁移不写入该列：由出片管道渲染完成时写入（后续块接线）。
-- 在接线之前该列恒为 NULL，因此所有签字一律视为无效。
ALTER TABLE public.content_work_orders
  ADD COLUMN IF NOT EXISTS final_mp4_sha256 text;

COMMENT ON COLUMN public.content_work_orders.final_mp4_sha256 IS
  '最终成片 mp4 的 sha256;由出片管道渲染完成时写入(后续块接线,本迁移不写);NULL = 未记录,签字一律视为无效';

-- =============================================================================
-- 2. 追加式表
-- =============================================================================

-- 2.1 签字表
CREATE TABLE IF NOT EXISTS public.creative_binding_attestations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  work_order_id      uuid NOT NULL,
  video_id           text,
  final_mp4_sha256   text NOT NULL,
  meta_video_length_s numeric,
  signed_by          text NOT NULL,
  signed_at          timestamptz NOT NULL DEFAULT now(),
  retracted_at       timestamptz,
  retracted_by       text,
  retract_reason     text
);

-- 唯一键只约束未撤回行：撤回后对同哈希重签 = 新建一条带新序号的签字（旧撤回行保留）。
-- 部分索引条件只引用本行固定列（retracted_at），可行。
CREATE UNIQUE INDEX IF NOT EXISTS creative_binding_attestations_active_key
  ON public.creative_binding_attestations (work_order_id, final_mp4_sha256)
  WHERE retracted_at IS NULL;

CREATE INDEX IF NOT EXISTS creative_binding_attestations_work_order_idx
  ON public.creative_binding_attestations (client_id, work_order_id);

COMMENT ON TABLE public.creative_binding_attestations IS
  'PM 对「这条片子的最终 mp4」的签字。追加式：撤回只置 retracted_*，不删行。有效 = 哈希等于工单此刻文件哈希 ∧ retracted_at 为空（唯一定义在 creative_binding_is_valid）。';
COMMENT ON COLUMN public.creative_binding_attestations.final_mp4_sha256 IS
  '签字时 PM 看过的最终 mp4 的 sha256。读取时与工单此刻哈希现场比对，不靠存储字段。';
COMMENT ON COLUMN public.creative_binding_attestations.signed_by IS
  '签字人（管理员会话邮箱）。数据库函数无法自验此值，签字真伪的根仍是管理员会话（s1 §2）。';
COMMENT ON COLUMN public.creative_binding_attestations.retracted_at IS
  '撤回时刻。只经 link_retract_v1 写。已撤回的签字不得被引用，也不会因哈希回到旧值而复活。';

-- 2.2 换创意意图表（追加式；只有 resolving 字段可经 link_mark_stale_v1 更新）
CREATE TABLE IF NOT EXISTS public.link_swap_intents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id          uuid NOT NULL REFERENCES public.ad_creative_links(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  old_creative_id  text NOT NULL,
  new_creative_id  text NOT NULL,
  state            text NOT NULL DEFAULT 'swap_pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution       text
);

CREATE INDEX IF NOT EXISTS link_swap_intents_link_idx
  ON public.link_swap_intents (link_id, state);

COMMENT ON TABLE public.link_swap_intents IS
  '换创意意图（追加式，不置 stale_at）。先写意图再调 Meta。state: swap_pending | result_unknown | resolved。只有换创意被确认成功才置关联行 stale_at（s1 §3）。';
COMMENT ON COLUMN public.link_swap_intents.state IS
  'swap_pending（调 Meta 前）/ result_unknown（超时/崩溃/网络断）/ resolved（对账或明确结果后）。读取方见 s1 §3 状态机。';
COMMENT ON COLUMN public.link_swap_intents.resolution IS
  'resolved 时的结论：confirmed_success | confirmed_failure | reconciled_old | reconciled_new | reconciled_third_party。只经 link_mark_stale_v1 写。';

-- 2.3 stale 原因追加表（只增不改，只有 link_mark_stale_v1 能写）
CREATE TABLE IF NOT EXISTS public.link_stale_reasons (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id  uuid NOT NULL REFERENCES public.ad_creative_links(id) ON DELETE CASCADE,
  reason   text NOT NULL,
  at       timestamptz NOT NULL DEFAULT now(),
  by       text
);

CREATE INDEX IF NOT EXISTS link_stale_reasons_link_idx
  ON public.link_stale_reasons (link_id, at DESC);

COMMENT ON TABLE public.link_stale_reasons IS
  'stale 原因追加表：只增不改。后来发现别的问题可追加，不覆盖。只有 link_mark_stale_v1 能写（列入权限矩阵断言）。';

-- =============================================================================
-- 3. RLS + REVOKE
-- =============================================================================
-- RLS 只是行级兜底；列级/表级 REVOKE 在 RLS 之上生效。
-- service_role 只保留 SELECT；写只能经 SECURITY DEFINER 函数（函数属主绕过 RLS）。
-- 迁移里同时写 RLS 策略与 REVOKE，并加断言测试证明两者并存时直写被拒（s1 §2）。
--
-- 注意：ad_link_fn_owner 不是表属主、也没有 BYPASSRLS，因此 RLS 开启后
-- DEFINER 函数（以 ad_link_fn_owner 身份执行）的 INSERT/UPDATE 会被 RLS 拦。
-- 所以每张表除 service_role_full 外，另加 ad_link_fn_owner_full 策略：
-- 函数属主是唯一写入者，RLS 保持开启（不关 RLS，只给属主一条 FOR ALL 策略）。

ALTER TABLE public.ad_creative_links              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_binding_attestations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_swap_intents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_stale_reasons             ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- ad_creative_links 已有 service_role_full 策略（20260801000001），幂等重建。
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_creative_links'
      AND policyname = 'service_role_full'
  ) THEN
    CREATE POLICY "service_role_full" ON public.ad_creative_links
      FOR ALL TO service_role USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'creative_binding_attestations'
      AND policyname = 'service_role_full'
  ) THEN
    CREATE POLICY "service_role_full" ON public.creative_binding_attestations
      FOR ALL TO service_role USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'link_swap_intents'
      AND policyname = 'service_role_full'
  ) THEN
    CREATE POLICY "service_role_full" ON public.link_swap_intents
      FOR ALL TO service_role USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'link_stale_reasons'
      AND policyname = 'service_role_full'
  ) THEN
    CREATE POLICY "service_role_full" ON public.link_stale_reasons
      FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- 函数属主策略：ad_link_fn_owner 是唯一写入者（DEFINER 函数以它的身份执行）。
-- RLS 保持开启；这条策略只给属主放行，不给任何其他角色放行。
-- 幂等：先 DROP IF EXISTS 再 CREATE。
DROP POLICY IF EXISTS ad_link_fn_owner_full ON public.ad_creative_links;
CREATE POLICY ad_link_fn_owner_full ON public.ad_creative_links
  FOR ALL TO ad_link_fn_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ad_link_fn_owner_full ON public.creative_binding_attestations;
CREATE POLICY ad_link_fn_owner_full ON public.creative_binding_attestations
  FOR ALL TO ad_link_fn_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ad_link_fn_owner_full ON public.link_swap_intents;
CREATE POLICY ad_link_fn_owner_full ON public.link_swap_intents
  FOR ALL TO ad_link_fn_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ad_link_fn_owner_full ON public.link_stale_reasons;
CREATE POLICY ad_link_fn_owner_full ON public.link_stale_reasons
  FOR ALL TO ad_link_fn_owner USING (true) WITH CHECK (true);

-- REVOKE 写权限：service_role / anon / authenticated / PUBLIC 一律无写。
-- 注意：REVOKE 在 RLS 之上生效 —— 即使策略允许，表级权限被收回后直写仍被拒。
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.ad_creative_links,
     public.creative_binding_attestations,
     public.link_swap_intents,
     public.link_stale_reasons
  FROM service_role, anon, authenticated, PUBLIC;

-- service_role 只保留 SELECT（读归因、读台账）。
GRANT SELECT
  ON public.ad_creative_links,
     public.creative_binding_attestations,
     public.link_swap_intents,
     public.link_stale_reasons
  TO service_role;

-- 六个写入角色对表无直接写权限（写只能经各自函数）。
REVOKE ALL
  ON public.ad_creative_links,
     public.creative_binding_attestations,
     public.link_swap_intents,
     public.link_stale_reasons
  FROM ad_link_creation_rw, ad_link_registration_rw, ad_link_attest_rw,
       ad_link_backfill_rw, ad_link_retract_rw, ad_link_stale_rw;

-- -----------------------------------------------------------------------------
-- 3.1 函数属主 ad_link_fn_owner 的表权限
-- -----------------------------------------------------------------------------
-- 函数属主是唯一能直写这四张表的角色（SECURITY DEFINER 函数以它的身份执行）。
-- 表由迁移的超级用户创建，属主不是 ad_link_fn_owner，因此必须显式授权，
-- 否则每个 DEFINER 函数都会报 "permission denied for table ..."。
-- 只授 SELECT/INSERT/UPDATE/DELETE，不授 TRUNCATE（TRUNCATE 由触发器无条件拒）。
-- 注意：属主同样受 BEFORE UPDATE/DELETE/TRUNCATE 触发器约束 —— 触发器函数
-- 不检查 current_user / session_user，也不对属主放行；「属主 = 唯一写入者」
-- 不等于「属主可绕过触发器」。
GRANT USAGE ON SCHEMA public TO ad_link_fn_owner;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.ad_creative_links,
     public.creative_binding_attestations,
     public.link_swap_intents,
     public.link_stale_reasons
  TO ad_link_fn_owner;
-- content_work_orders 只读（签字函数读工单校验 client_id / 哈希）。
-- 上面的 ALTER TABLE 已要求该表存在，这里不再用 IF EXISTS 兜底。
GRANT SELECT ON public.content_work_orders TO ad_link_fn_owner;
-- 列级 UPDATE 仅授 updated_at：唯一目的是让 creative_binding_attest_v1 里的
-- SELECT ... FOR SHARE 能拿到行锁（PostgreSQL 要求对表有 UPDATE 权限才能
-- 加 FOR SHARE 锁）。不授 final_mp4_sha256 列 —— 函数属主不得改写哈希。
GRANT UPDATE (updated_at) ON public.content_work_orders TO ad_link_fn_owner;

-- =============================================================================
-- 4. SECURITY DEFINER 函数
-- =============================================================================
-- 每个写入者一个窄函数，不开通用 upsert。函数属主 = ad_link_fn_owner（NOLOGIN）。
-- SET search_path = public, pg_temp 钉死。REVOKE ALL FROM PUBLIC，只授对应角色。

-- -----------------------------------------------------------------------------
-- 4.1 link_ad_at_creation_v1 —— 建广告处（winner_reel_sync / publishDraftPaused 后）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_ad_at_creation_v1(
  p_client_id        uuid,
  p_platform         text,
  p_ad_id            text,
  p_page_id          text,
  p_post_id          text,
  p_creative_ref     text,
  p_creative_source  text,
  p_link_method      text,
  p_unresolved_reason text,
  p_created_by       text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_client_id IS NULL OR p_ad_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'link_ad_at_creation_v1: client_id/ad_id/post_id 必填';
  END IF;
  IF p_link_method NOT IN ('published_post_id','asset_binding','asset_binding_provisional','unresolved') THEN
    RAISE EXCEPTION 'link_ad_at_creation_v1: 非法 link_method %', p_link_method;
  END IF;
  IF p_link_method = 'unresolved' AND (p_unresolved_reason IS NULL OR p_unresolved_reason = '') THEN
    RAISE EXCEPTION 'link_ad_at_creation_v1: unresolved 必须写明原因';
  END IF;
  IF p_link_method <> 'unresolved' AND p_creative_ref IS NULL THEN
    RAISE EXCEPTION 'link_ad_at_creation_v1: 已解析行必须带 creative_ref';
  END IF;

  INSERT INTO public.ad_creative_links (
    client_id, platform, ad_id, page_id, post_id,
    creative_ref, creative_source, link_method, unresolved_reason,
    created_by, link_source
  ) VALUES (
    p_client_id, COALESCE(p_platform,'meta'), p_ad_id, p_page_id, p_post_id,
    p_creative_ref, p_creative_source, p_link_method, p_unresolved_reason,
    p_created_by, 'ad_creation_path'
  )
  ON CONFLICT (client_id, platform, ad_id) DO UPDATE
    SET page_id           = EXCLUDED.page_id,
        post_id           = EXCLUDED.post_id,
        creative_ref      = EXCLUDED.creative_ref,
        creative_source   = EXCLUDED.creative_source,
        link_method       = EXCLUDED.link_method,
        unresolved_reason = EXCLUDED.unresolved_reason,
        link_source       = EXCLUDED.link_source
    -- 已解析行不允许被覆盖回 unresolved（触发器也会拦，这里显式拒绝更早报错）
    WHERE public.ad_creative_links.link_method = 'unresolved'
       OR public.ad_creative_links.link_method = EXCLUDED.link_method
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'link_ad_at_creation_v1: 已解析行不可被覆盖（ad_id=%）', p_ad_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_ad_at_creation_v1(uuid,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_ad_at_creation_v1(uuid,text,text,text,text,text,text,text,text,text) TO ad_link_creation_rw;

-- -----------------------------------------------------------------------------
-- 4.2 link_ad_registration_v1 —— 每日自动登记 + 补登路由
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_ad_registration_v1(
  p_client_id        uuid,
  p_platform         text,
  p_ad_id            text,
  p_page_id          text,
  p_post_id          text,
  p_creative_ref     text,
  p_creative_source  text,
  p_link_method      text,
  p_unresolved_reason text,
  p_created_by       text,
  p_meta_created_time timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_client_id IS NULL OR p_ad_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'link_ad_registration_v1: client_id/ad_id/post_id 必填';
  END IF;
  IF p_link_method NOT IN ('published_post_id','asset_binding','asset_binding_provisional','unresolved') THEN
    RAISE EXCEPTION 'link_ad_registration_v1: 非法 link_method %', p_link_method;
  END IF;
  IF p_link_method = 'unresolved' AND (p_unresolved_reason IS NULL OR p_unresolved_reason = '') THEN
    RAISE EXCEPTION 'link_ad_registration_v1: unresolved 必须写明原因';
  END IF;
  IF p_link_method <> 'unresolved' AND p_creative_ref IS NULL THEN
    RAISE EXCEPTION 'link_ad_registration_v1: 已解析行必须带 creative_ref';
  END IF;

  INSERT INTO public.ad_creative_links (
    client_id, platform, ad_id, page_id, post_id,
    creative_ref, creative_source, link_method, unresolved_reason,
    created_by, link_source, meta_created_time
  ) VALUES (
    p_client_id, COALESCE(p_platform,'meta'), p_ad_id, p_page_id, p_post_id,
    p_creative_ref, p_creative_source, p_link_method, p_unresolved_reason,
    p_created_by, 'registration_entry', p_meta_created_time
  )
  ON CONFLICT (client_id, platform, ad_id) DO UPDATE
    SET page_id            = EXCLUDED.page_id,
        post_id            = EXCLUDED.post_id,
        creative_ref       = EXCLUDED.creative_ref,
        creative_source    = EXCLUDED.creative_source,
        link_method        = EXCLUDED.link_method,
        unresolved_reason  = EXCLUDED.unresolved_reason,
        link_source        = EXCLUDED.link_source,
        meta_created_time  = COALESCE(public.ad_creative_links.meta_created_time, EXCLUDED.meta_created_time)
    WHERE public.ad_creative_links.link_method = 'unresolved'
       OR public.ad_creative_links.link_method = EXCLUDED.link_method
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'link_ad_registration_v1: 已解析行不可被覆盖（ad_id=%）', p_ad_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_ad_registration_v1(uuid,text,text,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_ad_registration_v1(uuid,text,text,text,text,text,text,text,text,text,timestamptz) TO ad_link_registration_rw;

-- -----------------------------------------------------------------------------
-- 4.3 link_ad_backfill_v1 —— 回填（PM 授权批次）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_ad_backfill_v1(
  p_client_id        uuid,
  p_platform         text,
  p_ad_id            text,
  p_page_id          text,
  p_post_id          text,
  p_creative_ref     text,
  p_creative_source  text,
  p_link_method      text,
  p_unresolved_reason text,
  p_created_by       text,
  p_batch_id         text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_batch_id IS NULL OR p_batch_id = '' THEN
    RAISE EXCEPTION 'link_ad_backfill_v1: 回填必须带 PM 授权批次号';
  END IF;
  IF p_client_id IS NULL OR p_ad_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'link_ad_backfill_v1: client_id/ad_id/post_id 必填';
  END IF;
  IF p_link_method NOT IN ('published_post_id','asset_binding','asset_binding_provisional','unresolved') THEN
    RAISE EXCEPTION 'link_ad_backfill_v1: 非法 link_method %', p_link_method;
  END IF;
  IF p_link_method = 'unresolved' AND (p_unresolved_reason IS NULL OR p_unresolved_reason = '') THEN
    RAISE EXCEPTION 'link_ad_backfill_v1: unresolved 必须写明原因';
  END IF;
  IF p_link_method <> 'unresolved' AND p_creative_ref IS NULL THEN
    RAISE EXCEPTION 'link_ad_backfill_v1: 已解析行必须带 creative_ref';
  END IF;

  INSERT INTO public.ad_creative_links (
    client_id, platform, ad_id, page_id, post_id,
    creative_ref, creative_source, link_method, unresolved_reason,
    created_by, link_source
  ) VALUES (
    p_client_id, COALESCE(p_platform,'meta'), p_ad_id, p_page_id, p_post_id,
    p_creative_ref, p_creative_source, p_link_method, p_unresolved_reason,
    p_created_by, 'backfill_' || p_batch_id
  )
  ON CONFLICT (client_id, platform, ad_id) DO UPDATE
    SET page_id           = EXCLUDED.page_id,
        post_id           = EXCLUDED.post_id,
        creative_ref      = EXCLUDED.creative_ref,
        creative_source   = EXCLUDED.creative_source,
        link_method       = EXCLUDED.link_method,
        unresolved_reason = EXCLUDED.unresolved_reason,
        link_source       = EXCLUDED.link_source
    WHERE public.ad_creative_links.link_method = 'unresolved'
       OR public.ad_creative_links.link_method = EXCLUDED.link_method
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'link_ad_backfill_v1: 已解析行不可被覆盖（ad_id=%）', p_ad_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_ad_backfill_v1(uuid,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_ad_backfill_v1(uuid,text,text,text,text,text,text,text,text,text,text) TO ad_link_backfill_rw;

-- -----------------------------------------------------------------------------
-- 4.4 creative_binding_attest_v1 —— 管理员会话签字路由（唯一）
-- -----------------------------------------------------------------------------
-- 签字有效性 = 签字哈希 == 工单此刻文件哈希（content_work_orders.final_mp4_sha256）。
-- 该列由出片管道渲染完成时写入（后续块接线）；本迁移不写它。
-- 若该列为 NULL（未记录），一律拒绝签字。
CREATE OR REPLACE FUNCTION public.creative_binding_attest_v1(
  p_client_id          uuid,
  p_work_order_id      uuid,
  p_video_id           text,
  p_page_sha256        text,
  p_meta_video_length_s numeric,
  p_signed_by          text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wo_client  uuid;
  v_wo_sha     text;
  v_existing   uuid;
  v_id         uuid;
BEGIN
  IF p_client_id IS NULL OR p_work_order_id IS NULL
     OR p_page_sha256 IS NULL
     OR p_signed_by IS NULL OR p_signed_by = '' THEN
    RAISE EXCEPTION 'creative_binding_attest_v1: 必填参数缺失';
  END IF;

  -- 同一事务内读工单行 FOR SHARE，防读到一半被重渲改写（s1 §1）。
  -- FOR SHARE 需要表级 UPDATE 权限；本迁移只授了列级 UPDATE (updated_at)，
  -- 仅用于加锁，不用于改写哈希列。
  SELECT client_id, final_mp4_sha256
    INTO v_wo_client, v_wo_sha
    FROM public.content_work_orders
   WHERE id = p_work_order_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'creative_binding_attest_v1: 工单不存在（%）', p_work_order_id;
  END IF;
  IF v_wo_client IS DISTINCT FROM p_client_id THEN
    RAISE EXCEPTION 'creative_binding_attest_v1: client_id 不一致（工单=%, 入参=%）', v_wo_client, p_client_id;
  END IF;
  IF v_wo_sha IS NULL THEN
    RAISE EXCEPTION 'creative_binding_attest_v1: 工单未记录最终 mp4 哈希（final_mp4_sha256 IS NULL），签字无效';
  END IF;
  IF v_wo_sha <> p_page_sha256 THEN
    RAISE EXCEPTION 'creative_binding_attest_v1: 签字哈希与工单当前哈希不一致';
  END IF;

  -- 已存在同 (work_order_id, sha) 且未撤回的签字 → 直接引用旧签字，不新增。
  SELECT id INTO v_existing
    FROM public.creative_binding_attestations
   WHERE work_order_id = p_work_order_id
     AND final_mp4_sha256 = p_page_sha256
     AND retracted_at IS NULL
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.creative_binding_attestations (
    client_id, work_order_id, video_id, final_mp4_sha256,
    meta_video_length_s, signed_by
  ) VALUES (
    p_client_id, p_work_order_id, p_video_id, p_page_sha256,
    p_meta_video_length_s, p_signed_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.creative_binding_attest_v1(uuid,uuid,text,text,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creative_binding_attest_v1(uuid,uuid,text,text,numeric,text) TO ad_link_attest_rw;

-- -----------------------------------------------------------------------------
-- 4.5 link_retract_v1 —— 撤回（PM 授权 + 理由）
-- -----------------------------------------------------------------------------
-- 撤回只经本函数；触发器放行 retracted_* 的受审写入（会话标志 app.ad_link_fn='retract'）。
CREATE OR REPLACE FUNCTION public.link_retract_v1(
  p_link_id       uuid,
  p_retracted_by  text,
  p_reason        text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_link_id IS NULL OR p_retracted_by IS NULL OR p_retracted_by = ''
     OR p_reason IS NULL OR p_reason = '' THEN
    RAISE EXCEPTION 'link_retract_v1: link_id / 操作人 / 理由 必填';
  END IF;

  -- 会话标志：只在本事务内有效（set_config(..., true)）。
  PERFORM set_config('app.ad_link_fn', 'retract', true);

  UPDATE public.ad_creative_links
     SET retracted_at   = now(),
         retracted_by   = p_retracted_by,
         retract_reason = p_reason
   WHERE id = p_link_id
     AND retracted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_retract_v1: 关联行不存在或已撤回（%）', p_link_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.link_retract_v1(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_retract_v1(uuid,text,text) TO ad_link_retract_rw;

-- -----------------------------------------------------------------------------
-- 4.6 link_mark_stale_v1 —— stale 标记（swap_creative 意图、对账扫描）
-- -----------------------------------------------------------------------------
-- 只写 stale_at（单向）+ 追加 link_stale_reasons + 解析 link_swap_intents。
CREATE OR REPLACE FUNCTION public.link_mark_stale_v1(
  p_link_id   uuid,
  p_reason    text,
  p_by        text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_link_id IS NULL OR p_reason IS NULL OR p_reason = '' THEN
    RAISE EXCEPTION 'link_mark_stale_v1: link_id / reason 必填';
  END IF;

  PERFORM set_config('app.ad_link_fn', 'stale', true);

  -- stale_at 只能从 NULL 变有值（触发器拦回退）。
  UPDATE public.ad_creative_links
     SET stale_at = COALESCE(stale_at, now())
   WHERE id = p_link_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_mark_stale_v1: 关联行不存在（%）', p_link_id;
  END IF;

  -- 原因追加（只增不改）。
  INSERT INTO public.link_stale_reasons (link_id, reason, by)
  VALUES (p_link_id, p_reason, p_by);
END;
$$;

REVOKE ALL ON FUNCTION public.link_mark_stale_v1(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_mark_stale_v1(uuid,text,text) TO ad_link_stale_rw;

-- -----------------------------------------------------------------------------
-- 4.7 link_touch_checked_v1 —— 每日扫描刷新 creative_checked_at
-- -----------------------------------------------------------------------------
-- s1 §5：只经窄函数写，归「对账扫描」角色 ad_link_stale_rw 同一写入方。
--
-- 只写 creative_checked_at，绝不写 meta_creative_id（已解析行的 meta_creative_id
-- 由触发器保护，不可改；本函数也不应改它）。
-- 行为：
--   · 读存储的 meta_creative_id；
--   · 存储为 NULL 或与 p_meta_creative_id 不一致 → 返回 false，不写任何列；
--   · 一致 → 置 app.ad_link_fn='touch'（事务内局部），只 UPDATE creative_checked_at，
--     返回 true。
-- 返回类型由 void 改为 boolean，故先 DROP FUNCTION IF EXISTS 再重建。
DROP FUNCTION IF EXISTS public.link_touch_checked_v1(uuid, text);

CREATE FUNCTION public.link_touch_checked_v1(
  p_link_id           uuid,
  p_meta_creative_id  text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stored text;
BEGIN
  IF p_link_id IS NULL THEN
    RAISE EXCEPTION 'link_touch_checked_v1: link_id 必填';
  END IF;

  SELECT meta_creative_id
    INTO v_stored
    FROM public.ad_creative_links
   WHERE id = p_link_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_touch_checked_v1: 关联行不存在（%）', p_link_id;
  END IF;

  -- 存储为 NULL 或与入参不一致 → 不写，返回 false（调用方据此走对账/标 stale）。
  IF v_stored IS NULL OR v_stored IS DISTINCT FROM p_meta_creative_id THEN
    RETURN false;
  END IF;

  -- 会话标志：只在本事务内有效（set_config(..., true)）。
  PERFORM set_config('app.ad_link_fn', 'touch', true);

  -- 只写 creative_checked_at；meta_creative_id 不动。
  UPDATE public.ad_creative_links
     SET creative_checked_at = now()
   WHERE id = p_link_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.link_touch_checked_v1(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_touch_checked_v1(uuid,text) TO ad_link_stale_rw;

-- -----------------------------------------------------------------------------
-- 4.8 creative_binding_is_valid —— 「有效签字」唯一定义（只读）
-- -----------------------------------------------------------------------------
-- 有效 = 签字存在 ∧ retracted_at 为空 ∧ 签字哈希 == 工单此刻文件哈希
--        ∧ 工单此刻文件哈希 IS NOT NULL。
-- 注意：STABLE 函数不允许 SELECT ... FOR SHARE，这里用普通读；s1 §1 的 FOR SHARE
-- 只适用于写入路径（creative_binding_attest_v1）。读取路径的竞态窗口由
-- 「每次读取现场比对」+ 台账 30 小时窗口兜底（s1 §5）。
CREATE OR REPLACE FUNCTION public.creative_binding_is_valid(
  p_attestation_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sha        text;
  v_retracted  timestamptz;
  v_wo_id      uuid;
  v_current    text;
BEGIN
  SELECT final_mp4_sha256, retracted_at, work_order_id
    INTO v_sha, v_retracted, v_wo_id
    FROM public.creative_binding_attestations
   WHERE id = p_attestation_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_retracted IS NOT NULL THEN
    RETURN false;
  END IF;

  SELECT final_mp4_sha256
    INTO v_current
    FROM public.content_work_orders
   WHERE id = v_wo_id;

  IF NOT FOUND OR v_current IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_sha = v_current;
END;
$$;

REVOKE ALL ON FUNCTION public.creative_binding_is_valid(uuid) FROM PUBLIC;
-- 只读，不授写。授给台账函数属主 ledger_fn_owner（若存在）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_fn_owner') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.creative_binding_is_valid(uuid) TO ledger_fn_owner';
  ELSE
    RAISE NOTICE 'ledger_fn_owner 不存在，creative_binding_is_valid 暂未授给台账（s1 §5 要求授给台账函数属主）';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4.9 creative_link_has_pending_swap —— 只读：该关联行有无未了结换创意意图
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.creative_link_has_pending_swap(
  p_link_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.link_swap_intents
     WHERE link_id = p_link_id
       AND state IN ('swap_pending','result_unknown')
  );
$$;

REVOKE ALL ON FUNCTION public.creative_link_has_pending_swap(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_fn_owner') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.creative_link_has_pending_swap(uuid) TO ledger_fn_owner';
  ELSE
    RAISE NOTICE 'ledger_fn_owner 不存在，creative_link_has_pending_swap 暂未授给台账（s1 §5 要求授给台账函数属主）';
  END IF;
END $$;

-- =============================================================================
-- 5. 函数属主统一为 ad_link_fn_owner
-- =============================================================================
ALTER FUNCTION public.link_ad_at_creation_v1(uuid,text,text,text,text,text,text,text,text,text)          OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.link_ad_registration_v1(uuid,text,text,text,text,text,text,text,text,text,timestamptz) OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.link_ad_backfill_v1(uuid,text,text,text,text,text,text,text,text,text,text)        OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.creative_binding_attest_v1(uuid,uuid,text,text,numeric,text)                       OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.link_retract_v1(uuid,text,text)                                                    OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.link_mark_stale_v1(uuid,text,text)                                                 OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.link_touch_checked_v1(uuid,text)                                                   OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.creative_binding_is_valid(uuid)                                                    OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.creative_link_has_pending_swap(uuid)                                               OWNER TO ad_link_fn_owner;

-- =============================================================================
-- 6. ad_creative_links 触发器：已解析行只放行受审写入
-- =============================================================================
-- 已解析 = link_method IN ('published_post_id','asset_binding','asset_binding_provisional')。
-- 放行清单（s1 §1 / v0.6 §1）：
--   · stale_at：NULL → 有值（永不回退）
--   · retracted_*：仅当 app.ad_link_fn = 'retract'
--   · creative_checked_at：仅当 app.ad_link_fn = 'touch'
--   · attestation_id：已解析行永不可改
-- 其余列一律拒。
--
-- 触发器对函数属主 ad_link_fn_owner 同样生效：触发器函数不检查
-- current_user / session_user，也不对属主放行。属主是唯一写入者，但
-- 「唯一写入者」不等于「可绕过触发器」—— 受审写入靠会话标志
-- app.ad_link_fn 区分，不靠角色身份。
--
-- link_touch_checked_v1 只改 creative_checked_at（不改 meta_creative_id），
-- 因此本触发器无需为它额外放行：creative_checked_at 分支已覆盖。

CREATE OR REPLACE FUNCTION public.ad_creative_links_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_fn text := current_setting('app.ad_link_fn', true);
BEGIN
  -- 只对已解析行生效；unresolved 行允许函数内正常更新（函数本身已校验）。
  IF OLD.link_method NOT IN ('published_post_id','asset_binding','asset_binding_provisional') THEN
    RETURN NEW;
  END IF;

  -- attestation_id 永不可改
  IF NEW.attestation_id IS DISTINCT FROM OLD.attestation_id THEN
    RAISE EXCEPTION 'ad_creative_links: 已解析行的 attestation_id 不可改（link_id=%）', OLD.id;
  END IF;

  -- stale_at 只能 NULL → 有值
  IF NEW.stale_at IS DISTINCT FROM OLD.stale_at THEN
    IF OLD.stale_at IS NOT NULL THEN
      RAISE EXCEPTION 'ad_creative_links: stale_at 不可回退或改写（link_id=%）', OLD.id;
    END IF;
    IF NEW.stale_at IS NULL THEN
      RAISE EXCEPTION 'ad_creative_links: stale_at 不可置空（link_id=%）', OLD.id;
    END IF;
  END IF;

  -- retracted_* 只经 link_retract_v1
  IF (NEW.retracted_at   IS DISTINCT FROM OLD.retracted_at)
  OR (NEW.retracted_by   IS DISTINCT FROM OLD.retracted_by)
  OR (NEW.retract_reason IS DISTINCT FROM OLD.retract_reason) THEN
    IF v_fn IS DISTINCT FROM 'retract' THEN
      RAISE EXCEPTION 'ad_creative_links: retracted_* 只经 link_retract_v1 写（link_id=%）', OLD.id;
    END IF;
  END IF;

  -- creative_checked_at 只经 link_touch_checked_v1
  IF NEW.creative_checked_at IS DISTINCT FROM OLD.creative_checked_at THEN
    IF v_fn IS DISTINCT FROM 'touch' THEN
      RAISE EXCEPTION 'ad_creative_links: creative_checked_at 只经 link_touch_checked_v1 写（link_id=%）', OLD.id;
    END IF;
  END IF;

  -- 其余列：已解析行一律拒改（link_method 也不可改回 unresolved）
  IF NEW.client_id        IS DISTINCT FROM OLD.client_id
  OR NEW.platform         IS DISTINCT FROM OLD.platform
  OR NEW.ad_id            IS DISTINCT FROM OLD.ad_id
  OR NEW.page_id          IS DISTINCT FROM OLD.page_id
  OR NEW.post_id          IS DISTINCT FROM OLD.post_id
  OR NEW.creative_ref     IS DISTINCT FROM OLD.creative_ref
  OR NEW.creative_source  IS DISTINCT FROM OLD.creative_source
  OR NEW.link_method      IS DISTINCT FROM OLD.link_method
  OR NEW.unresolved_reason IS DISTINCT FROM OLD.unresolved_reason
  OR NEW.created_by       IS DISTINCT FROM OLD.created_by
  OR NEW.link_source      IS DISTINCT FROM OLD.link_source
  OR NEW.source_video_id  IS DISTINCT FROM OLD.source_video_id
  OR NEW.meta_creative_id IS DISTINCT FROM OLD.meta_creative_id
  OR NEW.meta_created_time IS DISTINCT FROM OLD.meta_created_time THEN
    RAISE EXCEPTION 'ad_creative_links: 已解析行不可改列（link_id=%）', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ad_creative_links_guard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.link_method IN ('published_post_id','asset_binding','asset_binding_provisional') THEN
    RAISE EXCEPTION 'ad_creative_links: 已解析行不可删除（link_id=%）', OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

-- TRUNCATE 守卫：无条件拒。任何角色（含函数属主 ad_link_fn_owner 与表属主
-- 超级用户）对 ad_creative_links 的 TRUNCATE 一律 RAISE。BEFORE TRUNCATE
-- 语句级触发器，不依赖表内是否有已解析行。
CREATE OR REPLACE FUNCTION public.ad_creative_links_guard_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ad_creative_links: 禁止 TRUNCATE（无条件拒绝，含函数属主与表属主）';
END;
$$;

DROP TRIGGER IF EXISTS ad_creative_links_guard_update ON public.ad_creative_links;
CREATE TRIGGER ad_creative_links_guard_update
  BEFORE UPDATE ON public.ad_creative_links
  FOR EACH ROW EXECUTE FUNCTION public.ad_creative_links_guard_update();

DROP TRIGGER IF EXISTS ad_creative_links_guard_delete ON public.ad_creative_links;
CREATE TRIGGER ad_creative_links_guard_delete
  BEFORE DELETE ON public.ad_creative_links
  FOR EACH ROW EXECUTE FUNCTION public.ad_creative_links_guard_delete();

DROP TRIGGER IF EXISTS ad_creative_links_guard_truncate ON public.ad_creative_links;
CREATE TRIGGER ad_creative_links_guard_truncate
  BEFORE TRUNCATE ON public.ad_creative_links
  FOR EACH STATEMENT EXECUTE FUNCTION public.ad_creative_links_guard_truncate();

-- 触发器函数属主也归 ad_link_fn_owner（避免属主漂移）。
ALTER FUNCTION public.ad_creative_links_guard_update()   OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.ad_creative_links_guard_delete()   OWNER TO ad_link_fn_owner;
ALTER FUNCTION public.ad_creative_links_guard_truncate() OWNER TO ad_link_fn_owner;

-- =============================================================================
-- 7. 表/列注释（新表已在上文注释；此处补 ad_creative_links 表级说明）
-- =============================================================================
COMMENT ON TABLE public.ad_creative_links IS
  '广告 ↔ ME 自己的片子。建广告那一刻写（唯一知道对应关系的时刻），事后推不出来。creative_ref 为 NULL = 当时查不到，绝不猜。硬化后：写只能经 SECURITY DEFINER 函数（service_role 只保留 SELECT）。';

COMMIT;

-- =============================================================================
-- ASSERTIONS
-- =============================================================================
-- 常驻权限断言：「多出的授权 = 红」。覆盖表权限、函数 EXECUTE、函数拥有者。
-- 本块可单独 SELECT 执行（DO 块），失败即 RAISE。
DO $$
DECLARE
  v_bad text;
BEGIN
  -- 1) service_role 对四张表不得有任何写权限
  SELECT string_agg(format('%s.%s:%s', table_schema, table_name, privilege_type), ', ')
    INTO v_bad
    FROM information_schema.role_table_grants
   WHERE grantee = 'service_role'
     AND table_schema = 'public'
     AND table_name IN ('ad_creative_links','creative_binding_attestations','link_swap_intents','link_stale_reasons')
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: service_role 仍有写权限: %', v_bad;
  END IF;

  -- 2) 列出的函数不得被 PUBLIC 执行
  SELECT string_agg(p.proname, ', ')
    INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'link_ad_at_creation_v1','link_ad_registration_v1','link_ad_backfill_v1',
       'creative_binding_attest_v1','link_retract_v1','link_mark_stale_v1',
       'link_touch_checked_v1','creative_binding_is_valid','creative_link_has_pending_swap'
     )
     AND has_function_privilege('public', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: PUBLIC 可执行: %', v_bad;
  END IF;

  -- 3) 函数属主必须是 ad_link_fn_owner
  SELECT string_agg(p.proname, ', ')
    INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'link_ad_at_creation_v1','link_ad_registration_v1','link_ad_backfill_v1',
       'creative_binding_attest_v1','link_retract_v1','link_mark_stale_v1',
       'link_touch_checked_v1','creative_binding_is_valid','creative_link_has_pending_swap',
       'ad_creative_links_guard_update','ad_creative_links_guard_delete','ad_creative_links_guard_truncate'
     )
     AND r.rolname <> 'ad_link_fn_owner';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: 函数属主不是 ad_link_fn_owner: %', v_bad;
  END IF;

  -- 4) 六个写入角色对四张表不得有直接写权限
  SELECT string_agg(format('%s.%s:%s:%s', table_schema, table_name, grantee, privilege_type), ', ')
    INTO v_bad
    FROM information_schema.role_table_grants
   WHERE grantee IN ('ad_link_creation_rw','ad_link_registration_rw','ad_link_attest_rw',
                     'ad_link_backfill_rw','ad_link_retract_rw','ad_link_stale_rw')
     AND table_schema = 'public'
     AND table_name IN ('ad_creative_links','creative_binding_attestations','link_swap_intents','link_stale_reasons')
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: 写入角色有直接写权限: %', v_bad;
  END IF;

  -- 5) 除 ad_link_fn_owner 与超级用户外，任何角色都不得对四张表有
  --    INSERT/UPDATE/DELETE/TRUNCATE。用 has_table_privilege 逐角色逐表逐权限扫，
  --    覆盖直接授权、角色继承、PUBLIC 授权等所有路径。
  --    跳过内置角色（pg_*）与超级用户：前者是系统角色，后者本就绕过权限检查。
  SELECT string_agg(format('%s:%s:%s', r.rolname, t.tbl, p.priv), ', ')
    INTO v_bad
    FROM pg_roles r
    CROSS JOIN (VALUES
      ('ad_creative_links'),
      ('creative_binding_attestations'),
      ('link_swap_intents'),
      ('link_stale_reasons')
    ) AS t(tbl)
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) AS p(priv)
   WHERE NOT r.rolsuper
     AND r.rolname NOT LIKE 'pg\_%'
     AND r.rolname <> 'ad_link_fn_owner'
     AND has_table_privilege(r.oid, format('public.%I', t.tbl), p.priv);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: 非属主角色仍有写权限: %', v_bad;
  END IF;

  -- 6) ad_link_fn_owner 不得有 TRUNCATE（TRUNCATE 由触发器无条件拒，权限层也不给）
  SELECT string_agg(format('%s:%s', t.tbl, 'TRUNCATE'), ', ')
    INTO v_bad
    FROM (VALUES
      ('ad_creative_links'),
      ('creative_binding_attestations'),
      ('link_swap_intents'),
      ('link_stale_reasons')
    ) AS t(tbl)
   WHERE has_table_privilege('ad_link_fn_owner', format('public.%I', t.tbl), 'TRUNCATE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ad_link_fn_owner 有 TRUNCATE 权限: %', v_bad;
  END IF;

  RAISE NOTICE 'ASSERTIONS PASSED: 权限矩阵符合 s1 §2 / v0.6 §2';
END $$;
