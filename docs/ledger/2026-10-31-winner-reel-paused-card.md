---
id: 2026-10-31-winner-reel-paused-card
title: 赢家素材不再直接改广告，只出一张暂停草稿确认卡
status: decided
owner: agent
decided_on: 2026-10-31
source: doc:docs/ledger/2026-10-18-winner-reel-sync-bypasses-kernel.md
verify_by: 2026-11-07
verify_how: 开关开着时，每日任务和补新素材只出一张确认卡，不直接建广告、不暂停疲劳广告。人确认后只在原来的广告组里加暂停广告，不加预算、不自动开投。生产上已经关掉的那一行保持关掉。
---
扫描不再调用建广告或暂停广告。同一个开关仍同时管扫描出卡、补新素材、疲劳广告不自动暂停，这次不拆、不改配置。
人确认后走原来的暂停草稿通路，只加暂停广告。打开队列不会把原来的广告组一起打开。
旧卡仍是 decided，本卡是它的做法，不改旧卡判据。
