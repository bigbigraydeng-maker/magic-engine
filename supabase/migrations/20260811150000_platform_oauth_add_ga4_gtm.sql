-- 让 platform_oauth_connections 认识 GA4 (Google Analytics 4) 和 GTM (Google Tag
-- Manager) 这两个新平台。
--
-- 为什么需要：GSC/GA4/GTM 这次要合并成一次 Google 授权（一个同意页拿三个服务的
-- token），token 存哪里已经有定论（platform_oauth_connections，每客户每平台一条、
-- AES 加密）。GA4/GTM 之前完全没有自己的 provider 值，这里补上。
--
-- google_gsc 已经在白名单里（2026-06-03 建表时就有），不用新增。
--
-- 动手前已核对线上真实约束：当前是 6 个值（含 2026-08-02 加的 microsoft_mail），
-- 不是最初建表时的 5 个值——这条迁移在 6 个基础上加 2 个，变成 8 个，不是覆盖。
--
-- 可逆：把 'google_ga4' / 'google_gtm' 从数组里去掉即可（去掉前需先清理这两个
-- provider 的行）。
--
-- 详见 docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.2

ALTER TABLE platform_oauth_connections
  DROP CONSTRAINT IF EXISTS platform_oauth_connections_provider_check;

ALTER TABLE platform_oauth_connections
  ADD CONSTRAINT platform_oauth_connections_provider_check
  CHECK (provider = ANY (ARRAY[
    'google_gbp'::text,
    'google_gsc'::text,
    'meta'::text,
    'tiktok'::text,
    'google_ads'::text,
    'microsoft_mail'::text,
    'google_ga4'::text,
    'google_gtm'::text
  ]));
