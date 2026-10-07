---
id: 2026-09-25-close-pr1940-duplicate-of-1932
title: 关掉重复的 PR #1940，AI 提及率修复以 #1932 为准
status: done
owner: agent
decided_on: 2026-09-25
source: session:32ac29ef
done_on: 2026-09-25
done_ref: pr:1940
---
PR #1940 和 #1932 修同一个问题（AI 探测失败算进提及率分母），#1932 更全面（多修了 parser 漏洞、分页截断、snapshot_skipped_reason、EngineComparison/ModelStats 组件），关掉 #1940 保留 #1932。
