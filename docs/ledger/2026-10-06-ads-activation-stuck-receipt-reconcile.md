---
id: 2026-10-06-ads-activation-stuck-receipt-reconcile
title: 广告重开记录若停在「等待中/开启中」要有人对账：Meta 可能已经开了但记录没改
status: decided
owner: agent
decided_on: 2026-10-06
source: session:a0f2e1de
verify_by: 2026-10-13
verify_how: 加一个定时对账：把停在 authorized_pending / activating 超过 30 分钟的行，对照 Meta 当前状态补成 executed 或 meta_failed，或至少进今日待办；用假 Meta 当场试跑一次
---
来自卫青审查（本 PR 的 A 级草稿）：进程在 Meta 成功之后、最终写账本之前被杀，记录会停在中间状态，广告其实已开。
本 PR 已做到「宁可卡住也不重复开」，但还没有自动对账。不在本 PR 范围，排第一优先。
