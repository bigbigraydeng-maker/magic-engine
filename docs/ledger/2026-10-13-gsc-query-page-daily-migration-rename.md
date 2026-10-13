---
id: 2026-10-13-gsc-query-page-daily-migration-rename
title: 词×页存档的迁移文件改个唯一的版本号（与另一个窗口的迁移撞号，线上账本没受影响）
status: decided
owner: agent
decided_on: 2026-10-13
source: session:ceb3769c
verify_by: 2026-10-20
verify_how: "合并后在主干上跑内核检查里的「migration 版本不许撞车」，不再点名词×页存档那个文件；并确认线上迁移账本里 gsc_query_page_daily 仍只有一条（版本由应用时刻生成，与文件名无关）。"
---
两个迁移文件同用了一个版本号。线上迁移已按名字应用过，账本里版本是应用时刻生成的，不受文件名影响，所以只改文件名，不动线上库，不改 SQL 内容。
