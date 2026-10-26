---
id: 2026-10-26-ad-draft-custom-audiences
title: 起草器支持挂自定义受众（包含）和排除受众：建前核归属与可用、建后回读必须看见（刀②）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3190
verify_by: 2026-11-02
verify_how: **【第一条，试跑前我们不知道答案】一条正常建出来的草稿，回读里 `targeting_relaxation_types` 和 `targeting_automation.advantage_audience` 这两个字段 Meta 到底会不会返回？** 3190 的开启前复核现在「读不到 = 拒开」（优势受众缺失一律拦；放宽字段缺失在草稿带包含名单时拦），若 Meta 正常情况下就不回显，所有带名单的草稿到开启那一步都会被 blocked、功能走不通——不跑就不知道这道闸会不会把所有草稿堵死。只读旁证（2026-10-26 查 CTS 两个账户现有广告组，不是 ME 经这条链路建的）：ME 之前建的无受众正式条回读含 `advantage_audience:0`（回显了）；老广告组里有包含名单的 5 条中 `targeting_relaxation_types` 仅 2 条回显（那 2 条是显式设置过的），`targeting_automation` 有的有、有的缺——说明 Meta 对「没显式传」的字段常不回显，但 ME 现在显式传 `{custom_audience:0, lookalike:0}` 与 `advantage_audience:0`，是否回显**只有试跑能回答**。 合并前用 CTS 旧账户跑一次 2 美元 2 天的试跑草稿（建完立刻删三层、不进审批页、账本标试跑；需 PM 本人在 119 窗口说「做试跑」）并贴原始回读，必须同时回答：① Meta 收不收 targeting_relaxation_types（收下并回显 / 静默丢掉 / 报 100）；② excluded_custom_audiences 在回读里是否就在 targeting 顶层；③ 建完立刻回读有无读写延迟致排除项还没出现；④ 挂自定义受众时 Meta 是否强开 advantage_audience；⑤「只给排除不给包含」的组单独跑一次。验收项还要含：排除名单的覆盖人数（读回的 approximate_count_lower_bound 与状态，不只看 id）。合并部署后复核：审批页点开前的受众小结一行、开之前复核受众仍挂着。47 人排除名单的上传不在本刀，需 PM 本人授权。
---
A 级（改 Meta 建广告请求与回读闸）。动机：处方要的组 B 老客户建不出来；已付款、即将出行的老客人仍可能看到在投的广告。受众归属读不到时失败关闭（不建）。
