---
id: 2026-09-28-circuit-breaker-same-day-retry-gap
title: 熔断检查当天同步不完整只会 skip，不会重试——故障当天真出现异常花费会被永久漏检
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-12
verify_how: 查 cron_run_logs 里 circuit_breaker_check 的 skipped 原因是否真的出现过（account discovery / spend sync 不完整），若出现次数 > 0 立即按 §11 重新打分决定是否马上做；否则到期按 §11 重新打分排入 ROADMAP 或再展期
---
Codex 复审 PR #2019（熔断器运行时调用方 round 4→round 5）：`google-data-pullback-daily` 里 `circuit_breaker_check` 的发送闸（round 4 修的 `accountDiscovery.complete && primarySpendSynced && secondarySpendSynced`）只要有一项不满足就整体 skip，原因写进 `result.circuit_breaker_check`，但不触发本轮重试，也刻意不进 `errors`/`failed`（跟 `ad_level`/`adset_level` 同一惯例）。

**这条建议没有被立即采纳为代码改动**，但跟同一轮的另外两条（"undeterminable 不该 fail-closed"、"未来生效策略竞态"）性质不同——那两条是"不存在的分支"或"推翻已评审设计"，这条是**真实存在、当前就没关上的检测缺口**，用 CLAUDE.md §11 三维打分明示：

- **频率**：低。要同时命中"账户清单读取或某个账户的 campaign 花费同步当天恰好失败"和"故障那天真的发生了会触发熔断的异常花费"两个条件的交集，日常同步失败率不高，异常花费也不是天天有。
- **IMPACT 闭环关键度**：高。熔断器是 Act 段唯一的自动止损闸，这一天被跳过 = 这一天的真实异常永久不会被任何后续判定捕捉到——`evaluationDate` 之后只会前进，被跳过的那天即使花费数据后续被别的路径回填，也只会作为未来某天判定的"历史样本"出现，再也不会作为"今天"接受 3 倍判据检查（固定事件 id 决定了这天的检查窗口只有一次机会）。
- **收入关联度**：高。真出现这种交集，代价是客户账户在故障当天继续 `auto_approve` 花钱且没有任何安全网，直接对应客户投诉/资金损失风险。

→ 频率低，IMPACT 高，收入高：**恰好一个低、两个高 → P1**（不是"没关系可以不管"，也不是"立刻塞进这个 PR"）。

**为什么不在这个 PR 里现在就修**：Codex 建议的两个方向（"给原 evaluationDate 排一个可重试的持久任务" 或 "让本轮任务本身重试而不是等明天"）都需要新的基础设施——`google-data-pullback-daily` 是普通 cron 路由（不是 Inngest 函数），没有内建的"对某个历史 evaluationDate 单独重跑一次熔断检查"机制；要做对，得挂一个新的对账扫描（比如：每天额外查一遍"最近 N 天有没有 evaluationDate 缺 circuit_breaker_check 回执但当天数据后来其实补全了"，缺了就补发一次带那天日期的检查事件），这是一个独立的、需要自己设计 + 复审的小功能，不是"接线 cron 调用方"这个 PR 顺手带一句代码能做对的事。本 PR 的用户原始目标（"把 cron 调用方接上，熔断器才能在生产环境真正自动触发"）已经达成——正常情况下熔断器确实会自动触发；这条是在此基础上的健壮性加固项，排进 P1 单独跟踪更合适，比塞一个仓促实现更安全。

**下一步**（谁来接、接的时候要做什么）：实现方向二选一——① 每日在 pullback 路由末尾加一段"回看最近 7 天 circuit_breaker_check 回执缺口"扫描，缺口对应日期的数据如果现在已经完整就补发一次以该历史日期为 `date` 的 `ads.circuit_breaker.check_due`；② 用 pm-todo 管道下发人工待办，缺口出现时提醒 FDE/PM 去手动核对那天的花费有没有异常（更轻量，但不自动闭环)。选哪个交给接手的人按当时的 §11 分数和是否已经有真实缺口发生来定。
