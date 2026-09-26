---
id: 2026-09-26-seo-patrol-card-dedupe
title: SEO 巡查卡收敛（第 3 条 3a）：已有卡的目标不再天天重开，每个客户滚动 7 天最多 3 张新巡查卡
status: done
owner: agent
decided_on: 2026-09-26
source: pr:2062
done_on: 2026-09-26
done_ref: pr:2062
verify_by: 2026-10-10
verify_how: 上线满 14 天后查生产库 execution_items（dimension='seo'、source='zhuge'、steps_json 带 rule_id 的巡查卡）三件事：①任一客户任一连续 7 天里新开的巡查卡 ≤ 3 张；②同一个规范化网址 + 动作类型 + 关键词，在已有待处理 / 处理中卡片时没有被重开；③不同网址的「没收录」卡不再互相替换（没有「同一天新开 A、同时把 B 标成 superseded」这种对）。另查 cron_run_logs 里 seo-patrol-daily 的 summary 带 cards_withheld_weekly_cap / cards_withheld_lookup_failed / findings_held_existing_card，且 lookup_failed 不是天天发生。三项全对算成
---
PM 2026-09-26 回「全开工」（第 3 条「动作卡少而能执行」）。子牙审两轮、魏征审一轮后定为 v4 规格：3a 先做（B 级，不依赖在飞的 PR），3b 改网站通道排在 #1948 之后。
上线前基线（生产只读 2026-09-26）：近 60 天 SEO 卡 391 张、完成 0；Oztop 122 张卡只有 20 个不同目标；CTS 的 china-tours-from-australia 一页 9/12–9/26 天天重开，15 天 16 张；Christchurch 那页的发现因为老去重键撞车，从来没开出过卡。
当场试跑（CTS 真实数据）：过去 7 天已开 7 张 → 当天不开新卡；已有开着卡的那页被压住；每周额度清出后 Christchurch 那页会开卡。
「每周 3 张」是 PM 原话「每周只出几条」的默认值，改一个常量即可调整。
