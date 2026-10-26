---
id: 2026-10-26-crm-leads-roundrobin-impl
title: 第二刀 part 2：round-robin 分配库 + meta-leads 入库挂钩
status: decided
owner: pm
decided_on: 2026-10-26
source: session:aedf9b5a
verify_by: 2026-11-02
verify_how: 新 Meta 线索（真/测试表单均可）进库后，查 contacts.assigned_to，CTS 客户下的新行应落在 receives_round_robin_leads=true 的候选中（当前只有 info@ctstours.co.nz）。真跑证据：手动触发 meta-leads-sync 一次或等正常 cron 触发，查最近 10 条 CTS contacts 的 assigned_to 分布
---
Round-robin 实现：候选从 client_portal_users.receives_round_robin_leads=true 列表取，持有线索最少的人胜出，并列按字典序。库写 src/lib/crm/lead-assignee.ts，单测 6 条绿。挂钩在 meta-lead.ts resolveContact 后、新 contact 分支，写失败不阻塞主流程。Baker 邮箱待给，后台 UPDATE 一行即可加入列表。
