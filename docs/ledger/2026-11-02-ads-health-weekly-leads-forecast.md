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
done_ref: pr:3542
---
当周 = 本周已有 + 今天按同星期几补全剩余 + 之后各天同星期几日均。低量日用与全天预测相同的门槛剔除。
周日没有可用样本时返回「数据不足」，不把已到条数当成整周精确值。今天拟合已到去掉最近暂定小时，区间不低于已入库总数。
