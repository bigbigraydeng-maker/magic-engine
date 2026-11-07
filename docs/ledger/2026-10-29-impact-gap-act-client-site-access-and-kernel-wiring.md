---
id: 2026-10-29-impact-gap-act-client-site-access-and-kernel-wiring
title: 事件促销场景缺口（执行段）：改客户官网要有授权通道，审批内核要真接进投放流程
status: decided
owner: agent
decided_on: 2026-10-29
source: doc:docs/specs/2026-10-29-impact-gap-three-layer-event-campaign.md
verify_by: 2026-11-05
verify_how: 读代码与台账核对：审批内核是否已进入广告上线的真实路径并有执行回执；官网改动（修表单、建事件页）由谁、用什么权限、走哪条授权做；缺口开实现卡，改客户官网的动作必须有人工任务三件套（做什么、怎么做、链接）。
---
平台层：授权、预算与幂等闸、执行回执、人工任务三件套。企业层：Meta 账户授权、官网权限、真实素材、评价引用许可、预算批准。
行业层：销售接线纪律的默认要求（如回电时限，候选）。
10/18 核查说审批内核当时没接进业务流，之后有变化，本卡要求逐项重验。
