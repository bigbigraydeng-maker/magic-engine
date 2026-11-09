---
id: 2026-11-01-crm-small-tails
title: CRM 三个评审遗留小尾巴：笔记整理防编造补口子、「下午再打给我」不再被记成先放着、一条测试对齐
status: decided
owner: agent
decided_on: 2026-11-01
source: session:96dc6edf
verify_by: 2026-11-08
verify_how: 看 PR 合并后三件事：员工笔记「预算三千」被改写成五千时档案里仍是原话；客人说「下午再打给我」的通话不再被记成先放着；contacts 路由测试全绿
---
(a) 笔记防编造：补「千」换算、别名地名（魔都/帝都/长城）、dalian 不是 Dali、英文 next March 翻成明年三月不丢出行时间。
(b) 通话表态：「Call me back later this afternoon / 下午再打给我 / 晚点打给我」是回电请求，挡住 not_now；补两行原话第二行是问句的测试。
(c) contacts 路由测试：允许 PR #3427 加的那一条按 id 取摘要的查询，仍禁止整表扫描。
