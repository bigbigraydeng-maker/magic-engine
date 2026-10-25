-- 广告健康页（作战地图）账户展示开关
--
-- ⚠️ 尚未应用：等 PM 授权后再跑。
-- 本迁移只加列，不改任何数据；「把旧个人账户标成 hidden」是单独的数据步骤，另行执行。
-- 不改 RLS：client_meta_ad_accounts 已有 service_role_full 策略。

ALTER TABLE public.client_meta_ad_accounts
  ADD COLUMN IF NOT EXISTS hidden_from_ad_health boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.client_meta_ad_accounts.hidden_from_ad_health IS
  '为 true 的账户不在广告健康页（作战地图）显示、不进状态异常提示；只管展示，不改变投放/预算/内核对该账户的任何处理';
