---
id: 2026-10-21-creative-pool-status-tolerance
title: 素材池读取先容忍「自动流程状态」新值（只读容忍，写入未启用）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3016
verify_by: 2026-10-28
verify_how: 合并部署后，CTS 广告健康页素材池照常显示，已批准 A2/B3 与候选不变；没有任何新状态被写入库里。
---
B 级小改动：先让解析认识新状态值，免得以后写入时旧代码把新状态的行丢掉；新状态都不是「已批准」，手批入口对它们返回 409。数据驱动流程设计见 PR 3013（已合）。
