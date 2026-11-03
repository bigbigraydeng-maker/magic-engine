---
id: 2026-10-26-prescription-weekly-recheck-only
title: 10/27 周二 prescription-weekly 是改后第一次自动跑，要核实它只复查、没生成新计划步骤
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3177
verify_by: 2026-10-28
verify_how: 看 cron_run_logs 里 prescription-weekly 最近一条应为成功，摘要写「只复查」，且没有新增草稿广告计划；若写了生成，第一步回报 74，不手动改生产数据。已加日历提醒（10-28 上午 9 点）。
---
74 要求核对（处方动作→计划步骤自动生成是 A 级，暂不做，主干上应只复查不生成）。
