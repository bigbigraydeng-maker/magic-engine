---
id: 2026-10-21-ad-heartbeat-inngest-function
title: 广告心跳第④块：每小时 Inngest 定时函数（默认只演练）+ 判断粘合层 + 存取层 + cron 登记（无客户、无写待办）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3037
verify_by: 2026-10-28
verify_how: 合并部署后去 Inngest 后台 Sync 一次；Render 设置 AD_HEARTBEAT_CLIENT_IDS（只填 CTS）后手动重新部署；先用默认 dry 跑满一天：次日核对 cron_run_logs 里 ad-heartbeat 当天已跑 ≥20 次、没有 failed；迁移（PR 3036）应用并 PM 回「开写」前不会写任何报警行。
---
A 级草稿，依赖 PR 3035（读取层）与 PR 3036（迁移，未应用）；表不存在时安全返回 table_missing，不抛错。
