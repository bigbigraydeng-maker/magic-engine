# Oztop Building Supplies · Google Ads 广告计划

> **数据基础**：GSC 28 天 + master_brief.keyword_seeds + 5 transactional 高潜力词 + Brisbane 地域
> **Ads 现状**：⚠️ 待 PM 确认（截图未显示 Ads 帐户，PM 选了"不清楚 / PM 要去查"选项）
> **整体策略**：本文档分两情况预案

---

## ⚠️ 关键差异（vs CTS）

Oztop 跟 CTS 完全不同，**不能照搬 CTS 的 Campaign 结构**：

| 维度 | CTS | Oztop |
|---|---|---|
| 业务模式 | outbound 服务（NZ → 中国旅游）| 本地零售 + B2B 建材 |
| 客单价 | NZ$3,500-8,000 / 团 | AU$50-50,000+（瓷砖一片 → 整套装修） |
| 转化路径 | 询盘 → 顾问通话 → 14-90 天定团 | showroom 到店 / free measure 预约 / 在线询价 |
| 受众 | NZ 全国 35-70 岁文化游 | Brisbane + 周边 200km 装修业主 / 装修商 |
| Conversion event | 提交询盘 form | (1) 在线询价 form (2) free measure 预约 (3) showroom 电话 (4) WhatsApp |
| 决策周期 | 30-90 天 | 7-30 天（装修中） |

**Oztop 的 Ads 应该按 4 类受众分独立 Campaign，不是按主题分 Ad Group**：
- **Campaign A**: B2C 装修业主（Brisbane 半径 100km）
- **Campaign B**: B2B 装修商 / builder（Brisbane + Gold Coast + Sunshine Coast）
- **Campaign C**: Brand defense（oztop / oztop building supplies）
- **Campaign D**: Brand authorised dealer（Preference Floors / NFD / KDK / Karndean 等 dealer 词 — 高商业意图）

---

## 1 · 如果 Oztop 当前未上线 Google Ads（Day 1 配置）

### 1.1 · Conversion Tracking 必须先做

**Oztop 需要的 4 个 conversion event**：

| Conversion Name | 配置 | Value | 优先级 |
|---|---|---|---|
| Free Measure Booking | Form submit on `/contact/` 或 popup | AU$500 (估计单次 lead 价值) | Primary |
| Quote Request | Form submit on product pages | AU$300 | Primary |
| Showroom Phone Call | Call extension click + 30s+ call | AU$200 | Secondary |
| WhatsApp Message | WhatsApp link click | AU$100 | Secondary |

**装好 gtag/GTM 在 oztopbuildingsupplies.com.au**（**绝禁** 装 ME 域名）。

### 1.2 · Campaign 结构

```
[Account] Oztop Building Supplies
  ├─ Campaign A: Oztop — Flooring B2C — Brisbane                 [B2C 装修业主]
  │     daily AU$30 / Maximize clicks / Brisbane 100km radius
  │     Languages: English
  │     ├─ AG_Flooring_Hybrid       AU$10  Exact+Phrase   → /product-category/flooring/spc-wpc-hybrid-flooring/
  │     ├─ AG_Flooring_Timber       AU$8   Exact+Phrase   → /product-category/flooring/engineered-timber-flooring/
  │     └─ AG_Flooring_Vinyl        AU$5   Exact+Phrase   → /product-category/flooring/vinyl-flooring/
  │
  ├─ Campaign B: Oztop — Tiles + Bathware B2C — Brisbane          [瓷砖 + 卫浴]
  │     daily AU$20 / Maximize clicks
  │     ├─ AG_Tiles                 AU$10  Exact+Phrase   → /product-category/tiles/
  │     └─ AG_Bathware              AU$10  Exact+Phrase   → /product-category/tapware-and-bathware/
  │
  ├─ Campaign C: Oztop — Brand Defense                            [防御]
  │     daily AU$5 / Maximize clicks
  │     └─ AG_Oztop_Brand           AU$5   Exact           → /
  │
  └─ Campaign D: Oztop — Authorised Brand Dealer                  [Brand 词]
        daily AU$15 / Maximize clicks
        ├─ AG_Preference            AU$5   Exact+Phrase   → /brand/preference-floors/
        ├─ AG_NFD                   AU$3   Exact+Phrase   → /brand/nfd/
        ├─ AG_KDK_Bathroom          AU$3   Exact+Phrase   → /brand/kdk/
        └─ AG_Karndean              AU$4   Exact+Phrase   → /brand/karndean/
```

**Total daily budget**：AU$70 / 月 ≈ AU$2,100

### 1.3 · AG_Flooring_Hybrid 关键词（B2C 主推产品线）

| 关键词 | Match | 来源 |
|---|---|---|
| `[hybrid flooring brisbane]` | Exact | keyword_seeds + GSC "hybrid flooring" pos 10.8 |
| `"hybrid flooring brisbane"` | Phrase | |
| `[spc flooring brisbane]` | Exact | primary_keywords + 地域 |
| `"spc flooring brisbane"` | Phrase | |
| `[waterproof hybrid flooring]` | Exact | GSC "waterproof hybrid flooring" 排第 10 |
| `[hybrid flooring near me]` | Exact | local intent |
| `"spc wpc hybrid flooring"` | Phrase | 产品大类页关键词 |

**总词数**: 7 个
**Final URL**: `/product-category/flooring/spc-wpc-hybrid-flooring/`

⚠️ **依赖**：先把这页 SEO 修好（当前 GSC 排第 49 — 致命问题）。详见 `03-page-rewrites.md` 改写 #2。

### 1.4 · AG_Flooring_Timber 关键词

| 关键词 | Match | 来源 |
|---|---|---|
| `[engineered timber flooring brisbane]` | Exact | GSC "engineered timber flooring brisbane" 第 11 / CTR 100% |
| `"engineered timber flooring brisbane"` | Phrase | |
| `[timber flooring brisbane]` | Exact | keyword_seeds + 地域 |
| `"engineered timber flooring"` | Phrase | |
| `[hardwood flooring brisbane]` | Exact | |

**总词数**: 5 个
**Final URL**: `/product-category/flooring/engineered-timber-flooring/`

### 1.5 · AG_Tiles 关键词

| 关键词 | Match | 来源 |
|---|---|---|
| `[porcelain tiles brisbane]` | Exact | keyword_seeds |
| `"porcelain tiles brisbane"` | Phrase | |
| `[bathroom tiles brisbane]` | Exact | keyword_seeds |
| `"600x1200 tiles brisbane"` | Phrase | GSC 桶 D 大量瓷砖尺寸搜索 |
| `[lappato finish tiles]` | Exact | GSC "lappato finish" 第 13 |
| `[outdoor tiles brisbane]` | Exact | 子分类 |

**总词数**: 6 个
**Final URL**: `/product-category/tiles/`

### 1.6 · AG_Bathware 关键词

| 关键词 | Match | 来源 |
|---|---|---|
| `[bathroom tapware brisbane]` | Exact | keyword_seeds |
| `"bathroom renovation brisbane"` | Phrase | keyword_seeds |
| `[kdk bathroom]` | Exact | GSC "kdk bathroom" pos 24 / vol 390 |
| `"caroma bathroom brisbane"` | Phrase | brand + 地域 |
| `[bathware brisbane]` | Exact | |

**总词数**: 5 个
**Final URL**: `/product-category/tapware-and-bathware/`

### 1.7 · AG_Oztop_Brand（防御 — 低预算）

| 关键词 | Match | 来源 |
|---|---|---|
| `[oztop]` | Exact | GSC #2 词 |
| `[oztop building supplies]` | Exact | GSC #1 词 |
| `"oztop flooring"` | Phrase | brand_aliases |
| `"oz top"` | Phrase | GSC 变体 |

**总词数**: 4 个
**Final URL**: `/`

### 1.8 · AG_Preference / NFD / KDK / Karndean（Brand 高商业意图）

每组 3-5 词，全部 Exact + Phrase，落地到对应 `/brand/<name>/` 页。

| Ad Group | 主词 | 落地页 |
|---|---|---|
| AG_Preference | `[preference flooring]` `"preference floors brisbane"` | /brand/preference-floors/ |
| AG_NFD | `[nfd flooring]` `"nfd brisbane"` | /brand/nfd/ |
| AG_KDK_Bathroom | `[kdk bathroom]` `"kdk fans brisbane"` `[kdk shower]` | /brand/kdk/ |
| AG_Karndean | `[karndean flooring brisbane]` `"karndean dealer brisbane"` | /brand/karndean/ |

---

## 2 · 否定词清单（Campaign-level）

```
# 业务边界外
diy install
how to install (educational — 进 SEO 不进 Ads)
flooring jobs
flooring career
flooring salary
flooring training
flooring course
flooring apprenticeship

# 通用屏蔽
free
cheap
wholesale (B2B 在专门 campaign 处理)
auction
gumtree
ebay
ikea
amazon

# 错误地理（Oztop 只服务 QLD，不送 NSW / VIC / WA / SA / TAS / ACT / NT）
sydney
melbourne
perth
adelaide
darwin
hobart
canberra
auckland (新西兰)
nsw
victoria

# 错误产品（Oztop 不卖的）
shutters
plantation shutters
curtains
blinds
roller blinds
sheer curtains
herringbone (PM 历史记忆里 Oztop 不做 herringbone — 见 feedback_no_business_fabrication.md)
wallpaper
wall paint
exterior paint

# 错误对应
oztop motors
oztop auto
oztop car
oztop construction (不同公司)
```

---

## 3 · 地域定向

**Campaign A/B（B2C）**：
- Locations: **Brisbane + 100km radius**（覆盖 Logan / Ipswich / Gold Coast 北 / Sunshine Coast 南）
- 排除：Sydney / Melbourne / 任何 QLD 外城市
- Presence: People IN target locations only（防引流外州）

**Campaign D（Brand 词）**：
- Locations: **QLD 全州**（brand 词搜索者愿意远途，比如 Cairns 用户也可能下单 Karndean）

---

## 4 · RSA 广告文案模板

### 4.1 · AG_Flooring_Hybrid RSA

**15 Headlines**：

```
品牌名 (3):
1. Oztop Building Supplies Brisbane
2. Brisbane's Hybrid Flooring Specialists
3. Slacks Creek Showroom — Visit Us

主关键词 (3):
4. Hybrid Flooring Brisbane
5. SPC Flooring Brisbane Showroom
6. Waterproof Hybrid Floors QLD

USP (3):
7. Free Measure & Quote in Brisbane
8. Authorised Preference Floors Dealer
9. Premium Brands at Trade Prices

CTA (3):
10. Book Your Free Measure Today
11. Visit Our Brisbane Showroom
12. Get a Hybrid Flooring Quote

地域 (3):
13. Brisbane Showroom — Slacks Creek
14. Servicing All of Brisbane & Logan
15. Visit Us in Slacks Creek QLD
```

**4 Descriptions**：

```
1. Brisbane's trusted hybrid flooring specialist. Authorised dealer for Preference Floors, NFD, Big Panda. Visit our Slacks Creek showroom or book a free measure.

2. Waterproof SPC and hybrid floors for Queensland conditions. Expert consultation, premium brands, competitive pricing. Free quote and measure across Brisbane.

3. From budget-friendly hybrid to premium engineered timber, Oztop has Brisbane's largest hybrid flooring range. Authorised dealer with expert install advice.

4. Renovating in Brisbane? Visit our Slacks Creek showroom for premium hybrid flooring. Free measure and quote across Brisbane, Logan, and Gold Coast.
```

**Final URL**: `/product-category/flooring/spc-wpc-hybrid-flooring/`

⚠️ **禁用词复查**: `best` `#1` `guarantee` `cheapest` — 不用。`premium` / `authorised` / `trusted` / `competitive` 可以。

### 4.2 · AG_Tiles RSA（瓷砖）

**15 Headlines 重点**：
- 包含 "porcelain" / "lappato" / "bathroom tiles" / "Brisbane"
- USP："1200x600 / 600x600 / 300x600 大尺寸瓷砖" / "Authorised DIY Tiles dealer"
- CTA: "Visit Brisbane Showroom" / "Free Tile Sample" / "Get Tile Quote"

### 4.3 · AG_Bathware RSA（卫浴）

**15 Headlines 重点**：
- 包含 "tapware" / "vanity" / "KDK" / "Caroma" / "bathroom renovation Brisbane"
- USP："Brisbane bathroom renovation specialist" / "KDK + Caroma authorised dealer"
- CTA: "Book Free Measure" / "Bathroom Quote Brisbane"

---

## 5 · 如果 Oztop 当前已上线 Google Ads（复盘流程）

PM 查到上线了 → 让 PM 下载以下 7 个 CSV 给我：

1. 广告系列概览（30 天）
2. 搜索关键词
3. 搜索词（实际用户搜的，不是配置的关键词）
4. 时序图
5. 受众特征（年龄 / 性别）
6. 设备
7. 地区报告（重要 — 验证是否引流到错误州）

**复盘问题清单**：
- 是否 100% 是品牌词（同 CTS Day 1 问题）？
- 是否有外州流量浪费（NSW / VIC）？
- 是否有 broad match 导致杂质流量（同 CTS）？
- conversion tracking 是否在记数据？
- Quality Score 分布如何？

---

## 6 · Day 1-14 学习期保护规则（同 CTS SOP）

- Maximize clicks（不上 tCPA）
- 不调出价 / 不加词 / 不删词 / 不接 Google 推荐
- 触发暂停条件：
  - 单日花费 > AU$140（70 × 200%）
  - CTR < 1.5% 持续 3 天
  - 出现 ≥ 5 个外州搜索词

---

## 7 · 预期产出（Campaign 全部上线后 30 天）

| 指标 | 预期范围 |
|---|---|
| 月花费 | AU$2,100 |
| 月点击 | 800-1,400 |
| 月展示 | 25,000-40,000 |
| 月转化（free measure + quote）| 35-70 |
| CPA（单次 lead 成本）| AU$30-60 |
| 单次 lead → 成单率（行业估）| 8-15% |
| 月预估成单 | 3-10 项目 |
| 平均订单 | AU$3,000-15,000（地板）/ AU$1,000-5,000（瓷砖 / 卫浴）|
| ROI 临界 | 1 单 ≈ 覆盖 1 月 Ads 总成本 |

---

## 8 · 下一步（PM 拍板）

请逐条 OK / NOT-OK：

1. **PM 确认 Oztop Google Ads 现状**（已上线 / 未上线 / 不清楚）→ ?
2. **4 Campaign 结构**（A B2C 装修业主 / B 瓷砖卫浴 / C 品牌防御 / D Brand dealer）→ ?
3. **月预算 AU$2,100**（≈ NZ$2,300）→ ? 是否承受？
4. **4 个 Conversion event 配置**（free measure / quote / phone / WhatsApp）→ ?
5. **地域定向 Brisbane 100km**（B2C）+ **QLD 全州**（Brand）→ ?
6. **否定词清单复审**（特别 shutters/curtains/herringbone 这一类 PM 历史强约束）→ ?
7. **RSA 文案** 直接用还是 PM 改一版？→ ?
8. **依赖事项**：先把 `/product-category/flooring/spc-wpc-hybrid-flooring/` 这页 SEO 修好（当前第 49）才能投 AG_Flooring_Hybrid → 排期？

---

**Cross 文件**：
- GSC 信号桶: `01-gsc-signal-buckets.md`
- 落地页改造: `03-page-rewrites.md`
- SEO 内容 backlog: `04-seo-content-backlog.md`
- 总报告: `00-research-summary.md`
