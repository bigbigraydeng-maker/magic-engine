-- =============================================================================
-- DRAFT — 回滚草稿（不在 supabase/migrations 下，永不自动执行）
-- 对应迁移：supabase/migrations/20261021120000_ad_creative_link_hardening.sql
--
-- ⚠️ 仅 PM 明确授权时手工执行；本文件不是迁移，不会被 supabase db push 拾取。
-- ⚠️ 破坏性：会删除签字（creative_binding_attestations）、换创意意图
--    （link_swap_intents）、stale 原因（link_stale_reasons）、
--    哈希写入历史（content_work_order_hash_history）的全部数据。
--    恢复 service_role 直写是单独的第 7 块（默认注释，需 PM 书面批准）。执行前必须备份。
--
-- 顺序 = 迁移的逆序。整体包在一个事务里；失败即回滚。
--
-- 覆盖清单（迁移创建的每一个对象都必须在这里被 DROP / REVOKE）：
--   · 触发器：ad_creative_links ×3、creative_binding_attestations ×3、
--             link_stale_reasons ×3、link_swap_intents ×3、
--             content_work_orders_guard_hash_update ×1、
--             content_work_order_hash_history ×3
--   · 函数：13 个业务/只读函数 + 13 个触发器函数（含 work_order_set_final_hash_v1）
--   · 表：creative_binding_attestations、link_swap_intents、link_stale_reasons、
--         content_work_order_hash_history
--   · 列：ad_creative_links 新增 10 列、content_work_orders.final_mp4_sha256
--   · 约束：content_work_orders_final_mp4_sha256_fmt
--   · 策略：ad_link_fn_owner_full ×5、service_role_full ×5（ad_creative_links 恢复原状）
--   · 角色：ad_link_creation_rw / registration_rw / attest_rw / backfill_rw /
--           retract_rw / stale_rw / hash_rw / fn_owner
--   · 授权：ad_link_fn_owner 对 schema public 的 USAGE、对 content_work_orders 的
--           SELECT 与列级 UPDATE、对 CURRENT_USER 的成员资格
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- =============================================================================
-- 1) 触发器（先于函数与表）
-- =============================================================================
DROP TRIGGER IF EXISTS content_work_order_hash_history_guard_truncate ON public.content_work_order_hash_history;
DROP TRIGGER IF EXISTS content_work_order_hash_history_guard_delete   ON public.content_work_order_hash_history;
DROP TRIGGER IF EXISTS content_work_order_hash_history_guard_update   ON public.content_work_order_hash_history;
DROP TRIGGER IF EXISTS content_work_orders_guard_hash_update          ON public.content_work_orders;

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

-- =============================================================================
-- 2) 业务 / 只读函数（先收回 EXECUTE 授权，再 DROP）
-- =============================================================================
REVOKE ALL ON FUNCTION public.work_order_set_final_hash_v1(uuid,text,text) FROM PUBLIC;
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

DROP FUNCTION IF EXISTS public.work_order_set_final_hash_v1(uuid,text,text);
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

-- =============================================================================
-- 3) 触发器函数（触发器已在第 1 节删除）
-- =============================================================================
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

DROP FUNCTION IF EXISTS public.content_work_orders_guard_hash_update();
DROP FUNCTION IF EXISTS public.content_work_order_hash_history_guard_update();
DROP FUNCTION IF EXISTS public.content_work_order_hash_history_guard_delete();
DROP FUNCTION IF EXISTS public.content_work_order_hash_history_guard_truncate();

-- =============================================================================
-- 4) 新表（策略随表一起走；数据一并销毁）
-- =============================================================================
DROP TABLE IF EXISTS public.content_work_order_hash_history;
DROP TABLE IF EXISTS public.link_stale_reasons;
DROP TABLE IF EXISTS public.link_swap_intents;
DROP TABLE IF EXISTS public.creative_binding_attestations;

-- =============================================================================
-- 5) ad_creative_links 上的策略与新增列
-- =============================================================================
DROP POLICY IF EXISTS ad_link_fn_owner_full ON public.ad_creative_links;
-- 恢复 20260801000001 的原始策略（注意：原策略漏写 TO service_role，
-- 回滚即恢复该缺陷 —— 这是「回到硬化前状态」的应有之义，须在授权记录里写明）。
DROP POLICY IF EXISTS "service_role_full" ON public.ad_creative_links;
CREATE POLICY "service_role_full" ON public.ad_creative_links
  FOR ALL USING (true);

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

-- =============================================================================
-- 6) content_work_orders 新增列与约束
-- =============================================================================
ALTER TABLE public.content_work_orders
  DROP CONSTRAINT IF EXISTS content_work_orders_final_mp4_sha256_fmt;
ALTER TABLE public.content_work_orders
  DROP COLUMN IF EXISTS final_mp4_sha256;

-- =============================================================================
-- 7) ad_link_fn_owner 的授权（表已删，只剩 schema 与 content_work_orders 上的）
-- =============================================================================
REVOKE UPDATE (updated_at) ON public.content_work_orders FROM ad_link_fn_owner;
REVOKE SELECT ON public.content_work_orders FROM ad_link_fn_owner;
REVOKE USAGE ON SCHEMA public FROM ad_link_fn_owner;
-- 迁移第 5 节临时授予的成员资格与 CREATE 权限（迁移末尾已收回，这里幂等再收一次）。
REVOKE CREATE ON SCHEMA public FROM ad_link_fn_owner;
REVOKE ad_link_fn_owner FROM CURRENT_USER;

-- =============================================================================
-- 8) 角色（先收回授权，再 DROP ROLE）
-- =============================================================================
--    REASSIGN OWNED 把 ad_link_fn_owner 名下的函数/对象转给当前用户，
--    否则 DROP ROLE 会因「仍拥有对象」失败。
REASSIGN OWNED BY ad_link_fn_owner TO CURRENT_USER;

--    DROP OWNED 清掉各写入角色名下的授权与默认权限。
DROP OWNED BY ad_link_creation_rw;
DROP OWNED BY ad_link_registration_rw;
DROP OWNED BY ad_link_attest_rw;
DROP OWNED BY ad_link_backfill_rw;
DROP OWNED BY ad_link_retract_rw;
DROP OWNED BY ad_link_stale_rw;
DROP OWNED BY ad_link_hash_rw;
DROP OWNED BY ad_link_fn_owner;

DROP ROLE IF EXISTS ad_link_creation_rw;
DROP ROLE IF EXISTS ad_link_registration_rw;
DROP ROLE IF EXISTS ad_link_attest_rw;
DROP ROLE IF EXISTS ad_link_backfill_rw;
DROP ROLE IF EXISTS ad_link_retract_rw;
DROP ROLE IF EXISTS ad_link_stale_rw;
DROP ROLE IF EXISTS ad_link_hash_rw;
DROP ROLE IF EXISTS ad_link_fn_owner;

COMMIT;

-- =============================================================================
-- 9) 【单独执行 · 需 PM 书面批准】恢复 service_role 对 ad_creative_links 的直写
-- =============================================================================
-- ⚠️ 本块不在上面的 BEGIN/COMMIT 里，默认注释掉。
-- ⚠️ 执行 = 回到硬化前的不安全状态（谁都能改归因）。
-- ⚠️ 执行前必须在授权记录里写明：批准人、日期、理由、影响面。
--
-- BEGIN;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.ad_creative_links TO service_role;
-- COMMIT;
