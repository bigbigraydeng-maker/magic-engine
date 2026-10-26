---
id: 2026-10-26-ad-draft-custom-audiences
title: 起草器支持挂自定义受众（包含）和排除受众：建前核归属与可用、建后回读必须看见（刀②）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3190
verify_by: 2026-11-02
verify_how: 合并前用 CTS 旧账户跑一次 2 美元 2 天的试跑草稿（建完立刻删三层、不进审批页、账本标试跑；需 PM 本人在 119 窗口说「做试跑」）并贴原始回读，必须同时回答：① Meta 收不收 targeting_relaxation_types（收下并回显 / 静默丢掉 / 报 100）；② excluded_custom_audiences 在回读里是否就在 targeting 顶层；③ 建完立刻回读有无读写延迟致排除项还没出现；④ 挂自定义受众时 Meta 是否强开 advantage_audience；⑤「只给排除不给包含」的组单独跑一次。验收项还要含：排除名单的覆盖人数（读回的 approximate_count_lower_bound 与状态，不只看 id）。合并部署后复核：审批页点开前的受众小结一行、开之前复核受众仍挂着。47 人排除名单的上传不在本刀，需 PM 本人授权。
---
A 级（改 Meta 建广告请求与回读闸）。动机：处方要的组 B 老客户建不出来；已付款、即将出行的老客人仍可能看到在投的广告。受众归属读不到时失败关闭（不建）。
