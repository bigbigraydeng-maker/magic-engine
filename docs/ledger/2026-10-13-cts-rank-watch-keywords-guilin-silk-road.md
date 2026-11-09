---
id: 2026-10-13-cts-rank-watch-keywords-guilin-silk-road
title: CTS 周快照新增「指定追踪词」功能，先放 guilin 和 silk road 两个词
status: decided
owner: agent
decided_on: 2026-10-13
source: session:2cd3c621
verify_by: 2026-10-20
verify_how: 10-20 查 CTS 在 10-19 周快照里 guilin、silk road 两词是否各有一行记录（有名次，或名次为空表示前 100 外）；两行都在算成；缺行先看 cron 回执的 watch_error 字段，再确认 PR 已合并、配置已写入。
---
代码在本 PR：周快照后对 seo_config.rank_watch_keywords 里的词各查一次实时谷歌名次（深度 100），查不到记前 100 外，查失败不写行。
配置写入（生产库，加两个词）要等统筹 / PM 点头后再做，回执和回滚见 docs/clients/cts/2026-10-13-cts-rank-watch-keywords-config.md。
