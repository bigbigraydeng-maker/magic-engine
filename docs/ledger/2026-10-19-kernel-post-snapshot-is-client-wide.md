---
id: 2026-10-19-kernel-post-snapshot-is-client-wide
title: kernel_post 快照是按客户全量写的，谁拿它当「这个实体刚改过」都会冻死整个客户 72 小时——现在没人写它，接通前必须先收窄
status: decided
owner: agent
decided_on: 2026-10-19
source: session:c668eb35
verify_by: 2026-11-03
verify_how: |-
  查两件：①全仓是否出现 captureClientSnapshots(..., reason: 'kernel_post') 的生产调用方（现在零个）②若出现，先核它写出来的行是不是只覆盖本次动作的实体；以及 diagnostics/loader.ts 判「真改动」时还认不认它。两件都满足才算修好。
---
实查 `src/lib/ads-strategy/portfolio/snapshot.ts:363-365`：`reason` 传 `kernel_post` 时，当前所有实体一律写一行，**不看设置有没有变**。
所以这个原因码代表「这一轮抓过它」，不代表「它变了」。谁把它当真改动，任何一次动作之后该客户每个实体都会显示「刚改过」。
后果：72 小时冷却期闸会把整个客户的自治一起冻死；而且因为方向是「偏严」，不会报错，只会安静地什么都不做。
现状不咬人：全仓**没有任何生产写入方**，只有两处读（`diagnostics/loader.ts:89` 与冷却期判据）。冷却期这一处 2026-10-19 已改为不认它（魏征复审查实）；`loader.ts` 那处本轮没动。
接通 kernel_post 之前必须先把它收窄到本次动作的实体，否则一上线就是静默冻结。
