---
id: 2026-11-21-ads-tune-confirm-cards
title: 巡查点名的广告组只出调方确认卡，不直接改广告
status: decided
owner: agent
decided_on: 2026-11-21
source: pr:3829
verify_by: 2026-11-28
verify_how: 开关默认关。用夹具跑一轮：有已审核且没投过的图就出暂停的加图确认卡且确认前不写广告；没有图就出内容待办。确认时诊断已不成立就拒绝，且不再写广告。
---

客户开关在 leads_config.ads_tune_cards，默认关，这次没有打开任何客户。
加图复用现有确认卡；没有可加的图就记一条内容待办。收窄受众和降预算这次不出卡。
每天每个广告组最多一张。当天新西兰时间 23:59 作废。确认时重读 ads-daily-trend-check 的最新诊断，对不上就不改。
每日巡查的自动挂接留到诊断导出写进该回执之后。
