---
id: 2026-09-28-circuit-breaker-check-no-failure-monitoring
title: 熔断检查 Inngest 函数自己重试耗尽仍失败时，没有任何人工可见的告警通道
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-12
verify_how: migration apply + Inngest Sync 之后，查有没有出现过 ads-circuit-breaker-check 这个函数在 Inngest 后台的失败记录且没有对应人工感知；若近期发生过，立即按 §11 重新打分
---
子牙独立架构复审 PR #2019（round 1，7 问第 7 问"失败了谁最先感知"）发现：如果"读花费/写 deny"这一步本身失败（不是"判定不熔断"，是"整个检查根本没跑成"——比如 migration 还没 apply、SQL 函数不存在、数据库短暂不可用），目前没有任何机制会告诉人。

`google-data-pullback-daily` 只监控"叫醒事件有没有发出去"（发不出去记 `cron_run_logs`），但事件发出去之后，消费者（`ads-circuit-breaker-check` 这个 Inngest 函数）自己重试两次都失败的话，这个失败**只存在于 Inngest 自己的后台**：不会进 `action_runs` 的 dead_letter 监控（那是 Kernel 执行引擎的机制，这个函数不走 Kernel），也没有对应的 pm-todo 待办、没有 `cron_run_logs` 记录。

对照同一个 PR 里的姊妹功能——`ads-autonomy-sync` worker 有专门的 `ads_autonomy_sync_receipts` 表 + `pushAdsAutonomySyncItems` 待办通道去发现同步失败——熔断检查这条路径没有对应物，是一个不对称的监控盲区。

按 CLAUDE.md §11 三维打分：

- **频率**：低偏中。稳定运行后基础设施级失败（数据库连不上、函数本身抛异常）总体少见；但有一个**具体的近期风险**——这个 PR 新增的 SQL migration 按设计不随 PR 自动 apply，如果合并后有人忘记手动 apply 就先触发了这条链路，熔断检查会**每次必然失败**（RPC 函数不存在），且现在完全不会有人知道。
- **IMPACT 闭环关键度**：高。这条链路一旦静默失效，等于这个 PR 的核心目标（熔断器在生产环境自动触发）名存实亡，且没有任何信号会告诉任何人。
- **收入关联度**：高。真出现，客户在没有熔断保护的情况下继续被判定"正常"，异常花费不会被拦。

→ 频率低（偏中）、IMPACT 高、收入高：**恰好一个低、两个高 → P1**。

**为什么没有在这个 PR 里现在就修**：子牙建议的修法（照抄 `ads_autonomy_sync_receipts` 的模式加一张轻量回执表，或至少接入现有的失败告警通道）本身需要新建数据结构或至少新的写入点，不是几行代码的小改动，且这个 PR 本身已经因改动过大被 `fix-scope` 闸门标红。更现实的短期缓解是"人工在 apply migration + Sync Inngest 之后，先手动跑一次确认没有报错"（当场试跑清单里已经包含这一步），中期再补正式监控。

**下一步**（谁来接、接的时候要做什么）：① 短期——合并后 apply migration + Sync Inngest 时，人工确认 Inngest 后台看一眼这个函数近几次运行状态，不要只看"事件发出去了"就当完成；② 中期——照 `ads_autonomy_sync_receipts` 的模式给 `ads-circuit-breaker-check` 加一张回执表（每次运行不管 tripped/not_tripped/error 都落一行），并接入 pm-todo 在检测到"预期应该有回执但连续 N 天没有"时下发待办；③ 这条不必等到大重构，先做①把近期唯一已知会必然失败的场景（migration 忘记 apply）堵上即可缓解大半风险。
