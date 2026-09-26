---
id: 2026-09-26-auto-dev-lane-p2p3
title: P2/P3 小活不再问 PM，建一条每天自动开发、自动合并的车道（DeepSeek 写代码）
status: decided
owner: agent
decided_on: 2026-09-26
source: doc:docs/specs/2026-09-26-auto-dev-lane-v1.md
verify_by: 2026-10-10
verify_how: 主干上有 scripts/auto-dev/ 且判级为 A；本机定时任务 auto-dev-lane 已建；设计 §9 验收第 5 条第 5 张试跑任务单的 PR 已自动合并。三项都成立算成
---
PM 2026-09-26 要求 P2/P3 不问、做成定时自动开发，代码由 DeepSeek 写。设计经魏征 + 狄仁杰三轮审放行（v0.3）。
实施写入者：ME 2.0 构建控制；开工前提：合并闸窗口的判级缺口 PR 先合进主干。
车道搭建 PR 为 A 级，合并时按规矩问 PM 一次；之后 P2/P3 任务全程不问。
