---
id: 2026-11-10-auto-letters-mailchimp-batch-wiring
title: 「自动发信」读接口先不接 Mailchimp 那一批：等发信设计窗口定“活动标题对应哪封信”，再把发送、打开、点击接进页面
status: done
owner: agent
decided_on: 2026-11-10
source: session:37644f65
verify_how: 打开 ME 后台 CRM「自动发信」，走 Mailchimp 发出的那一批点开能看到每位客人的发出、打开、点击；现在这一批只显示“草稿”和“—”，因为还没有“活动标题 ↔ 哪封信”的对应规则
done_on: 2026-11-10
done_ref: pr:3749
---
读接口（改动单见 CRM.AUTOLETTERS.V1）已读订单、信的登记、ME 自己发的提案和发送记录；Mailchimp 的发出记录在 contact_touchpoints 里，但活动标题和“哪封信”还没有对应规则，所以这一版不接。
规则一定，只改 src/lib/messaging/letters/load-facts.ts（加一个读 Mailchimp 记录的函数），汇总和页面不用改（汇总函数已支持 Mailchimp 一路）。
PM 11-10 还要在列表和按团汇总里看到“打开”：12/2 这一批是 Mailchimp 发的，接上以后“已过发信日的信”和团汇总里的打开数才会有数（页面和读接口已留好位置，见 2026-11-10-auto-letters-group-view-history-opens）。
11-10 傍晚更新：PM 回「接」、发信窗口定了对应规则，已在补充那一单里接上，见 2026-11-10-auto-letters-mailchimp-batch-read-wired（这张卡的验收写法已过时，以新卡为准）。
