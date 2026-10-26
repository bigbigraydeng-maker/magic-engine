-- 回收 20261021120000 加的 14 个 SECURITY DEFINER 函数对 PUBLIC / anon /
-- authenticated 的 EXECUTE。原迁移建函数时没写 REVOKE，CI 不变量 4 从
-- 2026-10-25 起连红：SECURITY DEFINER 以属主身份运行会绕 RLS，若对公众开
-- EXECUTE，任何匿名访客都能用属主权限写这几张表。
--
-- ⚠️ `REVOKE ... FROM PUBLIC` 在 Supabase 上收不干净：Supabase 用 ALTER
-- DEFAULT PRIVILEGES 给 anon / authenticated 单独授了权，不经过 PUBLIC。
-- 必须 FROM PUBLIC, anon, authenticated 三个一起收（见 db-invariants.sql）。
--
-- GRANT TO service_role 补回来，让业务代码仍能通过 service_role 调这些函数。
-- 函数本体不动，只改 EXECUTE 权限。

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.ad_link_check_attestation_v1(uuid, uuid, text, text)',
    'public.link_ad_at_creation_v1(uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb, uuid, text)',
    'public.link_ad_registration_v1(uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, text, jsonb, text, uuid, text)',
    'public.link_ad_backfill_v1(uuid, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text, uuid, text)',
    'public.creative_binding_attest_v1(uuid, uuid, text, text, numeric, text)',
    'public.link_retract_v1(uuid, text, text)',
    'public.link_mark_stale_v1(uuid, text, text)',
    'public.link_touch_checked_v1(uuid, text)',
    'public.creative_binding_is_valid(uuid)',
    'public.creative_link_has_pending_swap(uuid)',
    'public.attestation_retract_v1(uuid, text, text)',
    'public.work_order_set_final_hash_v1(uuid, text, text, boolean)',
    'public.link_swap_intent_open_v1(uuid, text, text)',
    'public.link_swap_intent_resolve_v1(uuid, text, text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
