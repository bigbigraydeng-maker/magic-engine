---
id: 2026-10-15-promo-plan-pra-followups
title: 推广计划批准加固第一批没做完的四件事（审查人点出的）
status: decided
owner: agent
decided_on: 2026-10-15
source: session:8aade036
verify_by: 2026-10-22
verify_how: 逐条对照：广告草稿入口接阶段检查；客户员工不能触发计划生成；页面一打开就不显示批准按钮；本机新建数据库的广告计划表权限与线上一致
---
1) 将来任何「建广告草稿」的入口都必须先过 evaluatePhaseGates（目前只在往执行看板派广告任务那一步接了）。
2) generate / generate-focus（花 AI 钱、新增草稿）仍允许客户员工调用，要不要收紧待定。
3) 页面按钮要靠服务端给的 viewer_can_approve 一打开就隐藏，现在是点一下被拒后才隐藏。
4) marketing_plans 建表的那份迁移文件 的权限写法漏了 TO service_role（线上已修，照这份新建的库是裸的），需另开 A 级 PR 改迁移。
