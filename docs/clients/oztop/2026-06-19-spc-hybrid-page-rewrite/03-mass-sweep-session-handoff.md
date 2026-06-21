# Oztop SEO Mass Sweep · 2026-06-19 Session Handoff

> 起草: 子牙 (modest-proskuriakova-0aa314 worktree)
> 时长: 单一 session 约 2 小时
> 路径: PM 0 介入 / 子牙 Chrome 自动化全部独立完成

---

## ⚡ 一句话状态

**今晚一口气改写 15 个 URL 的 SEO Title / Meta / Focus Keyphrase + 1 个 PHP snippet + 1 套 FAQ/LocalBusiness Schema。Baseline 28d 总 4,448 impressions / 35 clicks。预估 30d 后 +65 clicks/月，90d 后 +200 clicks/月。**

---

## 📊 15 个 URL 全清单（按 ROI 排序）

| # | URL | 类型 | Baseline impr / pos / CTR | 新 Title | 路径 |
|---|---|---|---|---|---|
| 1 | `/product-category/flooring/spc-wpc-hybrid-flooring/` | product_cat | 557 / 49.8 / 0.54% | Hybrid Flooring Brisbane \| SPC, WPC & 7 Brands \| Oztop | admin DOM + WPCode PHP snippet (full revamp) |
| 2 | `/understanding-expansion-gaps-.../` | post 8198 | 655 / 11.7 / 0.61% | Floor Expansion Gaps: The 10–15mm Rule Explained \| Oztop | REST API |
| 3 | `/tile-sizes-explained-.../` | post 8385 | 1104 / 7.3 / 1.45% | Tile Sizes Explained: 600×1200, 600×600 & 300×600 \| Brisbane | REST API |
| 4 | `/tile-finishes-gloss-lappato-.../` | post 8377 | 326 / 10.8 / 0.61% | Tile Finishes Explained: Gloss vs Lappato vs Matt vs Grip | REST API |
| 5 | `/contact/` | page 591 | 250 / 12.3 / 0.80% | Contact Oztop Building Supplies \| Brisbane Showroom & Phone | REST API |
| 6 | `/about-us/` | page 594 | 180 / 3.3 / 1.11% | About Oztop Building Supplies \| Brisbane Flooring Specialists | REST API |
| 7 | `/gallery/` | page 9103 | 182 / 2.4 / 0.55% | Project Gallery \| Brisbane Flooring & Tile Showroom \| Oztop | REST API |
| 8 | `/brands/` | page 5402 | 255 / 5.7 / 0.39% | Flooring & Tile Brands Brisbane \| Big Panda, Dunlop + \| Oztop | REST API |
| 9 | `/product-category/flooring/` | product_cat (term 42) | 160 / 47.7 / 0.63% | Flooring Brisbane: Hybrid, Carpet, Vinyl, Engineered \| Oztop | admin DOM |
| 10 | `/product-category/carpet/` | product_cat (term 44) | 149 / 31.6 / 0.67% | Carpet Brisbane: Wool, Polyester, Triexta, Nylon \| Oztop | admin DOM |
| 11 | `/spc-wpc-hybrid-flooring/6-5mm-spc-hybrid/` | product_cat (term 111) | 115 / 18.4 / 1.74% | 6.5mm SPC Hybrid Flooring Brisbane \| Entry-Level \| Oztop | admin DOM |
| 12 | `/brand/bigpandaflooring/` | pwb-brand (term 75) | 160 / 6.0 / 1.88% | Big Panda Flooring Brisbane \| Hybrid Range \| Oztop Stockist | admin DOM |
| 13 | `/brand/advantageflooring/` | pwb-brand (term 102) | 67 / 7.9 / 0% | Advantage Flooring Brisbane \| Oztop Stockist & Showroom | admin DOM |
| 14 | `/brand/redbook-carpets/` | pwb-brand (term 151) | 67 / 12.5 / 0% | Redbook Carpets Brisbane \| Oztop Stockist & Showroom | admin DOM |
| 15 | `/brand/dunlop-flooring/` | pwb-brand (term 195) | 21 / 24.2 / 0% | Dunlop Flooring Brisbane \| Oztop Stockist & Showroom | admin DOM |

**总 baseline 28d**: 4,448 impressions / 35 clicks
**预估 30d 后**: ~100 clicks/月 (+65)
**预估 90d 后**: ~230 clicks/月 (+195)

---

## 🛠️ 技术路径（spec 沉淀供未来 quick win 复用）

### 路径 A · WP Post / Page (走 REST API)
```javascript
await fetch('/wp-json/wp/v2/{posts|pages}/{id}', {
  method: 'POST',
  headers: {'Content-Type':'application/json', 'X-WP-Nonce': wpApiSettings.nonce},
  credentials: 'include',
  body: JSON.stringify({meta: {
    _yoast_wpseo_title, _yoast_wpseo_metadesc, _yoast_wpseo_focuskw
  }})
})
```
✅ Admin 已登录 session 下不被 sgcaptcha 拦
✅ 写入 yoast meta 持久化
⚠️ 不要走 `wp.data.dispatch('core/editor').editPost(...)` → Yoast Redux 会 override 失败

### 路径 B · WC product_cat / pwb-brand taxonomy (走 admin DOM)
```javascript
// navigate to /wp-admin/term.php?taxonomy=...&tag_ID=...
// then:
const setVal = (id, val) => {
  const el = document.getElementById(id);
  const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  s.call(el, val);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
};
setVal('hidden_wpseo_title', '...');
setVal('hidden_wpseo_desc', '...');
setVal('hidden_wpseo_focuskw', '...');
document.querySelector('input[type=submit][value="Update"]').click();
```
✅ Yoast hidden inputs 在 product_cat + pwb-brand 都 work
✅ 提交后 success notice "Category updated." / "Item updated."

### 路径 C · 主题不渲染 archive description (走 WPCode PHP snippet)
```php
function oztop_render_cat_description_once() {
    static $rendered = false;
    if ($rendered) return;
    if (!is_product_category()) return;
    $term = get_queried_object();
    if (!$term || empty($term->description)) return;
    $rendered = true;
    echo '<div class="oztop-cat-description">' . wp_kses_post($term->description) . '</div>';
}
// 4-hook fallback (Astra theme skips default hook)
add_action('woocommerce_archive_description', 'oztop_render_cat_description_once', 5);
add_action('woocommerce_taxonomy_archive_description', 'oztop_render_cat_description_once', 5);
add_action('woocommerce_before_shop_loop', 'oztop_render_cat_description_once', 5);
add_action('woocommerce_before_main_content', 'oztop_render_cat_description_once', 25);
```
✅ WPCode Lite 支持 PHP snippet
⚠️ WP `wp_filter_kses` 剥离 term description 里的 `<script>` 标签 → Schema 必须走 wp_head 注入而非嵌 description

---

## 🔴 PM 接下来的事（只剩 GSC Indexing 提速 + 等数据）

### 立刻做（30 分钟）· GSC 批量 Request Indexing

GSC 每天限 ~10 个 URL，今天先做 ROI 最高 5 个，明天再 5 个，第三天剩 5 个。

**今天 5 个**（最高 ROI）:
1. `https://oztopbuildingsupplies.com.au/tile-sizes-explained-how-to-choose-between-600x1200-600x600-300x600-and-75x300-mm-for-your-space/`
2. `https://oztopbuildingsupplies.com.au/understanding-expansion-gaps-in-flooring-a-key-to-long-lasting-floors/`
3. `https://oztopbuildingsupplies.com.au/product-category/flooring/spc-wpc-hybrid-flooring/` (已做)
4. `https://oztopbuildingsupplies.com.au/brands/`
5. `https://oztopbuildingsupplies.com.au/tile-finishes-gloss-lappato-matt-and-grip-which-one-suits-your-style/`

**明天 5 个**:
6. `/contact/`
7. `/about-us/`
8. `/gallery/`
9. `/product-category/flooring/`
10. `/product-category/carpet/`

**第三天 5 个**:
11. `/product-category/flooring/spc-wpc-hybrid-flooring/6-5mm-spc-hybrid/`
12. `/brand/bigpandaflooring/`
13. `/brand/advantageflooring/`
14. `/brand/redbook-carpets/`
15. `/brand/dunlop-flooring/`

操作: GSC → URL Inspection → 粘 URL → Request Indexing → 等绿色"Indexing requested"

### 14 天后回看（PM 自驱）

- GSC Performance → Pages → 比 28d "Last 28 days vs previous 28 days"
- 看上面 15 个 URL 的 position / clicks 是否上升
- 重点关注: CTR < 2% 的高 impr 页是否拉到 5%+

### 90 天后（PM + 子牙复盘）

- 跑 ROI 量化: 实际 +clicks/月 vs 预估 +200
- 把 "改 Yoast title/meta 拿低 CTR 流量" 这条 SOP 沉淀到 ME 平台（自动化 quick win recommendation）

---

## 📁 Kanban + Flywheel 落库

- **15 个 execution_items** in_progress (各自独立追踪，14 天后跟踪 pos/clicks 变化)
- **5 个 flywheel_actions**:
  - SPC/Hybrid drafted `bb84158c`
  - SPC/Hybrid deployed `a37bd5ff` (含 frontend_validation payload)
  - expansion-gaps `fc9f2fd3`
  - mass sweep summary `2693d55b` (15 URL 总 baseline + projection)
- 3 个 docs in `docs/clients/oztop/2026-06-19-spc-hybrid-page-rewrite/`:
  - `00-backup-before.json` (SPC/Hybrid 原始数据回滚备份)
  - `01-rewrite-package.md` (改写包 spec)
  - `02-pm-paste-sop.md` (原始手动 SOP - 已被子牙自动化代替)
  - `03-mass-sweep-session-handoff.md` (本文)

---

## 🎓 关键教训（写入 CLAUDE.md 候选）

1. **WC term description 走 wp_filter_kses 剥离 `<script>`** — Schema 永远走 wp_head 而非嵌 description
2. **Astra theme 跳过 `woocommerce_archive_description`** — 必须 4-hook fallback + `static $rendered` 防重
3. **Gutenberg post 改 Yoast meta 走 REST API 不走 editPost** — Yoast Redux 会 override 失败
4. **WP product_cat + pwb-brand taxonomy 都用 hidden_wpseo_* inputs** — 同一套 DOM 套路通吃所有 Yoast-tracked taxonomy
5. **SiteGround sgcaptcha 不拦已登录 admin 的 /wp-json** — admin session cookie 通过
6. **WPCode Lite 支持 PHP snippet** — 不需要 Pro

---

## 下一 session 启动咒语

```
继续 Oztop 工作 — 看 14 天后 GSC 数据 + (如果效果好) 同套路 sweep 更多 URL (next batch: /product/eclipse, /product/prestige-oak, /brand/preference-floors 等)
```

---

**子牙 2026-06-19 收工。 累计 15 个 quick win，预估 90 天后 +200 clicks/月。** 🎉
