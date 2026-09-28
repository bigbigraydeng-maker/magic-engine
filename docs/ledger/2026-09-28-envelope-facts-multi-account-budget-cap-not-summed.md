---
id: 2026-09-28-envelope-facts-multi-account-budget-cap-not-summed
title: envelope-facts.ts 算账户预算合计只看当前这一个广告账户，但拿去比的是客户级总闸——CTS Tours NZ 现在就是这个场景（2 个账户 + bounded_auto）
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-05
verify_how: 查 CTS 是否发生过 Kernel 加预算动作、发生时两个账户各自读到的 accountDailyTotalBeforeCents 与 client 级 daily_budget_cap_cents 的实际比较结果；目前两个账户的 kernel_pre 快照行数都是 0（Kernel 从未真的对它们下过动作），一旦不再是 0 要立刻复查
---
Codex 复审 PR #2019（round 16）：`envelope-facts.ts:133-140` 查账户预算合计时，查询按 `client_id` + `ad_account_id` 精确过滤到**当前这一个广告账户**；算出的 `accountTotal`（`facts.accountDailyTotalBeforeCents`）随后（`autonomy-envelope.ts` 的判据里）会拿去跟 `facts.dailyCapCents` 比——而 `dailyCapCents` 来自 `ad_strategy_configs.daily_budget_cap_cents`（`:231-235`），只按 `client_id` 过滤，是**客户级**总闸，不分账户。

**已核实不是假设场景**：查了生产库，`bounded_auto` 的 2 个真实客户里，CTS Tours NZ 名下登记了 **2 个** Meta 广告账户（账户 id 见 `client_meta_ad_accounts` 表本身，台账不抄）。举例：两个账户当前各花 90（合计 180），客户总闸是 150——如果 Kernel 要给其中一个账户加预算到 100，这条判据只看得到"这个账户从 90 到 100，跟 150 比还有余量"，通过；但客户实际合计已经是 190，早就超过 150 的总闸。**这条判据设计的前提（"一次只看一个账户就够"）在 CTS 身上不成立。**

按 CLAUDE.md §11：IMPACT 闭环关键度高（日预算总闸是 bounded_auto 唯一的资金硬约束之一，被绕过等于自治系统可以让客户实际花费超过 PM 设定的上限）· 收入关联度高（真出现，是对 CTS 这个真实客户的超预算风险）· 频率**不确定/不低**（不是"理论上可能"，是"CTS 现在就满足全部前提条件，只差 Kernel 真的执行一次加预算动作"）→ 不满足"恰好一个低"，按"零个低、两个以上高→**P0**"处理，理由跟已有的冷却期 P0 条目同构：这个 PR 把 resolver 接成默认值之前，CTS 的自治动作全部被无条件拒绝，这条判据从未真正对它生效过；接上之后，这个漏洞第一次变得可达。

**为什么没有在这个 PR 里现在就修**：`envelope-facts.ts` 是 WP2 既有代码，本 PR 没有改动这部分逻辑。要修对不是简单地"把多个账户的 accountTotal 加起来"——Codex 自己也点出了配套问题："不同币种账户还会直接复用同一个数值"，也就是说如果 CTS 的两个账户货币不同（需要核实），单纯相加是错的数字，需要先换算成统一币种再比。这是一个需要先做产品/技术判断的设计问题，不是几行代码的小改动。而且——见姊妹卡 [envelope-facts.ts 零测试覆盖](./2026-09-28-envelope-facts-zero-test-coverage.md)——这个文件目前完全没有测试，在没有测试保护网的情况下现在就去改这段资金判据逻辑风险很高，容易在修一个洞的同时开另一个洞而不自知。

**下一步**（谁来接、接的时候要做什么）：① 先核实 CTS 两个账户是否同币种（不同币种要先解决换算，同币种可以先简单求和）；② 查客户当前的账户级/客户级预算设置实际语义（`daily_budget_cap_cents` 设计意图到底是"每账户"还是"整个客户"，可能需要问 PM 或翻实现前的 spec）；③ 改成汇总客户名下全部账户（不只是当前这一个）的 `accountTotal` 再跟 `dailyCapCents` 比；④ 这是碰资金安全判据的改动，必须先给 `envelope-facts.ts` 建立基础测试覆盖（姊妹卡），再改这条逻辑，不要在裸奔状态下动手；⑤ 按 CLAUDE.md 大任务规矩走子牙+魏征双审。
