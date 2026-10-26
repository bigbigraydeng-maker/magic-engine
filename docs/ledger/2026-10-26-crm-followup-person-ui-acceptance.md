---
id: 2026-10-26-crm-followup-person-ui-acceptance
title: 「全部客人」页能按跟进人筛选、抽屉里能改跟进人：上线后点一遍验收
status: decided
owner: agent
decided_on: 2026-10-26
source: doc:docs/ledger/2026-10-26-crm-after-leads-flow-cts.md
parent: 2026-10-26-crm-after-leads-flow-cts
verify_by: 2026-11-02
verify_how: 打开 CRM「全部客人」页：筛选条出现「跟进人」按钮（全部 / 我负责 / 未分配 / 某个邮箱）；点开客人抽屉能看到并改跟进人；「相关工具」里的「我的待跟进」直达只看自己负责的客人。三项都点过才算过。
---
CRM 第二刀第 3 块是纯界面改动（B 级，不动数据库），沿用第 1 块的 assigned_to 字段和第 2 块的跟进人列表库。
原卡的 source 写成 pr:TBD、格式不合格，冻结字段改不了，所以换成本卡；上线 PR 号请记在根台账 2026-10-26-crm-after-leads-flow-cts。
