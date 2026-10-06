---
id: 2026-10-06-prod-fill-cts-daily-caps
title: 生产库已填 CTS 两个广告户的日预算上限（主账户 100、官方账户 50，客户总闸 150）；PM 回「按旧口径填」授权
status: done
owner: pm
decided_on: 2026-10-06
source: session:ec90bb17
verify_by: 2026-10-13
verify_how: 生产库只读查 client_meta_ad_accounts 两行 daily_budget_cap_cents 为 10000 / 5000；再当场不外发试跑一次经 Kernel 的人工止损，确认暂停不再被「账户级日上限未配置」拒；币种按快照为 NZD，换币种账户前不得相加。
---
授权：PM 在统筹窗口回「按旧口径填」，口径取 PM 2026-09-25（主 100 / 另一个 50 / 客户总闸 150）。
执行：对 CrazyContent 生产库 client_meta_ad_accounts 只更新 CTS 两行且仅当原值为空：主账户 act_2775766642787274 = 10000；官方账户 act_2202695063810470 = 5000（均为分，NZD）。返回 2 行，其他客户未动。
回滚：把这两行 daily_budget_cap_cents 置回 NULL。
未验证：Kernel 人工止损在填值后是否确实不再被拒，仅做了数据层填写，未当场触发。
