---
id: 2026-10-19-learning-board-per-agent
title: Agent 学习库页改版：按支柱分块，只显示学习中 待验证 等你拍板三个大数字，页面文字压到原来的约十五分之一
status: decided
owner: agent
decided_on: 2026-10-19
source: session:c45254ff
verify_by: 2026-10-26
verify_how: 合并部署后用管理员账号打开线上 /dashboard/learning：每个 Agent 一块，块里只有三个大数字加最多两条短清单，没有逐条罗列学习中的点，没有整页红色报错；其它支柱的笔记加上 pillar 字段后自动多出一块
---
PM 2026-10-19 反馈：页面内容大量是给 AI Agent 看的，文字太多，学习中全部揉在一起看不懂。
只改现有页面 /dashboard/learning，不新增页面、路由或按钮。笔记机器索引顶层可选 pillar 字段（取值 ads/seo/ai_visibility/social/reputation/competitor），没写默认归广告 Agent。
