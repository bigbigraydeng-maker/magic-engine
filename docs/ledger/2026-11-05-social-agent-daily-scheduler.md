---
id: 2026-11-05-social-agent-daily-scheduler
title: 社媒 Agent 第 1 刀：开了社媒 Agent 的客户每天补明后两天的 Reel 排期，按档位默认配额，所有客户默认关
status: done
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-social-agent-high-frequency-facebook-dev-plan-v1.md
verify_by: 2026-11-12
verify_how: 合并部署 + Inngest Sync 后，发一次 social/week_pack.draft_due（CTS，mode dry_run，cadence daily），cron_run_logs 里 social-weekly-draft 那行回执 cadence=daily、slot_dates 是发事件那天的明后两天、no_publish=true，content_work_orders 零改动；没开 social_agent 的客户回执里没有 cadence 字段且排期照旧在出稿日
done_on: 2026-11-05
done_ref: pr:3612
---
本刀只写发布日、不公开、不授权、不花钱。每日排期看未来 28 天、只补明后两天空位，已有日子的条目一律不动并占着那天，同一条的任一版本已有日子则其他版本不排。每日模式只在那周周卡正在审时停手。第 2 刀（清单卡授权）上线前不给 CTS 打开 social_agent.enabled，否则每日排进来的条目批不了。
