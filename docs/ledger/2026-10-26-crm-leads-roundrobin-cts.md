---
id: 2026-10-26-crm-leads-roundrobin-cts
title: 第二刀：meta-leads-sync 创建 conversation 时 round-robin 分配给 Baker/Lisa
status: decided
owner: agent
decided_on: 2026-10-26
source: session:aedf9b5a
verify_by: 2026-11-02
verify_how: 新 Meta 线索进库后 conversations.owner_email 按 Baker/Lisa 轮流落值；CRM 联系人详情页能看到跟进人；「我的待跟进」看板按 owner_email 过滤。真跑证据：手动触发 meta-leads-sync，查最近 10 条 CTS conversations.owner_email 分布
---
用 CTS v6.1 测试表单真跑一次端到端。复用 conversations.owner_email（2026-07-26 迁移已加）。CTS 销售名单先用 info@ctstours.co.nz 占位，等 PM 给 Baker/Lisa 个人邮箱再填进 client_configurations.sales_assignees。digest 开关此刀不动，仍默认 off。
