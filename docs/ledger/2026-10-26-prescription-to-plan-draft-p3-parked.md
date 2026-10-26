---
id: 2026-10-26-prescription-to-plan-draft-p3-parked
title: 处方→推广计划草稿自动生成：PM 决定暂停，记 P3 待认领（设计稿 v0.2 已存，将来接手从稿末 §11 续）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3183
verify_by: 2026-11-30
verify_how: 到期前问 PM 是否恢复。若恢复：从 docs/specs/2026-10-26-prescription-to-promo-plan-draft-design-v0.1.md（稿头标 v0.2）续，先读 §11 的审查意见对照；块 0（plan_seed 与人工处方路由、审阅页渲染）单独走 A 级 PR。按 §11 判级：频率低 / IMPACT 闭环关键度低（已有人工路径可走通）/ 收入关联度低 → P3。当前 MVP 走现有页面：处方在处方页批准、计划在计划页核实批准、广告草稿走 meta-ads/draft 进审批页。
---
两位审查员的意见（魏征 BLOCK 6 必改 + 5 建议；子牙 PASS-WITH-FIXES 4 必改 + 8 建议）已逐条写进设计稿 §11，不另存。要点：自动开方现无调用方；种子唯一写入口是人工处方路由；阶段不得重叠；生成器分 preview/write；工作量估 5–7 天。
