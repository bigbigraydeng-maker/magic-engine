# CTS Tours NZ · GSC Signal Buckets

> **数据期**：2026-05-13 → 2026-06-10（28 天）
> **客户**：CTS Tours NZ（domain: ctstours.co.nz）
> **数据源**：Supabase `gsc_performance_snapshots`（GSC 真实拉取）
> **总量**：630 clicks / 50,531 impressions / CTR 1.25% / avg position 14.52

---

## 桶 A · 自然品牌词（已稳定，**不投 Google Ads**）

这些词 GSC 自然排名 ≤ 3，CTS 自有流量已经接住，**Google Ads 不需要重复抢**（除非要做防御，那是品牌防御 campaign 的事，不在本 SOP 范围内）。

| Query | Position | Clicks | Impressions | CTR | 处理 |
|---|---:|---:|---:|---:|---|
| cts tours | 1.7 | 127 | 223 | 56.9% | 保留自然 |
| ctstours | 1.5 | 3 | 22 | 13.6% | 保留 |
| cts tour | 1.6 | 4 | 27 | 14.8% | 保留 |
| cts tours and travels | 1.9 | 2 | 21 | 9.5% | 保留 |
| cts nz | 2.4 | 3 | 12 | 25% | 保留 |
| best tour company for china | 1.0 | 1 | 1 | 100% | 保留 |
| china travel service (cts) | 1.0 | 1 | 1 | 100% | 保留 |

**结论**：CTS 品牌词在 GSC 已经吃满，**当前 Google Ads 把全部预算都投在品牌词上是浪费**（重复抢自己的免费流量）。

---

## 桶 B · 🔥 错位机会（高 impressions / 低 CTR / position 5-15）— **第一优先级**

这是金矿。GSC 已经把页面排到第 5-15 位，但 title / meta / Schema 没写好，CTR 异常低 → **SEO 改写 + Google Ads 抢前 3 位 = 立刻起量**。

| Query | Pos | Impr | Clicks | CTR | 当前页 | 行动 |
|---|---:|---:|---:|---:|---|---|
| **china tours from nz** | 9.4 | 273 | 12 | 4.4% | /china-tours-from-new-zealand | 🔥 SEO 改 title + 投 Ads Exact + Phrase |
| **china tours** | 36.4 | 520 | 5 | 1.0% | /china-tours | 🔥 重写 H1 + meta + 投 Ads（NZ 限定地域）|
| **shanghai itinerary 10 days** | 8.3 | 1090 | 3 | 0.3% | /blog/shanghai-10-days-itinerary | 🔥 标题加 "(NZ Edition)" + 投 Ads "shanghai 10 days itinerary" |
| **china travel service nz** | 14.5 | 79 | 18 | 22.8% | / | 改 home meta 包含此词 |
| **china tour packages including airfare from nz** | 10.4 | 85 | 5 | 5.9% | （无专题页） | ❌ 没页 → 新建 `/china-tour-packages-including-airfare-nz` |
| **best china tours from nz** | 12.8 | 75 | 4 | 5.3% | /china-tours-from-new-zealand | 把 "best" 嵌入 H1 + 投 Ads "best china tours from nz" Phrase |
| **china tours from auckland** | 14.7 | 49 | 2 | 4.1% | /china-tours-from-auckland | 改 title + 投 Ads |
| **liziba station** | 11.3 | 767 | 2 | 0.3% | /blog/liziba-station-chongqing-guide | SEO 加 Schema + image alt |

**评估**：桶 B 共 **8 个错位机会**，合计 28 天 impressions ≈ **2,938**，clicks 51 → CTR 1.7%。**如果改到行业平均 4% CTR**，clicks 可以拉到 ≈ 117 — 增量 +66 clicks/月，**纯自然流量增益**（不花 ads 钱）。

---

## 桶 C · 已排名但内容弱（position 15-30）

GSC 给了排名机会但页面深度不够、内链不密集。重点是改写现有页面。

| Query | Pos | Impr | Clicks | CTR | 当前页 |
|---|---:|---:|---:|---:|---|
| china tours from new zealand | 15.2 | 164 | 2 | 1.2% | /china-tours-from-new-zealand |
| tours to china from nz | 16.6 | 59 | 2 | 3.4% | /china-tours-from-new-zealand |
| china private tour | 32.4 | 5 | 1 | 20% | （泛页） |
| china travels | 24.4 | 22 | 1 | 4.5% | / |
| china travel agency | 11.6 | 27 | 1 | 3.7% | / |
| chinese travel agency near me | 2.5 | 1 | 1 | 100% | / |

**行动**：改 `/china-tours-from-new-zealand` 这页（已经覆盖 3 个 query），加：
- 长尾 H3 `Private China Tours for New Zealanders`
- internal anchor `#private` `#small-group` `#airfare-included`
- FAQ section（"Do CTS tours include airfare?" "Can I book a private tour?"）

---

## 桶 D · 完全没接住（高 impressions / 0 clicks / position > 20）

需要建新页或者修复严重排名差的页面。

| Query | Pos | Impr | Clicks | 备注 |
|---|---:|---:|---:|---|
| china tours | 36.4 | 520 | 5 | /china-tours 排到第 36，几乎进不了第 4 页，需要权重 |
| /china-tours-from-new-zealand | 30.5 | 802 | 20 | 这页平均 30 位，标题应该有问题 |
| /tours/china/discovery/essentials | 41.8 | 331 | 3 | **Best of China 主推页排到 41 位** — 致命问题 |

**最优先一项 → /tours/china/discovery/essentials 排名修复**：
- 这是 PM 明确要重点推的 Best of China 团页
- 当前排在 41 位，几乎收不到自然流量
- 标题里没有出现 "Best of China" / "China Tours NZ" / "15 days China" 等核心词
- **行动**：检查 `<title>` `<h1>` `<meta description>` `<link rel="canonical">`，重写

---

## 桶 E · visa-free 页面专项（PM 6 号问题）

PM 提"visa-free 这是一个很好的点"，确认。

| Page | Pos | Impr | Clicks | CTR | 评估 |
|---|---:|---:|---:|---:|---|
| /blog/china-visa-free-nz-2026 | 9.1 | 5,153 | 18 | 0.35% | 🔥 第 9 位但 CTR 只有 0.35% — 标题/meta 严重失效 |
| /china-visa-guide-for-new-zealanders | 9.2 | 1,808 | 16 | 0.89% | 同上 |

**这是 CTS 站点 28 天 impressions Top 5 之一**（合计 6,961 impressions），**但 CTR 不到 1%**。

**判断**：visa-free 是 informational 高流量入口，但目前这两页：
- title 没有强 CTA
- meta description 不够吸引（推断，需要看实际 HTML 验证）
- 没有 Schema FAQ markup
- 没有内链转化到 tour 页

**机会量级**：如果 CTR 从 0.4% 提到 4%（行业平均），合计 28 天 clicks 从 34 → 278，**+244 clicks/月**。这是 CTS 站点所有页面里**ROI 最高的一次改写**。

具体行动**：
1. **重写 `/blog/china-visa-free-nz-2026` title**：从（推断当前）"China Visa Free Entry for NZ Passport Holders 2026 | CTS Tours" → 改为带数字 + 时间感的："2026 China Visa-Free Entry for NZ Passports: 30 Days Confirmed (Updated June 2026)"
2. **meta description 加 CTA**："NZ passport holders can now visit China visa-free for 30 days. We've helped 1000+ Kiwis travel since 1928. Free itinerary advice → tap here."
3. **加 FAQ Schema** — 5 个常见问题（Do I still need a visa? How long? Can I work? Multiple entries? What documents?）
4. **页底加 "Plan Your First China Trip" CTA**，指向 `/china-tours-from-new-zealand`
5. **加 internal links 到 Beijing / Shanghai / Xi'an tour 页**

⚠️ **不建议把 visa-free 页作为 Google Ads 落地页** — visa-free 搜索意图是 informational，进来的人在研究阶段，付费引流转化率会很低。**走 SEO 自然流量 + remarketing pixel** 把这批人养起来再转。

---

## 总结：5 个立刻可执行的 SEO 改写

按 ROI 降序：

| 优先级 | 页面 | 行动 | 预估 28 天 clicks 增量 |
|---|---|---|---:|
| 1 | /blog/china-visa-free-nz-2026 | 改 title + meta + 加 FAQ Schema + 内链 | +180 |
| 2 | /china-visa-guide-for-new-zealanders | 同上 | +60 |
| 3 | /tours/china/discovery/essentials | 改 title + H1 把 "Best of China" 嵌进去 | +15 |
| 4 | /china-tours-from-new-zealand | 加长尾 H3 + FAQ section + 内链 | +20 |
| 5 | /china-tours | 重写整页（当前 36 位太弱） | +30 |

合计预估 **+305 clicks/月**（约 50% 站点流量增长）— 全部来自 SEO 改写，不烧 Ads。

---

**Cross 文件**：
- 广告投放计划：`02-google-ads-plan.md`
- 落地页改造：`03-page-rewrites.md`
- 新建 blog backlog：`04-seo-content-backlog.md`
- 总报告：`00-research-summary.md`
