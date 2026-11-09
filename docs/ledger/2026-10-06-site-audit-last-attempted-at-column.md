---
id: 2026-10-06-site-audit-last-attempted-at-column
title: 网站体检要单独记"最近一次尝试时间"，曾成功后持续失败的页才能退避
status: decided
owner: agent
decided_on: 2026-10-06
source: pr:2233
verify_by: 2026-10-20
verify_how: 看是否开出加 last_attempted_at 列的 A 级 PR 并由 PM 回「合」；合并后体检排序用它。不成：到期仍没有这条 PR。目前边界：曾抓成功、之后持续失败的页保留最后成功时间，每周被重试一次占一个名额（样本：CTS 约 179 页/上限 150，影响页数很少）。
---
不加列修不干净：updated_at 有触发器，任何更新都会改（收录检查、改写页面也写这张表），不能当尝试时间；把失败原因塞进 crawl_error 只能表示"失败过"，没有时间，会让这些页永不重试。
正确做法是加一列 last_attempted_at（碰数据库结构，A 级，要 PM 点头），本卡只记决定，没有动手。
