---
id: 2026-09-28-stop-loss-bypasses-circuit-breaker-until-pr-c
title: 止损按钮现在完全绕过熔断器和执行内核，PR C 合并前这个洞一直开着
status: decided
owner: agent
decided_on: 2026-09-28
source: session:d9b147f8
verify_by: 2026-10-15
verify_how: PR C 合并之后，找一个正在投放的广告去点广告健康看板上的"先按住钱"按钮（暂停或降预算），然后去查那条改动是不是真的走了新的执行记录（`action_runs` 表里有没有对应的一行，而不是只在 `flywheel_actions` 里有一行旧式审计）。如果那条记录不存在，说明路由还在走老路径，这个洞没关。同时确认：故意在一个正被熔断冻住的客户账户上按这个按钮，系统应该拒绝，不能真的把钱动了。
---
止损路由接线已在本地提交 `caa0c323` 完成：暂停与降预算通过 Kernel action run 执行，并有定向测试及 Kernel 架构测试覆盖。当前分支尚未推送或部署，因此生产环境状态未改变、保护尚未实证。

本地验证：止损/能力/Meta 定向测试 64/64 通过；Kernel 架构测试 193/193 通过；对应 ESLint 通过。全量类型检查仍有 16 条错误，均位于本次变更以外的脚本、CRM、Messenger、Meta metrics 测试及 ops-review-loop 文件。本记录不把它们标为既有失败，因为没有取得修改前同环境证据。
