---
id: 2026-10-09-platform-learning-stage-column-unfilled
title: 平台缺口：广告组快照的学习期字段从未被填，学习期读不到
status: decided
owner: pm
decided_on: 2026-10-09
source: session:4544d90e
verify_by: 2026-10-16
verify_how: 只读查 ad_entity_snapshots 的学习期列是否已有非空值；仍全空则本卡未完成
---
1593 条广告组快照行该列全为空（2026-10-08 核实），导致预算闸门只能按“读不到就当学习期”处理。需单独开发取数接通。
明细见 doc:docs/clients/cts/2026-10-09-budget-two-step-preflight-blocked.md
