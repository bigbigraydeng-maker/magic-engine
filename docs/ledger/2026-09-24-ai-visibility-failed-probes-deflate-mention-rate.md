---
id: 2026-09-24-ai-visibility-failed-probes-deflate-mention-rate
title: AI 可见度周快照把失败探测算进分母，客户提及率被系统性压低
status: done
owner: agent
decided_on: 2026-09-24
source: session:5b440750
verify_by: 2026-09-29
verify_how: 查 ai_visibility_snapshots 最近一周快照的 mention_rate 是否只用 conclusive runs 算；对比修复前后同客户同周数据
done_on: 2026-09-25
done_ref: pr:1932
---
aggregateSnapshot() 拉全部 ai_visibility_runs 算提及率，失败行混入分母。
新增 run-conclusive.ts 共享判据 + partitionConclusiveRuns，orchestrator 过滤后再算。
历史 30 条快照有错误分母，已建日历提醒 9-29 出修复方案给 PM。
