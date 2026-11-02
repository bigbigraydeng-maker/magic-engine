---
id: 2026-11-02-ads-health-leads-forecast-cutoff
title: 广告健康进线全天预测：历史累计占比与 20% 门槛同截最近 2 小时
status: done
owner: agent
decided_on: 2026-11-02
source: pr:3504
verify_by: 2026-11-09
verify_how: 合并后 npm test -- hourly-leads-forecast 全绿；「20% 门槛与已到同样截最近 2 小时」用例为 insufficient；其余 ok 用例 rangeMin≤rangeMax 且不含单点预测字段。
done_on: 2026-11-02
done_ref: pr:3504
---
Claude 复审：「已到」不含近 2 小时但历史占比用 currentHour，区间系统性偏低；已与 todayArrived 对齐 lastReliableHour。
