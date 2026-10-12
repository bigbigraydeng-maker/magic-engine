---
id: 2026-10-13-gsc-query-page-daily-archive
title: 谷歌搜索「哪个词落在哪一页」每天存档，并补齐过去约 16 个月（品牌词/非品牌词可拆）
status: decided
owner: agent
decided_on: 2026-10-13
source: session:ceb3769c
verify_by: 2026-10-27
verify_how: 合并+迁移 apply+Inngest Sync 并手动 Invoke 一次派单后，约 4 天回补完再验，五件事缺一不可：①所有连了谷歌的客户（不只 CTS）在 gsc_query_page_fetch_receipts 都有 daily 与 backfill 回执，status=complete，没有停在 running，且 days_pulled>0；②CTS 某个 5 天以前的定稿日，词级 clicks 合计 ≥ gsc_performance_snapshots 前 50 词 28 天点击对应口径的下限、≤ gsc_page_daily 同日页级合计（只验上限会被一行数据放水通过）；③cron_run_logs 里 gsc-query-page-daily 与 gsc-query-page-daily-pull 都 completed，且 gsc-page-daily* 仍 completed、gsc_page_daily 行数没有下降（证明没伤到在线页级链）；④用 getBrandSplit 对 CTS 真调用一次，返回四个桶且 unattributed 非负、brand_terms_not_configured 只出现在没配置的客户；⑤探针先于迁移跑过，实测逐日行数记在 evidence。任何一项不成，状态改 failed 并写哪一项。
---
73 号窗口策略稿 §11 A4 / §12 第 5 件事要求先有「词×页」历史。设计 v2（子牙+魏征审后）：docs/specs/2026-10-13-gsc-query-page-daily-design.md。复用页级每日存档链（参数化，缺省=现状），定时走 Inngest 不走 Render（无 render.yaml 条目）。
品牌词配置在 clients.seo_config.brand_terms，不写进共享代码；CTS 取值合并后经 PM 点头再写。Settings 输入框本次不做（需 PM 豁免 §8），后续事项。
真实试跑：合并前做不了（生产谷歌凭据只在 Render，工作流只在 main 上跑）；方案是 PR 内带只读探针，合并后先量体量再 apply 迁移，Inngest 后台手动 Invoke 当天回读行数。
