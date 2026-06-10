# Oztop Building Supplies · GSC Signal Buckets

> **数据期**：2026-05-08 → 2026-06-05（28 天）
> **客户**：Oztop Building Supplies（domain: oztopbuildingsupplies.com.au）
> **地理**：Slacks Creek QLD 4127（Brisbane south-east / Logan）
> **行业**：flooring / tiles / bathware（专业建材供应商，零售 + 装修商 B2B）
> **业务范围**：local（Brisbane 主，Queensland 广义）
> **数据源**：Supabase `gsc_performance_snapshots`（真实 GSC 拉取）
> **总量**：152 clicks / 6,760 impressions / CTR 2.25% / avg position 18.77

---

## 桶 A · 自然品牌词（已稳定，不投 Google Ads）

品牌词总计 ≈ **48 clicks**（占总点击 31.6%）— **正常 branded 比例**（vs ME 后台显示 0% — 平台 bug）。

| Query | Position | Clicks | Impressions | CTR | 处理 |
|---|---:|---:|---:|---:|---|
| oztop building supplies | 1.5 | 35 | 101 | 34.7% | 保留自然 |
| oztop | 4.8 | 11 | 72 | 15.3% | 保留 |
| oz top | 8.4 | 2 | 18 | 11.1% | 保留 |

**判断**：Oztop 品牌词自然排名稳定但有改善空间 — `oztop` 排第 4.8 应该升到第 1（同 `oztop building supplies`），可能因为 home title 不够强。

---

## 桶 B · 🔥 错位机会（高 impressions / 低 CTR / position 5-15）— **第一优先级**

| Query | Pos | Impr | Clicks | CTR | 当前页 | 行动 |
|---|---:|---:|---:|---:|---|---|
| `tile-sizes-explained...` | 7.2 | **1,256** | 24 | 1.9% | /tile-sizes-explained-... | 🔥 改 title + FAQ Schema |
| panda flooring | 8.2 | 45 | 1 | 2.2% | /brand/bigpandaflooring | 🔥 brand 页改 H1 包含 "panda flooring" |
| hybrid flooring | 10.8 | 11 | 1 | 9.1% | /product-category/.../spc-wpc-hybrid-flooring/ | 改 title 加 Brisbane |
| expansion gap flooring | 14 | 4 | 1 | 25% | /understanding-expansion-gaps-... | ✅ 已在 informational 阶段，加内链 |
| engineered timber flooring brisbane | 11 | 2 | 2 | 100% | /product-category/.../engineered-timber-flooring/ | 🔥 已经有 Brisbane 意图，必须升排名 |
| waterproof hybrid flooring | 10 | 1 | 1 | 100% | （需新建）| ❌ 新建 H3 anchor 或 blog |
| vinyl bathroom | 4 | 1 | 1 | 100% | /product-category/.../vinyl-flooring/ | 加 H2 vinyl in bathroom 内容 |

**评估**：桶 B 共 **7 个错位机会**，最大金矿是 `tile-sizes-explained` 页（1,256 impr / CTR 1.9% / 排第 7）。**改 title + 加 FAQ Schema 立即能拉到 5% CTR = +40 clicks/月**。

---

## 桶 C · 已排名但内容弱（position 15-30）

| Query | Pos | Impr | Clicks | CTR | 当前页 | 行动 |
|---|---:|---:|---:|---:|---|---|
| /contact | 15 | 197 | 4 | 2.0% | /contact | 改 title 加 Brisbane + showroom |
| /product-category/.../spc-wpc-hybrid-flooring/6-5mm-spc-hybrid/ | 18.6 | 136 | 3 | 2.2% | 同 | 改 H1 加规格关键词 |
| /understanding-expansion-gaps-... | 12.4 | 402 | 4 | 1.0% | 同 | 🔥 加 FAQ + 内链到产品页 |

---

## 桶 D · 完全没接住（高 impressions / 0 clicks）

🔴 **这是 Oztop 真实金矿** — 大量瓷砖尺寸 / 长尾 informational 词在排名但 CTR = 0。

### D.1 · 瓷砖尺寸计算词组（百+ 0-click informational 长尾）

样本（按 impressions 降序）：

| Query | Pos | Impr | Clicks |
|---|---:|---:|---:|
| 1200+600 | 8.9 | 22 | 0 |
| 12mm hybrid floors lifestyle collection | 43.2 | 19 | 0 |
| 1200-600 | 8.5 | 15 | 0 |
| 1200 600 | 7.7 | 12 | 0 |
| 1200/600 | 8.7 | 9 | 0 |
| 600 x 1200 | 13.9 | 7 | 0 |
| 600+600+1200 | 9.0 | 2 | 0 |

**判断**：用户在 Google 搜 "**1200+600**" / "**600 x 1200**" 这种**瓷砖尺寸计算或拼接组合**，Oztop 的 `tile-sizes-explained` 页面排了第 7-13 位，但**标题没踩这些精准短词**。

**机会**：
- 在 `tile-sizes-explained` 页加 H3 `1200 x 600 mm Tile Size Combinations`
- 加 calculator widget（"Mix 600x1200 + 300x600 + 75x300 in same layout — what's the visual ratio?"）
- 加 SVG 图表显示尺寸对比

⚠️ 这些是 **informational 长尾**，转化路径长。**不投 Ads，走 SEO 自然流量**，加 remarketing pixel 抓装修研究阶段用户。

### D.2 · brand 页大量 0-click 排名

| Brand 页 | Pos | Impr | Clicks |
|---|---:|---:|---:|
| /brand/diytiles/ | 32.3 | 180 | 0 |
| /brand/redbook-carpets/ | 15.9 | 159 | 0 |
| /brand/lauxes-grates/ | 41.2 | 89 | 0 |
| /brand/karndean/ | 43.5 | 57 | 0 |
| /brand/kdk/ | 17.7 | 52 | 0 |
| /brand/caroma/ | 37.1 | 52 | 0 |
| /brand/preference-floors/ | 27.0 | 37 | 0 |
| /brand/mapei/ | 49.7 | 36 | 0 |

**判断**：Oztop 的 brand 页全部**接入了 Google 索引，但内容深度不够 / title 不强 / Schema 缺**。

**行动**：批量改写 brand 页模板（一次改模板 → 31 个 brand 页全受益）：
- title 模板：`{Brand Name} Flooring/Tiles Brisbane | Authorised Dealer | Oztop Building Supplies`
- meta：`Shop {Brand Name} {category} at Oztop's Brisbane showroom in Slacks Creek. Free measure + expert advice. {USP}.`
- H1：`{Brand Name} — Authorised Brisbane Dealer`
- 加 Organization Schema + Product Schema
- 加 "Visit our Slacks Creek showroom" CTA

### D.3 · 产品大类页低排名

| 产品页 | Pos | Impr | Clicks |
|---|---:|---:|---:|
| /product-category/flooring/spc-wpc-hybrid-flooring/ | 49.3 | 302 | 1 |
| /product-category/flooring/vinyl-flooring/ | 53.4 | 161 | 1 |
| /product-category/carpet/ | 23.1 | 92 | 1 |

🔴 **`spc-wpc-hybrid-flooring` 母类页排第 49 — 致命问题**。这是 Oztop 流量主线产品的入口页（302 impr），但实际接住了 1 click。

**行动**：必须 audit 这页 title/meta/H1/canonical。可能 canonical 指错了。

---

## 桶 E · transactional 高潜力词专项（截图 2 显示）

这 5 个词在 ME 后台被识别为 transactional 类，需重点关注：

| 词 | DF Pos | Vol | Est Traffic | 当前页 | 行动 |
|---|---:|---:|---:|---|---|
| **preference flooring** | 33 | 1.3K | 5 | /brand/preference-floors/ | 🔥 brand 页改造 + 投 Ads Exact |
| **nfd** | 22 | 880 | 4 | /brand/nfd/ | 🔥 同上 |
| **kdk bathroom** | 24 | 390 | 2 | /brand/kdk/ | 🔥 加 H1 "KDK Bathroom Brisbane" |
| **elegance oak** | 77 | 170 | 0 | （需新建）| ❌ 这是地板系列名，应该是某 brand 子页 |
| **lappato finish** | 13 | 90 | 1 | /tile-finishes-gloss-lappato-... | 🔥 改 title 包含 "lappato" |

**判断**：这 5 个都是 Oztop 真实经营的 brand / 产品。**preference flooring / nfd / kdk bathroom 月搜合计 2.6K** — 改 brand 页 + 投 Ads 立即可起。

⚠️ "elegance oak" 排第 77 = 几乎没排名 — 这可能是某 brand 的具体系列名，但 Oztop 还没建专题页。需要 PM 确认是否经营该系列。

---

## 总结：6 个立刻可执行的 SEO 改写

按 ROI 降序：

| 优先级 | 页面 | 行动 | 预估 28 天 clicks 增量 |
|---|---|---|---:|
| 1 | `/tile-sizes-explained-...` | 改 title + 加 H3 "1200x600 / 600x600 / 300x600 mm Tile Combinations" + FAQ Schema | +60 |
| 2 | `/product-category/flooring/spc-wpc-hybrid-flooring/` | 修 canonical + 重写 title/H1/meta（从第 49 救到前 20）| +50 |
| 3 | `/brand/preference-floors/` | brand 页改造模板 first try | +25 |
| 4 | `/brand/nfd/` | 同上 | +20 |
| 5 | `/brand/kdk/` | 同上，特别强调 "KDK Bathroom Brisbane" | +15 |
| 6 | `/tile-finishes-gloss-lappato-...` | 改 title 包含 "lappato finish" + 加 visual gallery | +10 |

合计预估 **+180 clicks/月**（约 +118% 站点流量增长）— 全部来自 SEO 改写，不烧 Ads。

---

## 8 个 brand 页批量改造（模板化）

直接套用模板 once → 31 个 brand 页全部受益：

```
title: "{Brand Name} Flooring/Tiles Brisbane | Authorised Dealer | Oztop"
meta: "Shop {Brand Name} {category} at Oztop's Slacks Creek showroom. Premium {category} for Queensland homes. Free measure + expert advice. Visit us in Brisbane."
h1: "{Brand Name} — Authorised Brisbane Dealer"
sub: "Shop the full {Brand Name} range at Oztop Building Supplies, Slacks Creek"
```

预估增益：31 brand 页平均位置从 25 → 18 = 28 天 +80 clicks。

---

**Cross 文件**：
- Ads 计划：`02-google-ads-plan.md`
- 落地页改造：`03-page-rewrites.md`
- 新建 blog backlog：`04-seo-content-backlog.md`
- 总报告：`00-research-summary.md`
