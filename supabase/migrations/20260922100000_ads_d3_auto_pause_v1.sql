-- Ads D3 auto-pause v1（广告诊断 D3「花钱没结果」→ Kernel 自动暂停建议）
--
-- 🔴 PM 显式 go 之后才 apply，agent 严禁自行 apply_migration。
--
-- 做两件事：
--   1. ad_strategy_configs 加两个双重开关：autopilot_enabled（默认 false，
--      只有显式打开的客户才生成暂停建议）+ autopilot_dry_run（默认
--      true，打开后先只写记录不真调 Meta，观察几天再放开）。
--   2. client_automation_policies 给 CTS 插一条 ads.auto_pause_on_d3 的规则，
--      mode='require_approval'——这个动作会真的写 Meta（暂停一条正在花钱的
--      广告组），Kernel 的 outward 闸门硬性要求人工批准，auto_approve 在这里
--      不放行（authorize.ts 的 outward_requires_human_policy）。「一键批准」
--      靠的是待办卡片直接调 approveAndExecuteAdsAutoPause，不是这条规则本身
--      免人工。
--
-- 这条 migration 只建配置行，**不改变任何现有行为**：CTS 的
-- autopilot_enabled 这次插入就是 true，但 autopilot_dry_run 也是 true——
-- 打开之后先进入"只记录、不执行"的观察期，PM 另行拍板何时把
-- autopilot_dry_run 改成 false 才会真的开始暂停广告。

ALTER TABLE ad_strategy_configs
  ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS autopilot_dry_run BOOLEAN NOT NULL DEFAULT true;

-- CTS：打开 D3 自动暂停建议，先跑 dry-run 观察（不真的调 Meta）。
-- 🔴 WHERE EXISTS 而不是裸 INSERT：CTS 这一行客户不是由任何 migration 建的。
--    从零重放全部 migration 的场景（本机沙盘/CI）里没有这一行，裸 INSERT 会撞
--    外键约束报错退出——跟 20260913000001_client_meta_ad_accounts.sql 同一个坑，
--    同一个写法。生产库上 CTS 这行本来就在，行为不变。
INSERT INTO ad_strategy_configs (client_id, enabled, autopilot_enabled, autopilot_dry_run)
SELECT 'c0000000-0000-0000-0000-000000000000', true, true, true
WHERE EXISTS (
  SELECT 1 FROM public.clients WHERE id = 'c0000000-0000-0000-0000-000000000000'
)
ON CONFLICT (client_id) DO UPDATE SET
  autopilot_enabled = true,
  autopilot_dry_run = true,
  updated_at = now();

-- CTS 的 ads.auto_pause_on_d3 自动化规则：要人批准才能执行。
-- 🔴 decision_ttl_seconds 给 7 天（604800 秒）——诊断日报一天发一次，
--    待批准的暂停建议至少要撑到 PM/FDE 下一次看内部日报的那一刻，
--    默认的 900 秒（15 分钟）对这个场景太短，会让授权在人看到之前就过期。
INSERT INTO client_automation_policies (
  client_id, action_key, mode, decision_ttl_seconds, updated_by
)
SELECT
  'c0000000-0000-0000-0000-000000000000',
  'ads.auto_pause_on_d3',
  'require_approval',
  604800,
  'migration:20260922100000_ads_d3_auto_pause_v1'
WHERE EXISTS (
  SELECT 1 FROM public.clients WHERE id = 'c0000000-0000-0000-0000-000000000000'
)
ON CONFLICT DO NOTHING;
