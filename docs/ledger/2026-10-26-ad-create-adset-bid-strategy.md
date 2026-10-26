---
id: 2026-10-26-ad-create-adset-bid-strategy
title: 接口建广告组时必须声明竞价策略（最低成本），否则 Meta 拒收（试跑第二次真跑撞上）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3181
verify_by: 2026-10-28
verify_how: 合并部署后重跑 CTS 的 1 美元试跑：系列、广告组、创意、广告四步都应建成且为暂停；读回广告组 bid_strategy 为 LOWEST_COST_WITHOUT_CAP。上一次失败记录 5273a759 在「建广告组」被拒（100/2490487），系列已被自动删回，7274 账户没有「试跑」残留（已用 Meta 读接口核对）。
---
A 级（改 Meta 建广告请求）。只加一个字段，建出来仍一律暂停。
