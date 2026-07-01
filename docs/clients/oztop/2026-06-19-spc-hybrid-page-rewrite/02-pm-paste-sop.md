# PM 操作 SOP · SPC/Hybrid 分类页改写

> **预估时长**: 10 分钟
> **风险**: 极低（可一键还原 — 操作前 PM 先复制现有 Description 备份到记事本）

---

## Part 1 · 修改分类页内容（5 分钟）

### 步骤 1 · 进入分类编辑页

1. WP 后台登录 → 左侧菜单 **Products** → **Categories**
2. 找到 **"SPC/WPC/Hybrid Flooring"** 那一行
3. 鼠标 hover 该行 → 点击 **Edit**

### 步骤 2 · 备份当前 Description

1. 滚到 **Description** 字段
2. 切到右上角 **Text** 标签页（不是 Visual）
3. 选中全部 → Cmd+C → 粘到一个 TextEdit / Notes 文件存档（万一改坏了可回滚）

### 步骤 3 · 粘贴新 Description

1. **清空** Description 字段全部
2. 打开 `docs/clients/oztop/2026-06-19-spc-hybrid-page-rewrite/01-rewrite-package.md`
3. 复制 **④ Category Description HTML** 整段 `<div class="oztop-category-intro">...</div>`
4. 粘到 Description 字段（确认是 Text 模式）

### 步骤 4 · Yoast SEO metabox（最关键 SEO 信号）

滚到页面底部 **Yoast SEO** metabox：

| 字段 | 粘什么 |
|---|---|
| **SEO title** | `Hybrid Flooring Brisbane \| SPC, WPC & 7 Brands \| Oztop` |
| **Slug** | 保持原样 `spc-wpc-hybrid-flooring` ⚠️ 不要改 |
| **Meta description** | `Compare 7 hybrid flooring brands at Oztop's Slacks Creek showroom — SPC, WPC, engineered options for Brisbane homes. View samples in-store, fast delivery.` |
| **Focus keyphrase** | `hybrid flooring brisbane` |

### 步骤 5 · Update

1. 滚到右侧 → 点蓝色 **Update** 按钮
2. 看到顶部绿色 "Term updated" 提示 = 成功

---

## Part 2 · 安装 Schema JSON-LD（3 分钟）

> Schema 不能直接放 WooCommerce category description（会被 Yoast 自动覆盖 Product schema），必须用 WPCode 单独注入。

### 步骤 1 · 进入 WPCode

1. WP 后台 → **Code Snippets** （WPCode plugin）→ **+ Add Snippet**
2. 选 **Add Your Custom Code (New Snippet)** → **HTML Snippet**

### 步骤 2 · 配置 Snippet

| 字段 | 填什么 |
|---|---|
| **Title** | `SPC Hybrid Category — FAQ + LocalBusiness Schema` |
| **Code Type** | HTML Snippet |
| **Code** | 复制 01-rewrite-package.md 里的 **⑤ FAQ Schema** + **⑥ LocalBusiness Schema** 两段 `<script>` 拼一起 |
| **Insertion** | Auto Insert → **Site Wide Footer** |
| **Conditional Logic** | ✅ Enable → **Page URL** → **Contains** → `/spc-wpc-hybrid-flooring/` |

### 步骤 3 · 启用 + Save

1. 右上角 toggle **Active** → 灰变蓝
2. 点 **Save Snippet**

---

## Part 3 · 清缓存 + 验证（2 分钟）

### 步骤 1 · Purge SiteGround Cache

1. WP 后台顶部黑条 → **SG Optimizer** → **Purge SG Cache**
2. 等弹出 "Cache purged" 提示

### 步骤 2 · 验证

打开**无痕窗口**访问:
```
https://oztopbuildingsupplies.com.au/product-category/flooring/spc-wpc-hybrid-flooring/
```

检查项:

| ✓ | 检查 |
|---|---|
| ☐ 浏览器 tab 标题显示 "Hybrid Flooring Brisbane \| SPC, WPC & 7 Brands \| Oztop" |
| ☐ 页面顶部出现新的 H2 "Hybrid Flooring Brisbane — SPC, WPC & Engineered Options Compared" |
| ☐ 看到 4 个 H3 小节（Why Hybrid / 7 Brands / SPC vs WPC / Pricing & Showroom） |
| ☐ 右键 → View Page Source → Cmd+F 搜 `"@type":"FAQPage"` 有命中 |
| ☐ 右键 → View Page Source → Cmd+F 搜 `"@type":"HomeAndConstructionBusiness"` 有命中 |

### 步骤 3 · Google Rich Results Test

打开: https://search.google.com/test/rich-results
1. 粘 URL: `https://oztopbuildingsupplies.com.au/product-category/flooring/spc-wpc-hybrid-flooring/`
2. 点 **Test URL**
3. 应该绿 ✅ 显示 **FAQ** + **Local Business** 两个 valid items

---

## Part 4 · 加速 Google 重抓（1 分钟）

1. 打开 [Google Search Console](https://search.google.com/search-console)
2. 选 Oztop 资源
3. 顶部 URL Inspection bar → 粘 `https://oztopbuildingsupplies.com.au/product-category/flooring/spc-wpc-hybrid-flooring/`
4. 等 30s 显示当前状态
5. 点 **Request Indexing**
6. 弹出确认 → 等绿色 ✅ "Indexing requested"

→ Google 24-48h 内重新爬取 + 重新评估排名

---

## 回滚方案（万一改坏）

| 改坏的部分 | 怎么还原 |
|---|---|
| Description 字段乱了 | 回 Products → Categories → SPC/WPC/Hybrid → Edit → 清空 Description → 粘步骤 2 备份的旧版 → Update |
| SEO title/meta 错了 | 同上, Yoast metabox 清空那 4 个字段 → Update |
| Schema snippet 出问题 | Code Snippets → 找 "SPC Hybrid Category — FAQ + LocalBusiness Schema" → toggle Active 关掉 |

---

## 跟进时间表

| 时间 | 做什么 |
|---|---|
| **改后立刻** | Rich Results Test + Page Source 验证（Part 3）|
| **24-48h** | GSC URL Inspection 看 "Coverage" 是否变成 "URL is on Google"（已抓取最新版）|
| **7-14 天** | 看 GSC Performance 是否开始出现 "hybrid flooring brisbane" 关键词 + 排名变化 |
| **30 天** | 评估 — 进入第二页（pos 11-20）= 改写有效；还在 pos 49 = 子牙重新评估 |
| **90 天** | 目标位 pos 5-15（第一页）|
