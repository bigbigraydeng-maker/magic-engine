---
id: 2026-10-18-foundation-6-event-agent-liveness
title: 地基块 6——靠事件叫醒的 Agent「该跑没跑」现在没人知道：体检第一问只对定时任务有效；要写代码，等 PM 排
status: decided
owner: pm
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-11-03
verify_how: PM 是否在问题 1 排了期。排了之后验收：挑一个事件型 Agent（如 D3 自动暂停、日计划自动发帖），人为让它一个周期不跑，体检必须报红并进今日待办
---
子牙复审地基清单时指出漏了这一块：src/lib/cron/registry.ts 只管排了班的任务，事件型被明确豁免；而多数新 Agent 走事件叫醒。
最小做法见 v1.0 正文 §6、§8 第 3 条：让事件型 Agent 也经 cronRunIdFromInngestRun 写 cron_run_logs，再登记期望周期。
按 §11：频率 中 · 影响 高 · 收入 中 → 零个低、一个高 → P2。
