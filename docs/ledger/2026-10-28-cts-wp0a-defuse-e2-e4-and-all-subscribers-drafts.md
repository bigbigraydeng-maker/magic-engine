---
id: 2026-10-28-cts-wp0a-defuse-e2-e4-and-all-subscribers-drafts
title: 先拆雷已做：E2/E3/E4 三个发信定时任务停了（改成 2099 年一次性日期，没删），11 封全员草稿收件人改成只发内部测试地址
status: done
owner: agent
decided_on: 2026-10-28
source: session:82f88edf
verify_by: 2026-10-29
verify_how: "10/29 10:30 后查：Apps Script 执行记录里没有 E2 / E3 / E4 的运行；Mailchimp 没有新的 auto_e2 / e3 / e4 活动；11 封草稿收件人仍是测试分组；E1 批次与同步类任务照常"
done_on: 2026-10-28
done_ref: doc:docs/ledger/evidence/2026-10-28-wp0a-defuse-landmines.md
---
PM 10/28 回「停」后执行。触发器没有停用开关，删除被安全系统拦下，改成 2099 年一次性日期（可逆，原设置记在证据文件）。
13 封全员草稿里改了 11 封；Email 1 与 PREVIEW ONLY 两封欢迎信底稿没动（E1 批次依赖，待查清哪封是底稿）。
保存触发器时 Google 弹出未验证应用授权页，没有点继续；已加日历提醒 10/29 10:30 复核。
