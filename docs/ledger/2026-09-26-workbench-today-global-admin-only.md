---
id: 2026-09-26-workbench-today-global-admin-only
title: 今日待办接口只给内部管理员看，试用/演示账号拿不到全部客户的待办
status: decided
owner: agent
decided_on: 2026-09-26
source: session:ce4b4c71
verify_by: 2026-09-30
verify_how: 合并上线后，用 DEMO_ADMINS 里的演示账号登录，直接打开 /api/workbench/today 应返回 403；用内部管理员账号打开 /dashboard/today，数字照常出来。两边各试一次即可判。
---
魏征审 PR #2025 时发现：/api/workbench/today 用的是 guardAdmin，演示账号（DEMO_ADMINS）也能过，
而接口返回的是全部客户的「需要你动手」清单。页面由 middleware 挡住了，接口没挡。
本卡改为 guardGlobalAdmin，并补了接口 403/200 测试和页面跳转测试。
