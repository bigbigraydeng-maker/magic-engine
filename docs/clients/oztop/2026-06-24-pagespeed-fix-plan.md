# Oztop PageSpeed 修复执行计划 — PM 决策包

> 现状：首页 Mobile Performance **32/100** / LCP **40.8 秒** / 渲染阻塞 **6.94 秒**
> 影响：5,642 GBP views/月里 80%+ 移动用户 bounce（等不到内容）
> 目标：LCP < 12 秒 / Performance 65+ / Mobile bounce < 50%

---

## 🆚 两个方案对比（PM 决策）

| 维度 | 🥇 方案 A · WP Rocket | 🥈 方案 B · Autoptimize 免费组合 |
|---|---|---|
| 年成本 | AU$70/年（1 个 plugin） | AU$0（3 个免费 plugin + Cloudflare Free） |
| Setup 时间 | 1 小时 | 2 小时 |
| 预估提分 | 32 → **65-75** | 32 → 55-65 |
| Critical CSS | ✅ 自动 | ❌ 手工 |
| Lazy load 图片 | ✅ 自动 | ✅（WP Smush）|
| CSS minify + combine | ✅ 自动 | ✅（Autoptimize）|
| JS defer | ✅ 自动 | ✅（Autoptimize）|
| WebP 转换 | ❌（要装 Imagify $35/月）| ✅（WP Smush + ShortPixel free 100/月）|
| CDN | ✅ Cloudflare 一键配 | 🟡 Cloudflare Free 手动配 |
| Database 清理 | ✅ | ❌ |
| 升级维护 | 自动更新 | 自动更新 |
| Oztop 这种站推荐 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

### 💰 ROI 计算

| 方案 | 月度成本 | 12 月成本 | 拯救的流量 |
|---|---|---|---|
| A WP Rocket | AU$6/月 | AU$70 | 5,642 × 30% = +1,700 views/月（推回的移动用户）|
| B 免费组合 | AU$0 | AU$0 | +1,200 views/月 |

→ **每月差 +500 views × Oztop 平均 conversion 0.5% × 平均订单 AU$2,000** = AU$5,000/月差额 ≫ AU$70/年 WP Rocket 成本。

**子牙强烈推荐方案 A（WP Rocket）**。

---

## 🎯 方案 A · WP Rocket 实施 SOP

### Phase 1 · PM 购买 + 下载（5 min）

1. 访问 https://wp-rocket.me/
2. 选 **Single** 套餐 (AU$70/年 单站)
3. 用 PM 邮箱 + 信用卡付款
4. 邮箱收到 download link → 下载 wp-rocket.zip

### Phase 2 · FDE 安装 + 启用（5 min）

1. WP 后台 → **Plugins → Add New → Upload Plugin** 
2. 选 wp-rocket.zip → **Install Now** → **Activate**
3. WP Rocket 顶部菜单出现

### Phase 3 · 配置 5 个核心区块（30 min）

#### A) Cache 区块
- ✅ Enable caching for mobile devices
- ✅ Separate cache files for mobile devices  
- ✅ Enable caching for logged-in WordPress users
- Cache Lifespan: **10 days**

#### B) File Optimization 区块（最关键 — LCP 主战场）

**CSS**:
- ✅ Minify CSS files
- ✅ Combine CSS files
- ✅ **Optimize CSS delivery** → ⭐ Choose: **Remove Unused CSS** (BETA but works)
  - 或 fallback: **Load CSS asynchronously**

**JavaScript**:
- ✅ Minify JavaScript files
- ✅ Combine JavaScript files
- ✅ **Load JavaScript deferred**
- ✅ **Delay JavaScript execution** → 主要 3rd-party scripts（GTM / FB Pixel / Hotjar 等）

#### C) Media 区块

- ✅ Enable for images（Lazy load）
- ✅ Enable for iframes and videos
- ✅ **Replace YouTube iframe with preview image**
- ✅ Add missing image dimensions
- ❌ Disable WordPress embeds（如果不用 WP embed）

#### D) Preload 区块

- ✅ Activate Preloading
- ✅ Activate sitemap-based cache preloading
- ✅ Preload Fonts → 添加 Astra theme fonts 路径

#### E) Database 区块（一次性清理）

- 跑一次：
  - ✅ Post Revisions
  - ✅ Auto Drafts
  - ✅ Trashed Posts
  - ✅ Spam Comments
  - ✅ Expired Transients
  - ✅ Database Cleanup tables

### Phase 4 · CDN 集成（30 min）

#### 选项 1 · 用 RocketCDN（WP Rocket 自家，$8/月）
- WP Rocket → CDN 区块 → Activate → 输入 RocketCDN URL
- 立刻全球 CDN

#### 选项 2 · 用 Cloudflare Free（免费推荐）
- 注册 https://cloudflare.com Free plan
- 加 oztopbuildingsupplies.com.au domain
- Cloudflare 给 2 个 NS records
- SiteGround DNS 改 NS 到 Cloudflare（DNS 切换需要 24-48h 全球生效）
- WP Rocket → Add-ons → 启用 Cloudflare → 输入 API token + zone ID
- 自动配 Browser cache + Always Online + Auto Minify

### Phase 5 · 验证（24h 后）

1. 重跑 https://pagespeed.web.dev/analysis?url=https%3A%2F%2Foztopbuildingsupplies.com.au%2F&form_factor=mobile
2. 期望:
   - Performance Score: **65+**
   - LCP: **< 12s**
   - FCP: **< 3s**
   - Lighthouse SEO: 100/100 保持
3. 若 < 65 → 子牙诊断哪里还有阻塞

---

## 🛠️ 方案 B · 免费组合 SOP（如 PM 选免费）

### Plugin 1 · Autoptimize（CSS/JS 优化）

1. WP 后台 → Plugins → Add New → 搜 "Autoptimize" → Install + Activate
2. Settings → Autoptimize:
   - ✅ Optimize JavaScript Code → ✅ Aggregate JS-files → ✅ Force JavaScript in `<head>`
   - ✅ Optimize CSS Code → ✅ Aggregate CSS-files → ✅ Inline and Defer CSS
   - ✅ Optimize HTML Code
   - Save

### Plugin 2 · WP Smush（图片优化 + Lazy load）

1. Plugins → Add New → 搜 "WP Smush" → Install + Activate
2. Smush → Bulk Smush → Run（一次性压缩所有现有图片）
3. Smush → Lazy Load → 启用

### Plugin 3 · WP-Optimize（Database 清理 + Cache）

1. Plugins → Add New → 搜 "WP-Optimize" → Install + Activate
2. Cache → Enable page caching
3. Database → 跑一次 cleanup

### SG Optimizer（已装，启用更多功能）

1. WP 后台 → SG Optimizer → Performance:
   - ✅ Dynamic Caching
   - ✅ Memcached  
   - ✅ Browser Caching
   - ✅ Lazy Load Images（如未启）
2. Frontend Optimization:
   - ✅ Minify HTML
   - ✅ Combine CSS
   - ✅ Combine JS
   - ⚠️ 启用前测试 — 可能跟 Autoptimize 冲突，二选一

### Cloudflare Free（CDN）

1. 注册 https://cloudflare.com Free
2. 加 domain → 改 NS（同上 WP Rocket 流程）
3. 启用：
   - Browser cache TTL: 1 year
   - Always Online ON
   - Auto Minify: CSS / JS / HTML 全开
   - Rocket Loader: ON（异步加载 JS）

---

## ⚠️ 子牙能远程做的部分（无需 PM 付费）

子牙今晚立刻能装：
1. ✅ Autoptimize plugin（Chrome MCP 自动化）
2. ✅ 配 SG Optimizer Performance settings
3. ❌ WP Smush（需要 PM 同意 — 改全站图片）
4. ❌ Cloudflare（需要 PM 改 DNS NS records，DNS 操作不可逆 → PM 决定）

---

## 🚦 PM 立刻决策（3 选 1）

| 选项 | 子牙做 |
|---|---|
| **`方案 A — 我付 AU$70 装 WP Rocket`** | 子牙等 PM 下载 zip 后告诉，子牙帮 install + 全套 5 phase 配置（90 min） |
| **`方案 B — 走免费 Autoptimize + SG Cache`** | 子牙立刻 Chrome 装 Autoptimize + 配置（30 min）|
| **`先免费方案试，效果不够再升级 WP Rocket`** | 子牙立刻装 Autoptimize → 24h 后看 PageSpeed → 不够再装 Rocket |

子牙强烈推荐 **方案 A**（AU$70/年 = 0.1% 营收价格换 +30% 流量复活）。

---

*起草: 子牙 2026-06-24*
