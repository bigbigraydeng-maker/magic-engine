# 生产库改动记录：广告户日预算上限栏位与 CTS 两户取值（2026-10-06）

性质：统筹窗口按 PM 在对话里的两次授权（「补列」「按旧口径填」）执行的两次生产库写入。账户号只放本文件，台账卡只放指针。

## 一、补栏位
- 库：CrazyContent（项目 ID glbdnayojixmexgofbsd）。另一个名字像的 magic-engine-platform-prod 项目里没有这张表，不是生产。
- 动作：原样执行仓库迁移 supabase/migrations/20260927000003_client_meta_ad_accounts_daily_cap.sql 的语句部分（加可空整数栏位 daily_budget_cap_cents + 正数约束 + 栏位注释 + 刷新接口缓存）。
- 前后对比：client_meta_ad_accounts 7 列 → 8 列；表 7 行未动。
- 回滚：ALTER TABLE public.client_meta_ad_accounts DROP CONSTRAINT client_meta_ad_accounts_daily_cap_positive, DROP COLUMN daily_budget_cap_cents;（栏位全空时回滚不丢数据；填值之后回滚会丢这两个值）

## 二、填值
- 口径：PM 2026-09-25 的「主账户 100 / 另一个 50 / 客户总闸 150」，PM 2026-10-06 回「按旧口径填」。
- 动作：只更新 CTS（client_id c0000000-0000-0000-0000-000000000000）两行且仅当原值为空：主账户 act_2775766642787274 → 10000；官方账户 act_2202695063810470 → 5000（单位分，币种按快照为 NZD）。返回 2 行。
- 回滚：两行 daily_budget_cap_cents 置回 NULL。
- 未验证：填值后经 Kernel 的人工止损是否确实不再被「账户级日上限未配置」拒，没当场触发。
