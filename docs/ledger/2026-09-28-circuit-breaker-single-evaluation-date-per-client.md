---
id: 2026-09-28-circuit-breaker-single-evaluation-date-per-client
title: 熔断检查全客户共用一个 evaluationDate，账户报告时区不同时较快时区的账户会晚一天才被查
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-12
verify_how: 查真实客户的 client_meta_ad_accounts + ad_entity_snapshots.timezone_name，看是否存在同一客户多账户跨不同报告时区的情况；出现且该客户 autonomy_mode=bounded_auto 就升级处理，否则到期按 §11 重新打分
---
Codex 复审 PR #2019（熔断器运行时调用方 round 7）指出：`google-data-pullback-daily` 给一个客户发 `ads.circuit_breaker.check_due` 时，只带 `resolveClientEvaluationDate()` 算出的**一个** `evaluationDate`；consumer（`ads-circuit-breaker-check.ts`）内部虽然按账户分别判定花费，但全部账户共用这同一个日期做"今天"。

**验证了这条技术描述准确**：`resolveClientEvaluationDate`（`src/lib/ads-strategy/account-timezone.ts:95-108`）对客户名下每个广告账户各自算"该账户时区下的昨天"，再取全部结果里**最早**的那个（`.sort()[0]`）——这是 WP2 就有的既有设计，注释里没有明说取最早的用意，但逻辑上是"保证选中的日期对所有账户都已经是完整的一天"这个保守策略的自然结果。本 PR 在 `google-data-pullback-daily/route.ts` 只是复用了这个已经在算的 `evaluationDate` 变量来发熔断检查事件，没有新引入这个单一日期的设计。

**影响**：如果一个客户名下多个 Meta 广告账户配置在不同报告时区（比如一个账户 NZST、一个 AEST，相差 2 小时——同一 UTC 时刻两边可能不在同一个自然日），较早进入新一天的账户，它最新那个完整日的真实花费要等到*下一次*每日任务（即再晚一天）才会被当作"今天"送进 3 倍中位数判据检查。这段时间该账户如果有异常花费，`bounded_auto` 客户仍可能继续自动放行相关动作。

按 CLAUDE.md §11 打分：
- **频率**：低——需要同时命中"客户有多个账户"+"这些账户报告时区确实不同"+"恰好在这个时间差窗口内发生异常花费"三个条件的交集。
- **IMPACT 闭环关键度**：高——熔断器是 Act 段安全闸，延迟生效等于给异常花费多留了最多一天的自动放行窗口。
- **收入关联度**：高——真出现，代价是客户账户在这段延迟期继续 `auto_approve` 花钱。

→ 恰好一个低、两个高 → **P1**。

**为什么没在这轮直接改**：正确修法（按账户各自的时区选评估日，而不是全客户共用一个）需要把"一个客户一条熔断检查事件"的模型改成"一个客户可能要发多条、每条带各自账户子集 + 各自日期"的模型，或者让 consumer 侧自己重新解析每个账户的评估日（但那样又要在 consumer 里重复 `resolveClientEvaluationDate` 已经做的时区查询，两处口径要保持一致）。这个改动会影响事件的 payload 形状和幂等 id 构造方式（当前 `adsCircuitBreakerCheckEventId(clientId, date)` 假设一个客户一天一个 id），牵连到 consumer 的幂等假设，不是"接线 cron 调用方"这个 PR 范围内能顺手做对的事，需要独立设计。

**下一步**：接手时先核实 `verify_how` 里的真实数据分布——如果当前所有多账户客户实际上账户报告时区都相同（比如 CTS 的账户可能同属 NZ 业务、时区一致），这个缺口目前没有现实触发场景，可以继续排期；一旦出现跨时区多账户客户，需要重新设计"一个客户对应哪些评估日"这个事件模型，而不是在现有 payload 上打补丁。
