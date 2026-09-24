---
id: 2026-09-25-agent-crm-list-all-trade-contacts
title: 同行渠道页面整页空修好：Agent 列表改为列出全部同行联系人，没客户的也显示，不再从客户行反推
status: done
owner: agent
decided_on: 2026-09-25
source: session:bb3d4403
verify_by: 2026-09-28
verify_how: 生产页面 /dashboard/clients/<id>/agents 显示 CTS 的 16 张同行联系人卡（不再整页空），每张卡在没客户时显示「还没有客户」提示；样本 = 这一个客户即可判
done_on: 2026-09-25
done_ref: pr:1999
---
根因：GET 先查 agent_customers 再反推联系人，生产 0 行客户 → 返回空 → 页面空白。
改法：先按 clients.leads_config 的同行域名用 contactKindOf 挑出 trade 联系人，再把客户行挂上去；响应形状不变。
UI 只改两处空态文案（page.tsx 无 Agent 时、AgentList 卡无客户时）。不改 mail-ingest / migration / POST。
未做：页面上目前没有「+ 添加客户」按钮，手动加客户仍只能走接口。
