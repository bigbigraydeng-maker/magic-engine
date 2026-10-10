---
id: 2026-10-09-platform-learning-stage-column-unfilled
title: 平台缺口：广告组快照的学习期字段从未被填，学习期读不到
status: decided
owner: pm
decided_on: 2026-10-09
source: session:4544d90e
verify_by: 2026-10-16
verify_how: 只读查 CTS 全部在投广告组（至少目标广告组）各自最新一行的学习期列（快照是增量的，未变化的广告组本轮可以没有新行，所以按每个广告组取它自己的最新行，不要求同一次快照包含全部），必须全部可读且取值有效；只有部分历史行或个别广告组有值则本卡未完成
---
1593 条广告组快照行该列全为空（2026-10-08 核实），导致预算闸门只能按“读不到就当学习期”处理。需单独开发取数接通。
明细见 doc:docs/clients/cts/2026-10-09-budget-two-step-preflight-blocked.md
