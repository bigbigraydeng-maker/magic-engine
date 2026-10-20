---
id: 2026-10-20-form-travel-window-budget
title: 官网表单新增的「预计出发时间」「每人预算」存成结构化代码，并在客人抽屉顶部显示一行人话（只是事实，不参与冷热和阶段判断）
status: decided
owner: pm
decided_on: 2026-10-20
source: session:96dc6edf
verify_by: 2026-10-23
verify_how: 官网新表单上线后，由统筹用非 CTS 邮箱在团页提交一条带出发时间和预算的内部测试；下一轮每小时同步读回：网站表单触点的附加信息里有 travel_window 和 budget_band 代码；客人抽屉顶部「上次说到这」上方出现一行「预计 2027 年 x 月出发 · 预算 x/人」；没填这两项的老客人不显示这一行；映射不到的值回执 unknownExtras 计数而不是乱存
---
筛选先不做。映射不到的值存空并计数，不存原文。
