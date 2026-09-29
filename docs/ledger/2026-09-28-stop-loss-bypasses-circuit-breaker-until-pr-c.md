---
id: 2026-09-28-stop-loss-bypasses-circuit-breaker-until-pr-c
title: 止损按钮已在本地分支接入 Kernel，待评审、部署与生产验证
status: decided
owner: agent
decided_on: 2026-09-28
source: session:d9b147f8
verify_by: 2026-10-15
verify_how: 先确认含本次接线的代码已合并部署；之后在 PM 指定且明确批准的测试账户上验证广告健康止损产生 `action_runs` 记录，并确认熔断账户会拒绝执行。没有指定对象和明确批准前，不触发真实 Meta 预算/状态写入。
---
止损路由接线已在本地提交 `caa0c323` 完成：暂停与降预算通过 Kernel action run 执行，并有定向测试及 Kernel 架构测试覆盖。当前分支尚未推送或部署，因此生产环境状态未改变、保护尚未实证。

本地验证：止损/能力/Meta 定向测试 64/64 通过；Kernel 架构测试 193/193 通过；对应 ESLint 通过。全量类型检查仍有 16 条错误，均位于本次变更以外的脚本、CRM、Messenger、Meta metrics 测试及 ops-review-loop 文件。本记录不把它们标为既有失败，因为没有取得修改前同环境证据。
