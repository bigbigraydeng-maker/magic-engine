# CTS 近门槛机会扫描 v1（手册 K-07 首次执行）

> 只读：`gsc_query_page_daily`（谷歌搜索后台「词×页」存档，库里已落库），28 天 2026-09-13～10-10，11,000 行，其中「词×页」曝光 ≥30 的组合 **92 个**；非品牌词（排除 cts/boying/ctstours/ctsnz）。零花费，没改任何东西。风险级 C。

## 结论
1. **「排第 11～30 名、有量、再推一把就进前 10」的池子很小**：满足条件的只有 **11 个组合**，最大的也只有 137 曝光（首页的 `china tours`，名次 10.9）；其余都是 30～92 曝光。**这条路不会成为增量主力。**
2. **真正的大头是「已经排在第 4～10 名，却几乎没人点」**：例如 `liziba station` 合计约 4,000 曝光只有 4 次点击（0.1%）；`zhangjiajie` 590 曝光 2 次点击；`forbidden city` 154 曝光 0 点击。这些词名次不差，问题在结果页（视频 / AI 回答占位）或标题描述没吸引力，**换算成动作是改标题描述的角度、做能出现在 AI 回答里的内容，不是继续爬名次**。
3. 词×页存档只暴露谷歌愿意给的词（大量搜索词被匿名），所以本扫描偏保守；谷歌与 DataForSEO 的名次口径也不同（如 `chengdu` 在谷歌后台里该页平均 10.8，DataForSEO 里是 27），两边不能直接对比。

## 11 个近门槛组合（28 天）
| 词 | 页面 | 点击 | 曝光 | 平均名次 |
|---|---|---|---|---|
| china tours | / | 5 | 137 | 10.9 |
| hangzhou | /hangzhou-travel-guide | 0 | 92 | 11.4 |
| chongqing hot pot | /blog/chongqing-hot-pot-guide | 1 | 91 | 11.4 |
| chengdu | /chengdu-travel-guide | 0 | 81 | 10.8 |
| liziba chongqing | /blog/liziba-station-chongqing-guide | 0 | 51 | 11.5 |
| terracotta warriors | /terracotta-warriors-travel-guide | 0 | 45 | 11.0 |
| imperial palace beijing | /forbidden-city-travel-guide | 0 | 44 | 10.6 |
| beijing to xian train | /blog/beijing-to-xian-high-speed-train | 1 | 40 | 14.2 |
| kunming | /kunming-travel-guide | 0 | 38 | 11.0 |
| bullet train beijing to xian first class | /blog/beijing-to-xian-high-speed-train | 0 | 32 | 20.6 |
| chong qing | /chongqing-travel-guide | 0 | 32 | 11.0 |

## 对工作流的含义（并入手册 / 方案）
- 方案 §5「点击率反常低」那一行升级为**常规动作**：每周对「名次 ≤10 且点击率 <0.3%、曝光 ≥300」的组合出一份「标题/描述角度」候选（走现有六道闸与周循环，保护页不动）。
- 近门槛扫描本身保留为每周只读一份清单，但不再当主力杠杆。
- 目的地页（成都/西安/桂林）因对手排第 3、CTS 排 23～41 名，不属于「近门槛」，仍是增量主力（见三档预期）。
