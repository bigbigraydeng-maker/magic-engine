---
id: 2026-10-06-seo-gsc-query-overlap-entry
title: 只读"页面抢词"入口：拉谷歌后台近 28 天"搜索词×页面"，找出同一个词被多个页面分走曝光的组
status: decided
owner: agent
decided_on: 2026-10-06
source: session:cdd5dbf9
verify_by: 2026-10-07
verify_how: 合并部署后用手动试跑入口跑 `job=gsc-query-overlap`（CTS client_id，dry_run 缺省）：摘要 status=ok、rows_fetched>0、rows_truncated=false，pairs 里列出页面对及共享搜索词数；再据此判断哪些页面组真该合并
---
PM 要判断除李子坝外还有没有"多页抢同一个词"的页面组。数据库只存了页面级数据，没有"页面×搜索词"，所以加一个只读入口直接读谷歌后台（沿用已有授权，不写任何表、不花钱）。
判定口径：同一搜索词下至少 2 个页面各有 ≥3 次曝光、合计 ≥20 次曝光才算重叠；页面对按各词的前两名统计。单次最多读 25000 行，超过会在摘要里标 rows_truncated。
这只证明"在抢词"，不证明合并后一定涨；合并方案仍要单独出、单独批。改 `.github/` 属 A 级，需 PM「合」。
