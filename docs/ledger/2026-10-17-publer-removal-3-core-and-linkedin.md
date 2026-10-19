---
id: 2026-10-17-publer-removal-3-core-and-linkedin
title: 删除第三方发布工具本体和 LinkedIn 自动发帖（删除任务第 3 步）
status: decided
owner: agent
decided_on: 2026-10-17
source: session:c45254ff
verify_by: 2026-10-24
verify_how: 合并上线后一周内，查 social-engagement-pullback 的运行记录只含 TikTok 和 Facebook 主页两段且成功；内容工厂「确认」只入队做片；「交付到 Launch Hub」按钮仍能存草稿（新路径 /api/content/quick-post）；Render 里已无两条 linkedin-progress-post 定时任务
---
PM 已取消该发布工具订阅，库里没有任何经它发出的帖子。本卡对应第 3 个 PR：删除它的封装、4 个接口、发布回调、LinkedIn 自动发帖整条线（只能走它发，默认关）、内核边界清单里的对应条目。
「交付到 Launch Hub」的存草稿接口并不调用该工具，已迁到 /api/content/quick-post，功能不变。
数据库里的 content_posts.publer_post_id、client_connectors 里的旧行、flywheel_actions.vendor、flywheel_metrics.source 的历史值留作历史，本 PR 不删列、不动 migration。
LinkedIn 内容工厂草稿 14 条留作历史（全是 draft，没有发布器），不迁移、不删除。
后续事项（合并后）：1 在 Render 手动删 linkedin-progress-post-mon、linkedin-progress-post-thu 两个定时服务，以及 PUBLER_API_KEY、PUBLER_WORKSPACE_ID、LINKEDIN_PROGRESS_POST_ENABLED 三个变量；2 手动触发一次 social-engagement-pullback 并记录退出码；3 今日待办里 pushPriceGateItems（manual-content-items.ts）的「再重发」待办文案需下线或改写，另开卡跟踪，本 PR 不改。
