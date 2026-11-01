---
id: 2026-11-01-provider-webhook-events-retention-job
title: 回调原始事件表要有保留期清理（建议 180 天）：第二阶段发信前做，A 级
status: decided
owner: agent
decided_on: 2026-11-01
source: session:33ebcd0b
verify_by: 2026-12-15
verify_how: 看是否已有清理办法并试跑过（带 render.yaml 调度条目的定时任务，或写成 SOP 的管理员手动事务）；没有就在第二阶段开工前如实写「没有」，并说明这张表现在有多少行
---
表里有收件人邮箱和发件名，现在触发器禁删，只写不删；清理要库所有者手动事务，或另开 A 级改动做自动清理。
设计与理由：docs/specs/2026-11-01-me-provider-event-intake-p1-design-v0.md §3.2、§3.6。
