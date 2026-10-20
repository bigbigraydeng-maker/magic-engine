---
id: 2026-10-21-ad-heartbeat-design
title: 广告心跳：每小时只读 Meta 的准实时监控与报警（零消耗≥2h/超限/拒审限制/账户付款状态），进今日待办（设计要点，未写代码）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3026
verify_by: 2026-10-28
verify_how: 子牙+魏征审过设计后才进实现；实现后先 dry_run 当场试跑：对 CTS 官方账户只读一轮，打印本来会触发的报警，不写待办；确认读调用次数与限流表现后再开写待办。
---
A 级设计稿，PM 2026-10-21 回「做心跳」；只读 Meta，不改广告、不碰内核；不构成对自动花钱的授权。
