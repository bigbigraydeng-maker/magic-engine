---
id: 2026-10-13-gsc-query-page-daily-archive
title: 谷歌搜索「哪个词落在哪一页」每天存档，并补齐过去约 16 个月（品牌词/非品牌词可拆）
status: done
owner: agent
decided_on: 2026-10-13
done_on: 2026-10-14
done_ref: pr:2575
source: session:ceb3769c
verify_by: 2026-10-27
verify_how: "前提（任何一项没发生就不算失败，改 verify_by 顺延）：PR 2526 已合并、PM 已点头 apply 迁移、Inngest 已重新 Sync 并手动 Invoke 过一次派单、约 4 天回补跑完。然后五件事缺一不可：①所有连了谷歌的客户（不只 CTS）在 gsc_query_page_fetch_receipts 都有 daily 与 backfill 回执，status 是 complete 或 truncated（truncated=撞谷歌每天 5 万行上限，合法终态但要在卡里写明是哪天哪个客户），没有停在 running；且 cron_run_logs 里 gsc-query-page-daily-pull 各单的 summary.days_pulled>0（回执表没有这一列）；②对 CTS 取一个 5 天以前的定稿日，gsc_query_page_daily 当日 clicks 合计 ≤ gsc_page_daily 同日合计，且 ≥ 页级合计的 60%（取 60% 是下限：谷歌只隐藏匿名词，CTS 实测需先看探针数字再把 60% 改成探针观测值的 0.9 倍；只验上限一行数据也能过）；③cron_run_logs 里 gsc-query-page-daily 与 gsc-query-page-daily-pull 都 completed，且 gsc-page-daily* 仍 completed、gsc_page_daily 行数没有比合并前下降（证明没伤到在线页级链）；④用手动入口 gsc-brand-split（`gh workflow run manual-cron-trial.yml --ref main -f job=gsc-brand-split -f dry_run=true -f client_id=<CTS>`）对 CTS 读一次：返回 status=ok 且 coverage 两表天数一致、warnings 为空；对没配品牌词的客户返回 brand_terms_not_configured；⑤探针在 apply 迁移之前跑过，实测逐日行数记在 docs/ledger/evidence。任何一项不成，状态改 failed 并写哪一项。"
---
73 号窗口策略稿 §11 A4 / §12 第 5 件事要求先有「词×页」历史。设计 v2（子牙+魏征设计审、实施后再各审一轮）：docs/specs/2026-10-13-gsc-query-page-daily-design.md。复用页级每日存档链（参数化，缺省=现状），定时走 Inngest 不走 Render（无 render.yaml 条目）。
品牌词配置在 clients.seo_config.brand_terms（没有时回退已有的 clients.brand_aliases），不写进共享代码；CTS 取值合并后经 PM 点头再写。Settings 输入框本次不做（需 PM 豁免 §8），后续事项。
真实试跑：合并前做不了（生产谷歌凭据只在 Render，工作流只在 main 上跑）；方案是 PR 内带只读探针与只读取数入口，合并后先量体量再 apply 迁移，Inngest 后台手动 Invoke 当天回读行数。
