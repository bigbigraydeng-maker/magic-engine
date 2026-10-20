---
id: 2026-10-21-content-factory-board-resilient-118
title: 内容工厂看板：YouTube 回执读失败不再让整页打不开，错误信息可读（不再是 Unknown error）
status: done
owner: pm
decided_on: 2026-10-21
source: session:ccc90b3d
verify_by: 2026-10-22
verify_how: 合并部署后：GET /api/clients/<id>/content-factory/board 返回 200（有 stages/counts），内容工厂页能打开；生产库 youtube_publish_receipts 的 10-18 那份迁移仍未应用时看板照常显示（只是没有 YouTube 阶段）；日志里有一条「youtube_publish_receipts 读取失败」警告
done_on: 2026-10-21
done_ref: pr:2985
---
18 号转述：看板接口稳定 500、页面红字 Unknown error。根因：生产库 youtube_publish_receipts 缺 content_post_id 列（10-18 那份 YouTube 回执迁移来自 PR #2864，未应用，要 PM 说 go apply 才能应用；文件名见 docs/sops/2026-10-21-youtube-receipts-content-post-go-apply.md）；路由 `throw receiptsError` 抛出的是 Postgrest 错误对象不是 Error，被吞成 Unknown error。本 PR 只改代码，不依赖那个迁移：回执读失败按「没有 YouTube 阶段」处理并记警告；catch 里取出真实错误信息。
