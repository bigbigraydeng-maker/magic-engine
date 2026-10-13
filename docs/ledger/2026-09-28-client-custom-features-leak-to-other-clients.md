---
id: 2026-09-28-client-custom-features-leak-to-other-clients
title: 只给 CTS 做的「同行渠道」出现在 NAL 后台——卡片没过滤、页面也不检查；要区分基础功能和客户定制功能
status: done
owner: pm
decided_on: 2026-09-28
source: session:5b9407a2
verify_by: 2026-10-05
verify_how: "用 NAL 打开客户首页「工具」页签看不到「🤝 同行渠道」；NAL 直接敲 /dashboard/clients/<NAL>/agents 被拒；CTS 两处照常。计划见 docs/specs/2026-09-28-crm-rebuild-plan.md 的 WP-A"
done_on: 2026-09-28
done_ref: pr:2161
last_checked: 2026-10-13
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
查证（读代码）：客户首页那排卡片只有行程单 / 楼盘 / 房子三张按行业开关过滤（clients/[id]/page.tsx），「同行渠道」卡片没有任何过滤；/agents 页面本身也不做服务端检查（对比 /tailor-made 有）——只藏卡片不够，敲网址照样进。

根因是现有机制按「行业」推断而不是按「客户开通」：PM 要的是「给谁定制的只有谁看得到」。建议客户开通为准、行业只当默认值（client configuration 层）。排在 WP-B 之前做，因为两边都改客户首页那排卡片。
