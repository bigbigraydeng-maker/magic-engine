---
id: 2026-11-10-social-post-readback-gap-r2
title: 社媒 R-2：发后读数缺口进今日待办（过点没回执 / 读不到 / 重试用尽 / Story 不支持）
status: done
owner: agent
decided_on: 2026-11-10
source: doc:uploads/readback-gap-2026-11-03.md
verify_by: 2026-11-12
verify_how: 本地跑 pushSocialPostReadbackGapItems 单测；有 staging 客户数据时打开今日待办邮件或 dev-debt，应出现过点没回执或 Story 不支持类条目；未到点的不会出。不加 cron、不写库。
done_on: 2026-11-10
done_ref: pr:pending
---
复用 R-1 的 loadSocialReadbackBundle / 视图模型；组装今日待办时按客户读取。T+N 过点再加 1 小时 grace 才报「过点没读到」。Story 一条汇总说明暂不支持 T+N，不误报为读数故障。
