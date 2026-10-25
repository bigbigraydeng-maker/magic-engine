---
id: 2026-10-26-crm-followup-person-ui
title: CRM 第二刀 part 3 — 跟进人字段接到 UI
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:TBD
parent: 2026-10-26-crm-after-leads-flow-cts
verify_by: 2026-11-02
verify_how: 「全部客人」页筛选条有「跟进人：全部/我负责/未分配/<邮箱>」按钮；点抽屉能看到并修改跟进人；CrmTabs「相关工具」里有「我的待跟进」入口直达 ?assignee=me
---
B 级 UI。无 schema 改动，复用 part 1 的 `contacts.assigned_to` 字段 + part 2 的 `listAssignees` 库。done_ref 指回根台账 2026-10-26-crm-after-leads-flow-cts。
