# 新建/重建广告组「零消耗不干等」· 设计 v0.3（增量，仅供讨论）· 只设计，未写代码 · 119 号 · 2026-10-21

> 在 v0.1/v0.2 之上：冲突处以本稿为准。吸收魏征 A–E 与子牙三处。**本稿不构成对 `bounded_auto` 或任何自动花钱的授权。**

## A. 意图行幂等：写成可执行规则
- `action_runs` 的唯一约束是 `UNIQUE(client_id, idempotency_key)`。重建动作的幂等键 **`keyFields` 只含「旧 adset_id」，`rebuild_seq` 为常量 `1`**；**禁止 `cycle_date`**（`ads.add_retargeting_adset` 的键含 `cycle_date`，照搬会按天重复建）；**禁止 `nonce`**（`computeIdempotencyKey` 支持 nonce，重试带 nonce 就会绕开唯一约束）。
- **并发输家**（幂等命中、拿到已有 run）**只读返回已有 run 的状态，不得再调 Meta**。
- 架构测试：断言该动作的 `keyFields` 恰为 `['old_adset_id']` 且不含 `cycle_date`/nonce。

## B. 重试：选二（写死，不重试）
**不重试**：与 `maxAttempts:1`、`rebuild_seq ≤ 1` 的本意一致。「结果未知」时先去 Meta 核实（§C）；**查不到就出待办，由人决定**，不自动再建。v0.2 §1 里「查不到且确认失败才允许一次受控重试」作废。

## C. 接管已建出的新组：严格条件（防误接管）
接管（把已在 Meta 上建出的新组认领回本 run）必须**同时满足**：
1. **同 `campaign_id`**；
2. **`created_time` ≥ 意图行落库时间**；
3. 名称含**只有我们知道的随机标记 = 意图行 id**（`action_runs.id`，**不是**旧 adset_id，旧 id 他人可知）；
4. 状态 **PAUSED 且从未激活**；
5. **恰好 1 个候选**（多于 1 个 → **不接管，出待办**）。
- 接管后**仍重读设置并重新过闸**才允许继续；`rebuild_failed` 残留组**排除在候选之外**。

## D. 状态机：克隆与自检分开
- **克隆**用 `action_runs`；**自检回执**用既有回执/复盘表（v0.2 §8）。
- 判断「该旧组是否有进行中重建」= **按旧 adset_id 筛克隆 run**（动作键为重建动作），**不是笼统取「最新一条」**（会把自检回执混进来）。

## E. 「当天重建后仍零消耗」计数口径
- 用**账户时区日**（账户快照里的 `timezone_name`）划「当天」；
- 数据来自**克隆 run 的回执 + 重建后 2 小时的回读结果**（不是 Meta 前端推断、不是 6 小时快照）。

## F. 子牙三处
- `learningApplicable=false` 是**重建动作自己的取值**（来自 `subject.learningApplicable`，`envelope-facts.ts:817`），**不得影响其他动作**（测试：其他 `ads.*` 的学习期判定不变）。
- 「跨账户合计必须加载」要**点名改动位置**：现在只有 `ads.scale_unit_budget` 才加载跨账户合计（`envelope-facts.ts:766` 前后），需把重建动作加入加载条件；这是 A 级内核改动，列入实现第一步。
- **步骤 2 回读失败（Meta 读不到）→ 归入「结果未知，进待核实」**（同 §C 的核实流程，不盲推进、不盲重试）。

**本稿不构成对 `bounded_auto` 或任何自动花钱的授权。**
