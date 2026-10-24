---
id: 2026-10-21-ad-heartbeat-dry-writes-state-and-stalled-check
title: 广告心跳 dry 模式每小时会往 ad_heartbeat_alarms 写一行状态（不写报警）；「心跳停了」检查由第⑤块负责
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3037
verify_by: 2026-10-28
verify_how: 迁移（PR 3036）应用并开 dry 后，查表里只有 row_kind=state 的行、每个被检查账户每小时更新一次、没有 alarm 行；第⑤块的「心跳停了」检查必须用 cron_run_logs 最近一次成功运行或状态行里的 sampled 时间当高水位，不得用 last_seen_at（读失败也会更新它）。负责人：119 号窗口，PM 需认可 dry 会写状态行。
---
dry 并非完全不写库：为了让第一次 live 能正确比对“状态变化”，dry 每小时每账户 upsert 一行状态，不产生报警行、不对外。「心跳停了」(heartbeat_stalled) 检测 3036/3037 都没有，由第⑤块负责，开 live 前必须有。
