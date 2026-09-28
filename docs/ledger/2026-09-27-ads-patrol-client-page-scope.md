---
id: 2026-09-27-ads-patrol-client-page-scope
title: 广告每日巡检只判挂客户自己 Facebook 主页的广告组，别家广告组不进诊断、不进自动暂停（A 级，等 PM 合）
status: done
owner: agent
decided_on: 2026-09-27
source: session:b487d1fb
verify_by: 2026-10-01
verify_how: 合并部署后第一次每日巡检跑完，查 CTS 当天巡检记录：排除清单里没有挂 CTS 主页的广告组被误切；D3 命中的广告组名下广告全挂 CTS 主页；自动暂停记账里每条要么带归属判定 own，要么是 blocked/failed 并写明归属原因。PR 还没合并就只盖章不判
done_on: 2026-09-28
done_ref: pr:2118
---
起因：一个只登记给 CTS 的广告账户里投着另一个客户主页的广告，另一个账户里有挂第三个客户主页的广告组花过钱；广告组/系列层诊断把它们全算给 CTS，D3 命中会进自动暂停。
做法：建上下文前按创意主页把不是客户的系列/广告组切掉（拿不准一律不算）；自动暂停出手前回库再核一次归属和快照新鲜度。登记表不改成「共用」（会让客户整个主账户只剩账户级）。
设计与两轮审：docs/specs/2026-09-27-ads-diagnostics-client-page-scope-design.md。
