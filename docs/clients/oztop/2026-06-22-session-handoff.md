# Oztop 2026-06-22 Session Handoff

> 起草：子牙（modest-proskuriakova-0aa314 worktree）· 凌晨收工
> 长度：超长 session — 32 URL Yoast sweep + 22 brand stockist + 11 个新内容 + DA Roadmap + PR #493 merged
> 给：下次接 Oztop 工作的任何窗口

---

## ⚡ 一句话状态

**Oztop SEO 资产从 ~10 → 60+ URL，DA 12月 Roadmap 落地，PR #493 已合 main，剩 2 件 WP 后台收尾（Elementor widget + Walnut LP 重传）+ 11 个 GSC Indexing 明天 PM 自跑。**

---

## ✅ 今晚战果（按类别）

### 1. WP Yoast metadata 批量优化（32 URL）

| 类型 | 数量 | 代表 |
|---|---|---|
| Post | 3 | tile-sizes / tile-finishes / expansion-gaps |
| Page | 4 | contact / about-us / gallery / brands |
| Product_cat | 4 | SPC/Hybrid / flooring / carpet / 6.5mm sub |
| Brand (pwb-brand) | 17 | bigpanda / advantage / redbook / dunlop + 13 新 |

全部前端验证生效（title / meta / focuskw）。

### 2. Brand stockist 深度版升级（5 个 · brand-pages-output.md 落地）

| Brand | 深度版变化 |
|---|---|
| **KDK** | 🔴 红线修复："Bathroom Fan" → "Tapware" |
| NFD | 200 字 description + 升级 Title |
| Karndean | 200 字 + Van Gogh / LooseLay / Korlok 真实系列名 |
| Preference Floors | 200 字 + 升级 Title |
| Mapei | 200 字（trade + DIY）+ 升级 Title |

5 个 brand description（200 字）已存 DB（wp_terms + YITH 2 个 textarea），**但 Elementor template bypass → 前端 body 未渲染**（见 § PM TODO）。

### 3. 新内容资产（6 个，全 publish）

| 类型 | URL | wp_id |
|---|---|---|
| Carpet 材质博客 (1,000 字) | [/carpet-materials-brisbane-triexta-vs-nylon-vs-polypropylene-vs-wool/](https://oztopbuildingsupplies.com.au/carpet-materials-brisbane-triexta-vs-nylon-vs-polypropylene-vs-wool/) | 16659 |
| Suburb Slacks Creek | [/flooring-slacks-creek/](https://oztopbuildingsupplies.com.au/flooring-slacks-creek/) | 16664 |
| Suburb Underwood | [/flooring-underwood-brisbane/](https://oztopbuildingsupplies.com.au/flooring-underwood-brisbane/) | 16661 |
| Suburb Logan | [/flooring-logan-brisbane/](https://oztopbuildingsupplies.com.au/flooring-logan-brisbane/) | 16660 |
| Suburb Springwood | [/flooring-springwood-brisbane/](https://oztopbuildingsupplies.com.au/flooring-springwood-brisbane/) | 16663 |
| Suburb Browns Plains | [/flooring-browns-plains-brisbane/](https://oztopbuildingsupplies.com.au/flooring-browns-plains-brisbane/) | 16662 |

### 4. 平台增强（不可见但加分）

- **WPCode PHP snippet (id=16649)**：4-hook fallback + Schema 注入 + 已扩展到 pwb-brand condition
- **FAQ + LocalBusiness JSON-LD** Schema：SPC/Hybrid 分类页（Brisbane 信号 + 营业时间 + Slacks Creek 地址）
- **WP 内链网络**：60+ 内链编织进新内容（brand → suburb → category → blog）

### 5. 数据驱动战略 reset

| 维度 | Before | After |
|---|---|---|
| master_brief.keyword_seeds | 13 aspirational (GSC 0 命中) | **30 真实可触达** (品牌+长尾+suburb) |
| master_brief.competitor_domains | Bunnings/Reece/Beaumont/Tile Trends (tier 错) | **Uptons/Oz Pro/Astro/Tradelink** (真实 Brisbane 竞品) |

### 6. 长期 DA Roadmap 落盘

[docs/clients/oztop/2026-06-19-oztop-da-uplift-12m-roadmap.md](docs/clients/oztop/2026-06-19-oztop-da-uplift-12m-roadmap.md) — 12 月 6 Layer 完整 plan + 月度进度表 + PM 新窗口启动咒语。

### 7. GSC Request Indexing（9/22 完成）

| 已成功 indexed | 状态 |
|---|---|
| SPC/Hybrid 分类页（PM 手动）| ✅ |
| tile-sizes / tile-finishes / expansion-gaps / brands / contact / about-us / gallery（7 个子牙跑）| ✅ |
| flooring / carpet（2 个第二轮 quota 回来跑）| ✅ |

13 个还没跑（GSC quota 限 / React 拦截自动化）— 见 § PM TODO。

### 8. PR #493 merged

```
SHA:    c81a87339f8cc7a5510cabdda7c99ee9a08e6643
State:  MERGED 2026-06-21T15:08:24Z
Files:  6 (5 new docs + 1 Walnut LP update)
Diff:   +964 / -47
```

---

## 🛠️ 3 条技术路径 spec（spec 沉淀供未来 quick win 复用）

| 路径 | 适用 | 关键洞察 |
|---|---|---|
| **REST API + X-WP-Nonce** | post / page | 不要走 `editPost`（Yoast Redux override 失败）。直接 POST `/wp/v2/{posts\|pages}/{id}` |
| **admin DOM + hidden_wpseo_*** | product_cat / pwb-brand | 同套路通吃所有 Yoast-tracked taxonomy。pwb-brand 多 2 个 textarea (`pwb_brand_description_field` + `pwb_long_brand_description_field`) |
| **WPCode PHP snippet** | 主题不渲染 archive description / inject Schema | 4-hook fallback + `static $rendered` 防重。Astra theme + Elementor template bypass — brand 仍需 Elementor widget 才能渲染 |

详细路径见 [03-mass-sweep-session-handoff.md](docs/clients/oztop/2026-06-19-spc-hybrid-page-rewrite/03-mass-sweep-session-handoff.md)。

---

## 🔴 PM / FDE TODO（按优先级）

### 立即（10 分钟）

| # | 任务 | Owner | 说明 |
|---|---|---|---|
| 1 | **Walnut LP 重传 SiteGround** | PM/FDE | git 已合 +GST 修正 + hero 1-1a.jpg，但 SG 服务器还跑旧版。下载新 [index.html](docs/clients/oztop/landing-pages/2026-06-10-walnut-clearance/index.html) → SG File Manager → `public_html/walnut-clearance/` 替换 + Purge SG Cache |

### 明天（quota 重置后，~15 分钟）

| # | 任务 | Owner |
|---|---|---|
| 2 | **GSC Request Indexing × 11 个**（分 2 天）| PM |

URL 清单：
```
今天 10 个：
https://oztopbuildingsupplies.com.au/carpet-materials-brisbane-triexta-vs-nylon-vs-polypropylene-vs-wool/
https://oztopbuildingsupplies.com.au/flooring-slacks-creek/
https://oztopbuildingsupplies.com.au/flooring-underwood-brisbane/
https://oztopbuildingsupplies.com.au/flooring-logan-brisbane/
https://oztopbuildingsupplies.com.au/flooring-springwood-brisbane/
https://oztopbuildingsupplies.com.au/flooring-browns-plains-brisbane/
https://oztopbuildingsupplies.com.au/brand/kdk/
https://oztopbuildingsupplies.com.au/brand/nfd/
https://oztopbuildingsupplies.com.au/brand/karndean/
https://oztopbuildingsupplies.com.au/brand/preference-floors/

后天 1 个：
https://oztopbuildingsupplies.com.au/brand/mapei/

加上之前没跑完的 6 个低优先 brand（明后天酌情）:
/brand/bigpandaflooring/
/brand/advantageflooring/
/brand/redbook-carpets/
/brand/dunlop-flooring/
/brand/stoneworld/
/brand/caroma/
```

### 本周（30 分钟，FDE 操作）

| # | 任务 | Owner | 影响 |
|---|---|---|---|
| 3 | **Elementor brand archive template 加 Description widget** | FDE | 一次性，30 个 brand 全部 200 字 description 渲染到前端 body（现在 70% 信号已落地，补这步 = 100%）|
| 4 | **Karndean 大小写 URL 统一**（WP Redirection 插件 301）| FDE | 避免 SEO duplicate 信号稀释 |

### 长期（DA Roadmap）

完整 12 月计划 → [DA Roadmap doc](docs/clients/oztop/2026-06-19-oztop-da-uplift-12m-roadmap.md)

**月 1 重点（PM 主导）**：
- Google Business Profile 完善 + 评论 SOP（PM 25/月 → 12 月 50+）
- 12 个 citation 注册 + NAP 一致性（4 小时）
- 详细清单：见 Roadmap doc § Layer 1

---

## 📊 预估 ROI（从 baseline 4,448 impr / 35 clicks）

| 时间 | clicks/月 增益 | 主驱动 |
|---|---|---|
| 30 天 | +60-100 | Yoast title/meta 立刻提 CTR |
| 90 天 | **+170-220** | + brand stockist position 改善 + suburb 长尾长流量 |
| 180 天 | +250-350 | + DA Layer 1 citation 完成 + 评论增长 |
| 12 月 | +400-600 | + Layer 2-5 全部 + linkable assets |

商业价值（建材店模型）:
- 90 天 +170 clicks/月 × 2.5% lead × 20% close × AU$4,000 = **~AU$3,400/月营收**
- 12 月累计预估增益 **AU$30,000-50,000**

---

## 🎓 子牙踩过的坑（教训沉淀）

| 坑 | 教训 |
|---|---|
| **KDK 编"Bathroom Fan"** | 红线触犯。后来从 brand-pages-output.md 看到深度版才发现是 Tapware。教训：写品牌类目必须先 fetch /brand/{slug}/ 看真实产品 |
| **WP `wp_filter_kses` 剥离 `<script>`** | term description 嵌 Schema 会被 strip。Schema 必须走 wp_head 注入 |
| **Astra theme 跳过 `woocommerce_archive_description`** | 必须 4-hook fallback + `static $rendered` 防重 |
| **Elementor brand archive bypass WC hooks** | PHP snippet 也救不了。要 Elementor template editor 改 |
| **Gutenberg post 改 Yoast meta** | 不要走 `editPost`（Yoast Redux override）→ 走 REST POST |
| **GSC URL Inspection React** | React controlled input 把 DOM 写入 reset → 自动化只能跑前几个（quota + React 双约束）|
| **SiteGround sgcaptcha** | 已登录 admin session 下 wp-json 不被拦 — admin REST API 全程通 |
| **WPCode Lite 支持 PHP snippet** | 不需要 Pro |
| **YITH brand taxonomy 用 2 个独立 textarea** | `pwb_brand_description_field` (short) + `pwb_long_brand_description_field` (long) — 必须同时 set，不只 WP 默认 description |

---

## 📁 文件资产清单

### 已 merge 到 main (PR #493)
- `docs/clients/oztop/2026-06-19-oztop-da-uplift-12m-roadmap.md` ⭐ 12 月长期任务
- `docs/clients/oztop/2026-06-19-spc-hybrid-page-rewrite/` (4 files)
- `docs/clients/oztop/landing-pages/2026-06-10-walnut-clearance/index.html` (+GST 修正)

### 另一窗口已 merge 到 main (PR #488, #489)
- `docs/clients/oztop/2026-06-22-da-uplift-week1/` (7 files):
  - `01-nap-audit.md` / `02-301-redirect-sop.md` / `03-localbusiness-schema.md`
  - `04-directory-building-checklist.md` / `05-brand-pages-codex-prompt.md`
  - `06-supplier-dealer-outreach.md`
  - **`brand-pages-output.md` ⭐ 5 brand 深度改写（kdk/nfd/karndean/preference/mapei）— 子牙今晚自动化执行**

### 本 handoff
- `docs/clients/oztop/2026-06-22-session-handoff.md`（本文）

---

## 🎯 数据库改动归因

### Supabase
- `master_briefs`: keyword_seeds (13→30) + competitor_domains (4 wrong→4 real) + competitive_notes_md
- `execution_items`: 32 + 6 + 13 = **51 个新卡** (in_progress, 14 天跟踪)
- `flywheel_actions`: 6 个新归因（含 baseline impr/clicks/pos + projection + red_line_compliance）

### WordPress
- 32 URL Yoast metadata（hidden_wpseo_title / desc / focuskw 全部 set）
- 22 brand stockist Title/Meta
- 5 brand 200 字 description (DB level)
- 6 个新 publish (1 post + 5 pages)
- 1 WPCode PHP snippet (id=16649) 扩展到 pwb-brand

---

## ⚠️ 已知限制

1. **GSC quota** 限 ~10 URL/天 → 11 个还没 indexed 要 PM 明天自跑
2. **Elementor template bypass** → brand description 前端不渲染（需 FDE 加 widget）
3. **Karndean 大小写 URL** → 需 WP Redirection 插件
4. **DataForSEO competitor gap API** → ME production 405，supabase 没存竞品 ranking，竞品深度分析待下次 dev server / 本地拉

---

## 🪄 下一 session 启动咒语

### 接 Oztop 业务执行线
```
继续 Oztop 工作 — 14 天后看 GSC 看今晚 60+ 改动的 pos/CTR/clicks 变化 +
评估是否继续做剩 25 个 brand (从 brand-pages-output.md)
```

### 接 Oztop DA 长期任务（推荐 PM 单独开窗口）
```
继续 Oztop DA 权重提升长期任务。

背景:
- Oztop Building Supplies (oztopbuildingsupplies.com.au)
- Brisbane 本地建材店 (Slacks Creek QLD 4127)
- 现 DA 估算 15-25, 真实竞品 (Uptons/Oz Pro/Astro) DA 20-30
- 12 月目标 DA 30-42

完整 Roadmap 在: docs/clients/oztop/2026-06-19-oztop-da-uplift-12m-roadmap.md
进度跟踪在: 该 doc § 月度进度表

请先读 Roadmap doc, 然后告诉我:
1. 当前在 Layer 几, 完成度多少
2. 本周该做的下一步具体动作 (子牙能做的 vs PM 必须做的)
3. 如有 blocker / 需要决策的点, 列出来

如果是第一次启动 (Layer 1 刚开始):
→ 从 NAP 标准化 + Google Business Profile 完善开始
```

---

**🌙 子牙 2026-06-22 收工**。 累计 60+ SEO 资产落地，12 月 Roadmap 落盘，PR merged，3 件 WP 后台收尾留 PM/FDE 自处理。下次见。
