---
id: 2026-10-14-todo-skip-person-removed-stories
title: 今日待办不再把人为撤下的 Story 当成「没发出去」
status: decided
owner: agent
decided_on: 2026-10-14
source: pr:2563
verify_by: 2026-10-15
verify_how: 今日待办里不再出现被 PM 撤下的 5 条 Story（原因代码以 PM_REMOVED 开头）的「没发出去」提醒；真被拦 / 失败 / 错过的 Story 仍然提醒
---
PM 10-14 撤下 5 条 Story 后它们是被拦状态，待办会误报成「没发出去」；只加一条跳过规则（原因代码前缀 PM_REMOVED），不碰发布与开关，带测试。
