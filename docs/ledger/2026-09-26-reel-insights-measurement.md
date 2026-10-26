---
id: 2026-09-26-reel-insights-measurement
title: 工作包 A · Facebook Reel 发布后自动读播放/完播/触达进 flywheel_metrics
status: decided
owner: agent
decided_on: 2026-09-26
source: session:bf0cd6eb
verify_by: 2026-11-15
verify_how: 生产 flywheel_metrics 表出现 reel_plays / reel_thruplays / reel_reach / reel_unique_viewers 四个指标类型；至少一条 factory_reel_publish 动作在 72h 窗口能查到这四个数字；权限申请前一周开工，权限批下来后一天上线；PR 合入主干；台账夜巡在 11-16 后盖章
---
工作包 A：接 Meta Reel Insights API 读播放/完播/触达/独立观看人数写进现有 flywheel_metrics 表；`factoryReelMeasurementAdapter`（`src/lib/inngest/functions/factory-reel-measurement-adapter.ts`）加 Insights adapter，不新建 IMPACT 骨架，直接复用广告支柱 flywheel_actions/flywheel_metrics/flywheel_outcomes 那套。前置：read_insights 权限——CTS + Oztop + NAL 三家一起走 Meta App Review 2-4 周（工作包外的 PM/FDE 提交材料）。风险 B（读 API + 写指标表，不改客户账号也不外发）；§11 频率高 + IMPACT 高（Measure 段缺一半）+ 收入中 → P0。分支 feat/reel-insights-measurement。PM 2026-09-26 通过小秘书授权全做，权限申请动作发起当天必建日历跟踪审批结果。
