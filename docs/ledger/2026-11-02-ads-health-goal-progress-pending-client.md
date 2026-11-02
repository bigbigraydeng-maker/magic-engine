---
id: 2026-11-02-ads-health-goal-progress-pending-client
title: 广告健康「今天看这里」目标条：客户版用 progressPending 判「还没设目标」，缓存行保留指标 key 供员工 fallback
status: done
owner: agent
decided_on: 2026-11-02
source: pr:3502
done_on: 2026-11-02
done_ref: pr:3502
verify_by: 2026-11-05
verify_how: 合并后客户账号打开广告健康「今天看这里」：定金类目标显示「还没设目标」且不出现进度条；员工版 live 读失败时仍对缓存里的 signups 类目标显示「还没设目标」。Vitest growth-client-view + today-goal-progress 绿。
---
Claude 复审：客户白名单曾剥掉 primaryMetricKey，导致定金/成交误画进度条；已改为下发 progressPending。员工 live 失败时沿用缓存 goal.primaryMetricKey。
