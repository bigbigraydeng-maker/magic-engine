---
id: 2026-10-14-crm-default-tab-all-guests
title: PM 定：CRM 默认先看全部客人（不另设今天页）
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2651
source: session:1a85e0eb
verify_by: 2026-10-21
verify_how: 打开客户的 CRM 入口 /crm 会跳到全部客人，页签里全部客人排第一；没有「今天」页签
---
PM 2026-10-14 回答「默认先看今天还是全部客人」：先看全部客人。线上现状已经是这样（/crm 跳转到 /crm/all，今天要联系页 2026-09-28 已删），无需改代码。后续页签合并、筛选合并都以此为前提，不再为「默认页」另开讨论。
