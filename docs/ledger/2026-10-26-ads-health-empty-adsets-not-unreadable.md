---
id: 2026-10-26-ads-health-empty-adsets-not-unreadable
title: 广告健康页「今日实时」空广告组别再误报读不到
status: decided
owner: agent
decided_on: 2026-10-26
source: session:cc71ed0a
verify_by: 2026-10-28
verify_how: PR 合并后打开 CTS 客户的广告健康页「今日实时」卡，两个账户都应显示「现在没有状态为「投放中」的广告组。」而不是红字「这个账户现在读不到：这些读取失败：adsets」；或在本地 pnpm vitest 跑 heartbeat 测试，171 条全绿。
---
CTS 两个账户当前所有广告组 PAUSED，心跳 adsets fetcher 用状态白名单返回 0 行，被 classifyRead 当成 read_failed。改成新 verdict `empty_but_ok`，live-view 把它当读 OK，UI 走已有的「现在没有活广告组」文案分支。改 types/read 两个 verdict union、criteria 的一个分支、live-view 的 adsetsOk 判断、evaluate 的 isSuccessfulRead；加 3 个测试 case 覆盖真失败 / 空ok / 有数据。
