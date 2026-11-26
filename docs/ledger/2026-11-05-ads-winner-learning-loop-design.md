---
id: 2026-11-05-ads-winner-learning-loop-design
title: "广告赢家经验闭环设计稿 v0：发现→拆骨架→PM 确认→工厂照骨架出片→对比→升级退役"
status: decided
owner: agent
decided_on: 2026-11-05
source: session:90a50c3b
risk: C
verify_by: 2026-11-08
verify_how: "子牙+魏征审完、PM 看过并点头第一刀"
---

PM 11-04 问「今后在 ME 内用视频工厂开发时，如何确保 winner 经验会被调用」，并指出上一版方案不是藏经阁要求的 agent 工作流。
设计稿 `docs/specs/2026-11-05-ads-winner-learning-loop-design-v0.md`：不新增 agent，给广告 agent 加「找赢家」、视频工厂加通用配方 `winner_skeleton_v1`、马良加骨架对账；PM 确认过的赢家才会成为默认骨架；事实从团目录现取；花钱与发布仍只认 PM。
分 5 刀，第一刀（考卷 + 后台看得见当前赢家 + 按单元结果种类挑赢家）B 级、不花钱、不改表结构。待子牙、魏征审。
