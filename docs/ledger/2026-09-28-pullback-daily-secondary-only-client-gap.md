---
id: 2026-09-28-pullback-daily-secondary-only-client-gap
title: pullback-daily 客户名单只认主账户——只登记辅助账户的客户会完全跳过熔断保护
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-05
verify_how: 查 client_meta_ad_accounts 是否出现 clients.meta_ad_account_id 为空、但该客户在 client_meta_ad_accounts 仍有行的情况；若出现且该客户 autonomy_mode=bounded_auto，升级为立即处理，否则跟 §11 三维打分排入 ROADMAP
---
Codex 复审 PR #2019（熔断器运行时调用方）时发现：`google-data-pullback-daily` 的客户名单查询（`clients` 表 `.not('meta_ad_account_id','is',null)`）只认主账户，只登记在 `client_meta_ad_accounts`（辅助账户绑定表）而清空了主账户的客户永远不进这个 cron 的处理循环——这个缺口是预先存在的（文件头原先定性为"仅丢分析数据"），但熔断器接上之后，同一批客户如果处于 bounded_auto 会完全绕过花费安全检查。

今天的真实数据不触发这个缺口：`client_meta_ad_accounts` 目前只有 CTS 两行、其余客户各一行，都对应有效的 `meta_ad_account_id`（2026-08-12 STATE.md 实查）。修复需要重建整条 cron 的客户名单来源（从登记账户表构建），影响诊断/摘要/快照等全部下游步骤，不是"接线路调用方"范围内的改动，需要单独设计 + 复审。
