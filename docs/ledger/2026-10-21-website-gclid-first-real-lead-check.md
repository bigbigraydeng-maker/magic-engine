---
id: 2026-10-21-website-gclid-first-real-lead-check
title: 官网询盘邮件新增的「Google click ID」那一行，要等第一封真实谷歌广告线索邮件来才能核对
status: decided
owner: agent
decided_on: 2026-10-21
source: session:ec90bb17
verify_by: 2026-10-28
verify_how: 在 CTS 询盘邮箱里找 10-21 之后来源是谷歌广告的第一封线索邮件（utm_source=google 或网址带 gclid），看有没有「Google click ID」一行、其他来源行没被挤掉；iPhone 的 gbraid、wbraid 目前不显示（已报 74），没有这一行属预期；没有谷歌线索则验收日顺延到 11-04。不成第一步：把邮件原文转给官网窗口，查「网址 gclid → 表单 → 邮件」这条链。
---
官网 #268（10-21 合并上线，官网主干 1fe9c4e9）让询盘通知邮件多一行「Google click ID」，用来之后把谷歌广告线索对回它的点击。服务器代码从浏览器读不到、不提交线索就读不回，所以只能等第一封真实谷歌广告线索邮件。
上线时只确认了：接口仍在、空请求仍返回 400。我核过 ME 解析询盘邮件按标签认、不按行位置，多一行不会丢单。按 §11 为 P3。日历提醒 10-28 09:00 由 121 号建好。
