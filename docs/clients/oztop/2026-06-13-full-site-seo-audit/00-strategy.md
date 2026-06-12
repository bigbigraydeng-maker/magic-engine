# Oztop 全站 SEO 结构审计 + 8 块优化执行包

> 起草:子牙(本窗口)
> 日期:2026-06-13 NZST(03:50 完成博客 #2 #4 上线后接续)
> 数据基础:GSC 28 天 (148 clicks / 6,775 impressions / 平均位 18.9) + 主页 HTML 抓取 + sitemap_index + robots.txt + 6/11 keyword-gap 调研
> 触发:PM "我们现在开始看他网站整体的 seo 结构有什么优化空间"
> 关联 Kanban:8 张新卡

---

## 一、审计结论一句话

**Oztop 站底层是健康的(Yoast/sitemap/robots 都正确)**,但有 2 个战略级缺口和 6 个执行级缺口导致 28 天只能拿 148 点击。**全部修完预估 6 个月 +300% 流量**(目标 600 点击/月,目前 148)。

## 二、6/11 调研 vs 今晚审计差异

6/11 调研聚焦"keyword gap + 落地页改写"。今晚审计聚焦"全站架构 + 技术 SEO"。**互补**,无冲突。

| 维度 | 6/11 已覆盖 | 今晚新增 |
|---|---|---|
| 落地页改写 (6 页) | ✅ | — |
| brand 页模板 | ✅ | 🆕 双轨 URL 问题 |
| 内容缺口 (6 篇 blog) | ✅ | — |
| 全站架构 | ❌ | 🆕 |
| 技术 SEO (sitemap/robots) | ❌ | 🆕 (审完无问题) |
| LocalBusiness Schema | ❌ | 🆕 战略级 |
| 主页 H1 + Hero | ❌ | 🆕 |
| Breadcrumb / Schema 全站覆盖 | ❌ | 🆕 |

---

## 三、8 块优化全清单(按 ROI 排)

### 🥇 块 1: 修 `/brand/` vs `/brands/` 双轨 (最高 ROI, 全站受益)

**问题证据**(GSC 28 天真实数据):
| URL | Position | Clicks | Impressions |
|---|---|---|---|
| `/brand/bigpandaflooring/` | 6.2 | 6 | 281 |
| `/brands/bigpandaflooring/` | 10.6 | 4 | 36 |

同品牌两个 URL → Google 权重对半 → 31 brand 全被影响。

**修复方案**:
1. 主导航/footer 统一改成 `/brand/` (短的胜出)
2. WP `.htaccess` 加 301 redirect:
   ```apache
   RewriteRule ^brands/(.+)$ /brand/$1 [R=301,L]
   ```
3. 31 brand 页全审查内链,把所有 `/brands/X/` 改成 `/brand/X/`
4. Yoast canonical 指 `/brand/` 版本
5. 提交 GSC URL Inspection 跑一遍触发重爬

**工时**:2h
**ROI**:整站 brand 词排名 +3-5 位(31 页同时受益)
**风险**:301 redirect 配置错可能造成 404 — 建议改前备份 `.htaccess`

---

### 🥈 块 2: 救 SPC/Hybrid 主线产品页 (排第 49 → 第 1 页)

**问题证据**:
| URL | Position | Impressions | Clicks |
|---|---|---|---|
| `/product-category/flooring/spc-wpc-hybrid-flooring/` | **48.7** | 411 | 1 |

SPC 是 Oztop 主线产品,曝光 411 但排名第 49 = Google 第 5 页 = 几乎隐形。

**修复 SOP**:
1. 改 H1(当前可能是 `SPC WPC Hybrid Flooring` 一类干瘪标题):
   ```
   SPC Hybrid Flooring Brisbane — 6.5mm, 8mm, 10mm Waterproof Options at Oztop
   ```
2. Yoast SEO Title (54 chars):
   ```
   SPC Hybrid Flooring Brisbane | 6.5mm 8mm 10mm | Oztop
   ```
3. Yoast Meta Description (155 chars):
   ```
   Browse Brisbane's range of SPC hybrid flooring at Oztop. Waterproof 6.5mm, 8mm, and 10mm options for pets, kids, and wet areas. Free measure in Slacks Creek.
   ```
4. 加 200 字 category intro (放在 product grid 之前):
   - 解释 SPC 是什么 (stone plastic composite)
   - 解释 6.5/8/10mm 的差异
   - 谁适合 (pet owners / wet areas / commercial)
   - Brisbane specific (climate, humidity)
   - 内链:link 到具体 6-5mm / 8mm sub-category 页 + Pet flooring blog (#5 那篇)
5. 加 BreadcrumbList JSON-LD
6. 加 CollectionPage Schema (WooCommerce Yoast 应该已默认输出)
7. 给页面加 5+ 内部链接(指向 brand 页 / blog / 6.5mm sub)
8. GSC URL Inspection → Request Indexing

**工时**:5h
**ROI**:+50 clicks/月 + Ads 质量分上升(降 CPC 20-30%)
**Phase 12.J A6/A7 修后**:此页可全 ME 自动改写

---

### 🥉 块 3: 主页 H1 + Hero + LocalBusiness Schema

**问题证据**:
- 当前 H1:`Flooring Specialist and a lot more` (无地理 / 无关键词)
- GSC 主页热搜:`oztop building supplies` (132 imp / 35 clicks) / `building supplies near me` (3 imp 1 click)
- 主页没有 LocalBusiness Schema (验证:`view-source` grep `application/ld+json` 看是否有 `@type":"LocalBusiness"`)

**修复方案**:

A. **H1 + Hero text**:
```
Brisbane Flooring, Tiles & Bathroom Specialist
Servicing Logan, Slacks Creek and Greater Brisbane since 2015
```

B. **加 LocalBusiness JSON-LD**(放主页 `<head>` 或 footer template):
```json
{
  "@context": "https://schema.org",
  "@type": "HomeAndConstructionBusiness",
  "name": "Oztop Building Supplies",
  "image": "https://oztopbuildingsupplies.com.au/logo.png",
  "@id": "https://oztopbuildingsupplies.com.au/",
  "url": "https://oztopbuildingsupplies.com.au/",
  "telephone": "+61-7-3416-6458",
  "email": "info@oztopbuildingsupplies.com.au",
  "priceRange": "$$",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "5 Judds Ct",
    "addressLocality": "Slacks Creek",
    "addressRegion": "QLD",
    "postalCode": "4127",
    "addressCountry": "AU"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": -27.6489,
    "longitude": 153.1383
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"],
      "opens": "09:00",
      "closes": "17:00"
    },
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": "Saturday",
      "opens": "09:00",
      "closes": "16:00"
    }
  ],
  "sameAs": [
    "https://www.facebook.com/oztopbuildingsupplies",
    "https://www.instagram.com/oztopbuildingsupplies"
  ]
}
```
(经纬度需用 Google Maps 取真实坐标)

C. **加 Hero CTA**:
- "Book Free Brisbane Measure" 按钮
- "Visit Slacks Creek Showroom" 按钮

**工时**:3h
**ROI**:抢 Google Map 3-pack (本地搜索结果顶部 3 个 = 客户进店最高效路径)
**配合**:Google Business Profile 同步 NAP (PM 应该已在做,GBP.0 等审批中)

---

### 块 4: `/tile-sizes-explained` 升级成 informational hub

**问题证据**:
- GSC 显示 100+ 个 tile size 计算词 (`1200x600` / `600x1200` / `300x600` 等) impression 200+ 但点击 0
- 当前页排第 7,CTR 1.9%(今晚 PM 已手工修 title + FAQ)

**升级 SOP**:
1. 已修 Yoast title + meta + FAQ Schema ✅
2. 新增 6 个 H3 sub-section:
   - `## 600 x 1200 mm Tiles — Best for Large Floors and Feature Walls`
   - `## 600 x 600 mm Tiles — Versatile and Classic`
   - `## 300 x 600 mm Tiles — Perfect for Bathrooms`
   - `## 75 x 300 mm Tiles — Subway and Bathroom Wall Specialist`
   - `## Mixing Tile Sizes: 1200+600+300 Combinations`
   - `## Tile Calculator: How Many Tiles Do I Need?`
3. 每个 sub-section 内链到产品页(eg 600x1200 → `/product-category/tiles/600x1200-tiles/`)
4. 加 1 张 chart "Tile Size Visual Comparison"

**工时**:4h(Phase 12.J A6 修后可 ME 自动改写)
**ROI**:+80 clicks/月(把 100+ 间接词抓住)

---

### 块 5: 整站 H1 audit + 加地理信号

**问题证据**:
- 主页 H1 `Flooring Specialist and a lot more` — 无地理无关键词
- 31 brand 页 H1 大概率是 `{Brand} - Oztop Building Supplies` — 无地理
- Product category 页同样问题

**修复**:
1. 跑全站 sitemap → 提取所有 H1 → 表格化
2. 按地理信号缺失程度分级 (Brisbane / Slacks Creek / Logan / QLD)
3. 模板化补全:
   - Brand 页:`{Brand} Flooring Brisbane | Authorised {Brand} Stockist at Oztop`
   - Product Category:`{Category} Brisbane | Browse {Subcategory} at Oztop`
   - Product:`{Product Name} — {Category} | Available at Oztop Slacks Creek`

**工时**:6h(20 页 H1 改写 + 内链调整)
**ROI**:+30 clicks/月

---

### 块 6: 31 brand 页批量加地理后缀 + brand schema

**问题证据**(GSC):
| Brand URL | Position | Imp | Clicks |
|---|---|---|---|
| `/brand/diytiles/` | 30.4 | 122 | 0 |
| `/brand/lauxes-grates/` | 34.7 | 75 | 0 |
| `/brand/redbook-carpets/` | 12.6 | 109 | 0 |
| `/brand/karndean/` | 43.9 | 33 | 0 |
| `/brand/preference-floors/` | 26.6 | 36 | 0 |

11 个 brand 页 0 点击但有曝光 → 排名在 12-44 位之间 → 模板优化能起量。

**修复模板**(适用 31 个 brand 页):
```html
<h1>{Brand} {Product Category} Brisbane — Authorised {Brand} Stockist at Oztop</h1>
<p>Looking for {Brand} {category} in Brisbane? Oztop Building Supplies is your authorised {Brand} stockist serving Logan, Slacks Creek and Greater Brisbane.</p>

<h2>About {Brand}</h2>
<p>...(brand history + speciality + why Aussie homes choose them)...</p>

<h2>{Brand} {Category} Range at Oztop</h2>
<!-- product grid -->

<h2>Why Choose {Brand} for Queensland Homes?</h2>
<ul>
  <li>Performs in Brisbane's subtropical humidity</li>
  <li>...</li>
</ul>

<h2>Pricing & Free Brisbane Measure</h2>
<p>Visit Oztop's Slacks Creek showroom or book a free measure on 07 3416 6458.</p>

<!-- BreadcrumbList JSON-LD -->
<!-- Brand JSON-LD with sameAs to brand's official site -->
```

**工时**:9h (Codex 用模板批量改 + 5 个高优先级人工 polish)
**优先级**:Preference / NFD / KDK / Karndean / BigPanda 这 5 个先做
**ROI**:+60 clicks/月

---

### 块 7: `/blog/` 主页改成 hub

**问题证据**:`/blog/` 主页 7 impressions 0 clicks (近乎没流量,但是用户进入博客内容的入口)

**修复**:
1. 改成 category 分组的 hub:
   - `Flooring Guides`(SPC / Engineered Timber / Vinyl)
   - `Bathroom & Tiles`(tile sizes / bathware / showers)
   - `Pet & Family`(pet flooring / 今晚发的 3 篇都归这)
   - `Brisbane Renovation`(Walnut clearance / cost guides)
2. Featured posts (4-6 篇高质量)
3. 加 BlogPosting list schema
4. Sidebar:Latest posts / Most popular / FAQ link

**工时**:4h
**ROI**:+20 clicks/月 + 大幅提升内链权重传导

---

### 块 8: 加 BreadcrumbList + Product schema 全站覆盖

**问题证据**:主页 HTML 没看到 breadcrumb,product schema 应该靠 Yoast WooCommerce 默认输出但需验证。

**修复**:
1. 全站启用 Yoast Breadcrumb (Customizer → Yoast → Breadcrumbs → Enable)
2. Footer template 加 BreadcrumbList JSON-LD fallback
3. 验证 Product Schema 输出:跑 Schema.org validator on 一个 product 页
4. 检查 `priceCurrency: AUD` / `availability: InStock` / `aggregateRating` 等字段是否完整

**工时**:5h
**ROI**:全站 CTR +15-20%(富文本搜索结果带价格/评分/breadcrumb)

---

## 四、实施顺序建议

按依赖关系排:

| 周 | 块 | 累计预估增益 |
|---|---|---|
| 本周(本)| 块 1(brand 双轨)+ 块 3(LocalBusiness Schema)+ 块 2(SPC 救命)| +100 clicks/月,Map 3-pack |
| 下周 | 块 4(tile-sizes hub)+ 块 8(Breadcrumb/schema 全站)| +130 clicks/月 |
| 第 3 周 | 块 5(H1 audit)+ 块 6(brand 31 页) | +200 clicks/月 |
| 第 4 周 | 块 7(blog hub)| +20 clicks/月 + 内链 |

**总 30 天预估**:148 → 450+ clicks/月 (~+200%)

---

## 五、依赖 Phase 12.J 修复的项

| 块 | 依赖 |
|---|---|
| 块 2(SPC 改写)| Phase 12.J A6 修后可 ME 自动改写 |
| 块 4(tile-sizes 升级)| 同上 |
| 块 5(H1 audit)| 同上,可批量 |
| 块 6(31 brand 页)| **强依赖 A6**(31 页全手工不现实) |

→ Phase 12.J A6/A7 修复在明天开发是**全站 SEO 优化的关键路径**。

---

## 六、配套动作(非代码)

1. Oztop FDE 联系 SiteGround 客服豁免 `/wp-json/*`(Phase 12.J BLOCKER 的客户端配合)
2. Google Business Profile 同步 NAP(GBP.0 等审批)
3. GSC 持续监控,每周看 top_pages 变化
