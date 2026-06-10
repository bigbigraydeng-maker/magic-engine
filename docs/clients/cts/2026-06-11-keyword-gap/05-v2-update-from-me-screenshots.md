# v2 更新 — 基于 ME 后台 4 张截图的真实数据

> **更新时间**：2026-06-11 NZST
> **数据源**：PM 在 ME 后台 SEO Intelligence / Keyword Gap 跑出的真实 DataForSEO + GA4 + GSC 合并视图
> **替代/补充**：本文档是 `01-gsc-signal-buckets.md` + `02-google-ads-plan.md` 的 v2 增量更新

---

## 一、真实 Organic Rankings（DF 排名 vs GSC 排名）

### 1.1 · 5 个 transactional 高商业意图词（必须重点关注）

| 词 | DF Pos | GSC Pos | 月搜量 | 当前月点击 | 评估 |
|---|---:|---:|---:|---:|---|
| **china tours** | 15 | 36.4 | 260 | 5 | 🔥 DF 排第 15 但 GSC 第 36 → 标题/meta 严重失效 |
| **china tour** | 17 | 16.6 | 260 | 3 | 🔥 同上 |
| **china travel** | 1 | 8.5 | 110 | 4 | ✅ DF 第 1，GSC 第 8 — Google ranking 稳定 |
| **best time to visit china** | 19 | — | 260 | — | ⚠️ DF 第 19 但 GSC 没接到流量，可能 informational 错过 SERP feature |
| **chinese visa** | 18 | — | 110 | — | ⚠️ 同上 |

### 1.2 · 16 个 commercial 类大批 untapped 词（金矿）

| 词 | DF Pos | 月搜量 | 评估 |
|---|---:|---:|---|
| **china travel packages** | 8 | 170 | 🔥 第 8 位 + GSC 0 接触 = 标题完全没踩 |
| china tours from nz | 9 | 170 | ✅ 已在 v1 AG_HighIntent |
| travel package china | 9 | 170 | 🔥 新增 — 同主题不同词形 |
| china tour packages | 14 | 170 | ⚠️ 中位排名 |
| china trips packages | 17 | 170 | ⚠️ |
| china trip packages | 19 | 170 | ⚠️ |
| china trip package | 29 | 170 | ⚠️ |
| china holiday package | 35 | 170 | ⚠️ |
| **holidays to china** | **49** | **390** | 🔥🔥 **最大金矿 — 月搜 390 + 排第 49 位 = 完全没抓** |
| japan package tours | 67 | 320 | ❌ Japan 误排名（CTS 不做日本团） |
| yangtze river cruise | 46 | 170 | ⚠️ Phase 2 候选 |
| china tours packages | 75 | 170 | ⚠️ 长尾错位 |

---

## 二、Top Pages GSC×GA4 合并视图（7 天对比）

### 2.1 · 站点 Top 6 流量页

| 页 | GSC 点击（7d） | 曝光 | CTR | 均排名 | 趋势 |
|---|---:|---:|---:|---:|---|
| /china-tours | 40 (+25%) | 1.9K | 2.1% | 21.3 | ⬆️ |
| /china-tours-from-new-zealand | 20 (-17%) | 802 | 2.5% | 30.5 | ⬇️ |
| **/blog/china-visa-free-nz-2026** | **18 (-14%)** | **5.2K (+9%)** | **0.3%** | 9.1 | 🔴 CTR 致命低 |
| **/china-visa-guide-for-new-zealanders** | **16 (+78%)** | **1.8K (+49%)** | **0.9%** | 9.2 | ⚠️ CTR 偏低 |
| /blog/what-to-pack-china-complete-packing-list-by-season | 12 (+9%) | 1.1K | 1.1% | 11.4 | ➡️ |
| /blog/how-many-days-in-chongqing | 11 (+38%) | 922 | 1.2% | 8.4 | ⬆️ |
| /blog/shanghai-10-days-itinerary | 9 (+50%) | 1.2K | 0.8% | 8.7 | ⬆️ |

### 2.2 · visa-free 双页流量趋势确认

✅ **完全印证 v1 报告判断**：
- visa-free 双页 7 天合计曝光 7.0K（5.2K + 1.8K）
- 7 天合计点击 34（18 + 16）
- 平均 CTR 0.5%
- 平均排名第 9 位
- **`/china-visa-guide-for-new-zealanders` 上周点击 +78% / 曝光 +49%** — 已经在自然加速 = **改写时机最佳**

**这是 CTS 站点 ROI 最高的一次改写**（v1 判断不变，但**更紧迫**了 — 曝光在涨，CTR 不修起来浪费）

---

## 三、竞品 Keyword Gap（金矿筛查）

### 3.1 · 5 个真实竞品对比

| 排名 | 竞品 | 月流量 | 关键词数 | 均排名 | 跟 CTS 共同词 |
|---:|---|---:|---:|---:|---:|
| #1 | **wendywutours.co.nz** | **82** | 25 | 4.9 | **25** |
| #2 | insiderchinatours.com | 0 | 0 | — | 0 |
| #3 | chinahighlights.com | **66.0K** | 1.5K | — | 0 |
| #4 | intrepidtravel.com | 70 | 21 | 7.0 | 21 |
| #5 | adventureworld.co.nz | — | — | — | — |

**洞察**：
- wendywutours 跟 CTS 完全 0 共同词 — 说明 wendywutours 排在的 25 个词 **CTS 全部没占到** = 真正的 gap
- chinahighlights.com 月流量 66K 但 0 共同词 — 它是全球 China travel 巨头，主要打全球泛流量，不是 NZ 本土竞争对手（但它的词可以参考）
- intrepidtravel.com 21 个共同词，均排第 7 = 同分赛道近距对手

### 3.2 · gap 词 KD/Volume 真实数据

**wendywutours.co.nz 独占的 58 个 gap 词（前 10）**：

| 词 | 月搜量 | KD | 来源竞品 | 是否投 CTS Ads/SEO？ |
|---|---:|---:|---|---|
| china | 22.2K | **59** | chinahighlights | ❌ KD 太高，泛词 |
| china hong kong | 12.1K | 18 | chinahighlights | ❌ 业务边界外 |
| lunar new year china | 8.1K | 44 | chinahighlights | ⚠️ 留观（季节性）|
| chinese new year in china | 8.1K | 44 | chinahighlights | ⚠️ 同上 |
| new year in china | 8.1K | 44 | chinahighlights | ⚠️ 同上 |

**关键结论**：

🔴 **gap 词 KD 普遍 ≥18，半数业务边界外（hong kong / Japan）。CTS 短期靠这些词上不了首页。**

**真实策略调整（替代 v1 判断）**：
- v1 假设："DataForSEO gap 词是金矿，等 PM 截图后补"
- v2 真实："**gap 词不是金矿**。CTS 真正的金矿是 **GSC 已排到第 8-20 位但 CTR < 1% 的那批词**（visa-free / china tours / china travel packages）"

---

## 四、v2 关键调整：广告计划更新

### 4.1 · AG_HighIntent 新增 5 个 Exact + Phrase 关键词

基于真实 DF 排名 + GSC 印证：

| 新增词 | DF Pos | 月搜量 | Match | 落地页 |
|---|---:|---:|---|---|
| `[china tours]` | 15 | 260 | Exact | /china-tours |
| `"china tours nz"` | — | — | Phrase | 同 |
| `[china tour]` | 17 | 260 | Exact | /china-tours |
| `[china travel packages]` | 8 | 170 | Exact | /china-tours-from-new-zealand |
| `[travel package china]` | 9 | 170 | Exact | 同 |
| `"holidays to china from nz"` | — | — | Phrase | /blog/holidays-to-china-from-new-zealand（**待新建**）|

**AG_HighIntent 关键词总数从 v1 的 15 个 → v2 的 20 个**

### 4.2 · AG_LongTail 新增 2 个 informational 高曝光词

| 新增词 | DF Pos | 月搜量 | Match | 落地页 |
|---|---:|---:|---|---|
| `[best time to visit china]` | 19 | 260 | Exact | /best-time-to-visit-china |
| `[chinese visa for new zealanders]` | 18 | 110 | Exact | /china-visa-guide-for-new-zealanders |

**AG_LongTail 关键词总数从 v1 的 6 个 → v2 的 8 个**

### 4.3 · 排除词新增

`japan` `tokyo` `kyoto` `osaka` — DataForSEO 显示 CTS 在 "japan package tours" 误排第 67 位，应该把这些词加进 Campaign-level 否定词，避免日本搜索者误进入。

---

## 五、v2 SEO 改写优先级更新

### 5.1 · 新增 P0 — 改写 `/china-tours`

**v1 原优先级**：#5（最低）
**v2 调整**：**升 P0**

理由：
- DF 真实排第 15（vs v1 GSC 显示第 36 — **DF 数据更准**）
- 7 天 +25% 点击 +5% 曝光 = 已经在自然增长
- 月搜量 260 + transactional intent
- **改 title 立刻起量**

**改写文案**（v2 更新）：

```html
<title>China Tours from New Zealand 2026/27 | Compare 12+ Itineraries | CTS</title>
<h1>China Tours from NZ — 12+ Itineraries Designed for Kiwi Travellers</h1>
<meta description>"Compare 12+ China tours from New Zealand. Beijing, Xi'an, Shanghai, Guilin, Yunnan. Small group + private + signature. Free itinerary from NZ's China specialist since 1928."</meta>
```

### 5.2 · 新增 P0 — 改写 `/china-tours-from-new-zealand` 加 H2 `Holidays to China`

**理由**：DF 真实排"holidays to china" 第 49 位（月搜 390）— 加 H2 锚点 + FAQ 后短期可推到第 20 位以内。

**新增 H2**：

```tsx
<section id="holidays-to-china">
  <h2>Holidays to China for Kiwi Travellers</h2>
  <p>
    Looking for a complete holiday package to China? CTS Tours offers all-inclusive
    holidays to China for New Zealanders — flights, accommodation, guides, transfers,
    and meals all sorted. Departures from Auckland, Wellington, Christchurch.
  </p>
  <h3>What's Included in a CTS China Holiday Package</h3>
  <ul>
    <li>...</li>
  </ul>
</section>
```

---

## 六、v2 SEO 内容 backlog 更新

### 6.1 · 升级 Phase 1 优先级

**新 Phase 1 顺序**（按 ROI 真实数据排）：

| 优先级 | Blog | 月搜量 | DF 当前位置 | 预估 30 天 clicks |
|---:|---|---:|---:|---:|
| **P0** | `/blog/holidays-to-china-from-new-zealand` | 390 | 49 | 50-80 |
| **P0** | `/blog/china-tour-packages-including-airfare-from-nz` | 85 (GSC) | 10 | 30-60 |
| **P1** | `/blog/is-china-safe-for-kiwi-travellers-2026` | — | — | 50-100 |
| **P1** | `/blog/best-china-tours-for-first-time-kiwi-travellers` | — | — | 40-80 |
| **P2** | `/blog/beijing-shanghai-xian-itinerary-15-days-kiwi-edition` | — | — | 40-70 |
| **P2** | `/blog/private-china-tours-vs-small-group-which-is-better-for-kiwis` | — | — | 30-60 |
| **P2** | `/blog/visa-free-china-vs-15-day-vs-30-day-policy-comparison` | — | — | 60-120 |

`holidays to china` 升 P0 因为月搜 390 是所有候选里最高 + 排第 49 位最容易短期推上去。

---

## 七、🐛 发现 ME 平台 bug — Branded vs Non-Branded 显示 0%

### 7.1 · 真实 bug

ME 后台 "Branded vs Non-Branded Traffic" 卡片显示：
- Branded: 0% · 0 kw · 0 vol
- Non-Branded: 100% · 32 kw · 8.6K vol

**这跟 GSC 真实数据矛盾**：
- GSC 显示 CTS 28 天来自品牌词（cts tours / cts / ctstours / cts travel / cts tour）的 clicks ≈ **127 + 7 + 3 + 8 + 4 = 149 clicks** ≈ 总流量 630 clicks 的 **23.6%**

### 7.2 · 根因推断

DataForSEO 的品牌词识别**没有用** `clients.brand_aliases` 字段。当前可能是用 domain → "ctstours" → 检测关键词是否含 "ctstours" 来判断 branded。但 CTS 的品牌词是 "cts" / "cts tours" / "china travel service"，都不包含 "ctstours" 这个连写串。

### 7.3 · 修复建议（建议子牙开小 PR）

修改 DataForSEO ranked-keywords 处理逻辑：
- 读 `clients.brand_aliases` 数组
- 对每个 keyword 做 substring 匹配 brand_aliases
- 命中任一 alias → 标 branded = true

**复用模式**：2026-06-04 PR #336 已经为 GSC clicks 做过类似处理（参见 memory: feedback_client_lp_must_use_client_domain → A2.2 brand_search_volume 接入）— 同模式直接套用。

### 7.4 · 影响

修完后：
- CTS Branded vs Non-Branded 真实显示 ≈ 25% / 75%
- 其他客户同 bug 同时修
- 华佗诊断引擎的 brand 维度评分会更准

---

## 八、PM 下一步（v2 更新）

按优先级降序：

| # | 操作 | 工时 | 预估增益 |
|---:|---|---|---|
| 1 | **改写 `/blog/china-visa-free-nz-2026`** | 2.5h | +180 clicks/月 |
| 2 | **改写 `/china-visa-guide-for-new-zealanders`** | 2h | +60 clicks/月 |
| 3 | **改写 `/china-tours`**（v2 升 P0）| 2.5h | +50 clicks/月 |
| 4 | **改写 `/china-tours-from-new-zealand` 加 `Holidays to China` H2**（v2 升级）| 2.5h | +40 clicks/月 |
| 5 | **改写 `/tours/china/discovery/essentials`** (Best of China 救排名) | 4h | +15 clicks/月 + Ads QS |
| 6 | **修品牌 Campaign 3 件事** + **conversion tracking** | 0.5h | 防 NZ$30+/月浪费 |
| 7 | **建独立 Campaign 2 行业获客**（v2 升级 20 + 22 + 8 = 50 词）| 3h | 月预算 NZ$900 / 月 lead 15-30（v2 上调）|
| 8 | **新建 Phase 1 P0 blog**（holidays to china + airfare packages，共 2 篇）| 4h | +80 clicks/月 |
| 9 | **修 ME 平台 Branded 识别 bug** (子牙小 PR) | 2h | 全客户华佗评分更准 |

**v2 合计 30 天 SEO 增益预估**：**+425 clicks/月**（vs v1 预估 +305 — 因为新增 `/china-tours` 和 holidays 改写）

**Campaign 2 v2 预估**：月花费 NZ$900 / 月点击 500-800（vs v1 400-700）/ 月询盘 15-30（vs v1 12-25）

---

## 九、v2 关键修正声明

| v1 判断 | v2 真实情况 | 调整方向 |
|---|---|---|
| "DataForSEO gap 词是金矿，等截图后补" | gap 词 KD 普遍 ≥18，半数业务边界外 — **不是金矿** | 删掉 v1 假设，转重点到 GSC 已排名词 |
| 假设品牌词 GSC 数据已被算法识别 | DataForSEO branded 识别 bug：0% — 实际 ≈24% | 报 bug 给子牙修，影响所有客户 |
| AG_HighIntent 15 词 | v2 → 20 词（加 china tours/tour/travel packages/travel package china/holidays） | Campaign 2 词数 +33% |
| 5 个落地页改写优先级 | `/china-tours` 升 P0 + `/china-tours-from-new-zealand` 加 holidays H2 | 优先级洗牌 |
| Phase 1 6 篇 blog 平等优先级 | holidays to china + airfare packages 双 P0 | 排期前移 |

---

**v2 报告完。等 PM 反馈，按 9 个操作顺序逐条 OK / NOT-OK。**
