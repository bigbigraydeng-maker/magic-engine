---
id: 2026-11-02-preflight-empty-stats-read-not-dead
title: 追踪检查读到空的事件统计时，别报「像素死了/没收到留资」，改标没读到
status: decided
owner: agent
decided_on: 2026-11-02
source: session:90a50c3b
verify_by: 2026-11-06
verify_how: 本改动合并上线后，看之后几次每日追踪检查：像素在线、收到留资事件两道门不再出现「24小时和7天同时为0」的红灯（10-28、11-01 各出现过一次假红）；样本要连续 3 次运行。
---
10-28 与 11-01 两次，检查读到的事件统计整个是空的（24小时和7天同时为0），而 Meta 数据集显示刚触发过，检查却报红，卡住推广计划的批准。
重跑后即变绿，证明是读到空响应。修法：这种自相矛盾的读数标灰（没读到），真死的像素（很久没触发）仍然红。
指针：src/lib/ads-tracking-preflight/judge.ts（statsReadLooksEmpty）
