# CTS 竞品词差距样例（只读探针，2026-10-13）

> 用途：给 `docs/specs/2026-10-13-seo-competitor-keyword-strategy-v0.1.md` 提供真实样例。不是处方，不改任何东西。风险级 C。
> 数据源：DataForSEO Labs `domain_intersection`（新西兰 location 2554，英文）。CTS = `ctstours.co.nz`。
> 实际花费：**US$0.156**（8 次查询，来自回单 `cost` 字段累加，不是估算）。
> 复用检查：库里 `local_data_cache` 有一份 2026-10-07 的差距缓存（6 天前，5 个竞品），但它只含「我们完全没排」的词，没有名次对比，所以补查了「两边都排、对手在前」这一半。

## 1. 口径与样本量

- 竞品 4 家：wendywutours.co.nz · exploreworldwide.co.nz · worldjourneys.co.nz · chinahighlights.com（都是 CTS 库里现有竞品名单里的，名单本身是否经 PM 确认见设计稿问题 1）。
- 每家 2 次查询：A=两边都排（取前 100，月搜 ≥30，按搜索量降序）；B=对手排、我们没排（同上）。
- 一天一次快照，没有重复拉取；低量词名次本身不稳（手册 §九），所以只作样例，不作结论。

## 2. 样例 A：两边都排，对手排前 20 且比我们靠前（去品牌词后 35 个词）

| 词 | 月搜 | 难度 | 对手名次 | 我们名次 | 我们现在排的页 |
|---|---|---|---|---|---|
| chengdu | 2,900 | 4 | 3 | 27 | /chengdu-travel-guide |
| terracotta warriors | 1,600 | 23 | 4 | 17 | /terracotta-warriors-travel-guide |
| forbidden city | 1,600 | 22 | 7 | 16 | /blog/forbidden-city-insider-tips（**博客在排，指南页没排上**） |
| xian | 880 | 6 | 3 | 41 | /xian-travel-guide |
| china tours | 260 | 6 | 1 | 10 | 首页 |
| china travel | 260 | 14 | 1 | 7 | 首页 |
| china tours from nz | 210 | 0 | 1 | 6 | 首页 |
| china trip | 260 | 0 | 1 | 18 | 首页 |
| best time to visit china | 260 | 0 | 2 | 22 | /blog/best-time-visit-china-seasonal-weather-crowds-guide |
| yangtze | 260 | 23 | 2 | 15 | /blog/yangtze-river-cruise-from-chongqing |

**交叉印证**：chengdu 27 / xian 41 / terracotta 17 / forbidden city 16，与 `2026-10-13-cts-rank-checkpoint-baseline-v1.md` 的基线名次完全一致，说明这条取数口径和已有周快照对得上。

## 3. 样例 B：对手排前 20、我们完全没排（去品牌词后 241 个词）

- 这一半**约九成是噪音**：对手是综合旅行社，排的是 portugal / egypt / iceland / buffalo 这类 CTS 不卖的目的地；用「含中国/亚洲地名」的粗过滤后剩 92 个，其中大半是**纯信息词**（Chinese New Year、生肖、龙、机场），不是买团意图。
- 值得人看的少数：silk road（5,400，难度 27，World Journeys 第 2）· great wall china / great wall of china（各 3,600）· tibet china（3,600，难度 19）· guangzhou（6,600，难度 11，对手第 20）。silk road 正是 73 号基线里「未追踪」的第二批词。
- panda（8,100，难度 22，Wendy Wu 第 6）：**不知道 CTS 是否有熊猫相关产品，没核实，不下结论**。
- Chinese New Year 2027（2027-02-06）相关词合计很大，但属信息词、有明确时间窗，设计稿里归「观察/定时」类，不当买团词。

## 4. 粗估机会（仅供排序，不是预测）

假设一条通用的名次→点击率曲线（第 1 名约 28%、第 2 约 15%、第 3 约 11%、第 4–5 约 7%、第 6–10 约 3%、第 11–20 约 1%，是**我设的假设，不是 CTS 的实测**）：样例 A 里前 15 个词若追到对手的位置，合计约 +970 点击/月，其中 chengdu 一个词约 +313。数字只用来比先后，不进任何对外报告。

## 5. 单价实测（来自回单）

| 查询类型 | 返回条数 | 单次花费 |
|---|---|---|
| domain_intersection，两边都排 | 15–34 | US$0.0138–0.0161 |
| domain_intersection，对手排我们没排 | 100（上限） | US$0.024 |

约等于「每次 US$0.01 + 每条 US$0.00014」，比 `keyword-opportunity.ts` 里写的列表价（每条 0.0001）略高，预算按实测算。
