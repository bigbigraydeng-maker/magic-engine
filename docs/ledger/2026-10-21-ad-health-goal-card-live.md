---
id: 2026-10-21-ad-health-goal-card-live
title: 广告健康页「目标与设置」卡改为实时读取当前生效目标（不再等每日缓存）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3038
verify_by: 2026-10-23
verify_how: 合并部署后打开 CTS 广告健康页，目标卡下方应出现「实时读取 · 时间」，且目标名/天数与目标管理页里当前生效的目标一致；若出现「实时没读到…缓存」提示，查 Render 日志里 [ads-strategy] goal context failed。
---
B 级。只改员工版：读接口在返回前用 buildDigestGoalContext 现算当前目标覆盖每日缓存行里的旧目标，读失败保留旧值并标明不是实时。客户版不变。不触发每日任务。
