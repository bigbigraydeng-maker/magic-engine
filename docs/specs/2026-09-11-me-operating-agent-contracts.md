# ME 经营 Agent 最小契约（Customer Zero 纵向闭环）

## 1. 决策契约

每次经营判断都必须按以下顺序组装：

1. **客户上下文**：客户身份、行业 Playbook、当前有效目标、客户产品范围、销售周期和已批准约束。
2. **事实**：带客户归属、来源、对象、采集时间、有效期和置信度的 evidence。客户事实与竞品事实分开。
3. **外部情报**：只从既有 `clients.competitor_domains` / Master Brief resolver 得到对象；不得另建名单。竞品网页优先既有 Web Intelligence/Apify。
4. **对比对象**：旅游 Tour 至少按目的地、路线、天数、出发窗口、价格口径、包含项目、定位和客群判断。不能只按关键词或品牌名称匹配。
5. **推理边界**：没有客户侧可比产品、目标或结果数据时，输出 `insufficient_evidence` / `UNKNOWN`，不得补齐、预测或建议调价。
6. **处方**：说明为什么现在关注、建议做什么、建议不做什么、预期证据、成本、风险、可逆性和人工复核要求。
7. **回流**：Act 仅进入授权/执行管道；Check 读取可比 after evidence；Tune 只改变下一次排序或停止/重复决定。

标准输出字段：`question`、`context`、`external_signal`、`impact`、`recommendation`、`authorization`、`evidence`、`unknowns`、`check_and_tune`。

事实、推断、建议、未知必须在数据结构和界面上分开。建议默认 `review_required`，本轮不自动执行。

## 2. 产品匹配契约

每个候选 Tour 必须落入一种状态：

- `comparable`：客户和竞品两边都有足够字段，且目的地/路线/天数/窗口/价格口径/包含项目/定位/客群没有已知冲突；仍需标出尚未验证的字段。
- `out_of_scope`：竞品明确属于客户当前范围之外，例如客户只经营中国团而竞品是日本或越南团；可保留外围市场情报，但不得进入当前经营建议。
- `insufficient_evidence`：客户产品缺失、目的地不明、跨多个市场或价格/日期/包含项目不可核实；不得继承 URL 或品牌名推断可比。

展示必须保留未进入建议的原因和证据时间。

## 3. 主动输出契约

| 输出 | 回答的问题 | 必须包含 | 不应包含 |
|---|---|---|---|
| 即时提醒 | “发生了什么，现在要不要看？” | 变化、影响假设、涉及对象、证据时间、未知、人工复核 | 全量采集记录、无客户对照的强建议 |
| 周报 | “CTS 本周为什么需要关注这件事？” | 与当前目标/销售窗口的关系、客户与竞品双侧证据、优先级、建议不做什么、数据缺口 | 逐条网页 diff、未验证的价格反应 |
| 月报 | “这个月哪些判断改变了经营优先级？” | 目标进展、竞品趋势、营销结果、成本、已采取动作的 Check、Tune 学习、下月三项优先动作 | 把执行回执当结果、把行业均值当客户结果 |

当客户目标过期或没有目标时，输出“没有当前有效目标”，不把历史目标冒充当前目标。

## 4. 被动问答契约

1. 解析问题中的客户、时间范围、产品/市场、指标和动作意图。
2. 先检索客户私有上下文与当前有效目标，再检索已验证 evidence；外部竞品和行业规则作为对照。
3. 应用行业 Playbook 的匹配规则，不以关键词命中替代实体对位。
4. 先给结论状态：`answered`、`partially_answered` 或 `insufficient_evidence`。
5. 展示证据来源、对象、观察时间、有效期、置信度和缺失数据。
6. 如果问题涉及调价、促销、广告修改或对外发布，只能生成 review package，不得执行。

## 5. CTS 最小真实闭环验收

真实问题：**“当前是否需要跟进主要竞品的中国团价格或促销？”**

- 客户上下文：CTS Master Brief 的当前方向为中国团；历史最近目标“CTS 2026 Best of China 团报名”已过期，当前没有 active goal。
- 竞品情报：Wendy Wu 的真实快照显示 Wonders of China，17 天，From $9,030PP，2027/28 Earlybird，且有 2026/2027 出发档期、部分 `Only N Spaces Left` / `SOLD OUT` 观测。
- 同类匹配：CTS `master_briefs.products` 当前为 `null`，因此该候选标记为 `insufficient_evidence`，而不是 `comparable`。
- 影响分析：只能确认竞品存在价格/促销/供给信号，不能确认 CTS 有对应产品、同一价格口径或销售压力。
- 建议：暂不调价、改促销或改变产品；先补齐 CTS 主力 Tour 的已验证产品事实，再逐项对位。
- 证据：所有结论链接到 CTS 归属的 `market_evidence`，保留来源 URL、观察时间和客户 ID；没有证据的部分列入 `unknowns`。
- Check/Tune：补齐产品事实后建立同类 baseline；下次比较价格、档期、余位和促销，并回看询盘/成交数据是否改变优先级。

这是一条“诚实未决”的真实闭环：它完成了 Inspect → Measure（缺口和边界）→ Prescribe（不采取高风险动作），同时把 Act/Check/Tune 的后续条件明确化；不得宣称已证明价格影响。

## Reuse Statement

本契约复用现有 Web Intelligence、Travel Profile、Evidence、Industry Baseline、Goal、Report 和 IMPACT 设施。通用部分只定义证据、匹配状态、推理边界和输出结构；旅游字段属于 L2 Playbook；CTS 的目标、产品缺口和真实结果属于 L4 配置/私有记忆。契约落点与 tier-gate 决策一致，没有把 CTS 私有事实写入 shared runtime。
