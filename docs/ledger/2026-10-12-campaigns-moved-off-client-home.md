---
id: 2026-10-12-campaigns-moved-off-client-home
title: 客户首页不再放「推广活动」，搬到独立页面，已过期的折叠进「已结束」
status: decided
owner: agent
decided_on: 2026-10-12
source: session:23686345
verify_by: 2026-10-14
verify_how: 合并上线后打开任一客户首页，概览里没有推广活动；工具页「推广活动」卡片能进新页面；已过期活动默认不显示、展开「已结束」才看到
---
PM 10/12 原话：首页里过期的要移除或整块不放首页，确认选「整块不放首页」。只改页面显示和入口，数据与读写逻辑未动。
新页面 `/dashboard/clients/<id>/campaigns`；过期 = 有效期早于今天但仍在进行中的活动，只折叠不删除。
