---
id: 2026-11-16-ads-predictive-early-warning-telegram-fde
title: 广告日内预警 Telegram（FDE 邮箱确认自绑）
status: done
owner: agent
decided_on: 2026-11-16
source: pr:3882
verify_by: 2026-11-19
verify_how: 生产配 TELEGRAM_BOT_TOKEN_ME 与 Resend；FDE 走 /start 邮箱+确认码绑 chat；触发预警时邮件仍按 receipt 幂等且 Telegram 走同一正文。未配 token 时 telegram_unconfigured。
done_on: 2026-11-16
done_ref: pr:3882
---
接 #3880：deliverEarlyWarningToFde；chat 在 leads_config。无迁库、无 Meta 写。