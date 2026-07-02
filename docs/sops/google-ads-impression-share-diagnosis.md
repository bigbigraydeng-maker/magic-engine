# Google Ads「Targeting fewer searches」诊断方法论 — IS 三件套 + 双窗口 + 信心分级

> 沉淀日期: 2026-07-03 · 来源: CTS Tours NZ 真实诊断 session (PM 认可该分析逻辑, 要求落档供 ME agent 学习)
> 适用: 任何 Google Ads campaign 出现 "Eligible (Limited) — Targeting fewer searches" 警告, 或 PM 问「要不要加预算」时。
> 关联支柱: 广告 (DAPE 的 A 段 Analysis)。

## 核心原则

**「要不要加钱」不是感觉题, 是 Impression Share 结构题。** 加预算前必须回答: 丢失的展示份额里, 多少丢在预算 (lost IS budget), 多少丢在排名 (lost IS rank)。丢在预算 → 加钱有用; 丢在排名 → 加钱没用, 要提广告质量/出价策略。

## 方法论四步

### 第 1 步: 加 IS 三件套列 (只读, 不动投放)

Campaigns 页 → Columns → Modify columns → Competitive metrics → 勾:
- `Search impr. share` (实际展示 ÷ 有资格展示)
- `Search lost IS (budget)` (预算花完导致的丢失)
- `Search lost IS (rank)` (出价×质量分竞不过导致的丢失)

### 第 2 步: 双窗口对比 (关键, 单窗口会误诊)

同一组列, 分别看 **30 天** 和 **最近 7 天**。原因: learning 期 / 近期改动 (加词、删 negative) 会让 30 天均值失真。**两个窗口结论一致 → 高信心; 不一致 → 以 7 天为准但降一档信心, 标注原因**。

真实案例 (CTS 2026-07): Differentiation Angles 30 天 lost-budget 20.7%, 但 7 天只有 5.7% —— learning 成熟后预算问题已大幅缓解, 30 天数据会误导你去加不需要的预算。Google 自带 budget simulator 用的也是旧窗口 (滞后一周), 不能直接信。

### 第 3 步: keyword 级下钻 (戳破 campaign 级稀释)

Campaign 级 IS 会被混在一起的 generic broad 词稀释 (它们的搜索池巨大)。**结论落到"品牌词在流血"这种具体叙事前, 必须下钻到 keyword 级**: Keywords 页同样加 IS 列 (注: keyword 级没有 lost-budget 列, 用 `100% − IS − lost(rank)` 反推预算丢失)。

真实案例: campaign 级 IS 12.9% 看着吓人, 但下钻后品牌词 `"cts tours"` IS 55.3% / lost-rank 仅 3.5% → 预算丢失 ≈41%。这才坐实「搜品牌名的场次有四成看到的是竞品广告, 且加钱能直接买回」。若下钻发现品牌词 IS >80%, 整个叙事就不成立。

### 第 4 步: 信心分级汇报 (PM 问"多大信心"之前主动给)

每条结论标 高/中/低 + 一句为什么。范式:
- 数字读对了没 (行有没有串) → 用独立数据交叉验证 (如日花费 ÷ 天数 ≈ 预算上限 来核对行归属)
- 大方向 (哪个 campaign 缺钱) vs 机制预测 (加的钱会流向哪) 分开标信心
- 小样本 (7 天 <10 个转化) 明确说是噪音, 不当论据
- **最弱的一环主动指出来 + 给一个廉价验证步骤**, 让 PM 拍板前可以先验证

## 反模式 (本 session 踩过的坑)

1. ❌ **拿 UI 图标状态当结论**: budget simulator 图标灰色 ≠ 不缺预算 (只是 simulator 对该出价策略不可用)。第一轮据此判断 Brand Defense "不是预算问题", 被 IS 数据直接推翻 (实际 lost-budget 59%)。**永远用 IS 数字, 不用 UI 暗示。**
2. ❌ 只看 30 天单窗口 → learning 期噪音会让你把已自愈的问题当成现患。
3. ❌ 在 campaign 级下"品牌词流血"结论 → 必须 keyword 级验证。
4. ❌ 拿不同口径数据互证 (paid impr vs GSC organic impr, 窗口和统计口径都不同) 只能当线索, 不能当证据。

## 决策框架 (诊断完之后)

| IS 结构 | 处方 |
|---|---|
| lost-budget 高 + lost-rank 低 (如品牌词 41%/3.5%) | 加预算 / 组内重分配, 直接有效 |
| lost-rank 高 + lost-budget 低 | 加钱没用; 提 Ad strength / 质量分 / 出价策略 (tCPA 等, 需 PM 拍板) |
| 两头都高 (如 Brand Defense 37%/50%) | 先解预算 (便宜) 再攻排名; 或结构性拆分 |
| 品牌词被 generic broad 拖累预算 | 备选: 拆独立 Brand campaign 小预算保供 (代价: 搬词重置 learning, 需稳定期后做) |

**硬约束不变**: 改预算/出价/结构 = 业务决策, agent 只出单一推荐方案 + 信心标注, PM 显式 go 才执行。

## CTS 2026-07-03 完整案例数据 (供参照量级)

30 天 (6/3–7/2): Diff Angles ($60/d) IS 58.5% / budget 20.7% / rank 20.8%; Brand Defense ($30/d) IS 13.8% / budget 59.3% / rank 27.0%。
7 天 (6/26–7/2): Diff IS 70.6% / budget **5.7%** / rank 23.7%, 花 ~$57/d, 9 conv @$44; Brand Defense IS 12.9% / budget 37.5% / rank 49.6%, 花 ~$27/d。
keyword 级 (30 天): `"cts tours"` IS 55.3% / rank 3.5% → budget ≈41%; `"best of china tour"` IS 63.2% / rank 7.0%。
账号背景: NZ 大盘相关搜索量 +56%, 账号 clicks 未同步跟涨 — IS 结构解释了缺口。
最终推荐 (PM 已 go): 总预算 $90/d 不变, Diff $60→$50, Brand Defense $30→$40。

## 闭环结果 (2026-07-03 执行)

PM 拍板 `go rebalance` 后经 Chrome MCP 在 Campaigns 页逐行编辑预算执行, 均未改变账号总额:
- Differentiation Angles: $60/day → **$50/day**
- Three Tours + Brand Defense: $30/day → **$40/day**
- 账号总额: $90/day (不变, 纯内部重分配)

**执行过程踩到已知坑**: 第二笔 Save 时撞 Google 账号安全挑战 "Confirm that it's you"
(与 [[feedback-google-ads-2fa-confirm-challenge]] 记录一致) — Chrome MCP 无法代过认证,
必须 hand off PM 本人点 Confirm 后再重按 Save 才生效。**任何涉及 Google Ads 账号设置写入
(预算/出价/关联账号等) 的 agent 操作, 都要预判这一步, 提前告知 PM 可能需要手动过一次认证。**

**待验证 (下次 session 跟进)**: rebalance 后 3-7 天回查同一组 IS 三件套, 确认
Brand Defense 的 lost-budget 是否如预期从 37.5% 收窄、品牌词 `"cts tours"` 的
展示份额是否回升; 同时确认 Differentiation Angles 降预算后 lost-rank/转化量
是否维持 (验证"该 campaign 已不缺预算"的判断站得住)。
