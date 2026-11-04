---
id: 2026-10-28-admin-agents-rules-index
title: Agent 名单页会读规则总索引，缺了索引就退回原来的表
status: decided
owner: agent
decided_on: 2026-10-28
source: issue:3125
verify_by: 2026-11-04
verify_how: 用管理员打开 Agent 名单页，卫青那一行能展开规则名和条数，点经验手册能在站内打开；把总索引表头改坏后页面仍是原来的表并有黄条，不报错
---
页面多读 docs/registry/platform-rules-index.md，用现成的表格解析器。
三列是读哪些规则、进不进提示词、最后核实。最后核实用索引里手写的日期。
经验手册和总索引目录可以在站内打开。待采纳经验只显示条数并链到广告引擎页，本页不加按钮。
