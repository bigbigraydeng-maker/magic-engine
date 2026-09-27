---
id: 2026-09-27-ads-growth-states-outputtables-registry
title: 把 ads_growth_states 加进 google-data-pullback-daily 的 outputTables，让沉默死检测能照到这张表
status: decided
owner: pm
decided_on: 2026-09-27
source: doc:docs/ledger/2026-09-27-growth-states-missing-0925-root-cause.md
verify_by: 2026-10-04
verify_how: 查 cron/registry.ts 里 google-data-pullback-daily 这个 job 声明的 outputTables 是否含 ads_growth_states（freshnessHours: 26）。加了 → 翻 done；没加 → 继续交回 PM，不当已解决
---
9/25 `ads_growth_states` 整天零行、零告警地躺了一天，根因见 source：该表没登记进 `cron/registry.ts` 的 outputTables，`cron/health.ts` 的沉默死检测因此照不到它。修法是一行配置改动（B 级、极小），但截至本卡建立时**还没有人拍板去改**，卫青未擅自改。这张卡只追踪这一行配置有没有落地，不代表根因排查本身没做完。
