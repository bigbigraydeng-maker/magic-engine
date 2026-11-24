# 证据 · 2026-09-27-ads-d11-audience-pool-starved · 2026-11-25
fetched_at: 2026-11-25T03:22:03+13:00
查了什么：SQL on ad_entity_snapshots audience counts (weekly) and ad_health_narratives for 受众池断供
数字（带样本量、两边取数状态）：ThruPlay pool 22.3k (wk 9-14) to 25.5k (9-28) to 28.1k (10-05); 50% pool 37.9k to 41.9k to 44.4k. No 受众池断供 hit between 9-27 and 10-19; hits only 9-26, 10-20, 10-21 (after supply ad stopped 10-10 and pools went flat). PR 2084 merged.
来源/命令：见「查了什么」，均为只读查询
结论：成，补人广告开着的那 7 天受众池确实在涨、没再命中断供提醒。
