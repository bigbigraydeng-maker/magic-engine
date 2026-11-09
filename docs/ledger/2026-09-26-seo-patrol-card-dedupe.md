---
id: 2026-09-26-seo-patrol-card-dedupe
title: SEO 巡查卡收敛（第 3 条 3a）：已有卡的目标不再天天重开，每个客户滚动 7 天最多给 3 个不同目标开新巡查卡
status: verified
owner: agent
decided_on: 2026-09-26
source: pr:2062
done_on: 2026-09-26
done_ref: pr:2062
verify_by: 2026-10-11
verify_how: 上线满 14 天后查生产库 execution_items 里的巡查卡（dimension='seo'、source='zhuge'、steps_json 带 rule_id），只看 2026-09-27 起新开的：①任一客户、任一起点在 9/27 当天或之后的连续 7 天里，新开巡查卡对应的不同目标（动作类型 + 网址 + 关键词）≤ 3 个；②没有一个目标在这 14 天里被开了不止一张卡；③被标成 superseded 的巡查卡，都是建了 14 天以上、由每日清理标掉的，没有「建了不到 14 天就被顶掉」的。另看 cron_run_logs 里 seo-patrol-daily 这 14 天 failed_count 基本为 0（读卡失败会让那个客户记成失败）。上线前同口径（9/12 起）是：Oztop 一周 6 个目标 21 张卡，CTS 一周 1 个目标 7 张卡，被重复开卡的目标 10 个，不到 14 天就被顶掉的卡 66 张。三项全对算成
last_checked: 2026-10-13
check_note: 两周实测：每客户7天最多3个目标、无重复开卡、无14天内被顶掉；注意 seo-patrol-daily 有2条一直停在running(10/06,10/10)
verified_ref: doc:docs/ledger/evidence/2026-09-26-seo-patrol-card-dedupe--2026-10-13.md
---
PM 2026-09-26 回「全开工」（第 3 条「动作卡少而能执行」）。v4 规格经子牙、魏征设计审；实施后两人复审「改后可合」，按复审又改了一轮：读已有卡拆成三条能测的查询、每周按不同目标计数、窗口 7 天减 1 小时、完成的「写新文章」卡压 90 天。
上线前基线（生产只读 2026-09-26）：近 60 天 SEO 卡 391 张、完成 0；Oztop 122 张卡只有 20 个不同目标；CTS 的 china-tours-from-australia 一页 9/12–9/26 天天重开，15 天 16 张；Christchurch 那页因为老去重键撞车，从来没开出过卡。
当场试跑（生产只读快照、只算不写，9/26 22:29 NZ）：CTS 过去 7 天的 7 张巡查卡全是同一目标 → 会给 Christchurch 那页开第一张卡，china-tours-from-australia 被压住；Oztop 本周已给 6 个不同目标开过卡 → 不开新卡，最早 10/3 空出名额。
没人处理的卡 14 天后会被每日清理标成 superseded，之后巡查可以再开，大约 15–16 天一轮，这不算重开。第一周的窗口会带上上线前开的卡，所以①只看起点在 9/27 之后的窗口。
「每周 3 个目标」是 PM 原话「每周只出几条」的默认值，改一个常量即可调整。
