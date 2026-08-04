-- 让 platform_oauth_connections 认识「客户自己的邮箱」这个平台。
--
-- 为什么需要：客人发到 CTS 的 info@ 的邮件，ME 现在一个字都看不到 —— 四条获客
-- 管道里唯一一条正在往外漏线索的。接进来需要存一份该邮箱的授权令牌，而令牌该存
-- 哪里已经有定论（platform_oauth_connections，每客户每平台一条、AES 加密），
-- 这里只是把新平台名加进白名单，不新建表。
--
-- 命名用 microsoft_mail 而不是 outlook/office365：同一套 Microsoft Graph 接口
-- 既服务 Outlook.com 也服务 Microsoft 365 企业邮箱，用产品名会在客户用的是另一个
-- 品牌名时显得对不上。
--
-- 可逆：把 'microsoft_mail' 从数组里去掉即可（去掉前需先清理该 provider 的行）。
--
-- 已于 2026-08-02 由 PM 放行并执行。文件名比原计划晚半小时，是为了跟另一个
-- 窗口同一时间戳的 team_memory 错开 —— 两者互不相干，只是重名会让人分不清顺序。

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
    'microsoft_mail'::text
  ]));
