---
id: 2026-11-02-crm-bulk-assignee-handover
title: CRM 客人交接页：把一位同事名下的客人整批转给另一位（先预览数量再确认，仅内部管理员）
status: decided
owner: agent
decided_on: 2026-11-02
source: session:96dc6edf
verify_by: 2026-11-05
verify_how: 合并部署后用管理员账号打开 /dashboard/clients/<CTS>/crm/handover：选转出邮箱和转入同事，点「先看会动多少位」显示数量；用测试：先转 0 位的邮箱确认无副作用。非管理员账号调用接口应返回 403。真实交接前不要点确认。
---
PM 2026-11-02 问跟进人能不能交接，回「批量」。只改 contacts.assigned_to，转入人必须在跟进人名单里，转出人可以是离职邮箱；接口 POST /crm/assignees/transfer，仅 requireOperatorAccess。
注意：改前没有记每位客人的旧跟进人，转错只能按「转回去」再整批改回。
