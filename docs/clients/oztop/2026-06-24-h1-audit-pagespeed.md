# Oztop H1 Audit + PageSpeed 报告（2026-06-24）

> 子牙·真欠账 #2（H1 audit）+ 真欠账 #5（PageSpeed LCP）合并报告
> 数据收集：WP REST API（75 个 publish post/page）+ PageSpeed Insights Mobile

---

## 📋 Part 1 · H1 / 地理信号 Audit

### 总览

| 维度 | 数字 |
|---|---|
| 总 publish | 75（22 pages + 53 posts）|
| ✅ 有地理信号（Brisbane/QLD 等）| 17（子牙今晚改的 Suburb + Hub + 部分 brand）|
| ❌ 无地理信号 | 30+ |

### 高 ROI 改写清单（子牙建议）

| URL | WP title 现状 | 建议 Yoast title |
|---|---|---|
| `/tile-sizes-explained-.../` | Tile Sizes Explained...（1104 imp/月）| ✅ 已改（含 Brisbane）|
| `/tile-finishes-.../` | Tile Finishes: Gloss, Lappato...（326 imp）| ✅ 已改（含 Brisbane）|
| `/brands/` | Brands（255 imp）| ✅ 已改（Flooring & Tile Brands Brisbane）|
| `/about-us/` | About Us（180 imp）| ✅ 已改 |
| `/contact/` | Contact（250 imp）| ✅ 已改 |
| `/gallery/` | Gallery（182 imp）| ✅ 已改 |

→ **子牙今晚已经全部改了 Yoast title**（含 Brisbane 信号）。

### 仍需改的（FDE Elementor 操作）

| 类别 | 数量 | 操作 |
|---|---|---|
| 项目展示页（Vogue/Hotel Marvell/Rose Heaven/The Holman）| 4 | 加 "(Brisbane Installation)" 后缀 |
| 老博客（Carpet Comparison/Wool/Triexta/Polyester/Polypropylene/Solution Dyed Nylon）| 15 | Yoast title 加 " for Brisbane Homes" 后缀 |
| 重复页（`/does-your-flooring-need-a-facelift/` × 2）| 2 | 合并或删一个 |
| Hero / Body H1（实际渲染）| 几乎全部 | Elementor 编辑改 H1 |

### 不需要改

| URL | 原因 |
|---|---|
| `/privacy-policy/` / `/terms-conditions/` / `/website-terms-of-use/` | 法律页 SEO 无价值 |
| `/elementor-15888/` Thank You Page | 内部转化页 |

---

## 🚨 Part 2 · PageSpeed Insights Mobile（首页）

### 灾难性数据

| 指标 | 现值 | Google 阈值 | 评级 |
|---|---|---|---|
| **Performance Score** | **32/100** | 90+ | 🔴 极差 |
| FCP | 6.0 秒 | < 1.8s | 🔴 |
| **LCP** | **40.8 秒** ⚠️ | < 2.5s | 🔴🔴🔴 灾难 |
| TBT | 1,090 ms | < 200ms | 🔴 |
| CLS | 0.06 | < 0.1 | 🟢 |
| SI | 15.0 秒 | < 3.4s | 🔴 |

**Lighthouse SEO**: 100/100 ✅（这部分子牙的工作）

### 5 大问题（按 ROI 排）

| # | 问题 | 估计节省 | 解决方案 |
|---|---|---|---|
| 🔴 1 | 渲染阻塞 CSS/JS | **6,940 ms** | Autoptimize / WP Rocket / FlyingPress |
| 🟡 2 | 图片传送 | 330 KiB | ShortPixel + WebP + lazy load |
| 🟡 3 | 缓存生命周期 | 189 KiB | SG Dynamic Cache + Cloudflare |
| 🟢 4 | 旧版 JS | 36 KiB | 升级 / 移除老 plugins |
| 🟢 5 | 字体显示 | 10 ms | font-display: swap |

### ROI 估算

| 优化路径 | 成本 | 预估提分 |
|---|---|---|
| **WP Rocket** 一键全套 | AU$70/年 | 32 → **65-75**（LCP 40s → 8-12s）⭐ |
| **Autoptimize free + ShortPixel free + Cloudflare** | 0 | 32 → 55-65 |
| 仅 SG Dynamic Cache | 0 | 32 → 40-45 |

### LCP 40.8 秒的真实影响

- 移动 4G 用户等 40 秒才看到主内容
- 行业基准：> 4 秒就 50% 用户 bounce
- → Oztop 5,642 GBP views/月里大概率 **>80% 移动用户进首页就走**
- **这是流量泄露的最大窟窿**，远比 SEO 内容更紧急

---

## 🎯 子牙建议优先级（按 ROI）

### 🔴 P0 立即（影响 5,642 views/月）

1. **FDE 装 WP Rocket** 或 Autoptimize（1 小时操作 → 立刻 LCP -30 秒）

### 🟡 P1 本周

2. **图片优化**（Hero / Featured Products）→ -3-5 秒 LCP
3. **Cloudflare Free**（CDN + cache headers）

### 🟢 P2 月度

4. 老博客 Yoast title 加 Brisbane 后缀（子牙能批量）
5. Elementor brand archive template 加 description widget（之前提过）
6. 4 个项目页（Vogue / Hotel Marvell 等）加地域 + Yoast title

---

## 📋 FDE Step-by-Step（WP Rocket 路径）

1. 购买 [WP Rocket](https://wp-rocket.me/)（AU$70/年）→ 下载 zip
2. WP 后台 → **Plugins → Add New → Upload Plugin** → 选 zip → Install Now → Activate
3. 入设置：
   - **File Optimization** → ✅ Minify CSS / Combine CSS / Optimize CSS Delivery / Minify JavaScript / Combine JavaScript / Defer JavaScript
   - **Media** → ✅ Lazy Load images / iframes / Replace YouTube preview / Add missing image dimensions
   - **Cache** → ✅ Mobile cache / Cache lifespan 10 days
   - **CDN**（如装 Cloudflare）→ 配 CDN CNAME
4. Save & Optimize
5. 24h 后重跑 PageSpeed Insights 验证 LCP < 12 秒

---

## 📊 数据落库

- execution_item: 已建（task #49, #50 completed）
- flywheel_action: 写 `pagespeed_audit` + `h1_audit_complete` 用于月报

---

**🚀 子牙建议下一步**：
- PM 决定 WP Rocket 投入（AU$70/年）→ 子牙写 WP Rocket SOP
- 或者 PM 让子牙批量改老博客 Yoast title 加 Brisbane（10 min）
- 或 commit + PR 收工

---

*起草：子牙 2026-06-24*
