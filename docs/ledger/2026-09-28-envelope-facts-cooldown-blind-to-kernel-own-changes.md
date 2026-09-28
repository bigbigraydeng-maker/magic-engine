---
id: 2026-09-28-envelope-facts-cooldown-blind-to-kernel-own-changes
title: 72 小时冷却期判据看不到 Kernel 自己刚做的改动——已确认 2 个真实客户处于 bounded_auto，此前一直被"没装信封解析器"的 bug 兜底保护，这个 PR 解除了那层兜底
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-05
verify_how: 查 CTS Tours NZ（client_id 见 CLAUDE.md 客户 ID 列表，台账不抄）和 New Asian Logistics（client_id 4ae76381-cd45-43bd-85cd-98cfd7604007）合并部署后的 action_runs / ad_entity_snapshots，看有没有出现"同一 adset/campaign 在 72 小时内被 Kernel 执行两次以上真实设置改动"；若出现即刻按 P0 处理，不等到期
---
Codex 复审 PR #2019（熔断器运行时调用方 round 13）：`src/lib/capabilities/ads/envelope-facts.ts:91-97` 的 `hoursSinceLastRealChange()` 只识别 `ad_entity_snapshots.capture_reason = 'changed'` 的行来判断"距上次真实设置变化过了多久"（72 小时冷却期判据的事实来源）。已独立核实这个判据本身没写错——问题在于**没有东西在 Kernel 写完之后立刻补一条能被它认出来的快照**。

**核实过程**（不是转述 Codex 的原话，是自己验证的）：
1. `grep` 全仓 `kernel_pre`：执行链（`src/lib/kernel/gateway.ts`）在写之前调用 `captureClientSnapshots(..., { reason: 'kernel_pre' })`，这条只用于资金闸的"改前是多少"，`hoursSinceLastRealChange` 明确不用它（写前的状态不代表"变化发生了"）。
2. `grep` 全仓 `kernel_post`：只在 `src/lib/ads-strategy/portfolio/diagnostics/loader.ts:88`（消费方，判据里认 `changed` 或 `kernel_post` 两种）和一个测试文件的假数据（`real-setting-changes.test.ts:119`）里出现过——**没有任何生产代码路径真的写出一条 `capture_reason: 'kernel_post'` 的快照**。也就是说 `diagnostics/loader.ts` 早就为"Kernel 写后立刻留痕"这件事准备好了消费逻辑，但生产者那一侧从来没接上。
3. `capture_reason = 'changed'` 的唯一生产者是 `snapshot.ts:369` 的每日/周期性快照跟上一条比对 `settings_hash`，不同才标记——这是**定期对账才会发现"变了"**，不是"Kernel 一执行完就知道自己刚变了"。

**后果**：Kernel 对同一个 adset/campaign 连续做两次自治动作，如果两次之间还没轮到下一次周期性快照跑完对账，第二次动作读到的 `hoursSinceLastChange` 仍然是**上一次周期性对账之前**的旧数字（可能是好几天前），72 小时冷却闸对第二次动作形同虚设。

**这条为什么不是"以后再说"级别，已经把频率评级从"低"改成"未知/待核实"**：查了生产库（Supabase 项目 `glbdnayojixmexgofbsd`）—— `ad_strategy_configs.autonomy_mode = 'bounded_auto'` 当前**有 2 条真实记录**：CTS Tours NZ（日预算上限 $150，2026-09-26 设置）、New Asian Logistics（日预算上限 $100，2026-09-24 设置）。`docs/ledger/2026-09-25-wp3-kernel-ads-wiring.md` 记录了这两个客户设置 `bounded_auto` 时，`createKernel()` 根本没装 `resolveEnvelopeFacts`——按 `src/lib/kernel/deps.ts:85` 的注释"不给 = bounded 动作一律拒"，这两个客户的自治动作此前**全部被 Kernel 无条件拒绝**，冷却期判据从未真正对真实客户生效过。这个 PR 把默认解析器接上（`kernel/index.ts:15,33`），是**同一个 PR 第一次让这两个真实客户的自治动作真正跑起来**——冷却期的漏洞和真实资金动作同一天一起上线。因为不知道 Kernel 触发同一实体连续动作的真实频率（卫青/处方引擎多久会对同一个 adset 再开一次处方，这条链路没有查过），不能诚实地把频率评成"低"。

按 CLAUDE.md §11：IMPACT 闭环关键度高（72 小时冷却是 spec 明确写死的治理约束，被绕过等于自治系统可以不受限速地连续改同一个客户的同一条广告）、收入关联度高（真出现，是对 CTS/NAL 这两个真实客户的广告反复自动改动，超出预期节奏）、频率不确定（不是低，也没有证据证明高）→ 不满足"恰好一个低、两个高→P1"的条件，按"零个低、两个以上高→**P0**"处理。

**为什么没有在这个 PR 里现在就修**：`envelope-facts.ts`/`hoursSinceLastRealChange` 是 WP2（`6581c7ec`）的既有代码，这个 PR 完全没有改动这个函数本身——本 PR 唯一相关的改动是在 `kernel/index.ts` 里把它接成默认值（补的是"没装等于全拒"这个更明显的 bug，子牙已核实这条修复本身是对的、必须做）。真正修对冷却期漏洞需要在 Kernel 执行链里补一次写后快照（比如 `gateway.ts` 写成功后调 `captureClientSnapshots(..., { reason: 'kernel_post' })`，让 `diagnostics/loader.ts` 早就写好的消费逻辑终于有数据可读），这是一处独立的 Kernel 执行链改动，碰的是资金安全核心路径，不该在"接线 cron 调用方"这个 PR 里顺手加——尤其这个 PR 本身已经因改动过大被 `fix-scope` 闸门标红。**但**因为 CTS/NAL 已经是真实的 bounded_auto 客户，这条不能只用常规 P1 的两周节奏拖着，需要 PM 明确知道：合并这个 PR 本身没问题（不会让冷却期漏洞变得比现在更差，circuit breaker 是独立的按花费金额触发的另一层保护，冷却期漏洞过去 Kernel 全拒时也是"生效"的、只是因为动作全部被拒才没暴露），但如果想让"72 小时冷却确实保护这两个客户"这件事是真的，需要在合理时间内补上写后快照这条修复，或者先手动核实这条链路实际不会短时间内对同一实体连续下动作。

**下一步**（谁来接、接的时候要做什么）：① 在 `src/lib/kernel/gateway.ts` 写成功之后补一次 `captureClientSnapshots(..., { reason: 'kernel_post' })`（`diagnostics/loader.ts` 的消费逻辑已经等着这个值，不用改消费侧）；② 同时把 `hoursSinceLastRealChange` 的过滤条件从只认 `changed` 扩到 `changed` 或 `kernel_post`；③ 落地前后各跑一次 `kernel-wiring-integration.test.ts` 这类接线测试防止再次出现"代码写了但没真的接上"；④ 这是碰 Kernel 执行链的改动，按 CLAUDE.md 大任务规矩走子牙+魏征双审，不要单人改完直接合。
