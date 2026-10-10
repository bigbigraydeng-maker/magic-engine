---
id: 2026-09-26-crm-priority-view
title: 「全部客人」页 priority 视图的纯装配函数 buildPriorityView 已就位
status: decided
owner: agent
decided_on: 2026-09-26
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: R6/R7 路由把它接进 view=priority 后，端到端验证 CTS 全部客人页 4 段人数总和 = 客户联系人总数
---
新建 src/lib/crm/contact-list-view.ts + 测试：把已经取好的 contacts / touchpoints / stages / now 喂进来，依次跑 buildContactModel → segmentContact → buildSections。纯函数，不碰 supabase；路由接线放 R6。BLOCKER-1 断崖的架构解由上层负责——SQL 层先按 owner/work_state/stage/q 过滤后再喂进本函数；本函数只处理拿到的子集。9 个测试全过。
