---
id: 2026-10-31-reel-publish-state-needs-meta-confirm
title: 只有 Meta 回读确认公开的 Reel 才记成已发布，发后读数只对着这些
status: decided
owner: agent
decided_on: 2026-10-31
source: pr:2817
verify_by: 2026-11-07
verify_how: 合并后下一条草稿的回执 video_state 为 DRAFT，日志含「未公开」，没有发后读数登记。下一条回读 published 为真的，video_state 为 PUBLISHED，并有发后读数登记。回读不到公开状态的，工单为发布失败，原因里写明没确认。
---
请求里写了要公开不算数，以平台回读的 published 为准。草稿留下流量记录给转公开用；已完成待办和「已发到」只在确认公开后写。发后 4 小时 / 72 小时读数只认这一戳。
工单状态栏没有单独的草稿取值（加取值要改数据库，这次没做）。确认过的草稿和已公开都先落在已发布这一栏，靠回执 video_state 区分；转公开按钮依赖这个组合。
历史里已经被记错的行这次不改，清不清理等 Ray 定。
