---
id: 2026-10-29-social-impact-loop-v1-design
title: 社媒 Agent 按 IMPACT 六段重新设计（目标契约、发布后自动回读与验证、验证结果回流处方），设计稿待子牙魏征复审
status: decided
owner: agent
decided_on: 2026-10-29
source: doc:docs/specs/2026-10-29-social-goal-driven-impact-loop-v1.md
verify_by: 2026-11-05
verify_how: 看设计稿是否已过子牙和魏征复审、PM 是否回了第 10 节四个问题；第一刀（定时读取单条表现，A 级）有没有开工；没开工就问 97 号窗口卡在哪
---
PM 2026-10-29：「参考广告 agent 的流程，严格按照 IMPACT 工作流，重新设计社媒 Agent」。
继承能力地图 v0.3 和日常运营设计稿，不推翻；比广告稿保守：v1 不开自动发布，沿用「PM 授权一周的包」。
第一刀选定发布后定时读取单条表现：主干上 post-performance 代码没有任何定时调用（2026-10-29 复核）。
本卡不授权改任何代码、不授权发布。
