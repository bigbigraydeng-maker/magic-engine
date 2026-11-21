---
id: 2026-11-15-cts-tour-poster-enabled
title: CTS 已打开每日线路海报，品牌色改成官网红金（生产配置）
status: decided
owner: agent
decided_on: 2026-11-15
source: doc:docs/tasks/2026-11-15-tour-poster-recipe.md
verify_by: 2026-11-19
verify_how: 周四 06:30 起草后看 cron_run_logs（job_name=social-weekly-draft、summary.kind=client_run）的 summary.imagePost：CTS 至少 1 张海报 status=composed、text_check=match；素材库出现「AI 海报 · 待对原图」；本周视频仍是每周 3 条
---
PM 2026-11-15 回「可以」后改了两处生产配置（老 ME 库）：CTS 当前品牌资料（第 3 版）vi_colors 改为 #B61E2E / #D6A756 / #23201C / 底 #FBF7F0（原 #1a1a1a / #d4af37 / #c41e3a / #ffffff）；
clients.publishing_calendar_config.social_agent = { image_post_standalone: true, image_post_per_day: 1, image_post_recipe: 'tour_poster_v1' }，未开每日社媒助理，视频排期不变。关掉：image_post_standalone 改 false。
日历提醒 2026-11-19 09:00（hello@magicengine.cloud）。本卡随 pr:3857 记账。
