---
id: 2026-10-26-ad-create-campaign-adset-budget-sharing
title: 接口建广告系列时必须声明「各组预算不共享」，否则 Meta 拒收（试跑第一次真跑撞上）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3179
verify_by: 2026-10-28
verify_how: 合并部署后重跑 CTS 的 1 美元试跑：系列、广告组、创意、广告四步都应建成且为暂停；读回系列的 is_adset_budget_sharing_enabled 为 false。账本里上一次失败记录 60c9bc6e 是在「建系列」这步被 Meta 拒（错误 100/4834011），没有留下半成品。
---
A 级（改 Meta 建广告请求）。只加一个字段，建出来仍一律暂停。
