---
id: 2026-10-06-prod-apply-daily-cap-column
title: 生产库已补上「每个广告户每日上限」栏位（PM 回「补列」授权）；栏位空着，CTS 两个户的数还没填
status: done
owner: pm
decided_on: 2026-10-06
source: session:ec90bb17
verify_by: 2026-10-13
verify_how: 生产库 CrazyContent 只读查 client_meta_ad_accounts.daily_budget_cap_cents 存在且可空；PM 确认 CTS 两户上限后填值，再当场不外发试跑一次经 Kernel 的人工止损，确认暂停不再被「账户级日上限未配置」拒。
---
授权：PM 在统筹窗口回「补列」（2026-10-06）。执行：统筹窗口用 Supabase apply_migration 对 CrazyContent（glbdnayojixmexgofbsd）原样执行仓库迁移 20260927000003_client_meta_ad_accounts_daily_cap.sql 的语句部分，迁移名 client_meta_ad_accounts_daily_cap。
执行前核对：生产该表 7 列、无此栏；另一项目 magic-engine-platform-prod 无此表，不是生产。
执行后核对：栏位 integer 可空；约束 client_meta_ad_accounts_daily_cap_positive 已建；表 7 行未改，填值 0 行。
回滚：ALTER TABLE public.client_meta_ad_accounts DROP CONSTRAINT client_meta_ad_accounts_daily_cap_positive, DROP COLUMN daily_budget_cap_cents;（栏位全空，回滚不丢数据）
待办：CTS 主账户 act_2775766642787274 与官方账户 act_2202695063810470 的上限按 PM 2026-09-25 口径（主 100 / 另一个 50 / 客户总闸 150）待 PM 确认后填。核实来源见 docs/ledger/2026-10-06-ads-activate-gate-and-daily-cap-column-verification.md（PR #2302）。
