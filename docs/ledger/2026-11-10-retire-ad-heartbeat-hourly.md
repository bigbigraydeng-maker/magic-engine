---
id: 2026-11-10-retire-ad-heartbeat-hourly
title: 下线每小时广告心跳 Inngest 定时任务
status: done
owner: pm
decided_on: 2026-11-10
source: doc:docs/ledger/2026-11-10-ad-intraday-spend-samples.md
done_on: 2026-11-10
done_ref: doc:docs/ledger/2026-11-10-retire-ad-heartbeat-hourly.md
---
Ray 批准下线 dry 态小时心跳；日内采样见台账 ad-intraday-spend-samples，停摆监控见 PR 3739。
保留 readHeartbeatAccount 供广告健康实时读与处方种子；告警表与 sweep 库代码暂留，不再调度。
