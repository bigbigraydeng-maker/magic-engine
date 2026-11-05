---
id: 2026-11-06-auto-publish-prereq-mutual-exclusion
title: 图文自动发布真发前第 1 项：手动发布和自动发布互相拦住（第 1 步已提交，第 2 步未做）
status: decided
owner: agent
decided_on: 2026-11-06
source: pr:3648
verify_by: 2026-11-13
verify_how: 第 1 步合并后在测试里看手动发布对没确认的日子返回 409；第 2 步（手动发布也写占位）做完并验证后，再回头把这张卡改成 done；两步都没完成前，Render 上不许设 DAILY_PLAN_AUTO_PUBLISH_LIVE
---
PM 11-06 选了全自动发布，6 项真发前清单第 1 项。调查结论：一半早就有了（手动发布已拦自动发布刚占住的日子）。第 1 步补「没确认的日子」也要拦，页面显示中文提示；第 2 步让手动发布也往同一张记录表写占位，闭合两边同时点的竞态，另开 PR。撤回过的日子手动能不能覆盖，要在第 2 步定口径。
