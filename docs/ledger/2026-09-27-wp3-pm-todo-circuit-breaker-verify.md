# WP3 pm-todo 熔断器待办验证

- status: decided
- verify_by: 2026-10-04
- refs:
  - PR: #2019
  - ledger: 2026-09-25-wp3-kernel-ads-wiring.md

## 背景

`pushAdsAutonomyCircuitBreakerItems` 已挂入 `loadManualItems` 管道（每日定时待办邮件）。
当前没有运行时写入者往 `client_automation_policies` 写 `circuit-breaker:*` deny 行，
所以 pusher 不会产出待办卡。

## 验证条件

1. 后续 PR 接入熔断器运行时调用方后，在测试环境手动写一条 deny 行
2. 触发 `loadManualItems`（调 daily email cron 或本地 vitest）
3. 确认生成了正确的 pm-todo 三件套（what/how/href）
4. 确认 href 链接到可用的管理员解除入口

## 当场跑不了的原因

熔断器运行时调用方（cron 读花费 → evaluate → 写 deny policy）尚未实现，
是本 PR 明确标为「待后续 PR」的范围。没有 deny 行 → pusher 正确返回空数组 →
不产出待办。纯函数部分（`evaluateCircuitBreaker`）有 7 条单元测试全绿。
