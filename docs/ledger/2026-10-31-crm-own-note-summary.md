---
id: 2026-10-31-crm-own-note-summary
title: 最近手记卡读取该手记自己的摘要
status: done
owner: agent
decided_on: 2026-10-31
source: doc:docs/specs/2026-10-31-crm-inline-recent-notes-stage-and-name.md
verify_by: 2026-11-02
verify_how: 线上打开 CTS 智能名单，展开最近手记，核对摘要来自同一笔触点；没有单独摘要时明确显示缺失并保留员工原文。核对客户姓名保留原始拼写。
done_on: 2026-10-31
done_ref: doc:docs/ledger/evidence/2026-10-31-crm-own-note-summary--local.md
---
上线抽查发现电话手记没有对话概况，原卡片的 AI 栏因此为空。改为只读取最近 50 笔员工手记的触点摘要，不扩大主名单扫描字段。
