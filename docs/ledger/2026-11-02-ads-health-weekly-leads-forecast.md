---
id: 2026-11-02-ads-health-weekly-leads-forecast
title: 广告健康进线卡增加当周预测（叠在 hourly-leads PR 之上）
status: done
owner: agent
decided_on: 2026-11-02
source: pr:3503
verify_by: 2026-11-09
verify_how: 合并 pr:3503 后再合本 PR；npm test -- weekly-leads-forecast hourly-leads-forecast 全绿；页面上「当周」与「全天」并排展示。
done_on: 2026-11-02
done_ref: pr:3504
---
当周 = 本周已有进线 + 余下各天按近 28 天同星期几日均（暂停日/低量日用与全天预测相同的 FORECAST_MIN_DAY_TOTAL 门槛剔除）；须先合并 pr:3503（全天预测基线）。
