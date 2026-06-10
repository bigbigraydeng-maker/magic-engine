# Oztop Building Supplies · 落地页改造清单

> **目的**：广告投出去后落地页接得住，自然流量同步起势
> **执行人**：FDE / Claude Code（改 WordPress 模板 或 ChinaTravel-style Next.js — 待确认 CMS）
> **优先级**：按 GSC 桶 B + 桶 D ROI

---

## ⚠️ 前置确认事项

Oztop 站点 **是 WordPress** 还是 **Next.js**？
- URL 结构 `/product-category/.../` + `/brand/.../` 看起来像 WordPress + WooCommerce
- 改写方式 = WordPress 后台改 SEO meta plugin（Yoast / RankMath）+ 改 page content
- 跟 CTS 的 Next.js 站点改法不同（CTS 改 `src/app/<route>/page.tsx`）

⚠️ **PM 确认后**才能给 FDE 准确改写指引。本文档**先给文案模板**，CMS 操作 PM 决定 WordPress 还是别的。

---

## 改写优先级 6 选

| 优先级 | URL | 当前问题 | 行动 | 28 天预估 clicks 增益 |
|---:|---|---|---|---:|
| 1 | `/tile-sizes-explained-...` | CTR 1.9%（impr 1,256, 排第 7） | 改 title + FAQ Schema + 加 H3 尺寸组合 | +60 |
| 2 | `/product-category/flooring/spc-wpc-hybrid-flooring/` | 排第 49（impr 302, 只 1 click） | 修 canonical + 重写整页 | +50 |
| 3 | `/brand/preference-floors/` | 排第 27, 0 clicks | brand 页模板改造 | +25 |
| 4 | `/brand/nfd/` | 排第 22（DF）/ 19（GSC）, 1 click | 同 | +20 |
| 5 | `/brand/kdk/` | 排第 17.7, 0 clicks | 加 "KDK Bathroom Brisbane" H1 | +15 |
| 6 | `/tile-finishes-gloss-lappato-...` | 排第 11, CTR 0.3% | title 包含 "lappato finish" + 视觉 gallery | +10 |

**合计预估**：**+180 clicks/月**（约 +118% 站点流量）

**+** 31 个 brand 页**批量模板改造** → +80 clicks/月

**Total**：≈ +260 clicks/月（站点 28 天总流量从 152 → ≈ 412 / +170%）

---

## 改写 #1 · `/tile-sizes-explained-...`（最高 ROI）

### 当前状态

- 排第 7.2 / 1,256 impressions / 24 clicks / **CTR 1.9%**（行业 5%+）
- 同时承接大量瓷砖尺寸计算搜索（1200+600 / 600x1200 / 300x600 等）— 全 0 clicks

### 改写后必须包含

**`<title>`**：
```
Tile Sizes Explained: 600x1200 vs 600x600 vs 300x600 mm Guide for Australian Homes
```

**`<meta description>`**：
```
Which tile size suits your bathroom or kitchen? Compare 600x1200mm, 600x600mm, 300x600mm, and 75x300mm tiles for floor and wall use. Brisbane tile specialist's complete guide.
```

**`<h1>`**：
```
Tile Sizes Explained — Choosing Between 600x1200, 600x600, 300x600 and 75x300 mm
```

### 加 H3 sub-sections（针对 informational 长尾词）

```markdown
## 600 x 1200 mm Tiles — Best for Large Floors and Feature Walls
## 600 x 600 mm Tiles — Versatile and Classic
## 300 x 600 mm Tiles — Perfect for Bathrooms
## 75 x 300 mm Tiles — Subway and Bathroom Wall Specialist

## Mixing Tile Sizes: 1200+600+300 Combinations
## Tile Calculator: How Many Tiles Do I Need?
## Brisbane Showroom: See All Sizes In Person
```

### FAQ Schema（必加 — 抓 informational 搜索）

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What does 600x1200 tile size mean?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "600x1200 mm refers to tile dimensions: 600 mm wide × 1200 mm long. This is a large-format tile popular for modern bathrooms, kitchens, and feature walls in Australian homes."
      }
    },
    {
      "@type": "Question",
      "name": "Can I mix 600x600 and 300x600 tiles in the same room?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Mixing 600x600 mm floor tiles with 300x600 mm wall tiles is a popular Brisbane bathroom design, creating visual interest while maintaining cohesion."
      }
    },
    {
      "@type": "Question",
      "name": "What size tiles are best for small bathrooms?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "For small bathrooms in Brisbane homes, 300x600 mm tiles work well on walls (vertical install adds height) while 600x600 mm tiles work for floors."
      }
    },
    {
      "@type": "Question",
      "name": "Do larger tiles make a room look bigger?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. 600x1200 mm tiles reduce grout lines and create a seamless look that visually expands small spaces — popular in Brisbane bathrooms and kitchens."
      }
    },
    {
      "@type": "Question",
      "name": "How many 600x600 tiles per square metre?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "2.78 tiles per square metre (1000 / 600 / 600 × 1000). For 10 sqm allow 28 tiles plus 10% for cuts and breakages = 31 tiles total."
      }
    }
  ]
}
```

### 加 internal links 到产品页

```
- Browse our [Porcelain Tiles](/product-category/tiles/porcelain-tiles/) range
- Visit our [Brisbane showroom](/contact/) to see tiles in person
- [Book a free measure](#contact-cta) — Brisbane bathroom renovation specialists
- [Lappato finish tiles guide](/tile-finishes-gloss-lappato-matt-and-grip-which-one-suits-your-style/)
```

---

## 改写 #2 · `/product-category/flooring/spc-wpc-hybrid-flooring/`（致命 SEO 修复）

### 当前状态

- 排第 49.3 / 302 impressions / 1 click
- 这是 Oztop 主线产品（SPC / Hybrid Flooring）的入口页
- 排第 49 = 用户根本看不到

### 必须 audit 的项

```
PM 操作（WordPress 后台）：
1. 在 WP admin → Pages → "SPC Hybrid Flooring" 检查：
   - Title (Yoast/RankMath SEO title)
   - Meta description
   - Canonical URL
   - Schema markup
2. 用 Chrome DevTools view-source 确认实际渲染
3. 检查是否有 noindex / 重复 canonical 指错
```

### 改写后必须包含

**`<title>`**：
```
SPC Hybrid Flooring Brisbane | Waterproof, Pet-Friendly | Oztop Building Supplies
```

**`<meta description>`**：
```
Premium SPC and WPC hybrid flooring at Oztop's Brisbane showroom. Waterproof, pet-friendly, kid-proof. 6.5mm, 8mm, 10.5mm options. Free measure across Brisbane + Logan.
```

**`<h1>`**：
```
SPC & WPC Hybrid Flooring Brisbane — Waterproof, Premium, Pet-Friendly
```

**`<h2>` sub-sections**：
```
## What is Hybrid Flooring?
## SPC vs WPC: Which Hybrid Suits Brisbane Homes?
## Hybrid Flooring Thickness: 6.5mm vs 8mm vs 10.5mm
## Authorised Hybrid Brands at Oztop (Preference Floors, NFD, Big Panda)
## Hybrid Flooring Installation in Brisbane
## Visit Our Slacks Creek Showroom
```

### Product Schema（Schema.org Product Group）

```json
{
  "@context": "https://schema.org",
  "@type": "ProductGroup",
  "name": "SPC Hybrid Flooring",
  "description": "Premium waterproof SPC and WPC hybrid flooring for Brisbane homes",
  "brand": [
    {"@type": "Brand", "name": "Preference Floors"},
    {"@type": "Brand", "name": "NFD"},
    {"@type": "Brand", "name": "Big Panda Flooring"}
  ],
  "offers": {
    "@type": "AggregateOffer",
    "lowPrice": "29",
    "highPrice": "89",
    "priceCurrency": "AUD",
    "offerCount": "30+"
  }
}
```

### 加 internal links

```
- [6.5mm SPC Hybrid →](/product-category/flooring/spc-wpc-hybrid-flooring/6-5mm-spc-hybrid/)
- [8mm SPC Hybrid →](/product-category/flooring/spc-wpc-hybrid-flooring/8mm-spc-hybrid/)
- [10.5mm SPC Hybrid →](/product-category/flooring/spc-wpc-hybrid-flooring/10-5mm-spc-hybrid/)
- [Preference Floors →](/brand/preference-floors/)
- [NFD →](/brand/nfd/)
- [Big Panda →](/brand/bigpandaflooring/)
```

---

## 改写 #3-5 · Brand 页批量改造（Preference / NFD / KDK）

### 通用模板

所有 31 个 brand 页套用：

**`<title>`**：
```
{Brand Name} Flooring/Tiles Brisbane | Authorised Dealer | Oztop Building Supplies
```

**`<meta description>`**：
```
Shop {Brand Name} {category} at Oztop's Slacks Creek showroom. Premium {category} for Queensland homes. Free measure + expert advice. Visit us in Brisbane.
```

**`<h1>`**：
```
{Brand Name} — Authorised Brisbane Dealer
```

**`<h2>` sub-sections**：
```
## About {Brand Name}
## {Brand Name} {Category} Range at Oztop
## Why Choose {Brand Name} for Queensland Homes?
## Pricing & Free Brisbane Measure
## Visit Our Slacks Creek Showroom
```

### 三个 brand 页的特殊点

#### `/brand/preference-floors/`
- 加 H2 "Preference Floors Brisbane — Full Range"
- 列出该 brand 主线产品系列（Eclipse / Eleanor / Antalya 等已经存在的子页）
- 加 Project 案例（Marine Quarter Apartments / Saville 等）

#### `/brand/nfd/`
- 加 H2 "NFD Brisbane Range"
- NFD 是地板品牌 — 强调 "engineered timber + hybrid"
- Estimated traffic 4 vs 实际 1 click — 改 meta CTA 强一些

#### `/brand/kdk/`
- 🔥 GSC 排名"kdk bathroom" 第 24 / vol 390 — **必投 Ads + 必改页**
- 加 H1 "KDK Bathroom Brisbane — Authorised Dealer"
- 加产品列表（KDK exhaust fans / KDK shower / KDK accessories）
- 加 "Brisbane bathroom renovation with KDK" CTA

---

## 改写 #6 · `/tile-finishes-gloss-lappato-matt-and-grip-...`

### 当前问题

- 排第 11.2 / 331 impressions / 1 click（**CTR 0.3%**）
- 标题没踩 "lappato finish" 短词

### 改写后

**`<title>`**：
```
Tile Finishes Explained: Gloss, Lappato, Matt, Grip — Which Suits Your Home?
```

**`<meta description>`**：
```
Choose between gloss, lappato, matt, and grip tile finishes for your Brisbane bathroom, kitchen, or outdoor area. Visual + practical comparison. Visit our Slacks Creek showroom.
```

**`<h1>`**：
```
Tile Finishes Guide — Gloss vs Lappato vs Matt vs Grip
```

**加视觉对比 gallery**：
- 每种 finish 一张实拍图（光线对比）
- "lappato finish" 单独的 H2 + 50 字 description
- Schema ImageGallery

---

## 通用硬性要求（所有改写都需符合）

- `<title>` ≤ 60 字
- `<meta description>` 130-160 字
- `<h1>` 存在且只有 1 个
- `<link rel="canonical">` 存在
- 所有页 H1/H2 包含主关键词
- 不允许 title 用 `best` `#1` `guarantee` `cheapest`（Google policy）
- AU 拼写: `colour` `organisation` `centre` `kilometre`
- internal links 5-10 条
- 所有图片 `alt` 描述（包含关键词 + 地域 Brisbane）

---

## 改写顺序（PM 拍板）

按本文档 1 → 6 顺序改。预估总产能：

| Page | 改写工时 | 测试工时 | 总 |
|---|---|---|---|
| #1 tile-sizes-explained | 3h | 0.5h | 3.5h |
| #2 spc-hybrid product category | 4h | 1h | 5h |
| #3 brand/preference-floors | 2h | 0.5h | 2.5h |
| #4 brand/nfd | 1.5h | 0.5h | 2h |
| #5 brand/kdk | 1.5h | 0.5h | 2h |
| #6 tile-finishes | 2h | 0.5h | 2.5h |
| **(批量)** 31 个 brand 页套模板 | 8h | 1h | 9h |

**合计 ≈ 26.5h FDE 工时**（≈ 3-4 个工作日）

---

## 跟 CTS 改写的关键差异

| 维度 | CTS（旅游服务）| Oztop（建材零售）|
|---|---|---|
| Schema 主类型 | TouristTrip + FAQPage | Product / ProductGroup + FAQPage |
| CTA 主类型 | "Get Free Itinerary" / "Talk to Specialist" | "Book Free Measure" / "Visit Showroom" / "Get Quote" |
| 地域信号 | "from New Zealand" / "for Kiwis" | "Brisbane" / "Slacks Creek" / "Queensland" |
| 内链方向 | 城市 tour 页 + Discovery 主页 | brand 页 + product-category 页 |
| 长尾内容 | 文化游 / 签证 / 行程对比 | 瓷砖尺寸 / 地板规格 / 装修 how-to |
| Conversion 节点 | thank-you page | free-measure form submit + WhatsApp |
