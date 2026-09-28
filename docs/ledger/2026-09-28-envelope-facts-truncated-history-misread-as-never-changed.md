---
id: 2026-09-28-envelope-facts-truncated-history-misread-as-never-changed
title: envelope-facts.ts 的快照查询硬顶 4000 行——账户快照多起来后，目标实体自己的 changed 记录可能被挤出窗口，被误判成"从未变化"
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-19
verify_how: 定期查 CTS/NAL 每个广告账户 ad_entity_snapshots 的总行数，接近 4000 时提前处理，不要等真的撞到上限才发现冷却判据已经开始出错——查证当下（2026-09-28）CTS 较大的账户不到 2000 行，NAL 不到 500 行，还有余量但会持续增长
---
Codex 复审 PR #2019（round 16）：`envelope-facts.ts:133-140` 一次性查出账户全部快照（`.eq('client_id', clientId).eq('ad_account_id', adAccountId)`），按 `captured_at` 倒序 `.limit(4000)`。`hoursSinceLastRealChange` 用来判断"距上次真实变化多久"的 `subjectRowsAllHistory`（`:192`）是从这个被截断的 `rows` 里按实体过滤出来的——如果账户内实体多、抓取轮次多，其它实体更新的快照会把目标实体自己的旧 `changed` 行挤出这 4000 行窗口。挤出去之后，`hoursSinceLastRealChange` 看不到任何 `changed` 行，会返回 `Number.MAX_SAFE_INTEGER`（"距上次变化无穷久"），冷却判据直接放行——但真相是"查不到"，不是"真的没变过"，这两者被代码当成了同一件事。

**已核实当前数据量、也核实了不是立刻会炸的问题**：查了生产库，`bounded_auto` 两个真实客户里最大的账户（CTS 的主账户）目前快照总行数不到 2000，离 4000 的上限还有余量；三个账户里 `capture_reason = 'kernel_pre'` 的行数都是 0——Kernel 至今还没有真的对任何一个账户执行过一次动作（这个 PR 刚接上默认 resolver，migration 也刚 apply，Inngest 还没同步），所以这条判据事实上还没被真实数据触发过。但快照是持续累积的（周期性抓取 + 未来的 kernel_pre/post），行数只会往上涨，不会自己降下来。

按 CLAUDE.md §11：频率低偏中（现在数据量还没到临界点，但会随时间推移接近，不是一次性偶发场景）· IMPACT 闭环关键度高（冷却判据被绕过等于自治系统可以不受限速地连续改动）· 收入关联度高（真出现，是对真实客户的重复自动改动）→ 恰好一个低（频率）、两个高 → **P1**（不到 P0 是因为当前数据量还没到触发门槛，有观察窗口，不像多账户预算那条 CTS 现在就满足全部前提）。

**为什么没有在这个 PR 里现在就修**：`envelope-facts.ts` 是 WP2 既有代码，本 PR 没有改动这部分逻辑。修法本身思路清楚（给目标实体单独查一次它自己的最近一条 `changed` 记录，不受账户级 4000 行上限影响，改动量不算大）——但见姊妹卡 [envelope-facts.ts 零测试覆盖](./2026-09-28-envelope-facts-zero-test-coverage.md)：这整个文件目前没有任何测试，在没有测试保护网的情况下修改这段资金安全判据风险不小，应该先建测试覆盖再动手，不要裸改。

**下一步**（谁来接、接的时候要做什么，思路已经想清楚可以直接抄）：在 `subjectRowsAllHistory` 那一步（现在的 `rows.filter(...)`）之外，单独加一次精确查询——按 `(client_id, ad_account_id, level=subject.level, entity_id=subject.entityId, capture_reason='changed')` 过滤、按 `captured_at` 倒序、`limit(1)`（`hoursSinceLastRealChange` 只用得到最新一条），不受账户级 4000 行上限影响；查到就算出小时数，查不到才是真的"从未变化"（`Number.MAX_SAFE_INTEGER`）。改之前先给 `createAdsEnvelopeFactsResolver` 建基础测试（姊妹卡的前置条件），改完把这条场景也纳入测试用例。按 CLAUDE.md 大任务规矩走子牙+魏征双审。
