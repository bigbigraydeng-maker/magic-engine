# Oztop · ME + WordPress SEO 标准 SOP

> 日期：2026-06-03
> 适用对象：FDE / PM
> 客户：Oztop Building Supplies
> 目的：把 Magic Engine 作为 WordPress 内容 SEO 生产线来用，稳定完成“生成 -> 检查 -> 推送草稿 -> 发布 -> 收录”

---

## 0. 先说结论：ME 内能做到哪一步

### 已可在 ME 内完成

1. 选关键词 / 选题并生成博客草稿
2. 自动生成 `title` / `meta title` / `meta description` / `slug`
3. 读取站点页面上下文，辅助插入内部链接
4. 对内部链接数量做质量检查
5. 推送到 WordPress Draft
6. 如果 Yoast REST 扩展已启用，自动写入：
   - SEO title
   - Meta description
   - Focus keyphrase
7. 在 ME 内点击 Publish
8. 在 ME 内请求 Google 收录

### 仍需要人工处理

1. 全站技术 SEO：
   - 301 / canonical
   - taxonomy / archive noindex
   - sitemap 清理
   - 首页 / 分类页模板改造
   - 站点速度
2. 首次安装 Yoast mu-plugin
3. WordPress 主题 / Elementor 模板级改动
4. 旧文章批量补 SEO 字段

### 当前最佳使用方式

- 把 ME 当成“新内容生产线”
- 把 WordPress 后台当成“发布确认 + 模板校验台”
- 把技术 SEO 当成独立清单处理，不混在单篇内容发布流程里

---

## 1. 开工前检查

### A. WordPress 连接检查

1. 进入 `Settings -> 网站连接 -> WordPress`
2. 确认状态为 `已连接`
3. 点击 `测试连接`
4. 结果必须是：
   - 账号可访问
   - 具备发文权限

### B. Yoast 检查

1. 在 WordPress 连接卡里点击 `验证安装`
2. 结果分两种：
   - `SEO 扩展已启用`：今天这篇可以让 ME 自动写 Yoast
   - `SEO 扩展未安装`：今天这篇仍可发，但要去 WP 后台手动补 Yoast

### C. 默认分类检查

1. 在 WordPress 连接卡确认默认分类
2. Oztop 博客默认应设为 `Flooring` 对应的分类 ID
3. 如果没设，今天先手动确认一次；后续固定下来

---

## 2. 单篇标准流程

### Step 1：在 ME 建立文章任务

1. 进入 `Oztop -> Blog Studio`
2. 输入：
   - `topic`
   - `primary keyword`
   - `mode`
3. 规则：
   - 场景词、比较词、成交词优先
   - 默认用 `unified`
   - 只有当这篇明显更偏 AI 推荐训练时，才用 `geo_only`

### Step 2：生成后先看 6 个地方

1. 标题是否包含主关键词
2. `meta title` 是否清晰、可点击
3. `meta description` 是否有 CTA
4. H2/H3 结构是否像真实买家指南
5. 是否至少有 3 个品牌提及
6. 是否至少有 3 个内部链接

### Step 3：决定是否直接进发布

符合下面条件才进发布：

1. 关键词没跑偏
2. 字数足够
3. 内链不为 0
4. FAQ 存在
5. CTA 明确

如果不符合：

1. 先在 ME 里重新生成一次
2. 仍不行再走人工微调

---

## 3. 发布 SOP

### 路径 A：理想状态（推荐）

适用条件：

- WordPress 已连接
- Yoast probe 通过
- 草稿可正常推送

流程：

1. 在博客详情页点击 `发布到网站`
2. 先执行 `Create Draft`
3. 打开 `Preview URL`
4. 检查：
   - 标题显示正常
   - 正文排版正常
   - 内部链接能点
   - 图片正常
   - 没有明显重复标题块
5. 确认无误后点击 `Publish`
6. 若返回 `published_url`，立刻点 `请求 Google 收录`

### 路径 B：半自动 fallback

适用条件：

- WordPress 能连，但 Yoast probe 未通过

流程：

1. 仍然在 ME 内 `Create Draft`
2. 在 WP 后台打开草稿
3. 手动补：
   - Focus keyphrase
   - SEO title
   - Meta description
4. 预览
5. 发布
6. 回到 GSC 提交收录

### 路径 C：纯手动 fallback

适用条件：

- WordPress Draft 推送失败
- 主机安全策略拦 API

流程：

1. 在 ME 里复制文章 HTML
2. 到 WP Code Editor 新建 Post
3. 手动配置 Yoast
4. 发布
5. GSC 提交收录

---

## 4. 发布后必做

1. 记录最终 URL
2. 记录目标关键词
3. 记录发布时间
4. 记录是否：
   - 自动写入 Yoast
   - 自动收录请求成功
5. 48-72 小时后复查：
   - 是否被收录
   - Search Console impressions 是否开始出现

---

## 5. 质量红线

以下情况不要发布：

1. 主关键词缺失
2. 没有内部链接
3. 标题与文章意图不一致
4. 品牌名提及过少
5. CTA 太弱
6. 发布页看起来像产品堆砌而不是买家指南

---

## 6. Oztop 的默认 SEO 规则

### 内容策略

1. 优先打 `SPC / Hybrid Flooring` 场景词
2. Brisbane 优先，Logan 第二，Gold Coast 后置
3. 每篇都要把流量导向产品页或 Book Free Measure

### 站内链接默认目标

1. `SPC / hybrid flooring`
   - `/product-category/flooring/spc-wpc-hybrid-flooring/`
2. `Engineered timber`
   - `/product-category/flooring/engineered-timber-flooring/`
3. `Vinyl flooring`
   - `/product-category/flooring/vinyl-flooring/`
4. `Tiles`
   - `/product-category/tiles/`

### CTA 默认写法

优先统一成：

- `Book Free Measure`
- `Talk to Oztop`
- `Get advice on the right flooring for your Brisbane home`

---

## 7. 今天执行时的推荐节奏

1. 先确认 WordPress 连接正常
2. 再确认 Yoast probe 是否通过
3. 在 ME 里生成今天这篇文章
4. 先走 Draft，不直接 Publish
5. 预览无误再发
6. 发完立刻请求 Google 收录

---

## 8. 今天不做的事

1. 不顺手修全站 taxonomy
2. 不顺手改首页
3. 不顺手改分类页模板
4. 不顺手补 20+ 篇旧文章的 Yoast

原则：今天只把一篇内容闭环跑通。

---

# Phase 22.E 追加章节（2026-06-05 上线）

> 本节为 2026-06-05 Phase 22.E（SEO 自动巡逻 + 子类型精细分流）上线后追加。原有 §1-8 的 WordPress + Yoast 单篇发布流程依然有效，本节在它之上叠加每日 / 每周 / 每月节奏 + 看板自动推荐 + 预期影响估算。

## 9. 客户事实卡（按反凭空铁律必读）

### 9.1 真实业务方向（master_brief 唯一权威）

Oztop Building Supplies — **澳大利亚 Brisbane 主营 flooring / carpet / tiles / bathware**。

> "Oztop Building Supplies delivers premium flooring, carpet, tiles, and bathware solutions for Australian homeowners and builders, combining extensive product selection with expert consultation and competitive pricing."

**严禁假设**：
- ❌ Oztop 卖 plantation shutters / sheer curtains / herringbone flooring（**子牙 2026-06-04 凭空假设，PM 纠偏后已删**）

### 9.2 真实 keyword_seeds（13 个，master_brief 唯一权威）

```
1.  flooring brisbane
2.  hybrid flooring
3.  engineered timber flooring
4.  bathroom renovation brisbane
5.  carpet installation brisbane
6.  porcelain tiles australia
7.  bathroom tapware
8.  vinyl flooring brisbane
9.  laminate flooring
10. bathroom tiles brisbane
11. carpet near me
12. flooring specialist brisbane
13. building supplies brisbane
```

### 9.3 真实 primary_keywords（PM 已配，5 个）

```
flooring · spc · vinyl floor · pet floor · spc floor
```

### 9.4 GSC 真实 baseline（2026-06-05 实测，看板 sticky 显示）

```
📊 客户 SEO 基础：月点击 155 · 总曝光 7,006 · Page-1 词数 0 · 平均排名 18.7
```

唯一 P1 排名是品牌词 `oztop building supplies`。其他全部 0→1。

**`Page-1 词数 0` 的解释**：这个数字来自 `keyword_snapshots` 表（DataForSEO 追踪的非品牌 SEO 机会词），不含品牌词。品牌词 `oztop building supplies` 虽然 GSC 显示 P1，但未纳入 DataForSEO 追踪集（追踪它没意义，本来就是品牌词），所以这里不计入。看板列头的"Page-1 词数 = 0" = "Oztop 没有任何非品牌 SEO 机会词进入 Google P1"。

## 10. 每日 SOP（AEST 上午开工 30 分钟）

🔗 https://app.magicengine.com.au/dashboard/clients/d5c98811-1c1d-4ded-bdf0-4cefec6afb84/execution

### 10.1 看板 SEO 列头看什么（Phase 22.E.S4ext）

```
📊 客户 SEO 基础：月点击 N · 总曝光 N · Page-1 词数 N · 平均排名 N.N
```

数字 vs 昨日 / 上周变化即是健康度信号。

### 10.2 看每日 cron 推的 SEO actions（Phase 22.E.S2b）

`seo-patrol-daily` 每天 4am UTC（AEST 2pm）跑，对 Oztop keyword_snapshots 自动诊断 5 规则：

- **R1 低 CTR 标题**：排名 P2-P3 但 CTR < 基准 60% → 推 `seo.refresh_blog`
- **R2 缺内链**：页面有曝光但无内链导流 → 推 `seo.refresh_blog`（🚧 当前版本不触发 — 数据采集 site-crawl 链接图待建）
- **R3 内容老化**：排名近 30 天下滑 > 3 位 → 推 `seo.refresh_blog`
- **R4 机会词**：高量低 KD 未覆盖词 → 推 `seo.publish_blog`
- **R5 未收录**：GSC "discovered not indexed" > 7 天 → 推 `seo.refresh_blog`（🚧 当前版本不触发 — GSC Index Coverage API 接入待建）

每客户每天最多 3 条 actions。**当前实际生效的是 R1 / R3 / R4 三条**，R2/R5 在数据采集到位前不触发。

### 10.3 点开 SEO action 卡片看 S9 预期影响

Content Workbench 顶部绿色卡片显示：

```
📊 90 天预期影响
每月增加 ~N 点击
搜索量 X/月 × 第 N 位基准 CTR Y% × 保守系数 0.5
```

N < 5 clicks/月 → 可考虑跳过。

### 10.4 按 action_type 路由（Phase 22.E.S13）

| action_type | Drawer tab | Oztop 操作（WordPress + Yoast）|
|-------------|-----------|------------------------------|
| `seo.publish_blog` | SEO 文章 | 走原有 §2-3 流程（Blog Studio → WP Draft → 预览 → Publish → GSC 收录）|
| `seo.refresh_blog` | SEO 文章 | 在 ME 找到现有博客 → 改标题/meta/内链 → WP 更新 |
| `seo.publish_landing_page` | SEO 落地页 stub | 后端 S14 待建。临时：用 SEO 文章 tab 生成长内容，再让 CMS 同事改为 WP "Page"（不是 "Post"）|
| `seo.optimize_page_seo` | 页面 SEO 优化 stub | 后端 S15 待建。临时：在 ME 后台 SEO Intelligence → Page Health 查 GSC 表现，手动改 title/meta/H1 → WP 后台 Yoast 改 |

### 10.5 Oztop 每日红线

- ❌ 不要写 plantation shutters / sheer curtains / herringbone 内容（Oztop 不卖）
- ❌ 不要假设 Brisbane 之外其他城市优先（master_brief 主战场是 QLD）
- ❌ 不要凭空想数字 — search_volume / KD 必从 DataForSEO 真查

## 11. 每周 SOP（每周一上午 1 小时）

等 `keyword-snapshots-weekly` cron 跑完（周一 2am UTC = AEST 12pm 周一），看 ME 后台 SEO Intelligence（**单页滚动布局，向下依次看 4 个 section**）：

- **Rankings**：当前 keyword 排名 + 周变化
- **Page Health**：各页面 GSC 表现 7 天 delta
- **Position Changes**：哪些词周环比进了 P30 / P50
- **竞品对比 + 关键词缺口**：竞品（Carpet Court / FloorWorld / theflooringguys）有 Oztop 没的真实机会词

### 11.1 周决策

- 看 Page Health → 选 1 个 7d 点击下跌 > 20% 的 WP page 做"救援"（在执行看板右上角点击 **`+ 手动录入`** → 填 title / description / dimension=`seo` / fix_type=`fde_manual`）
- 看"竞品对比 + 关键词缺口" → 从 13 个真实 keyword_seeds 维度选 1 个写新 WP post（同上方式手动录入 + steps_json 里必须走 DataForSEO 真实 search_volume + KD，**禁止凭空**）

## 12. 每月 SOP

- AI 可见度审查（看 `ai_visibility_snapshots` 表）
- Industry Baseline 复查（AU flooring / building supplies 行业）
  - **当前需 PM 手动触发**：`baseline-domains-monthly` endpoint 尚未在 render.yaml 注册自动调度
- 月度 review 文档 `clients/oztop/monthly-review-YYYY-MM.md`

## 13. 应急 SOP

完全同 CTS SOP §4（cron 失败 / GSC 收录卡住 / 数据看起来不对）。

**Oztop 专属应急**：

- WordPress 连接掉了 → 检查 Settings → 网站连接 → WordPress 状态
- Yoast 自动写入失败 → 走 §3 路径 B（半自动 fallback，手动补 SEO 字段）
- WP 主机拦截 API → 走 §3 路径 C（纯手动，复制 HTML 到 WP Code Editor）

## 14. 关键反例（Oztop 子牙踩过的坑）

### ❌ 反例 1：5 个虚构品类页（2026-06-04）

子牙凭空注入 5 个 actions：
1. vinyl flooring（方向 OK 但缺 brisbane 后缀）
2. carpet brisbane（方向对）
3. **herringbone flooring** — master_brief 无
4. **plantation shutters brisbane** — Oztop 不卖
5. **sheer curtains** — Oztop 不卖

并配编的搜索量 18100 / 8100 / 14800 / 5400 / 22200。PM 纠偏后全删，并把"反凭空铁律"写入 CLAUDE.md。

### ✅ 正例

- "flooring brisbane" → master_brief seed #1 ✅
- "bathroom renovation brisbane" → master_brief seed #4 ✅
- "vinyl flooring brisbane" → master_brief seed #8 ✅

## 15. 下次更新触发条件

- S14（落地页生成 API）上线 → 改 §10.4 表格
- S15（页面 SEO 优化 API）上线 → 改 §10.4 表格
- PM 调整 `clients.primary_keywords` → 改 §9.3
