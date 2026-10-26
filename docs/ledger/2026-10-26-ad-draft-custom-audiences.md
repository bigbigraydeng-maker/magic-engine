---
id: 2026-10-26-ad-draft-custom-audiences
title: 起草器支持挂自定义受众（包含）和排除受众：建前核归属与可用、建后回读必须看见（刀②）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3190
verify_by: 2026-10-30
verify_how: 合并部署后，用 CTS 旧账户跑一次 2 美元 2 天的试跑草稿，挂一个现成的受众（再带一个排除受众）：读回广告组 targeting 应含 custom_audiences 与 excluded_custom_audiences，targeting_relaxation_types 不放宽、优势受众关；重点实测「开启自定义受众时 advantage_audience 的行为」。读回对不上时应被回读闸拦成 blocked。建完立刻删除三层，不留在审批页。47 人排除名单的上传不在本刀，需 PM 本人授权。
---
A 级（改 Meta 建广告请求与回读闸）。动机：处方要的组 B 老客户建不出来；已付款、即将出行的老客人仍可能看到在投的广告。受众归属读不到时失败关闭（不建）。
