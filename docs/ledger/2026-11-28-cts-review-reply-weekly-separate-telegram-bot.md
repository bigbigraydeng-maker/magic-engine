---
id: 2026-11-28-cts-review-reply-weekly-separate-telegram-bot
title: CTS 谷歌评价回复改走单独的 Telegram 机器人：每周四读页面出草稿推给 PM，PM 回「贴评价」才发到谷歌
status: done
owner: agent
decided_on: 2026-11-28
source: session:5fbfc52b
done_on: 2026-11-28
done_ref: doc:docs/specs/2026-11-28-reputation-review-reply-weekly-telegram-v0.md
verify_by: 2026-12-03
verify_how: 12-03 周四上午本机定时任务「CTS 谷歌评价回复周巡」有一次成功运行，且评价机器人文件夹 state/runs.log 当天有一行（读到几条、几条没回）；当周有新评价时 PM 的评价机器人对话里要有一条草稿消息；再打开谷歌地图数一遍，除不回名单外没回的应为 0 或都在待批草稿里
---
PM 11-28 回「改」「贴」「做」。起因：评价回复草稿只进今日待办邮件，PM 说该邮件已无人看；当天实数 17 条里 10 条没回，已手工补回 9 条。
做法稿 docs/specs/2026-11-28-reputation-review-reply-weekly-telegram-v0.md；操作手册在 PM 本机 ~/.claude/channels/telegram-reviews/RUNBOOK.md（不进仓库）。
不改 src/。发回复只认 PM 在评价机器人对话里的批准词；低星和只有星没字的要单独批；评价机器人与主机器人分开（PM 要求，免得混乱）。
依赖：PM 电脑周四上午开着、Chrome 登着有权限的谷歌账号、电脑上 Claude 后台登录没过期。
