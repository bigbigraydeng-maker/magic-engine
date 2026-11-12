---
id: 2026-10-25-decision-history-source-columns
title: 调整决定写进客户经验记录：给记录表加「来源」三列，生产执行前还要 Ray 再点头
status: decided
owner: pm
decided_on: 2026-10-25
source: issue:3087
verify_by: 2026-11-08
verify_how: Ray 批准后在生产执行迁移；确认 client_decision_history 多出 source_kind/source_ref/goal_id 三列、旧行不变；再确认一次调整确认后只多一行、复检后结果填回
---
迁移文件已写（只加列，附回滚脚本），未在生产执行。Ray 10-25 批准写文件；生产执行另问。
代码：memory/adjustment-decision.ts（写入幂等、复检结果映射），测试 T17–T19。
