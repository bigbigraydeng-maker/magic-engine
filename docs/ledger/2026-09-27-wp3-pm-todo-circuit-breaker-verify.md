---
id: 2026-09-27-wp3-pm-todo-circuit-breaker-verify
title: pm-todo 熔断器待办卡生成验证 — 等运行时调用方接入后触发
status: decided
owner: agent
decided_on: 2026-09-27
source: session:dcc2476b
verify_by: 2026-10-04
verify_how: 接入熔断器运行时后手动写一条 deny 行，触发 loadManualItems，确认生成正确的 pm-todo 三件套（what/how/href）且 href 链接到管理员解除入口
---
熔断器运行时调用方（cron 读花费 → evaluate → 写 deny policy）尚未实现，
是 PR #2019 标为「待后续 PR」的范围。纯函数部分 evaluateCircuitBreaker 有 9 条
单元测试全绿（含 undeterminable 三态）。
