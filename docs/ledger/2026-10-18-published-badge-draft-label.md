---
id: 2026-10-18-published-badge-draft-label
title: 看板别把「Facebook 草稿」当成「已发布」：统一写「Facebook 草稿，未公开」，周概览/每日计划短视频区也按真实状态显示
status: decided
owner: agent
decided_on: 2026-10-18
source: session:ec90bb17
verify_by: 2026-10-25
verify_how: 合并上线后打开 CTS 的周概览页：已发布 18 张里的草稿（11 张）显示「Facebook 草稿，未公开」、真公开的显示「已公开（Facebook）」、没有平台状态的才显示「平台状态未核」；顶部一行分别数草稿/已公开/未核；视频工厂审片页徽章同样叫「Facebook 草稿，未公开」。
---
背景：登记表发现已标「已发布」的 18 张工厂 Reel 里 11 张其实是 Facebook 草稿，周概览页因为没把 video_state 传出来只能写「平台状态未核」。最小改动（B 级）：OverviewReel 多带 video_state；publishedBadge 文案统一；周概览与每日计划的短视频区复用同一句话。见 docs/clients/cts/2026-10-18-production-line-loop-register.md。
