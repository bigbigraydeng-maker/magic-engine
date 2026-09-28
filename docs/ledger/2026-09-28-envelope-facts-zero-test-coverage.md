---
id: 2026-09-28-envelope-facts-zero-test-coverage
title: envelope-facts.ts（bounded_auto 全部资金安全判据事实的唯一来源）没有任何测试文件——4 轮外部复审在同一个文件里各自独立挑出 4 个真 bug 绝非巧合
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-05
verify_how: 确认 src/lib/capabilities/ads/envelope-facts.ts 有没有对应的测试文件（当前是没有）；一旦有人开始给它建测试，这张卡可以关掉，改成跟踪覆盖率是否达到基本水平
---
在核实 PR #2019 round 16 两条 Codex 新发现（多账户预算总闸没求和、快照截断误判"从未变化"）时，顺手查了一下 `createAdsEnvelopeFactsResolver`/`envelope-facts.ts` 有没有测试——`Glob`/`Grep` 全仓核实：**没有任何文件测试这个函数**，不管是直接单测还是通过别的文件间接覆盖。

**这个文件是什么**：它是 Kernel 判断"bounded_auto 客户这次自治动作能不能放行"的**唯一事实来源**——改前预算是多少、账户合计花了多少、日上限是多少、距上次真实变化过了几小时、在不在学习期、在不在实验里，全部从这里读出来喂给 `autonomy-envelope.ts` 的纯判据函数。这个 PR 之前，这个函数因为没被 Kernel 装上而从未真正跑过（`docs/ledger/2026-09-25-wp3-kernel-ads-wiring.md`）；这个 PR 把它接成默认值之后，它现在是 CTS Tours NZ、New Asian Logistics 这两个真实客户全部自治动作的资金安全闸门。

**已经发现的 4 个真 bug，全部在这一个文件里，全部不是这个 PR 写的（WP2 既有代码），全部是靠外部复审读代码肉眼挑出来的，不是测试跑出来的**：
1. 冷却期判据看不到 Kernel 自己刚做的改动（`kernel_post` 从未被写出）——P0，见 [ledger 卡](./2026-09-28-envelope-facts-cooldown-blind-to-kernel-own-changes.md)
2. 多账户客户的预算总闸只看当前这一个账户，没有汇总——P0（CTS 现在就满足前提），见 [ledger 卡](./2026-09-28-envelope-facts-multi-account-budget-cap-not-summed.md)
3. 账户快照查询硬顶 4000 行，目标实体自己的变更记录可能被挤出窗口、误判成"从未变化"——P1，见 [ledger 卡](./2026-09-28-envelope-facts-truncated-history-misread-as-never-changed.md)
4. `pre_provider` 判据没限定到本次快照批次，混用历史 `kernel_pre` 行——P2，见 [ledger 卡](./2026-09-28-envelope-facts-pre-provider-not-batch-scoped.md)

四条发现横跨 3 轮不同的复审（round 15、16 各两条），全部集中在同一个不到 150 行核心逻辑的函数里——**这不是运气不好，是这个文件从写出来到现在都没有任何自动化手段在盯它**，靠"人肉读代码，读一次挑出一批"这种方式发现问题，效率低、也没法保证读全了。

按 CLAUDE.md §11：这条不是"某个具体故障场景"，是测试基础设施缺口，不完全适用常规三维打分，但给个定性——IMPACT 闭环关键度高（这是 bounded_auto 唯一的资金安全判据来源，出错方向可能是"该拦的没拦"也可能是"不该拦的错拦"）、收入关联度高（两个真实客户的自治动作都靠它）、频率就是"现在进行时"（每一次 CTS/NAL 的自治动作都会经过这个未测试的函数）→ 建议当作跟 P0 同等优先级对待，但不是"修一个 bug"，是"补基础设施"。

**为什么没有在这个 PR 里现在就做**：给一个近 150 行、涉及多种动作类型（暂停/砍预算/加预算/换素材/新建广告组）、CBO/ABO 两种预算口径、学习期判定的函数建立完整测试覆盖，是一次独立的、有一定工作量的测试基础设施建设任务，不是"接线 cron 调用方"这个 PR 顺手做的事；而且这个 PR 本身已经因改动过大被 `fix-scope` 闸门标红，不适合再继续扩大范围。

**下一步**（谁来接、接的时候要做什么）：给 `envelope-facts.ts` 建测试文件，覆盖至少：五种动作类型（pause/cut/scale/swap_creative/add_retargeting）各自的实体解析路径、CBO vs ABO 预算合计、`pre_provider` 的 `kernel_pre` 过滤、`hoursSinceLastRealChange` 的几种边界（无历史/有历史无 changed/有 changed）、读失败的 fail-closed 路径。测试基础打好之后，上面 4 条已发现的 bug（尤其 P0 的两条）应该作为回归用例的一部分顺带修掉，不要测试和修复分两次做——先写一条能复现 bug 的测试（红），再改代码让它变绿，这样每条修复自带回归保护，不会被下一次改动悄悄改回去。这是碰资金安全核心的改动，按 CLAUDE.md 大任务规矩走子牙+魏征双审，建议提到比常规两周节奏更靠前的优先级——理由不是"新发现了个 bug"，是"这整块地基没有任何监测，且已经在实际服务真实客户"。
