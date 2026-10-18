---
id: 2026-10-18-review-before-auto-merge-draft-first
title: 要走复审的 PR 一开出来先挂草稿，复审回了再转待合，避免 B 级自动合抢在复审之前
status: decided
owner: agent
decided_on: 2026-10-18
source: session:ec90bb17
verify_by: 2026-10-25
verify_how: 一周内各窗口新开的需复审 PR 都先是草稿；若再出现「复审结论回来前已被自动合」，说明这条要升成机器闸（如复审通过前禁用自动合并）
---
事件：推广计划 2790 在子牙+魏征复审回来前被 B 级自动合并合进主干，8 条必改上了主干（两句假话、两处真缺陷），改走新 PR 修。
规矩：要走复审的 PR 先挂草稿；复审回了、问题全解决才转待合。长期应做成机器闸，不靠记性。
