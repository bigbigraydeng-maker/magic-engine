---
id: 2026-10-06-mailchimp-paid-align
title: Mailchimp 补齐已付款客人标签：24 个已确认成交的邮箱，12 个补打 paid_customer，10 个本来就有，2 个不在名单里
status: done
owner: pm
decided_on: 2026-10-06
source: session:4569e58a
done_on: 2026-10-06
done_ref: doc:docs/ledger/2026-10-06-mailchimp-paid-align.md
verify_by: 2026-10-08
verify_how: 到 Mailchimp CTS 名单（dda97b7e61）里查 paid_customer 标签人数比 10/6 之前多 12；下一封群发的受众里不含这批人；不在名单里的 2 个邮箱要不要先加进名单由 PM 定（系统规矩是绝不替不在名单里的人凭空建联系人）
last_checked: 2026-10-13
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
做法：复用 src/lib/mailchimp/tags.ts 的 findMemberByEmail / applyMemberTags（只改名单里已有的人、只加 paid_customer，不摘任何标签、不新建人），先干跑再真跑，真跑后再干跑复核（22 个已有标签 / 2 个不在名单里）。
名单来源：上个窗口核实的 17 个已转化邮箱 + CRM 里阶段为已付定金/已付全款或已批准成交的 7 个 + PM 口述 4 个（取并集 24 个）。
回滚：对这 12 个邮箱执行摘除 paid_customer（本卡不含邮箱，名单在 PM 本机）。
