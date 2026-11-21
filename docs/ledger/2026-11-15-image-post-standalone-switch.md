---
id: 2026-11-15-image-post-standalone-switch
title: 自动图片帖可以单独打开，不再连带把视频排期改成每天
status: decided
owner: agent
decided_on: 2026-11-15
source: doc:docs/tasks/2026-11-15-tour-poster-recipe.md
verify_by: 2026-11-30
verify_how: 合并后给一个客户设 image_post_standalone=true + image_post_per_day=1，看它下一个起草日出了图片帖，同时视频排期仍是每周（回执 cadence 不是 daily）
---
PM 2026-11-15 回「改」：打开 CTS 海报不能顺带把每日社媒助理打开，否则 CTS 视频会从每周排期改成每天且每日数量为 0。
新开关只认显式的 image_post_standalone + image_post_per_day，不用套餐默认值，其他客户不受影响。
