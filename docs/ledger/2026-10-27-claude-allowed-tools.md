---
id: 2026-10-27-claude-allowed-tools
title: Claude 在工单里可以建分支、开草稿合并请求、跑测试
status: decided
owner: agent
decided_on: 2026-10-27
source: doc:.github/workflows/claude.yml
verify_by: 2026-11-03
verify_how: 这张改动合进主干后，在一条测试工单里叫 Claude，确认它能切换分支、跑测试、并且只开草稿合并请求；确认它仍不能合并、强推，也不能把审查意见勾掉。
---
Ray 定：只多放行建分支、开草稿合并请求、跑测试这三件事。
开合并请求的命令必须以草稿标记开头，工具权限直接挡住不带草稿的开法。
不放行合并、强推，也不放行把审查意见勾掉。
工作流任务上的令牌权限没有改；开合并请求走 Claude 应用自己的令牌。
合进主干之前，线上行为不变。
