---
id: 2026-10-28-agents-page-main-function-column
title: Agent 管理页新增「主要功能」列，名单每位 agent 一句话说清管什么
status: done
owner: agent
decided_on: 2026-10-28
source: session:bda94e59
verify_by: 2026-10-30
verify_how: 合并部署后打开 /dashboard/admin/agents，表头有「主要功能」，19 行都有文字（孙子、司马徽两行有"对照表没写档案文件"提示属预期）
done_on: 2026-10-28
done_ref: pr:3360
---
改了 docs/agents/README.md 名单表、agent-docs 解析与页面；对真实 README 本机跑通 19 行。线上显示待合并部署后验。
