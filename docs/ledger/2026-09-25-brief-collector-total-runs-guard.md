---
id: 2026-09-25-brief-collector-total-runs-guard
title: 竞品简报和诊断采集器加 total_runs===0 保护（从 #1940 拆出的独有改动）
status: done
owner: agent
decided_on: 2026-09-25
source: session:32ac29ef
done_on: 2026-09-25
done_ref: pr:2015
---
#1940 有两个文件的改动不在 #1932 范围内：competition-brief.ts 和 ai-visibility-collector.ts 对 total_runs===0 的保护。拆出来单独提交为 PR #2015，挂在 #1932 后面。
