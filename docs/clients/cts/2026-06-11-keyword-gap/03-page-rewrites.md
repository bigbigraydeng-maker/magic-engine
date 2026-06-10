# CTS Tours NZ · 落地页改造清单（SEO 同步）

> **目的**：广告投出去后，落地页能接住转化；自然流量同步起势。
> **执行人**：FDE / Claude Code（改 src/app/ 下 page.tsx）
> **优先级排序**：按 GSC 桶 B + 桶 D 错位机会 ROI

---

## 改写优先级 5 选

| 优先级 | 文件路径 | 当前问题 | 行动 | 28 天预估 clicks 增益 |
|---|---|---|---|---:|
| 1 | `src/app/blog/[slug]/page.tsx` (china-visa-free-nz-2026) | CTR 0.35%（impr 5,153） | title + meta + FAQ Schema + 内链 | +180 |
| 2 | `src/app/china-visa-guide-for-new-zealanders/page.tsx` | CTR 0.89%（impr 1,808） | 同 #1 | +60 |
| 3 | `src/app/tours/[destination]/[tier]/[tour]/page.tsx` (Best of China Essentials) | 排第 41 位 | title + H1 重写 + canonical 修复 | +15 |
| 4 | `src/app/china-tours-from-new-zealand/page.tsx` | 第 30 位 | 加长尾 section + FAQ + 内链 | +20 |
| 5 | `src/app/china-tours/page.tsx` | 第 36 位 | 重写整页 | +30 |

**合计 28 天增益**：**+305 clicks**（约 +50% 站点流量）

---

## 改写 #1 · `/blog/china-visa-free-nz-2026`（最高 ROI）

### 当前状态推断（需要 PM 打开页面 view-source 确认）

需要查的：`<title>` `<meta description>` `<h1>` 是否包含强 CTA + 时间感数字。

### 改写后必须包含

**`<title>`**（60 字内）：
```
2026 China Visa-Free Entry for NZ Passports: 30 Days Confirmed (Updated June 2026)
```

**`<meta description>`**（160 字内）：
```
NZ passport holders can now visit China visa-free for 30 days. We've helped 1,000+ Kiwis travel since 1928. Get free China itinerary advice from NZ's longest-running China specialist.
```

**`<h1>`**：
```
China Visa-Free for New Zealanders: Your 2026 Guide (30 Days, Updated June)
```

### FAQ Schema（必加 — 影响 Google AI Overview 引用）

在页面顶部加 JSON-LD `<script type="application/ld+json">`：

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Do New Zealand passport holders need a visa to visit China in 2026?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "From 30 November 2024, NZ passport holders can enter mainland China visa-free for up to 30 days for tourism, business, family visits, and transit. Confirmed valid through 31 December 2025 — and renewed for 2026."
      }
    },
    {
      "@type": "Question",
      "name": "How long can Kiwis stay in China visa-free?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Up to 30 days per entry. Multiple entries allowed within the validity period."
      }
    },
    {
      "@type": "Question",
      "name": "Can NZ passport holders work in China under the visa-free policy?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "No. Visa-free entry is for tourism, business meetings, family visits, and transit only. Working in China still requires a work visa."
      }
    },
    {
      "@type": "Question",
      "name": "What documents do I need at the border?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Valid NZ passport (6+ months validity), return ticket, accommodation address. No visa application needed."
      }
    },
    {
      "@type": "Question",
      "name": "Which Chinese cities can I visit visa-free as a Kiwi?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "All of mainland China. Common destinations include Beijing, Shanghai, Xi'an, Guilin, Hangzhou, Chengdu, and Chongqing — all covered by CTS Tours' Kiwi-led itineraries."
      }
    }
  ]
}
```

### 页底 CTA section

```tsx
<section className="cta-band">
  <h2>Now You Don't Need a Visa — Plan Your China Trip from NZ</h2>
  <p>
    With visa-free entry confirmed, more Kiwis than ever are heading to China.
    CTS Tours has helped New Zealanders explore China since 1928 — let our
    team craft your perfect itinerary.
  </p>
  <a href="/china-tours-from-new-zealand" className="btn-primary">
    See China Tours from NZ
  </a>
  <a href="/contact" className="btn-secondary">
    Talk to a China Specialist
  </a>
</section>
```

### Internal links（页中段插入）

```
- [Best Time to Visit China — Kiwi Guide →](/best-time-to-visit-china)
- [China Tours from New Zealand →](/china-tours-from-new-zealand)
- [Beijing Tours from NZ →](/beijing-tours)
- [Shanghai Tours from NZ →](/shanghai-tours)
- [Xi'an Terracotta Warriors Tour →](/xian-tours)
- [Best of China — 15-Day Discovery Tour →](/tours/china/discovery/essentials)
```

---

## 改写 #2 · `/china-visa-guide-for-new-zealanders`

跟改写 #1 同模式，唯一差别：

- 这页是 `/china-visa-guide-for-new-zealanders` 不是 `/blog/...`，所以是站点 hub 性质 — title 应该更"guide"/"all-in-one"调性
- 加 canonical 指向自己（如果跟 `/blog/china-visa-free-nz-2026` 内容高度重叠会被 Google 判 duplicate）
- 如果内容高度重叠 → 考虑 301 redirect 一个到另一个（PM 决定保留哪个）

**`<title>`**：
```
China Visa Guide for New Zealanders (2026): Complete Entry Rules
```

**`<h1>`**：
```
China Visa Guide for Kiwis — Everything You Need to Know (2026 Updated)
```

---

## 改写 #3 · `/tours/china/discovery/essentials`（Best of China — 致命修复）

### 当前问题

GSC 显示这页排第 **41.8 位**，几乎进不了首页（Google 搜不到 → 自然流量 ≈ 0）。这是 PM 重点推的 Best of China 团页，必须修。

### 必须 audit 的 HTML 元素

```bash
# PM 或 FDE 用以下任一方式 audit:
# A. view-source
# B. Chrome DevTools → Elements → 搜 <title> <meta name="description"> <link rel="canonical">
# C. 用 ME 后台 OnPage Audit（dataforseo/onpage.ts 提供）
```

### 改写后必须包含

**`<title>`**：
```
Best of China — 15-Day Tour from NZ | Beijing Xi'an Shanghai | CTS Tours
```

**`<meta description>`**：
```
15-day Best of China tour from Auckland. Beijing, Xi'an, Hangzhou, Shanghai with Kiwi-led small groups. Great Wall, Terracotta Warriors, Forbidden City. From NZD $3,880. Departures Nov 2026 – Mar 2027.
```

**`<h1>`**：
```
Best of China — 15-Day Tour from New Zealand
```

**`<h2>` sub-heading**：
```
Beijing • Xi'an • Hangzhou • Shanghai | Small Group | Departing from Auckland
```

### Schema `TouristTrip`（必加 — 让 Google 直接展示价格 + 时长 + 城市）

```json
{
  "@context": "https://schema.org",
  "@type": "TouristTrip",
  "name": "Best of China — 15-Day Discovery Tour",
  "description": "15-day Best of China tour for New Zealanders, covering Beijing, Xi'an, Hangzhou, and Shanghai.",
  "tourBookingPage": "https://www.ctstours.co.nz/tours/china/discovery/essentials",
  "image": "https://www.ctstours.co.nz/forbidden-city-700-7.jpg",
  "provider": {
    "@type": "TravelAgency",
    "name": "CTS Tours NZ",
    "url": "https://www.ctstours.co.nz",
    "telephone": "+64 800 287 888"
  },
  "offers": {
    "@type": "Offer",
    "price": "3880",
    "priceCurrency": "NZD",
    "availability": "https://schema.org/InStock",
    "validFrom": "2026-11-03",
    "validThrough": "2027-03-25"
  },
  "itinerary": {
    "@type": "ItemList",
    "itemListElement": [
      {"@type": "ListItem", "position": 1, "name": "Beijing - Forbidden City, Great Wall, Hutong"},
      {"@type": "ListItem", "position": 2, "name": "Xi'an - Terracotta Warriors, City Wall"},
      {"@type": "ListItem", "position": 3, "name": "Hangzhou - West Lake, Tea Plantation"},
      {"@type": "ListItem", "position": 4, "name": "Shanghai - The Bund, Yuyuan Garden"}
    ]
  },
  "touristType": ["Cultural", "Heritage", "Small Group"],
  "subjectOf": {
    "@type": "CreativeWork",
    "audience": {
      "@type": "Audience",
      "geographicArea": "New Zealand"
    }
  }
}
```

### Canonical

确保 `<link rel="canonical" href="https://www.ctstours.co.nz/tours/china/discovery/essentials">` 存在且无误。如果当前页排第 41 位，**很可能 canonical 指错了别的页**（指到了 `/china-tours` 或者 `/tours/china`）→ 必须 audit。

---

## 改写 #4 · `/china-tours-from-new-zealand`

**当前问题**：第 30 位，但 GSC 显示这页接了 6 个相关 query（china tours from new zealand / china tours from nz / china tours from auckland / tours to china from nz 等），说明 Google 把它认为是这组词的"代表页"。

**改写策略**：不重写整页，**加 H3 + FAQ + 内链**深化内容。

### 加 `<h3>` 长尾 section

在 `<main>` 中段插入：

```tsx
<section id="private-tours">
  <h3>Private China Tours for New Zealanders</h3>
  <p>...</p>
</section>

<section id="small-group">
  <h3>Small Group China Tours from NZ (Max 16 Travellers)</h3>
  <p>...</p>
</section>

<section id="airfare-included">
  <h3>China Tour Packages Including Airfare from NZ</h3>
  <p>...</p>
</section>
```

### FAQ Schema

```json
[
  {"q": "Do CTS tours include airfare from NZ?", "a": "..."},
  {"q": "What's the minimum group size for a private China tour?", "a": "..."},
  {"q": "Can I customise the itinerary?", "a": "..."},
  {"q": "How far in advance should I book?", "a": "..."},
  {"q": "What's included in the tour price?", "a": "..."}
]
```

### Internal links

加到 footer 区：
- Best of China — 15-Day Tour
- Beijing Tours from NZ
- Shanghai Tours from NZ
- Xi'an Terracotta Warriors Tour
- China Visa-Free Guide for Kiwis

---

## 改写 #5 · `/china-tours`

**当前问题**：第 36 位接 520 impressions，但 0 转化 — 严重的 title/meta 问题。

**改写策略**：**重写整页 SEO 元素**（不动文案大结构）。

**`<title>`**：
```
China Tours 2026/27 — From New Zealand | Beijing Xi'an Shanghai Guilin | CTS
```

**`<meta description>`**：
```
Compare 12+ China tours from NZ — small group, private, signature, discovery. Beijing, Xi'an, Shanghai, Guilin, Yunnan, Zhangjiajie. Free itinerary from NZ's China specialist since 1928.
```

**`<h1>`**：
```
China Tours from New Zealand — 12+ Itineraries Designed for Kiwis
```

---

## 改写顺序（PM 拍板）

建议按本文档顺序 1 → 5 改。预估总产能：

| Page | 改写工时 | 测试工时 | 总 |
|---|---|---|---|
| #1 visa-free blog | 2h | 0.5h | 2.5h |
| #2 visa-guide hub | 1.5h | 0.5h | 2h |
| #3 Best of China essentials | 3h | 1h | 4h |
| #4 china-tours-from-new-zealand | 2h | 0.5h | 2.5h |
| #5 china-tours | 2h | 0.5h | 2.5h |

**合计 ≈ 13.5h FDE 工时**（按 NZ FDE 时薪估，1.5-2 个工作日完成）。

---

## ⚠️ 共同硬性要求

- 所有 `<title>` 必须 ≤ 60 字
- 所有 `<meta description>` 必须 130-160 字
- 所有 `<h1>` 必须存在且只有 1 个
- 所有页必须有 `<link rel="canonical">`
- 所有页 H1/H2 必须包含主关键词
- 不允许在 title 用 `best` `#1` `guarantee` `cheapest`（Google policy 高风险）
- 不允许超链接堆叠（每页 internal links 控制在 5-15 条）
- 所有图片必须有 `alt` 描述（包含关键词）
