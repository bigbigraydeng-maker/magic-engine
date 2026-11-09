# 证据：2026-10-09-calendar-nal-goal-auto-renew-not-live · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：查一下 NAL 月目标有没有打开"自动续月"开关

## 结论

PR #2194 至今仍是 OPEN（草稿），NAL 的 goals 表只有 1 行（9 月目标，status=expired，292/300），没有任何 recurrence 开关；goals 表里 recurrence 这一列在生产库根本不存在（查询报 42703 column does not exist）。

## 怎么查的

gh pr view 2194 => OPEN, isDraft=true, 最后更新 2026-09-28；REST GET goals?primary_metric_key=eq.messaging_started 带 recurrence 列报 column goals.recurrence does not exist；按 client 查 goals 仅返回 9 月那行 + 一个 Unassigned Backlog 草稿。描述里的 UPDATE 在生产上跑不了（列未加）。
