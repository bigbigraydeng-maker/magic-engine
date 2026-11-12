---
id: 2026-11-13-ads-review-more-card-types
title: 扩大广告执行回看覆盖：金额确认卡、系列暂停、成绩单减预算等
status: done
owner: agent
decided_on: Ray 2026-11-13 01:28 NZDT
source: session:9c129e32
verify_by: 2026-11-21
verify_how: 客户各有一条已执行的成绩单减预算、止损减预算、D3 自动暂停、系列暂停或日内上限卡后，归因任务在观察窗结束后写入 reviewCase 与 client_learned_preferences；内部广告门「改完后的成绩」能显示对应类型与天数；默认窗可在 leads_config.ads_execution_review 按类型覆盖。
done_on: 2026-11-13
done_ref: pr:pending
---

只读扩展：不改出卡、不改 Meta 写、不加表或路由。动作类型 ads.adjust_adset_daily_budget、ads.pause_ad_set、ads.money_card（lane budget / pause_adset）、ads.pause_campaign（kind pause，含日内上限系列暂停）。默认观察窗：处方调日预算与金额确认卡减预算 7 天；处方暂停广告组用卡上 observationDays 否则 3 天；金额卡暂停与系列暂停默认 7 天（卡上天数优先）。D3 待批准行 ads.auto_pause_on_d3 不在此列。
