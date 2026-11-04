---
id: 2026-11-03-ads-d7-outcome-reminder-spending-only
title: 「广告结果怎么算没设置」只提醒近 14 天真花过钱的客户，不在投的客户不进今日待办
status: done
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-10
verify_how: UTC 周日晚那一轮今日待办里，近 14 天零花费的客户不出「结果怎么算没设置」；oztop 的「显示在投但 08-18 起没数据」照出且带 Ads Manager 链接
done_on: 2026-11-03
done_ref: pr:3533
---
生产库 11-03 只读核实：挂着「结果怎么算没设置」的 4 个客户（Magic Picks、NM Medspa、East International、oztop）近 14 天花费全是 0，真正在投的 CTS、NAL 早就设置好了。
#3530 把 D7 接进今日待办后，这 4 条会变成白提醒，所以加一道：近 14 天没花钱就不出这一条；读花费失败时照常提醒，宁可多一条也不吞掉真问题。
同客户的其它 D7（授权 / 数据断了）不受影响。用真实形状试跑：周日那一轮从 4 条变成 1 条，剩下的是 oztop 数据断更。
兄弟卡 2026-11-03-ads-d7-into-pm-todo 的核对口径「至少 3 个客户」因此不再成立，11-10 按本卡口径核：应出 1 条（oztop）。
