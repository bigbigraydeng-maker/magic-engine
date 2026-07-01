# Oztop SEO Session Handoff (2026-06-26 + 2026-06-27)

> 子牙工作记录 — 含 DB 改动 backup（防止 WP DB 数据丢失能 restore）。

---

## 📊 工作产出总览

| 类 | 数 | DB 落库 | 前端验证 |
|---|---|---|---|
| Redirection rules 加 + 撤销 | 2 | ✅ | ✅ |
| WPCode PHP snippet 新建 | 1 (id 16687) | ✅ | ✅ |
| Page slug 改 | 1 (5402: brands → brand) | ✅ | ✅ |
| Product_cat description 改 | 1 (53: 去 emoji) | ✅ | ✅ |
| SEO blog Yoast 改 | 9 篇 | ✅ | ✅ |
| Brand description 写 | 13 个 | ✅ | ✅ 3 抽样 |

---

## 🚨 重大事件 + 教训

### 1. /brand/ ⇄ /brands/ 互相 301 loop

**根因**：page 5402 slug 历史上被改 `brand` → `brands`，与 YITH brand archive base `brand` 冲突 → WP canonical redirect 死循环。

**修复（PM 拍板方向）**：page 5402 slug 改回 `brand`（客户运营方判断对的）+ WP nav menu 3 处 URL 自动同步 + Redirection plugin 加 301 `/brands/` → `/brand/` 保 SEO 流量。

**教训**：子牙第一次方向走反（误加 `/brand/` → `/brand/karndean/` rule），客户运营方提醒后才修对方向。**以后 brand 相关页面有问题先问客户运营**。

### 2. SPC 分类页巨大 `👇` emoji 撑成 956×956 SVG

**根因**：子牙之前 description 末尾用 `👇 Browse The Product Range Below`。WP wp-emoji 自动转 emoji 为 `<img src="s.w.org/.../1f447.svg">`。`.oztop-cat-description` 容器没 CSS 限制 img 宽高 → SVG 默认 fill 父容器 = 956×956。

**修复**：description 末尾 `👇` → `↓`（ASCII 不触发 wp-emoji 转换）。

**教训**：以后写 WP description **绝不用 emoji**（用 ASCII / HTML entity 代替）。

### 3. PATCH description 时 WP sanitize 把 H 标签 strip 了

**根因**：子牙修 emoji 时整段 PATCH description，触发 WP `wp_filter_post_kses` 对 product_cat description 字段的严格 sanitize，把 H1/H2/H3/UL/strong 全部 strip。pwb-brand description 同样行为。

**修复**：用 WPCode PHP snippet 16687 hard-code HTML 注入，绕过 sanitize（**SPC 分类页**）。Brand description 用纯 `<p>+<a>` 段落格式（**13 brand**）。

**教训**：以后改 product_cat / pwb-brand description **不要靠 description 字段保留 H 标签**。要么用 PHP snippet hard-code，要么用纯段落格式。

---

## 🛡️ WPCode Snippet 16687 PHP Backup（防 WP 灾难恢复）

文件：`wp-content/wpcode/`（数据库里 `wp_options.wpcode_snippets`）

```php
<?php
/**
 * Oztop SEO: SPC/Hybrid hardcoded HTML override
 * Overrides 16649 default description renderer for SPC term only.
 * Reason: WP wp_kses strips H/UL from product_cat description.
 * Set Inactive by default; activate manually after verify.
 */

add_action('wp_loaded', function() {
    add_action('woocommerce_archive_description', 'oztop_spc_hardcoded_html', 1);
    add_action('woocommerce_taxonomy_archive_description', 'oztop_spc_hardcoded_html', 1);
    add_action('woocommerce_before_shop_loop', 'oztop_spc_hardcoded_html', 1);
    add_action('woocommerce_before_main_content', 'oztop_spc_hardcoded_html', 1);
});

function oztop_spc_hardcoded_html() {
    static $rendered = false;
    if ($rendered) return;
    if (! function_exists('is_product_category')) return;
    if (! is_product_category('spc-wpc-hybrid-flooring')) return;
    $rendered = true;

    remove_action('woocommerce_archive_description', 'oztop_render_cat_description_once', 5);
    remove_action('woocommerce_taxonomy_archive_description', 'oztop_render_cat_description_once', 5);
    remove_action('woocommerce_before_shop_loop', 'oztop_render_cat_description_once', 5);
    remove_action('woocommerce_before_main_content', 'oztop_render_cat_description_once', 25);

    echo <<<'EOT'
<div class="oztop-cat-description"><div class="oztop-category-intro">
<h2>Hybrid Flooring Brisbane — SPC, WPC & Engineered Options Compared</h2>
<p><strong>Brisbane homeowners</strong> face one tough flooring question: how do you find a floor that survives Queensland's humidity, summer storms, and underfoot traffic without warping or fading? Hybrid flooring is the answer most installers and renovators have settled on over the past five years — and it's why we stock <strong>7 carefully selected hybrid brands</strong> at our Slacks Creek showroom.</p>
<h3>Why Hybrid Works in Queensland's Climate</h3>
<p>Brisbane's year-round humidity (often 65–75%) and 30°C+ summer days are tough on traditional timber and laminate floors. Hybrid flooring uses a <strong>rigid SPC (Stone Plastic Composite) or WPC (Wood Plastic Composite) core</strong> that's 100% waterproof and stays dimensionally stable across temperature swings — meaning no gapping in winter, no swelling in summer. <a href="/understanding-expansion-gaps-in-flooring-a-key-to-long-lasting-floors/">See our guide on why expansion gaps matter</a> for the technical details.</p>
<h3>7 Brands We Stock at Slacks Creek</h3>
<p>Browse the full range below, or jump to a specific thickness:</p>
<ul>
<li><a href="/product-category/flooring/spc-wpc-hybrid-flooring/6-5mm-spc-hybrid/"><strong>6.5mm SPC</strong></a> — entry-level, residential-grade, fast install</li>
<li><a href="/product-category/flooring/spc-wpc-hybrid-flooring/8mm-spc-hybrid/"><strong>8mm SPC</strong></a> — most popular for Brisbane homes, balances comfort and durability</li>
<li><a href="/product-category/flooring/spc-wpc-hybrid-flooring/10-5mm-spc-hybrid/"><strong>10.5mm SPC</strong></a> — premium-grade with thicker wear layer for high-traffic areas</li>
</ul>
<p>Our brand line-up includes <strong>Bespoke, Eclipse, Ecolux, Iconic, Summerhill, Titanguard</strong>, and <a href="/brand/bigpandaflooring/">Big Panda Flooring</a> — each tested by our team for Brisbane-specific conditions before being added to our showroom.</p>
<h3>How to Choose: SPC vs WPC vs Engineered Timber</h3>
<p>Quick rule for Brisbane homes:</p>
<ul>
<li><strong>Wet areas (kitchen, laundry, bathroom)</strong> → SPC hybrid (100% waterproof core)</li>
<li><strong>Living areas with underfloor heating consideration</strong> → WPC hybrid (warmer underfoot)</li>
<li><strong>Premium feel + real timber surface</strong> → engineered timber (different category, see <a href="/engineered-timber-flooring-timeless-elegance-with-modern-versatility/">our engineered timber overview</a>)</li>
</ul>
<p>Read the full breakdown in <a href="/spc-hybrid-vs-vinyl-vs-laminate-vs-engineered-timber-quick-comparison/">SPC Hybrid vs Vinyl vs Laminate vs Engineered Timber — Quick Comparison</a>.</p>
<h3>Pricing & Showroom Visit</h3>
<p>Hybrid flooring pricing varies by brand, thickness, and wear layer — we keep current pricing in-store and can match most Brisbane competitor quotes. <strong>Visit our Slacks Creek showroom</strong> at 5 Judds Ct, QLD 4127 to walk on actual samples and compare colours under natural light. Open Monday–Friday 9am–5pm and Saturday 9am–4pm — no appointment needed.</p>
<p><em>Browse the product range below ↓</em></p>
</div></div>
EOT;
}
```

---

## 📋 Redirection Plugin Rules（当前 active）

| ID | Source | Target | 用途 |
|---|---|---|---|
| 1 | `/does-your-floors-need-a-facelift/` | `/does-your-flooring-need-a-facelift/` | 重复页合并（2026-06-24）|
| 3 | `/brands/` | `/brand/` | page 5402 slug 改回后保 SEO 流量（2026-06-26）|

子牙 6-26 加过 id=2 错误 rule（`/brand/` → `/brand/karndean/`），客户运营方指出方向反后已删。

---

## 🎯 9 SEO 博客 Yoast 改写

全部 REST POST status 200，meta._yoast_wpseo_title 真存：

| ID | Slug | Old Yoast Title | New Yoast Title |
|---|---|---|---|
| 8377 | tile-finishes-gloss-lappato-... | Tile Finishes Explained: Gloss vs Lappato vs Matt vs Grip | Tile Finishes Brisbane: Gloss vs Lappato vs Matt vs Grip \| Oztop |
| 8291 | why-carpet-wastage-... | Why Carpet Wastage is High with a 3.66-Metre Roll | Carpet Wastage: Why 3.66m Rolls Use 25% More Brisbane \| Oztop |
| 8204 | quick-guide-flooring-installation | A Quick Guide to Flooring Installation | Flooring Installation Brisbane: Tools & Step-by-Step Guide \| Oztop |
| 8198 | expansion-gaps-flooring | Floor Expansion Gaps: The 10–15mm Rule Explained \| Oztop | Floor Expansion Gaps Brisbane: 10–15mm Rule Explained \| Oztop |
| 8186 | floor-preparation | Floor Preparation: The Foundation for Perfect Flooring | Floor Preparation Brisbane: Subfloor Prep for Long-Lasting Floors |
| 8178 | vinyl-flooring | Vinyl Flooring: The Ultimate Blend of Style and Practicality | Vinyl Flooring Brisbane: Style, Durability & Cost Guide \| Oztop |
| 8173 | engineered-timber-flooring | Engineered Timber Flooring: Timeless Beauty Meets Modern Innovation | Engineered Timber Flooring Brisbane: Buyer's Guide 2026 \| Oztop |
| 8165 | laminate-flooring | Discover the Endless Possibilities of Laminate Flooring | Laminate Flooring Brisbane: Styles, Cost & Install Guide \| Oztop |
| 8123 | spc-hybrid-flooring | Why SPC Hybrid Flooring is the Perfect Choice for Modern Homes | SPC Hybrid Flooring Brisbane: Why It's Best for QLD Homes \| Oztop |

19 个项目展示页（Hotel Marvell / Rose Heaven 等）GSC 0 impressions，不改（影响 ≈ 0）。

---

## 🏷️ 13 Brand Description Backup（防 DB 丢失能 restore）

每个 brand 描述 ~900 字符，结构：3 个 `<p>` 段 + 1-2 个内链 `<a>` + Brisbane/Slacks Creek/Logan 地理信号 + 真实在售产品列表 + 5 Judds Ct QLD 4127 showroom CTA + 营业时间。

| ID | Slug | Vol (月) | Products (verified from WP) |
|---|---|---|---|
| 183 | lauxes-grates | 1300 | Slimline Tile Insert, NeXT Generation |
| 195 | dunlop-flooring | 880 | Carpetmate, Summerhill |
| 147 | bremworth | 880 | Samurai, Kensho |
| 154 | godfrey-hirst | 880 | Caribbean, Venture, Beechmont, Modern Texture, Classic City, Murano |
| 198 | clever-choice | 720 | Perfecto, Shield |
| 173 | caroma | 590 | Liano II |
| 151 | redbook-carpets | 590 | Sapphire Bay, Carpathian, Hepburn, Skyway, Riverbed, Knights Ridge, Coonawarra |
| 97 | stoneworld | 320 | Borgogna, Terrazzo Rock, Magic Stone, Marble Vein, Kross, Timeless, Terrazzo Stone, Canyon, Veneto, Tuscany |
| 168 | tile-one | 260 | Fossil Stone, Antalya |
| 75 | bigpandaflooring | 210 | Heritage Oak, Ecolux 7.5, Spectrum 8, Spectrum 12, Luminous Oak, Titanguard, Ecolux, Eclipse |
| 193 | damtec | 110 | Multi Acoustic |
| 102 | advantageflooring | 50 | Salsa, Speedster, Hip Hop, Metropolis |
| 101 | diytiles | 70 | Riviera, Norcia Vein Cut, Norcia Travertine, Breccia, Carrara X, Hexagon, New Travertino, Dino |

**总 SEO 内容字符**：~12,000  
**总月搜量覆盖**：6,160/月

如需 restore 任一 brand description 内容，从 git 历史 `git show <this-commit>:docs/clients/oztop/2026-06-26-brand-descriptions-backup.md` 或者直接从此 PR 的 commit 内容获取完整 HTML。

---

## 🛠️ 全站 audit 数据快照（2026-06-27）

| 区 | Total | 真问题 |
|---|---|---|
| Product Categories | 41 | 0（SPC 已修，Carpet Tiles 仅 203 字短文不需 H 结构）|
| Pages | 21 | 0（Suburb pages `&#038;` 浏览器自动 decode 显示正常）|
| Blog Posts | 53 | 19 项目展示页（GSC 0 impr，决定不改）|
| Brand 页 | 30 | 0（13 brand 已补完，剩 17 已 sweep 过）|
| 全站 emoji | — | 0 |

---

## 🚦 PR 链路状态

| PR | Status | 内容 |
|---|---|---|
| [#497](https://github.com/bigbigraydeng-maker/magic-engine/pull/497) | OPEN（等 PM go merge）| 2026-06-24 工作（PageSpeed audit + Autoptimize + 11 citation）|
| 本次 commit | 接力到 PR #497 同一分支 | 2026-06-26+27 工作 backup |

---

## 📌 下次 session 启动咒语

```
继续 ME 工作 — Oztop SEO（13 brand + SPC PHP snippet 落地后 GSC 待 reindex 1-3 周）
```

监控指标:
- `lauxes grates` pos 31 → 期望 10-20
- `dunlop flooring` pos 32 → 期望 15-25  
- `bremworth` pos 31 → 期望 10-20
- `spc hybrid flooring brisbane` 当前未 rank → 期望进 top 30

---

*起草: 子牙 2026-06-27*
