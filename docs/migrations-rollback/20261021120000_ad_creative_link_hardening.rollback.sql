-- =============================================================================
-- DRAFT — 回滚草稿（不在 supabase/migrations 下，永不自动执行）
-- 对应迁移：supabase/migrations/20261021120000_ad_creative_link_hardening.sql
--
-- ⚠️ 仅 PM 明确授权时手工执行；本文件不是迁移，不会被 supabase db push 拾取。
-- ⚠️ 破坏性：会删除签字（creative_binding_attestations）、换创意意图
--    （link_swap_intents）、stale 原因（link_stale_reasons）的全部数据，
--    并恢复 service_role 对 ad_creative_links 的直写权限（= 回到硬化前的不安全状态）。执行前必须备份。
--
-- 顺序 = 迁移的逆序。整体包在一个事务里；失败即回滚。
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1) 触发器
DROP TRIGGER IF EXISTS ad_creative_links_guard_truncate ON public.ad_creative_links;
DROP TRIGGER IF EXISTS ad_creative_links_guard_delete   ON public.ad_creative_links;
DROP TRIGGER IF EXISTS ad_creative_links_guard_update   ON public.ad_creative_links;

DROP TRIGGER IF EXISTS creative_binding_attestations_guard_truncate ON public.creative_binding_attestations;
DROP TRIGGER IF EXISTS creative_binding_attestations_guard_delete   ON public.creative_binding_attestations;
DROP TRIGGER IF EXISTS creative_binding_attestations_guard_update   ON public.creative_binding_attestations;

DROP TRIGGER IF EXISTS link_stale_reasons_guard_truncate ON public.link_stale_reasons;
DROP TRIGGER IF EXISTS link_stale_reasons_guard_delete   ON public.link_stale_reasons;
DROP TRIGGER IF EXISTS link_stale_reasons_guard_update   ON public.link_stale_reasons;

DROP TRIGGER IF EXISTS link_swap_intents_guard_truncate ON public.link_swap_intents;
DROP TRIGGER IF EXISTS link_swap_intents_guard_delete   ON public.link_swap_intents;
DROP TRIGGER IF EXISTS link_swap_intents_guard_update   ON public.link_swap_intents;

-- 2) 函数（先收回 EXECUTE 授权，再 DROP）
REVOKE ALL ON FUNCTION public.attestation_retract_v1(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_swap_intent_open_v1(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_swap_intent_resolve_v1(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_ad_at_creation_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_ad_registration_v1(uuid,text,text,text,text,text,text,text,text,text,timestamptz,text,text,jsonb,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_ad_backfill_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.creative_binding_attest_v1(uuid,uuid,text,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_retract_v1(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_mark_stale_v1(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_touch_checked_v1(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.creative_binding_is_valid(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.creative_link_has_pending_swap(uuid) FROM PUBLIC;

DROP FUNCTION IF EXISTS public.attestation_retract_v1(uuid,text,text);
DROP FUNCTION IF EXISTS public.link_swap_intent_open_v1(uuid,text,text);
DROP FUNCTION IF EXISTS public.link_swap_intent_resolve_v1(uuid,text,text);
DROP FUNCTION IF EXISTS public.link_ad_at_creation_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.link_ad_registration_v1(uuid,text,text,text,text,text,text,text,text,text,timestamptz,text,text,jsonb,text,uuid,text);
DROP FUNCTION IF EXISTS public.link_ad_backfill_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,text,uuid,text);
DROP FUNCTION IF EXISTS public.creative_binding_attest_v1(uuid,uuid,text,text,numeric,text);
DROP FUNCTION IF EXISTS public.link_retract_v1(uuid,text,text);
DROP FUNCTION IF EXISTS public.link_mark_stale_v1(uuid,text,text);
DROP FUNCTION IF EXISTS public.link_touch_checked_v1(uuid,text);
DROP FUNCTION IF EXISTS public.creative_binding_is_valid(uuid);
DROP FUNCTION IF EXISTS public.creative_link_has_pending_swap(uuid);

DROP FUNCTION IF EXISTS public.ad_creative_links_guard_update();
DROP FUNCTION IF EXISTS public.ad_creative_links_guard_delete();
DROP FUNCTION IF EXISTS public.ad_creative_links_guard_truncate();

DROP FUNCTION IF EXISTS public.creative_binding_attestations_guard_update();
DROP FUNCTION IF EXISTS public.creative_binding_attestations_guard_delete();
DROP FUNCTION IF EXISTS public.creative_binding_attestations_guard_truncate();

DROP FUNCTION IF EXISTS public.link_stale_reasons_guard_update();
DROP FUNCTION IF EXISTS public.link_stale_reasons_guard_delete();
DROP FUNCTION IF EXISTS public.link_stale_reasons_guard_truncate();

DROP FUNCTION IF EXISTS public.link_swap_intents_guard_update();
DROP FUNCTION IF EXISTS public.link_swap_intents_guard_delete();
DROP FUNCTION IF EXISTS public.link_swap_intents_guard_truncate();

-- 3) 新表（先删策略随表一起走；数据一并销毁）
DROP TABLE IF EXISTS public.link_stale_reasons;
DROP TABLE IF EXISTS public.link_swap_intents;
DROP TABLE IF EXISTS public.creative_binding_attestations;

-- 4) ad_creative_links 上的策略与新增列
DROP POLICY IF EXISTS ad_link_fn_owner_full ON public.ad_creative_links;

ALTER TABLE public.ad_creative_links
  DROP COLUMN IF EXISTS retract_reason,
  DROP COLUMN IF EXISTS retracted_by,
  DROP COLUMN IF EXISTS retracted_at,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS creative_checked_at,
  DROP COLUMN IF EXISTS meta_created_time,
  DROP COLUMN IF EXISTS meta_creative_id,
  DROP COLUMN IF EXISTS attestation_id,
  DROP COLUMN IF EXISTS source_video_id,
  DROP COLUMN IF EXISTS link_source;

-- 5) content_work_orders 新增列与约束
ALTER TABLE public.content_work_orders
  DROP CONSTRAINT IF EXISTS content_work_orders_final_mp4_sha256_fmt;
ALTER TABLE public.content_work_orders
  DROP COLUMN IF EXISTS final_mp4_sha256;

-- 6) 恢复 service_role 对 ad_creative_links 的直写（= 回到硬化前的不安全状态）
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.ad_creative_links TO service_role;

-- 7) 角色（先收回授权，再 DROP ROLE）
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM
  ad_link_creation_rw, ad_link_registration_rw, ad_link_attest_rw,
  ad_link_backfill_rw, ad_link_retract_rw, ad_link_stale_rw, ad_link_fn_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM
  ad_link_creation_rw, ad_link_registration_rw, ad_link_attest_rw,
  ad_link_backfill_rw, ad_link_retract_rw, ad_link_stale_rw, ad_link_fn_owner;
REVOKE ALL ON SCHEMA public FROM ad_link_fn_owner;

DROP ROLE IF EXISTS ad_link_creation_rw;
DROP ROLE IF EXISTS ad_link_registration_rw;
DROP ROLE IF EXISTS ad_link_attest_rw;
DROP ROLE IF EXISTS ad_link_backfill_rw;
DROP ROLE IF EXISTS ad_link_retract_rw;
DROP ROLE IF EXISTS ad_link_stale_rw;
DROP ROLE IF EXISTS ad_link_fn_owner;

COMMIT;
