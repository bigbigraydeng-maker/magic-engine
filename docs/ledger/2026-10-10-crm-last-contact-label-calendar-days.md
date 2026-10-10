---
id: 2026-10-10-crm-last-contact-label-calendar-days
title: 全部客人页「最近联系」时间写法统一成 今天/昨天/N天前
status: decided
owner: agent
decided_on: 2026-10-10
source: session:6327ac2c
verify_by: 2026-10-14
verify_how: 合并上线后打开 NAL 全部客人页，最近联系列只出现 今天/昨天/N天前，不再夹杂 10/9 这类日期（30天内）
---
PM 2026-10-10 要求统一写法。原写法按满 24 小时算，不满 24 小时但不是同一天的会掉回日期。
改成按日历日算；只改 relTime，不改排序。附单元测试。
