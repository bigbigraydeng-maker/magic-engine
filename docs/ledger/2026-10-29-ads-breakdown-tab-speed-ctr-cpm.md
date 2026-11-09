---
id: 2026-10-29-ads-breakdown-tab-speed-ctr-cpm
title: 多维数据标签提速并补上点击率（CTR）和千次展示费用（CPM）
status: decided
owner: agent
decided_on: 2026-10-29
source: session:f9cb5ed1
verify_how: 上线后打开 CTS 广告健康页「多维数据」90 天，接口返回时间比改前明显缩短；总览和各表能看到 CTR、CPM 两列，数值等于点击除以展示、花费除以展示乘 1000
---
PM 2026-10-29 看了上线的多维数据标签，反馈加载慢、看不到 CTR 和 CPM。
慢的原因：90 天约 2.9 万行数据，每次只读 1000 行、一页一页排队读，另外还多读了一遍版位数据。改成 6 页同时读，并去掉重复那一遍。
