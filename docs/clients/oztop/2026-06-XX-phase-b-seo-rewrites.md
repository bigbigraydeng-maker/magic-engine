# Oztop · Phase B · 10 张 SEO 改写卡(可执行 spec)

> **来源**:本仓库 Phase A.2 SEO 诊断 5 查询(2026-06-21 跑)。
> **执行工具**:ME Page Rewriter(`/dashboard/clients/[id]/page-rewriter`,PR #475)。
> **执行人**:FDE(或子牙通过 admin MCP)。
> **预期**:全 10 卡执行 + 4 周 GSC 数据回流后,Oztop 月度 clicks 从 140 → **300-450**(目标 ×2-3),avg position 从 21.5 → 13-15。
>
> **客户 ID**:`d5c98811-1c1d-4ded-bdf0-4cefec6afb84`
> **域名**:`oztopbuildingsupplies.com.au`
> **行业**:flooring / carpet / tiles / bathware retail + 咨询 + 安装(Brisbane)

---

## 🚨 0 号阻塞 — 必须先解(否则 Page Rewriter 调不通)

ME 服务器 IP `74.220.48.245` 被 Oztop SiteGround anti-bot 拦,所有 `/wp-json/*` 请求 redirect 到 `sgcaptcha` 页。SiteGround 官方 AI 确认**永久 IP 白名单不可用**,只能走 ticket。

**前置 SOP**(PM 已 Z3 路径执行中):见 [`siteground-ticket-template.md`](#) — 等 SiteGround human support 回复给 IP reputation review 或 plan-level allowlist 路径,**才能**开始执行下面 10 卡。

期间 FDE 可手工在 WP admin 改(下面 spec 一字不差能照搬到 Yoast 字段)。

---

## 📊 全站现状一句话

GSC 28 天(5/23–6/20)= **140 clicks / 7,233 imps / CTR 1.94% / avg pos 21.47**。流量构成:
- 60% 品牌词(oztop building supplies 38 clicks + oztop 15 + 变体)
- 23% **tile-sizes-explained 单页**(16 clicks / 1071 imps / **CTR 仅 1.49%** — 因为意图错位,大量 "1200x600 数学题"垃圾流量稀释)
- 主营 SPC/Hybrid 主品类页排到 **pos 50.3** 拿不到 commercial 流量

诊断主因:**131 张页 全部 0 meta_description** + 大量主品类 + brand landing 页 SEO title 是 WooCommerce 默认 "X Archives"。

---

## 卡 #1 · `/tile-sizes-explained-…` — Hero 流量页 CTR 抢救

### 现状

| 字段 | 值 |
|---|---|
| URL | `https://oztopbuildingsupplies.com.au/tile-sizes-explained-how-to-choose-between-600x1200-600x600-300x600-and-75x300-mm-for-your-space/` |
| GSC 28 天 | **1071 imps / 16 clicks / CTR 1.49% / pos 7.3** |
| 当前 SEO title | (FDE pull from WP / 大概率是文章 H1 + " - Oztop Building Supplies") |
| 当前 meta description | **空** |
| word_count | ~1,200(blog post,质量 OK) |
| 命中 query | "600 x 1200", "1200 600", "600x1200 mm" 等 30+ 尺寸数学题(用户在算数,非买家) |

### 改写 spec

```yaml
seoTitle: |
  Tile Sizes Explained: 600x1200, 600x600, 300x600 — Brisbane Buyer's Guide | Oztop
metaDescription: |
  Pick the right tile size for your bathroom, kitchen or outdoor project.
  Brisbane showroom stocks 600x1200, 600x600, 300x600, 75x300 mm and more
  — free measure & quote in 1 business day. Includes sizing calculator.
focusKeyphrase: tile sizes brisbane
```

### 改完后还要做(内容侧,1h)

在文章正文末尾加一个 **「Tile size calculator」widget**(简单 JS — 用户输入房间 m² + tile 尺寸 → 算需多少块 + 含损耗 10%)。这一步把"算数学的用户"留下变 lead,不是让他跳出。

或者**第二选择**:在文章顶部加一个 hero CTA "Need a measure? Free Brisbane site visit" → 链 `/quote/`(我们刚做的 LP)。

### 预期

- pos 7.3 不会变(已经够高),但 **CTR 1.49% → 4-5%**(pos 7 应有 6% CTR,我们改 title 含 "Brisbane Buyer's Guide" + "Calculator" 增吸引力)
- 增 clicks ≈ **+27-37 clicks/月**(从 16 → 43-53)
- 副效应:加 calculator 后转化率上升,可能拿 5-10 个 lead/月

### 验证

```sql
-- 1 周后跑
SELECT period_end, (top_pages->0->>'clicks')::int AS top1_clicks
FROM gsc_performance_snapshots
WHERE client_id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
ORDER BY period_end DESC LIMIT 4;
```

---

## 卡 #2 · `/product-category/flooring/spc-wpc-hybrid-flooring/` — 主营品类抢救

### 现状

| 字段 | 值 |
|---|---|
| URL | `https://oztopbuildingsupplies.com.au/product-category/flooring/spc-wpc-hybrid-flooring/` |
| GSC 28 天 | **543 imps / 3 clicks / CTR 0.55% / pos 50.3** ⚠️ 第 5 页 |
| 当前 SEO title | "Hybrid Flooring Archives" (WooCommerce 默认) |
| 当前 H1 | 估 "Hybrid Flooring" 单词 |
| 当前 meta | 空 |
| word_count | 895(够,但全是产品 grid + 1-2 句话) |

### 改写 spec

```yaml
seoTitle: |
  SPC Hybrid Flooring Brisbane — Waterproof, In-Stock | Oztop Building Supplies
metaDescription: |
  Brisbane's specialist for SPC and hybrid flooring — 6.5mm, 8mm, 10.5mm
  in stock. Waterproof, pet-friendly, click-lock. Free measure & quote
  in 1 business day. Slacks Creek showroom + Australia-wide delivery.
focusKeyphrase: spc hybrid flooring brisbane
```

### 改完后还要做(内容侧,2h)

WooCommerce 分类页通常只有产品 grid 没文字。需要在 grid 上方加 **200-300 字 intro** + **FAQ section**(4-6 个 Q&A):
- "What's the difference between SPC, WPC and hybrid flooring?"
- "Which thickness should I choose: 6.5mm vs 8mm vs 10.5mm?"
- "Is hybrid flooring waterproof?"
- "How much does SPC hybrid flooring cost per m² in Brisbane?"
- "Can SPC be installed over tiles or concrete?"
- "Do you offer installation in Brisbane?"

FAQ 用 Yoast FAQ schema 包(Page Rewriter 的 `faq_schema` 字段直接传)。

加内链:
- **从首页** "Products" section 加链到此页(锚文本"SPC Hybrid Flooring")
- **从 `/brands/`** 加链
- **从 `/brand/bigpandaflooring/`** 加链(big panda 是主推 SPC 品牌)

### 预期

- pos 50.3 → **20-25**(改 title + content 加 50-80% 更新信号,+local intent "brisbane",+ FAQ schema 拿 rich snippet)
- imps 翻倍(543 → 1000+) → clicks +15-25/月

### 验证

```sql
-- 4 周后跑
SELECT period_end, (
  SELECT (p->>'position')::numeric FROM jsonb_array_elements(top_pages) p
  WHERE p->>'page' = 'https://oztopbuildingsupplies.com.au/product-category/flooring/spc-wpc-hybrid-flooring/'
) AS pos
FROM gsc_performance_snapshots
WHERE client_id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
ORDER BY period_end DESC LIMIT 4;
```

---

## 卡 #3 · `/` 首页 — 拿非品牌通用 + local 长尾

### 现状

| 字段 | 值 |
|---|---|
| GSC 28 天 | **991 imps / 88 clicks / CTR 8.88% / pos 13.8** |
| 当前 SEO title | "Flooring, Carpet, Tiles & Bathroom Renovation" (无 brand + 无 local) |
| 当前 meta | 空 |
| 命中 query | 90% 是品牌词("oztop building supplies" pos 1.5 / "oztop" pos 4.15 / "oz top" / "oz flooring" 等) |

### 为什么 pos 13.8 但 CTR 8.88% 看起来"正常"

品牌词在前几位,非品牌词在 30-50 位拉低 avg。88 clicks 几乎全是品牌词成果。**机会 = 拿非品牌通用 + local**。

### 改写 spec

```yaml
seoTitle: |
  Oztop Building Supplies — Brisbane Flooring, Carpet, Tiles & Bathware
metaDescription: |
  Brisbane's one-stop building supplies specialist. SPC & hybrid flooring,
  wool & nylon carpet, porcelain tiles, bathware. Slacks Creek showroom.
  Free measure & quote in 1 business day. Trade & retail welcome.
focusKeyphrase: building supplies brisbane
```

### 改完后还要做(0 — 首页改 title/meta 就够)

### 预期

- pos 13.8 → **8-10**(改 title 含核心 "Brisbane" 地域信号)
- 非品牌 imps 增长 30-50%
- 增 clicks ≈ **+15-25/月**(全是非品牌新流量)
- 副效应:品牌词 pos 1.5 不会变,品牌流量不丢

### 验证

同卡 #2(查首页在 top_pages 里的 pos)。

---

## 卡 #4 · 新建 `/brand/karndean/` — Brand landing 拿 1000 vol 词

### 现状

| 字段 | 值 |
|---|---|
| Keyword `karndean` | **vol 1000 / pos 20 / informational intent / CPC $0.51** |
| 有页吗? | 需 FDE 检查 oztopbuildingsupplies.com.au/brand/karndean/ 是否 200 |
| 既有 brand pages | /brand/bigpandaflooring (pos 6.2 ✓) / /brand/advantageflooring (pos 7.9 ✓) /brand/diytiles / /brand/lauxes-grates / /brand/redbook-carpets / /brand/caroma — 看到 6 个,**`karndean` brand 页可能不存在** |

### 操作分两种情况

**情况 A · `/brand/karndean/` 已存在**:走改写流程
```yaml
seoTitle: |
  Karndean Flooring Brisbane — Authorised Stockist | Oztop Building Supplies
metaDescription: |
  Karndean luxury vinyl flooring in stock at Oztop's Brisbane showroom.
  LooseLay Longboard, Korlok, Knight Tile and more. Free measure & quote
  in 1 business day. Slacks Creek + Australia-wide delivery.
focusKeyphrase: karndean flooring brisbane
```

**情况 B · `/brand/karndean/` 不存在**(更可能):FDE **新建** brand landing page
- Title: "Karndean Flooring Brisbane"
- H1: "Karndean Luxury Vinyl Flooring — Authorised Stockist in Brisbane"
- Content: 800-1200 字
  - Karndean brand 简介(从 Karndean 官网拉品牌故事)
  - Oztop 现货 ranges 列表(LooseLay / Korlok / Knight Tile / Da Vinci 等)
  - 适合人群(LVT vs SPC vs timber 比较)
  - Brisbane 安装服务介绍
  - FAQ 4-6 条
- Internal links:
  - 链到 /product-category/flooring/vinyl-flooring/
  - 链到首页
- FAQ schema(Yoast)

### 预期

- 情况 A: pos 20 → **8-12** = +30-50 clicks/月(vol 1000)
- 情况 B: 0 → pos 15-25(新页),3-6 个月后 pos 8-12 = +30-40 clicks/月

### 验证

```sql
-- 4 周后,需要 keyword_snapshots 重新跑(目前只 6/4 一天数据)
SELECT keyword, position, snapshot_date
FROM keyword_snapshots
WHERE client_id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
  AND keyword = 'karndean'
ORDER BY snapshot_date DESC LIMIT 5;
```

---

## 卡 #5 · 新建 `/brand/nfd/` (或 `/brand/nfd-flooring/`) — 880+720 vol 双词

### 现状

| Keyword | Pos | Vol | Intent | CPC |
|---|---|---|---|---|
| `nfd` | 22 | **880** | transactional | $3.42 |
| `nfd flooring` | 21 | 720 | commercial | $2.67 |
| `nfd sunvista` | 17 | 40 | informational | n/a |
| `sunvista vinyl planks` | 24 | 70 | commercial | $2.04 |

合计 monthly vol = 1710,**全 commercial/transactional 高商业价值**,CPC 总和 $5-8/click。

### 改写 spec(同卡 #4,情况 B 新建)

- Title: "NFD Flooring Brisbane — Sunvista Vinyl Planks & More | Oztop"
- H1: "NFD Flooring — Authorised Stockist in Brisbane"
- Content 800-1200 字(NFD 品牌介绍 + Sunvista 系列详情 + 安装案例)
- Yoast SEO + Focus keyphrase = `nfd flooring brisbane`

### 预期

- 880 + 720 vol 两词推 pos 21-22 → 10 → **+60-100 clicks/月**(transactional 转化高)
- 副效应:`sunvista vinyl planks` (vol 70) 同步上升

### 验证 SQL 同 #4(查 `nfd` / `nfd flooring`)

---

## 卡 #6 · 新建 `/brand/clever-choice-flooring/` — 720 vol 词

### 现状

| Keyword | Pos | Vol | Intent | CPC |
|---|---|---|---|---|
| `clever choice flooring` | **30** | 720 | commercial | $2.66 |
| `clever choice` | 22 | 590 | informational | n/a |

### 改写 spec(同 #4 情况 B)

- Title: "Clever Choice Flooring Brisbane — Authorised Stockist | Oztop"
- 内容 800-1200 字 + FAQ schema

### 预期

- pos 30 → 10 后:+40-70 clicks/月

---

## 卡 #7 · 改写 `/brand/bigpandaflooring/` — 已 pos 6.2,推 top 3

### 现状

| 字段 | 值 |
|---|---|
| URL | `/brand/bigpandaflooring/` |
| GSC | 133 imps / 2 clicks / CTR 1.5% / **pos 6.2** ✓ |
| Keyword `big panda` | vol 210 pos 10 |
| Keyword `big panda flooring` | vol 170 pos 16 (commercial) |

### 为什么 page pos 6.2 但 CTR 1.5%?

title/meta 弱,SERP snippet 不吸引点击。改 title 增 CTR。

### 改写 spec

```yaml
seoTitle: |
  Big Panda Flooring Brisbane — Lifestyle Collection In Stock | Oztop
metaDescription: |
  Big Panda hybrid flooring at Oztop's Brisbane showroom — full Lifestyle
  Collection in 6.5mm/8mm/10.5mm. Authorised stockist with same-day pickup,
  free measure & quote, Brisbane-wide installation.
focusKeyphrase: big panda flooring brisbane
```

### 预期

- pos 6.2 → 3-5
- CTR 1.5% → 5-8% = **+10-20 clicks/月**(只改 title/meta,不动 content)

---

## 卡 #8 · 改写 `/product/prestige-oak/` — 拿 36 imps 0-click query

### 现状

| 字段 | 值 |
|---|---|
| URL | `/product/prestige-oak/` |
| GSC page | 105 imps / 1 click / CTR 0.95% / pos 21.4 |
| Query `prestige oak` | **36 imps / 0 clicks / pos 5.75** ⚠️ pos 高但 0 click |

### 为什么 pos 5.75 还 0 click?

title/meta 完全不含 "prestige oak" 字眼,Google 用 product card snippet 但 brand name 没显在 title → 用户搜 "prestige oak" 看 SERP 不知道这页有 → 跳过。

### 改写 spec

```yaml
seoTitle: |
  Prestige Oak Hybrid Flooring — Authorised Stockist in Brisbane | Oztop
metaDescription: |
  Prestige Oak hybrid flooring planks in stock at Oztop Brisbane. Premium
  oak finish, waterproof SPC core, click-lock install. Free measure & quote
  in 1 business day.
focusKeyphrase: prestige oak flooring
```

确保 H1 也含 "Prestige Oak"(WooCommerce product 通常 H1 = product name,应该已经 OK)。

### 预期

- query `prestige oak` pos 5.75 → CTR 0% → **15-25%**(pos 5.75 + title 含 brand 应有 ~20% CTR)
- = 5-8 clicks/月 from this query alone
- page pos 21.4 → 10-15

---

## 卡 #9 · 改写 `/understanding-expansion-gaps-…` — 已 1195 字博客补 meta

### 现状

| 字段 | 值 |
|---|---|
| URL | `/understanding-expansion-gaps-in-flooring-a-key-to-long-lasting-floors/` |
| GSC | 640 imps / 4 clicks / CTR 0.63% / pos 11.7 |
| word_count | 1195(质量 OK) |
| meta | **空** |
| 命中 query | `expansion gap flooring` (vol 6 pos 11.5) + `expansion joint laminate flooring` (vol 70 pos 20 — 这个长尾值得抓) |

### 改写 spec

```yaml
seoTitle: |
  Expansion Gaps in Flooring: Why They Matter & How to Get Them Right | Oztop Brisbane
metaDescription: |
  Skip an expansion gap and your hybrid, laminate or timber floor will
  buckle. Brisbane flooring specialist explains the right gap size for
  every floor type, plus expansion joint requirements for laminate.
focusKeyphrase: expansion gap flooring
```

### 改完后还要做(content,15min)

在文章中段加一个 H2 "Expansion joints for laminate flooring" + 200 字段落,**显式覆盖** `expansion joint laminate flooring` (vol 70) 这个长尾词。

加 FAQ schema(3-4 Q&A):
- "How big should the expansion gap be?"
- "What happens if you skip the expansion gap?"
- "Do hybrid floors need expansion gaps?"
- "What's the difference between expansion gap and expansion joint?"

### 预期

- pos 11.7 → 7-9
- CTR 0.63% → 3-4% = **+15-25 clicks/月**
- 拿到 `expansion joint laminate flooring` 长尾 = +5-10 clicks/月

---

## 卡 #10 · 改写 `/tile-finishes-gloss-lappato-matt-and-grip-…` — 拿 $11 CPC transactional 词

### 现状

| 字段 | 值 |
|---|---|
| URL | `/tile-finishes-gloss-lappato-matt-and-grip-which-one-suits-your-style/` |
| GSC | 315 imps / 2 clicks / CTR 0.63% / pos 10.9 |
| word_count | 909(OK) |
| 命中 query | `lappato finish` (vol 90, pos 13, **transactional, CPC $11.02**) — 极高商业价值 |

### 改写 spec

```yaml
seoTitle: |
  Tile Finishes Explained: Gloss vs Lappato vs Matt vs Grip — Brisbane Guide | Oztop
metaDescription: |
  Choose the right tile finish for your bathroom, kitchen, outdoor or
  pool area. Brisbane tile specialist compares gloss, lappato, matt and
  grip — including slip ratings (R9-R11) for wet areas.
focusKeyphrase: tile finishes brisbane
```

### 改完后还要做(content,15min)

加 H2 "Lappato Finish Tiles in Brisbane" + 200 字 + 内链到 `/product-category/tiles/` 拿 transactional intent。

FAQ schema:
- "Which tile finish is best for bathroom floors?"
- "What's lappato finish?"
- "Are matt tiles harder to clean?"
- "What slip rating do I need for outdoor tiles in Brisbane?"

### 预期

- pos 10.9 → 6-8
- `lappato finish` pos 13 → 8 → +8-15 commercial clicks/月
- CTR 0.63% → 3-4% = **+8-15 总 clicks/月**

---

## 🔧 全站统一行动(贯穿全 10 卡)

### 全 1 · 131 张页 0 meta_description 批量补

CTR 1.94% 的直接根因。优先级:
1. 首页 + 主品类页(SPC/Hybrid/Vinyl/Tiles/Carpet/Bathware)+ 流量 top 10 页(从 GSC top_pages 拉)— 这批本 spec 已覆盖
2. **80 张 product 页**(每张 product page 都 missing meta)— FDE 批量任务,**模板**:
   ```
   {product name} in Stock at Oztop Brisbane — {key feature/spec}. Free measure & quote in 1 business day.
   ```
3. **38 张 "other" 页** — 部分是被爬虫拦的页(crawl_status='antibot_challenged'),修了 SiteGround 后重 crawl 才能写

### 全 2 · `primary_keywords` 加 local intent 词(SQL,5min)

```sql
UPDATE clients
SET primary_keywords = primary_keywords || ARRAY[
  'flooring brisbane',
  'hybrid flooring brisbane',
  'spc flooring brisbane',
  'carpet brisbane',
  'tiles brisbane',
  'bathware brisbane',
  'building supplies brisbane'
]
WHERE id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84';
```

执行后:① `diagnostic_findings` `keywords_not_configured` priority 90 告警消除 ② `keyword_snapshots` cron 下次会追踪这 7 个 local 词的排名 ③ AI Tracker 等下游用 primary_keywords 的也受益。

### 全 3 · 重启 SERP/keyword 追踪 cron

3 张表(`serp_rankings` / `serp_ranking_history` / `local_serp_rankings`)都是空的 — 没追踪就没法看改写效果。子牙起独立 PR 检查 cron 是否在跑、为什么 Oztop 没数据,修了再开 Phase B。

---

## 🚦 执行流水

| Step | 谁做 | 工时 | 阻塞 |
|---|---|---|---|
| 0 | PM 跟进 SiteGround ticket (Z3) | 1-3 天等回复 | 必须先解 |
| 1 | 子牙跑 全 2(SQL UPDATE primary_keywords)| 5 min | 0 (SQL 不经过 Oztop 站) |
| 2 | FDE 用 Page Rewriter 跑 #3 首页 + #7 #8 #9 #10(meta-only 改) | 各 30 min,共 2h | SiteGround 通后 |
| 3 | FDE 跑 #1 #2 内容补强(各 1-2h)| 2-3h | SiteGround 通后 |
| 4 | FDE 检查 #4 #5 #6 brand pages 是否存在,**不存在则新建** brand landing(各 1.5-2h)| 5-6h | SiteGround 通后 |
| 5 | 子牙起 PR 修 SERP/keyword 追踪 cron | 1-2h | 0 |
| 6 | 1 周后子牙 + FDE 回拉 GSC 看 quick wins 是否生效 | 30min | 0 |
| 7 | 4 周后回拉 keyword_snapshots 看完整 SEO 排名变化 | 30min | 0 |

**总工时(执行侧)**:~12-15h 跨 2-3 周 + 4 周等 SEO 数据回流。

---

## 📈 总预期(全 10 卡 + 全 3 行动执行 4 周后)

| 指标 | 现状 (5/23-6/20) | 预期 (执行 + 4 周) |
|---|---|---|
| Total clicks/月 | 140 | **300-450**(+115-220%) |
| Total impressions/月 | 7,233 | 12,000-15,000 |
| Avg CTR | 1.94% | 3-4% |
| Avg position | 21.47 | 13-15 |
| Top 10 ranked queries | ~3 | 10-15 |
| Pos 1-3 queries | 6(全是 brand 变体) | 8-10(加 local + brand landing 词) |

### 风险评估

- **风险 H**:SiteGround ticket 不通 → Page Rewriter 用不上 → 这份 spec FDE 要手工在 WP admin 一行行做,工时翻倍,但**仍然完全可行**。
- **风险 M**:卡 #2 #4 #5 #6 涉及 content 创建,如果客户老板审稿慢可能延 1-2 周。
- **风险 L**:keyword_snapshots cron 修不通 → 看不到 keyword 端排名变化,但 GSC 数据足够 cross-check。

---

## 📁 关联文档

- Phase A.1 数据底盘盘点:见对话历史 6/22(80 表 Oztop 行数)
- Phase A.2 5 查询完整数据:见对话历史 6/22(GSC top queries + pages, keyword quick wins, page 现状, diagnostic findings)
- ME Page Rewriter SOP:[`docs/sops/p12r-page-rewriter-m5-sanity.md`](./sops/p12r-page-rewriter-m5-sanity.md)
- SiteGround antibot SOP(已知 step 2 不可行 但仍可作为 ticket 模板):[`docs/sops/client-site-siteground-allowlist.md`](./sops/client-site-siteground-allowlist.md)
- ME crawler antibot 检测:PR #492 merged
