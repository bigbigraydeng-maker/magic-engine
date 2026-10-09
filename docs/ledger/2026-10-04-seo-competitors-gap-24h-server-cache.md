---
id: 2026-10-04-seo-competitors-gap-24h-server-cache
title: SEO 情报页竞品差距接口加 24 小时缓存，不再每次打开都扣 DataForSEO 的钱
status: done
owner: agent
decided_on: 2026-10-04
source: session:923e4990
verify_by: 2026-10-08
verify_how: 合并上线后，同一客户连开两次 SEO 情报页，第二次接口响应头 X-Cache 为 HIT；DataForSEO 后台当天同一客户只有一轮调用
done_on: 2026-10-04
done_ref: pr:2226
last_checked: 2026-10-09
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
改在 src/lib/seo-intelligence/competitors-gap-cache.ts，用已有的 local_data_cache 表，无数据库改动。
FDE 改竞品会立即让缓存失效；?refresh=1 有 10 分钟冷却。合并前还是草稿（A 级）。
