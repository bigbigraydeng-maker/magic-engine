---
id: 2026-09-30-ads-stop-loss-kernel-wiring
title: 广告健康人工止损接入 Kernel，等待审查与上线验证
status: decided
owner: agent
decided_on: 2026-09-30
source: pr:2205
verify_by: 2026-10-15
verify_how: PR 合并部署后，在 PM 指定并明确批准的测试账户验证止损生成 action_runs 记录，且熔断账户拒绝执行；未指定对象与动作前不触发 Meta 写入。
---
暂停与下调预算经 Kernel action run 执行。每次确认的止损带独立请求编号：同一请求重试仍去重，重新确认会生成新动作，避免广告被手动恢复后误报“已停”。当前仅本地及 PR 自动检查验证，生产行为尚未验证。
