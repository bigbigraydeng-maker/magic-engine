---
id: 2026-11-03-ads-d5-o3-and-core-metric-same-root
title: 「钱和结果错配」D5、预算错配 O3 跟 D3 同一个病根：拿客户主结果去数 WhatsApp / 视频组，可能建议把预算从开聊组挪走；另有三种组的结果种类认不出
status: decided
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-24
verify_how: 开工前先查生产库近 30 天 D5 / O3 命中里有几条落在「结果种类跟客户主结果不一样」的组上；0 条就只开测试护栏不改规则，≥1 条再按 D3（PR 3535）的做法改
---
子牙复审 PR 3535 时指出：D5（d5-budget-result-mismatch.ts）、O3（o3-budget-mismatch.ts）都没接 rules/core-metric.ts，CTS 这种客户的 WhatsApp 组按留资算永远是 0，会被当成最差的预算单位。
另有三种组 core-metric 认不出结果种类、D3 仍按主结果数：开聊目标但目的地是 UNDEFINED（Oztop 回放样本里有）、主结果是开聊时按网站转化优化的组、主结果是「私信聊到第 3 句」时的表单组。改 core-metric 会同时影响 D2 / D10，另开改动单，A 级。
