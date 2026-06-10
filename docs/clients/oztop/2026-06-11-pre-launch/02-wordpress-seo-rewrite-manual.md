# Oztop · WordPress 后台 SEO 改写手册（PM 可执行版）

> **执行人**：PM（不需开发能力 — 全在 WP 后台点击 + 粘贴）
> **预估工时**：6 个高 ROI 页 ≈ 5 小时 + 31 brand 页批量套模板 ≈ 8 小时 = **总共 13 小时**
> **预估 30 天 SEO 增益**：**+260 clicks/月**（约 +170% 站点流量）
> **依据**：`docs/clients/oztop/2026-06-11-keyword-gap/03-page-rewrites.md`（v1 改写设计）

---

## 0 · 前置准备（10 min）

### 0.1 · 确认 WP SEO plugin

登录 WP 后台 `https://www.oztopbuildingsupplies.com.au/wp-admin`

左侧菜单看：
- 如果有 **"Yoast SEO"** 菜单 → 走本手册 Yoast 流程
- 如果有 **"Rank Math"** 菜单 → 走本手册 RankMath 流程（操作 95% 相同）
- 如果都没有 → **先装 Yoast SEO**（免费版够用）：Plugins → Add New → 搜 "Yoast SEO" → Install + Activate

### 0.2 · 改写前备份

WP 后台 → Tools → Export（或者用 UpdraftPlus plugin） → 整站备份。**绝禁直接改 production 不备份**。

### 0.3 · 准备一份测试 + 上线流程

每个页改完先 **Preview** 不要直接 Update。Preview 确认无误 → 用 GTM Preview 模式确认 Schema markup 没坏 → 才点 Update。

---

## 1 · 改写 #1: `/tile-sizes-explained-...`（最高 ROI · 30 min）

### 1.1 · 找到这页

WP 后台 → Pages（或 Posts，看 Oztop 把它建在哪 — 推测在 Posts/Blog） → 搜 "Tile Sizes Explained" → 点 "Edit"

### 1.2 · 改 Yoast SEO Title

页编辑器底部 Yoast SEO box → **SEO title** 字段：

**粘贴**：
```
Tile Sizes Explained: 600x1200 vs 600x600 vs 300x600 mm Guide for Australian Homes
```

### 1.3 · 改 Yoast Meta Description

Yoast box → **Meta description** 字段：

**粘贴**：
```
Which tile size suits your bathroom or kitchen? Compare 600x1200mm, 600x600mm, 300x600mm, and 75x300mm tiles for floor and wall use. Brisbane tile specialist's complete guide.
```

### 1.4 · 改 H1（页内编辑器顶部）

WP 编辑器 → 找到当前 H1 → 改为：
```
Tile Sizes Explained — Choosing Between 600x1200, 600x600, 300x600 and 75x300 mm
```

### 1.5 · 加 6 个 H2 sub-sections

在页面内容末尾（CTA 之前）逐个加 H2：

```
## 600 x 1200 mm Tiles — Best for Large Floors and Feature Walls
[一段 80-120 字内容，描述 600x1200 适用场景：大型地面 / 浴室 feature wall / 现代厨房 backsplash. Brisbane homes 流行做法.]

## 600 x 600 mm Tiles — Versatile and Classic
[80-120 字]

## 300 x 600 mm Tiles — Perfect for Bathrooms
[80-120 字]

## 75 x 300 mm Tiles — Subway and Bathroom Wall Specialist
[80-120 字]

## Mixing Tile Sizes: 1200+600+300 Combinations
[80-120 字 — 这段抓 GSC 桶 D 大量数学搜索词]

## Brisbane Showroom: See All Sizes In Person
[CTA 文案：邀请来 Slacks Creek 看实物]
```

⚠️ 6 段正文每段 80-120 字，**不要凑字数**。每段必须有真实信息（尺寸 / 适用场景 / Brisbane 应用 / 价格区间提示）。

### 1.6 · 加 FAQ Schema（JSON-LD）

WP 编辑器 → 切换到 "Code editor"（右上角三点菜单）→ 找到 `</article>` 或文章结尾 → 在结尾前**粘贴**：

```html
<script type="application/ld+json">
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
</script>
```

切回 Visual editor → 应该看到 5 个 FAQ 在底部正常显示（Schema JSON 不显示是正常的，只对 Google 可见）

### 1.7 · 加 internal links

在文章中段（介绍完 4 种尺寸后），加：

```
For more on choosing the right tile finish, see our [Tile Finishes Guide](/tile-finishes-gloss-lappato-matt-and-grip-which-one-suits-your-style/).

Browse our complete [Porcelain Tiles](/product-category/tiles/porcelain-tiles/) range at the Slacks Creek showroom, or [book a free measure](/contact/) for your Brisbane bathroom renovation.
```

### 1.8 · 验证 + 上线

- WP 编辑器右上 **Preview** → 在新 tab 看实际渲染
- 看到 6 个 H2 + 5 个 FAQ（FAQ 会作为正常文字显示，schema 只对 Google 可见）
- 没问题 → 点 **Update** 发布
- **验证 Schema**：去 https://search.google.com/test/rich-results 粘贴页面 URL → 看到 "FAQPage" 绿勾 ✅

### 1.9 · Google Search Console 手动 fetch

- 进 GSC → URL Inspection → 输入 `https://www.oztopbuildingsupplies.com.au/tile-sizes-explained-...`
- 点 "Request indexing" → Google 1-7 天内重新爬

---

## 2 · 改写 #2: `/product-category/flooring/spc-wpc-hybrid-flooring/`（致命修复 · 50 min）

### 2.1 · 找到这页

WP 后台 → WooCommerce → Products → Categories → 找 "SPC WPC Hybrid Flooring" → Edit

### 2.2 · audit 当前状态

⚠️ 这页排第 49 — 必须先排查为什么这么差。打开 Chrome DevTools：
1. 访问 `/product-category/flooring/spc-wpc-hybrid-flooring/`
2. F12 → Elements → Ctrl+F 搜：
   - `<title>` — 当前是什么？
   - `<meta name="description">` — 当前是什么？
   - `<link rel="canonical">` — **重点检查 — 如果指错地方，这就是排第 49 的原因**
   - `<h1>` — 几个？理想是只有 1 个

把当前值**截图存档**，跟改写后对比。

### 2.3 · 改 Yoast SEO Title

Category Edit 页 → Yoast SEO box → **SEO title**：
```
SPC Hybrid Flooring Brisbane | Waterproof, Pet-Friendly | Oztop Building Supplies
```

### 2.4 · 改 Yoast Meta Description

```
Premium SPC and WPC hybrid flooring at Oztop's Brisbane showroom. Waterproof, pet-friendly, kid-proof. 6.5mm, 8mm, 10.5mm options. Free measure across Brisbane + Logan.
```

### 2.5 · 改 H1

Category description（页顶 banner 文字）→ 编辑器顶部加：

```html
<h1>SPC & WPC Hybrid Flooring Brisbane — Waterproof, Premium, Pet-Friendly</h1>
```

### 2.6 · 加 Category description（H2 section）

在 H1 下加 5 个 H2 + 介绍内容：

```
## What is Hybrid Flooring?
[80-150 字]

## SPC vs WPC: Which Hybrid Suits Brisbane Homes?
[80-150 字]

## Hybrid Flooring Thickness: 6.5mm vs 8mm vs 10.5mm
[80-150 字 + 链接到 3 个子类目页]

## Authorised Hybrid Brands at Oztop
[列出 Preference Floors / NFD / Big Panda Flooring 链接到 brand 页]

## Visit Our Slacks Creek Showroom
[CTA + 地址 + 营业时间]
```

### 2.7 · canonical 修复

如果 Step 2.2 发现 canonical 指错（比如指到 `/product-category/flooring/` 或者首页）→ 这就是排第 49 的真正原因。

Yoast SEO box → **Advanced** → **Canonical URL** 字段 → 粘贴：
```
https://www.oztopbuildingsupplies.com.au/product-category/flooring/spc-wpc-hybrid-flooring/
```

⚠️ 这步**最重要**。canonical 修对 → 30 天内排名从 49 升到 25-30 位 = +50 clicks/月。

### 2.8 · 加 Product Schema

Yoast SEO box → Schema → Article type → 改为 **WebPage**

或者用 Code editor 粘贴：

```html
<script type="application/ld+json">
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
</script>
```

### 2.9 · Update + GSC fetch

同 Step 1.8 + 1.9。

---

## 3 · 改写 #3-5: Brand 页 Preference Floors / NFD / KDK（每页 25 min · 共 1.5 h）

### 3.1 · 通用模板（先在文档里把 3 页的内容准备好）

#### Preference Floors

| 字段 | 值 |
|---|---|
| SEO title | `Preference Floors Brisbane | Authorised Dealer | Oztop Building Supplies` |
| Meta description | `Shop Preference Floors hybrid and engineered timber at Oztop's Slacks Creek showroom. Authorised Brisbane dealer. Free measure + expert advice for Queensland homes.` |
| H1 | `Preference Floors — Authorised Brisbane Dealer` |
| Sub-heading | `Shop the full Preference Floors hybrid + engineered timber range at Oztop Building Supplies, Slacks Creek QLD` |
| Internal links | Eclipse / Eleanor / Antalya 子产品页 + spc-wpc-hybrid-flooring 母类 |

#### NFD

| 字段 | 值 |
|---|---|
| SEO title | `NFD Flooring Brisbane | Authorised Dealer | Oztop Building Supplies` |
| Meta description | `Shop NFD engineered timber and hybrid flooring at Oztop's Brisbane showroom. Authorised dealer. Free measure across Brisbane + Logan. Visit Slacks Creek.` |
| H1 | `NFD — Authorised Brisbane Dealer` |
| Sub-heading | `Premium NFD engineered timber + hybrid range available at Oztop Building Supplies` |

#### KDK 🔥（特别关注 — kdk bathroom 月搜 390）

| 字段 | 值 |
|---|---|
| SEO title | `KDK Bathroom & Fans Brisbane | Authorised Dealer | Oztop Building Supplies` |
| Meta description | `Shop KDK exhaust fans, bathroom accessories at Oztop's Slacks Creek showroom. Authorised Brisbane KDK dealer. Free quote + expert advice for bathroom renovations.` |
| H1 | `KDK Bathroom — Authorised Brisbane Dealer` |
| Sub-heading | `Premium KDK exhaust fans, ventilation, and bathroom accessories for Queensland homes` |
| 加 H2 重点 | "KDK Bathroom Fans Brisbane Installation" / "Why KDK for Queensland Bathrooms" |

### 3.2 · 操作步骤（每个 brand 页）

1. WP 后台 → Products → Brands（如果用 PWB Brands plugin）或 Categories
2. 找对应 brand → Edit
3. 粘贴 Step 3.1 的 4 个字段
4. 加 brand description（H2 section 至少 200 字）
5. 加 internal links 到该 brand 的产品页 + 相关 product-category
6. Save / Update
7. GSC fetch

---

## 4 · 改写 #6: `/tile-finishes-gloss-lappato-matt-and-grip-...`（30 min）

跟 Step 1 同模式：

| 字段 | 值 |
|---|---|
| SEO title | `Tile Finishes Explained: Gloss, Lappato, Matt, Grip — Which Suits Your Home?` |
| Meta description | `Choose between gloss, lappato, matt, and grip tile finishes for your Brisbane bathroom, kitchen, or outdoor area. Visual + practical comparison. Visit Slacks Creek.` |
| H1 | `Tile Finishes Guide — Gloss vs Lappato vs Matt vs Grip` |

加 4 个 H2（每种 finish 一个）+ 视觉对比 gallery + FAQ Schema（5 个 Q）

---

## 5 · 批量改造 31 个 brand 页（套模板 · 8 h）

### 5.1 · 通用模板

每个 brand 页用同一份模板替换：

```
SEO title:        {Brand Name} Brisbane | Authorised Dealer | Oztop Building Supplies
Meta description: Shop {Brand Name} {category} at Oztop's Slacks Creek showroom. Premium {category} for Queensland homes. Free measure + expert advice. Visit us in Brisbane.
H1:               {Brand Name} — Authorised Brisbane Dealer
Sub-heading:      Shop the full {Brand Name} range at Oztop Building Supplies, Slacks Creek QLD
```

### 5.2 · 31 个 brand 的 category 速查表

| Brand | Category | 已在 Top Pages? |
|---|---|---|
| Big Panda Flooring | hybrid flooring | ✅ #3 流量页 |
| Preference Floors | hybrid + engineered | 改写 #3 |
| NFD | engineered timber + hybrid | 改写 #4 |
| KDK | bathroom fans + ventilation | 改写 #5 |
| Karndean | LVT vinyl flooring | 桶 D |
| Covey | flooring | |
| Tile One | tiles | |
| ArtiFloor | flooring | |
| QEP | tile tools / adhesives | |
| Polyflor | commercial vinyl | |
| Sunstar | flooring | |
| Complete Floors | flooring | |
| Stoneworld | natural stone | |
| Godfrey Hirst | carpet | |
| Brewers | carpet | |
| Feltex | carpet | |
| Mapei | adhesives + sealants | |
| Advantage Flooring | flooring | |
| Redbook Carpets | carpet | 桶 D |
| Norico | bathware | |
| Dunlop Flooring | underlay + flooring | |
| Fienza | bathware | |
| Simseal | sealants | |
| Clever Choice | flooring | |
| Caroma | bathware | 桶 D |
| Lauxes Grates | drains + grates | 桶 D |
| Everstone | natural stone | |
| DIY Tiles | tiles | 桶 D |
| Damtec | underlay | |
| Bremworth | premium carpet | |

### 5.3 · 操作节奏

按 brand 页接近 5-10 min/页（套模板 + 写 200 字 brand description）：
- 31 brand × 10 min = 5.2 h
- + GSC fetch 31 个 = 1 h
- + Schema 验证 + 修复 = 1.8 h
- 合计 8 h

**分批做**：每天 6-7 个 brand 页，5 个工作日完成。

---

## 6 · 改写后期回查（30 天后）

改完后 30 天，在 GSC 看：

| Page | 当前 28d clicks | 目标 30d clicks (改写后) |
|---|---|---|
| /tile-sizes-explained | 24 | 80+ |
| /spc-wpc-hybrid-flooring | 1 | 30+ |
| /brand/preference-floors | 0 | 15+ |
| /brand/nfd | 1 | 10+ |
| /brand/kdk | 0 | 15+ |
| /tile-finishes | 1 | 10+ |
| 31 brand 页合计 | ~10 | 80+ |

如果某页 30 天 < 5 clicks → 进 SOP Step 1 桶 D 下一轮（参考 `docs/sops/keyword-gap-attack-playbook.md`）

---

## 7 · 验证 PM 改完后没踩坑

每改完一页，PM 自己快速 4 步检查：

- [ ] **Rich Results Test**：`https://search.google.com/test/rich-results` → 粘贴 URL → 看到 FAQPage / ProductGroup 绿勾
- [ ] **Yoast SEO 分**：page edit 页 Yoast box 显示绿色 SEO score（不要红 / 橙）
- [ ] **页面真实渲染**：Preview 看 H1 / H2 / 内容齐全
- [ ] **GSC URL Inspection**：Request indexing 后等 Google 爬

---

## 8 · 如果 PM 自己改不动怎么办

**选项 A**：把本手册 + 6 个高 ROI 页 OK 后，剩 31 brand 页交给 FDE
**选项 B**：用 Codex 调用 WP REST API 批量改 brand 页（需 WP REST API 开 + admin token）
**选项 C**：留 31 brand 页给下一轮 SEO 优化，**Day 1 先改 6 个高 ROI 页**就够上 Ads

---

## 9 · 跟 CTS 改写方式的关键差异

| 维度 | CTS（Next.js）| Oztop（WordPress）|
|---|---|---|
| 改写位置 | git 仓 `src/app/<route>/page.tsx` | WP 后台 Pages/Products → Yoast SEO box |
| 部署方式 | git commit → push → Render auto-deploy | WP 后台 Update 即生效 |
| Schema 注入 | metadata export in page.tsx | WP 编辑器 Code editor 粘贴 `<script>` |
| 版本控制 | git 历史 | WP Revisions（每次 Update 自动存版本）|
| 协作能力 | Claude Code 可代改 | PM 手动 / FDE / 或 Codex 调 WP REST API |

---

**PM 下一步**：

1. 先完成 Step 0（确认 SEO plugin + 备份）
2. 改写 6 个高 ROI 页（Step 1-4 + Step 6）≈ 4 小时
3. 跟 `01-conversion-tracking-sop.md` **并行做**
4. 完成后回来报：每个页改完截图 + GSC inspect 结果
5. 31 brand 页等 6 高 ROI 页改完后再决定（自己改 / 交 FDE / 给 Codex）
