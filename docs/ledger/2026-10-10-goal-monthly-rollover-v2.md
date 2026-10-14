---
id: 2026-10-10-goal-monthly-rollover-v2
title: 月目标每月自动续建（接管旧 PR 2194，在最新主干上重做）；NAL 十月目标补建等 PM 点头
status: decided
owner: agent
decided_on: 2026-10-10
source: session:a52bae68
verify_by: 2026-10-14
verify_how: 合并后数据库加上 recurrence 列；PM 回「补建」后 NAL 有一条 2026-10-01~10-31、目标 300、状态生效中的 messaging_started 目标，且 recurrence=monthly；之后看 cron_run_logs 里 goals-expiry-check 最近一次的 summary 无报错，今日待办里没有「月目标没续上」。11-01 之后应自动出现 11 月那条（目标值仍为 300）。
---
旧 PR 2194 一直没合，NAL 十月目标至今缺失（生产库只有 9 月那条，状态已过期）。本卡对应的新 PR 把续建逻辑搬到最新主干，并补上「续建失败进今日待办」。
补建 NAL 十月目标是改生产数据，需要 PM 明确回「补建」；目标值沿用 300，不自动加大。
