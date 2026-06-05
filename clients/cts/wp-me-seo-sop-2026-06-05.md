# CTS Tours NZ · ME SEO 标准 SOP

> **日期**：2026-06-05（Phase 22.E 上线版）
> **适用对象**：FDE / PM
> **客户**：CTS Tours NZ — China travel specialists since 1928
> **目的**：把 Magic Engine 作为 Next.js + GitHub PR 部署的 SEO 内容生产线，覆盖每日 / 每周 / 每月节奏 + 应急处置
>
> **数据来源（按 CLAUDE.md 反凭空铁律必读）**：
> - `master_briefs` 表 — `brand_name = "CTS Tours"` / `core_proposition = "China travel specialists since 1928"`
> - `master_briefs.keyword_seeds` — 15 个真实方向（见下方 §0.1）
> - `clients.primary_keywords` — 待 PM 配（当前 NULL）
> - GSC 真实 baseline — 月点击 616 / 总曝光 48,256 / 平均排名 14.8 / Page-1 词数 1（2026-06-05 实测）

---

## 0. 客户事实卡（FDE 翻开 SOP 第一眼看这里）

### 0.1 业务方向（来自 master_brief，**严禁臆造**）

CTS Tours NZ 是 **outbound** 业务：把**新西兰 Kiwi 游客送到中国旅游**。**不是** inbound 中国游客到 NZ。

> "New Zealand's definitive China travel specialists since 1928, delivering authentic, seamlessly operated small-group tours through direct on-ground operations and unmatched cultural access."

### 0.2 真实 keyword_seeds（15 个，master_brief 唯一权威）

```
1.  china tours from new zealand
2.  china travel specialists nz
3.  great wall tours
4.  terracotta warriors xi'an
5.  beijing tours kiwi
6.  china visa free entry nz
7.  small group china tours
8.  guilin li river tours
9.  chengdu panda tours
10. zhangjiajie avatar mountains
11. china cultural tours
12. shanghai tours from auckland
13. best time visit china
14. china travel guide new zealanders
15. authentic china experiences
```

**FDE 选题时只能从这 15 个 + 它们的长尾派生（如 "great wall tours from auckland"）出发**，不能凭空写 "queenstown" / "new zealand inbound" / "australia inbound" 类内容。

### 0.3 平台特性

| 项 | CTS |
|----|-----|
| 域名 | `ctstours.co.nz` |
| 市场 | NZ（DataForSEO `location_code=2554`）|
| 站点平台 | **Next.js**（不是 WordPress）|
| 发布路径 | **GitHub PR 式部署**（不是 WP REST）|
| Schema 注入 | 直接写入 HTML `<head>` 或 Next.js `metadata` export |
| 时区 | NZST / NZDT |
| 语气 | NZ English（colour / organisation / travelling）|

### 0.4 GSC 真实 baseline（2026-06-05 实测，看板列头 sticky 显示）

```
📊 客户 SEO 基础：月点击 616 · 总曝光 48,256 · Page-1 词数 1 · 平均排名 14.8
```

**唯一 Page-1 词**是品牌词 `cts tours`（CTR 58%，质量极好）。其他 SEO 资产 0→1 阶段。

---

## 1. 每日 SOP（NZST 上午开工 30 分钟）

### 1.1 打开 CTS 看板第一眼看什么

🔗 https://app.magicengine.com.au/dashboard/clients/c0000000-0000-0000-0000-000000000000/execution

**SEO 内容列头**（Phase 22.E.S4ext 上线）：
- 看 **月点击** 是涨是跌（vs 上周 baseline）
- 看 **Page-1 词数** 是否新增
- 平均排名变好（数字变小）= 整体趋势 OK

### 1.2 看每日 cron 推的 SEO actions（Phase 22.E.S2b）

`seo-patrol-daily` 每天 4am UTC（NZST 4pm）跑，对 CTS keyword_snapshots 自动诊断 5 条规则：
- **R1 低 CTR 标题**：排名 P2-P3 但 CTR < 基准 60% → 推 `seo.refresh_blog` action
- **R2 缺内链**：页面有曝光但无内链导流 → 推 `seo.refresh_blog`
- **R3 内容老化**：排名近 30 天下滑 > 3 位 → 推 `seo.refresh_blog`
- **R4 机会词**：高量低 KD 未覆盖词 → 推 `seo.publish_blog`
- **R5 未收录**：GSC "discovered not indexed" > 7 天 → 推 `seo.refresh_blog`

最多 3 条 actions / 客户 / 天。

### 1.3 点开 SEO action 卡片看 S9 预期影响（Phase 22.E.S9）

每张卡片 Content Workbench 顶部绿色卡片显示：

```
📊 90 天预期影响
每月增加 ~N 点击
搜索量 X/月 × 第 N 位基准 CTR Y% × 保守系数 0.5
```

FDE 看到这个数字立刻知道"做这条值不值"。如果 N < 5 clicks/月 → 可考虑跳过。

### 1.4 按 action_type 走不同工作流（Phase 22.E.S13）

| action_type | Drawer 显示 tab | FDE 操作 |
|-------------|----------------|---------|
| `seo.publish_blog` | SEO 文章 | 用 Blog Studio 生成长内容 → GitHub PR 部署 |
| `seo.refresh_blog` | SEO 文章 | 找到现有博客文件 → 改标题/meta/内链 → GitHub PR |
| `seo.publish_landing_page` | SEO 落地页 stub | 后端 S14 待建。临时：用 SEO 文章 tab 生成长内容，再人工改为落地页结构 |
| `seo.optimize_page_seo` | 页面 SEO 优化 stub | 后端 S15 待建。临时：在 ME 后台 SEO Intelligence → Page Health 查 GSC 表现，手动改 title/meta/H1/Schema 后 GitHub PR |

### 1.5 CTS 专属 GitHub PR 部署流程

1. 在 Blog Studio 生成长内容（双信号 SEO + GEO）
2. 点击 "Generate to GitHub PR" — ME 自动开 PR 到 ctstours.co.nz repo
3. PM 在 GitHub 上 review → merge → Vercel 自动部署
4. 部署后 ME 自动调 `/gsc/index-request` 请求 Google 收录
5. 在看板 action 上点击 "已完成"

### 1.6 每日红线

- ❌ 不要凭空想关键词 — 只用 §0.2 的 15 个 seeds + 长尾
- ❌ 不要把 inbound 旅游/queenstown/milford sound 写进 CTS 内容
- ❌ 不要在没看 S9 预期影响的情况下决定做不做

---

## 2. 每周 SOP（每周一上午 1 小时）

### 2.1 等 `keyword-snapshots-weekly` cron 跑完（周一 2am UTC = NZST 2pm）

它会刷新 `keyword_snapshots` 表，含 CTS NZ 市场（location_code 2554）的真实 keyword 排名 + 搜索量 + KD。

### 2.2 看 ME 后台 SEO Intelligence

🔗 https://app.magicengine.com.au/dashboard/clients/c0000000-0000-0000-0000-000000000000/seo-intelligence

四个关键视图：

| 视图 | 看什么 |
|------|-------|
| **Rankings** | 当前 keyword 排名 + 周变化（新 / 进步 / 退步 / 掉出）|
| **Page Health** | 各页面 GSC 表现 7 天 delta（点击/曝光涨跌）|
| **Position Changes** | 哪些词周环比进了 P30 / P50 |
| **Keyword Gap** | 竞品有 CTS 没的真实机会词（按 13 个真实 keyword_seeds 维度查 DataForSEO）|

### 2.3 周决策

- 看 Page Health → 选 1 个 7d 点击下跌 > 20% 的页面做"救援"（FDE 手动 fde_manual action 进看板）
- 看 Keyword Gap → 从竞品有 CTS 没的词里选 1 个高搜索量低 KD 的开新博客（FDE 手动 action 进看板 + 在 metadata 里填真实 keyword + search_volume + KD）

---

## 3. 每月 SOP（每月 1 号上午 2 小时）

### 3.1 AI 可见度审查（Phase 22.A）

`ai-tracker-weekly` cron 每周一 1am UTC 跑，月底查 `ai_visibility_snapshots` 表：

- CTS 在 ChatGPT / AI Overview / Perplexity 提到中国旅游话题时的引用率
- 周环比 / 月环比走势
- 弱项查询（FDE 不可见 → 推 GEO Composer 优化 directive）

### 3.2 Industry Baseline 复查（Phase 30）

`baseline-domains-monthly` cron 每月 1 号跑，刷新 NZ outbound travel 行业基准：

- CTS 当前在行业基准里的位置（百分位 P50/P75/P90）
- vs 竞品 Trip A Deal / APT / Wendy Wu 的差距

### 3.3 月度 review 文档

FDE 在 `clients/cts/monthly-review-YYYY-MM.md` 记录：
- 上月看板完成的 actions 数
- 月点击 / 曝光 / Page-1 词数 / 平均排名月环比
- 1 个最大胜利 + 1 个最大失败 + 1 个下月聚焦

---

## 4. 应急 SOP

### 4.1 cron 失败（Render 触发）

如果 `seo-patrol-daily` 跑失败：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://app.magicengine.com.au/api/cron/seo-patrol-daily
```

查 Supabase logs 看具体错误。常见：DataForSEO API 429 → 等 5 分钟重试。

### 4.2 GSC 收录卡住

如果博客上线 48 小时仍未被 Google 收录：

1. 看 GSC URL Inspection 报什么（如 "Discovered - currently not indexed"）
2. 手动 Request Indexing
3. 检查 robots.txt 没屏蔽
4. 检查 sitemap.xml 包含新 URL
5. 检查 internal link：是否有别的页面链接到新博客

### 4.3 数据看起来"不对"

如果 S4ext 列头快照显示数字突然异常（如月点击从 616 跌到 0）：

1. 检查 `gsc_performance_snapshots` 最新一行（`period_end` 是不是太老）
2. 检查 `google-data-pullback-daily` cron 是否在跑（每天 3am UTC）
3. 检查 CTS GSC OAuth 是否过期（ME 后台 Settings → Connectors）

---

## 5. 关键反例（CTS 子牙踩过的坑）

### ❌ 反例 1：queenstown / milford sound

子牙 2026-06-04 把这些 inbound NZ 旅游词当成 CTS 测试数据 → 完全反向。**CTS 是 outbound Kiwi → China**。

### ❌ 反例 2：CTS to US（美国大学申请）

`master_briefs` 表里有一行污染（brand_name = "CTS to US"，keyword_seeds 是美国留学方向）—— **忽略它**，权威是 brand_name = "CTS Tours" 的那一行。

### ✅ 正例

- "great wall tours" → master_brief seed #3 ✅
- "chengdu panda tours" → master_brief seed #9 ✅
- "october in china" → seed #13 "best time visit china" 长尾 ✅

---

## 6. 下次更新触发条件

- Phase 22.E.S14（落地页生成 API）上线 → 改 §1.4 表格
- Phase 22.E.S15（页面 SEO 优化 API）上线 → 改 §1.4 表格
- PM 配置 `clients.primary_keywords` → 改 §0.4 数据来源
- master_brief 数据清理（去除 "CTS to US" 污染）→ 改 §5 反例 2

---

**最后**：本 SOP 是 ME Phase 22.E 上线后的首版 CTS SOP。所有数据来源在文档头部明确标注，FDE 看 SOP 时如发现任何数字与 ME 后台不符 → 优先信 ME 后台（DataForSEO / GSC 是真实数据源），并通知子牙更新 SOP。
