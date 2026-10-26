# 证据：2026-10-09-calendar-nal-oct-goal-not-created · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：查一下 NAL 的「开聊 300」有没有自动换成 10 月那一轮

## 结论

NAL(client 4ae76381…)在 goals 里仍只有 9 月那条，status=expired（292/300，9/1-9/30），没有 period 2026-10-01→10-31 的 active 行，10 月目标没有续上（已过 10-01 八天）。

## 怎么查的

REST GET goals?client_id=eq.4ae76381…&primary_metric_key=eq.messaging_started 返回 1 行：expired, current 292, updated_at 2026-10-01T10:23Z；全 client goals 另只有 Unassigned Backlog 草稿。自动换月的 PR #2194 仍未合并。cron goals-expiry-check 在 10-08 正常跑过。不成时第一步（update 改成 10 月）我未执行（只读）。
