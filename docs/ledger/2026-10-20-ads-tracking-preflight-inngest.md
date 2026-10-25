---
id: 2026-10-20-ads-tracking-preflight-inngest
title: 广告开投前追踪检查（每天自动查像素、落地页、留资、环境）代码做完，上线后要当场试跑一次
status: decided
owner: agent
decided_on: 2026-10-20
source: session:1f83deb6
verify_by: 2026-10-21
verify_how: 合并部署并重新同步后，对 CTS 发一次开投前检查，贴真实回执（每道门状态与证据、cron_run_logs 一行、今日待办里红灯三件套，不得含令牌）；次日早上看新西兰 7 点是否自动跑出新回执。合格 = 回执新鲜、不含令牌、每个红灯都有人能照做的说明
---
设计稿 docs/specs/2026-10-19-ads-tracking-preflight-workflow.md；代码在 src/lib/ads-tracking-preflight/ 和 src/lib/inngest/functions/ads-tracking-preflight.ts；只读，不发布不扣费。
部署与重新同步由 18 号做；触发用管理入口 POST /api/admin/ads-tracking-preflight/trigger（默认只演练，dry_run:false 才真发）。
