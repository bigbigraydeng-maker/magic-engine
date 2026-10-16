---
id: 2026-10-15-promo-plan-ai-draft-and-approval-holes
title: 推广计划页要改成 AI 起草 + 每天自己跑，先补三个批准漏洞
status: done
owner: agent
decided_on: 2026-10-15
source: session:8aade036
verify_by: 2026-10-17
verify_how: 打开推广计划页看广告那一格是不是已由 AI 填好且每个数带依据；再用一个只有付费客户权限的账号调批准接口，必须被拒；把广告放到第二阶段，批准前的硬检查必须照样跑
done_on: 2026-10-15
done_ref: pr:2699
---
PM 10-15 判定已上线页面方向不对（人填表、人点批准，没有常驻 agent 每天跑）。
本窗口查实三个已上线漏洞：批准接口只要求 requirePaidClientAccess（客户员工也能批带钱的计划）；
evaluateApproval 只评估第一阶段（广告在后面阶段时硬检查全不跑）；批准回执没钉内容版本。
执行顺序：第一刀 = 补三洞 + AI 起草广告预算/受众/素材（带依据，PM 只看改授权）；第二刀 = 诸葛亮每天对账并推待办。
A 级：子牙+魏征两审 + 狄仁杰攻击验证，合并要 PM 回「合」。
