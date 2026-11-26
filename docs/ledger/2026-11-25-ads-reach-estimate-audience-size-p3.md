---
id: 2026-11-25-ads-reach-estimate-audience-size-p3
title: 想判断「新西兰 45-65 这批人够不够大」时，再接 Meta 的「受众有多大」只读接口（P3，先不做）
status: decided
owner: pm
decided_on: 2026-11-25
source: session:ca3e0d15
verify_by: 2026-12-09
verify_how: 12-09 看组 A 累计触达频次是否还在 3 以上且线索成本变贵；是就按 §11 重新打分，决定要不要接「受众有多大」接口；不是就把本卡改写原因收掉
---
PM 11-25 看了一条讲 Meta「覆盖人数规划工具」的视频，问对我们机制有无影响。结论：视频里的便宜国家展示招数对 CTS 无用；该工具本身没找到公开接口。
Meta 有三个近亲只读接口：reachestimate（受众人数范围，可接）、delivery_estimate（文档没写预算输入，做不出「预算到展示和成本」预测）、reachfrequencypredictions（预订式买量，不适用竞价广告）。
按 §11：频率 低 / IMPACT 中 / 收入 低 → P3，不排开发。仓库内目前没有任何读受众大小预测的代码（11-25 已搜）。
属已有 Meta 广告连接里加一个只读读数，不新增能力线。另需留意 Meta 逐步淘汰旧触达/展示指标，盯盘用到触达和频次，线上暂仍正常返回。
