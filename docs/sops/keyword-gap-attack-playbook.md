# Keyword Gap Attack Playbook（关键词缺口攻击 SOP）

> **适用客户**：所有 FDE 月付客户 + self-serve 客户（接 Google Ads + SEO 内容飞轮）
> **第一受益客户**：CTS Tours NZ（2026-06-11 启动）
> **维护人**：诸葛亮（Ads 模块） + 华佗（诊断模块）
> **版本**：v1.0 — 2026-06-11

---

## 1 · 什么时候跑这套 SOP

任何一个**新客户**接 Google Ads 投放 **+** 想要 SEO 飞轮起势的时候，都跑这套 7 步。这不是"做完一次完事"的 SOP — 是**每月复跑一次的常规节奏**，竞品 + 季节性 + Google 算法都会让缺口动。

**触发节点**：
- 新客户接入第 1 个月（Day 8-14）
- 已有客户每月 1 日（月度复盘）
- 大行业变动后（如 Google 算法更新 / 重大政策变化如 visa-free）
- 客户加新产品线 / 新城市覆盖时

---

## 2 · 前置条件（不齐就别动手）

| # | 必须有 | 在哪里查 | 没有的处理 |
|---|---|---|---|
| 1 | 客户 `master_briefs` 已完成（brand_name / core_proposition / keyword_seeds / target_audience） | Supabase `master_briefs` 表 | PM 走 Brand Brief wizard 补完 |
| 2 | 客户 `clients.primary_keywords` 已配 | Supabase `clients.primary_keywords` | PM 在 ME 后台 Settings UI 配（**绝禁** 直接 SQL） |
| 3 | 客户 `clients.competitor_domains` 已配 5-20 个 | Supabase `clients.competitor_domains` | PM 在 ME 后台 CompetitorDomainsPanel 配 |
| 4 | 客户 GSC connector 已连 + `gsc_performance_snapshots` 至少有 1 行 28 天数据 | Supabase `gsc_performance_snapshots` | PM 走 GSC OAuth 流程，等 1 天 daily cron |
| 5 | ME industry baseline 已有该客户行业基准（`industry_benchmarks` + `baseline_domains`） | Supabase | 没有 → 子牙开 Phase 30 子任务补该行业基准 |
| 6 | 客户官网 sitemap / route 清单可见 | 本地 git 仓 / WebFetch 抓 sitemap.xml | 抓出来存 `docs/clients/<client>/site-map-<date>.md` |

---

## 3 · 7 步执行流程

### Step 1 · 拉 GSC 28 天真实搜索情报（金矿，最便宜）

**目的**：Google 已经免费告诉你 "用户在搜什么 + 你哪页排第几 + 你接住了几个"。

**操作**：

```sql
-- ME 后台跑（或诸葛亮 agent 跑）
SELECT
  site_url, period_start, period_end,
  total_clicks, total_impressions, avg_ctr, avg_position,
  top_pages, top_queries
FROM gsc_performance_snapshots
WHERE client_id = '<client_id>'
ORDER BY period_end DESC
LIMIT 1;
```

**拆出 4 类信号**：

| 类别 | 判断条件 | 行动 |
|---|---|---|
| **A. 自然品牌词**（已稳定） | 品牌名 + 客户在做的业务词，position ≤ 3 | 保留 / 不投 Google Ads（自然流量已够） |
| **B. 错位机会**（高 impressions 低 CTR）| impressions > 500 / CTR < 1% / position 5-15 | 🔥 **第一优先级**：写 SEO 内容优化标题 / meta + 上 Google Ads 抢前 3 位 |
| **C. 已排名但内容弱**（高 impressions 低 position） | impressions > 200 / position 15-30 | 改写页面内容 + 加内链 + Schema |
| **D. 完全没接住**（高 impressions 0 clicks） | impressions > 100 / clicks = 0 / position > 20 | 新建落地页 |

**输出文件**：`docs/clients/<client>/<date>-gsc-signal-buckets.md`

---

### Step 2 · 拉 ME industry baseline 拿行业天花板

**目的**：知道客户当前位置（p25 / p50 / p75 / p90）。

**操作**：

```sql
SELECT industry_category, market, dimension,
       score_p50, score_p75, score_p90,
       typical_monthly_budget_aud, notes
FROM industry_benchmarks
WHERE industry_category = '<client.industry>'
  AND market IN ('AU_NZ', 'AU', 'NZ');

SELECT domain, sub_industry, seo_score, geo_scope
FROM baseline_domains
WHERE industry = '<client.industry>'
ORDER BY seo_score DESC
LIMIT 20;
```

**结论卡（写进调研报告）**：
- 客户当前 SEO 分数 = X
- 行业 p50 = Y / p75 = Z / p90 = W
- 同细分赛道头部 3 家 = [domain1, domain2, domain3]
- **客户当前位置**：p25 / p50 / p75 / p90 哪一档

---

### Step 3 · ME 后台跑 keyword gap（DataForSEO 自动接入）

**目的**：拿 100 个"竞品有排名但客户没有"的关键词，带 KD / volume / intent。

**操作**：
1. ME 后台 → 进客户详情页 → SEO Intelligence → Keyword Gap
2. 等 60s（DataForSEO live 调用，有 60s s-maxage cache）
3. 截图导出 100 行 gap keywords
4. 存到 `docs/clients/<client>/<date>-keyword-gap-raw.csv`

**底层调用**：`GET /api/clients/{id}/seo-intelligence/competitors-gap`

⚠️ **不要每天跑** — 一次 DataForSEO domain_intersection ≈ 4 USD（每竞品 1 USD × top 3 + bulk volume）。月度 1 次足够。

---

### Step 4 · 筛 KD<20 / Volume>100 / commercial+transactional

**目的**：从 100 行 raw gap 里筛出可投资的"机会词"。

**Filter**：

```js
const opportunity = rawGap.filter(kw =>
  (kw.keyword_difficulty ?? 100) < 20 &&     // 容易排
  (kw.search_volume ?? 0) > 100 &&            // 有流量
  ['commercial', 'transactional'].includes(kw.intent) && // 有商业意图
  isBusinessRelevantKeyword(kw.keyword, businessTerms)   // 是真业务方向（防杂质）
)
```

**为什么 KD<20**：FDE 月付客户 SEO 投入有限，KD<20 的词 3-6 个月内能上首页。KD 20-40 留到 Phase 2 推。KD>40 的词不投入，直接投 Google Ads 抢。

**为什么 Volume>100**：低于 100 的词 ROI 太低（哪怕你做到第 1 月点击也就 30+，不值产能）。

**为什么 commercial+transactional**：informational 词点击不转化。这套 SOP 不做品牌建设型 informational，那是另一条 SEO 飞轮 SOP（写 blog 教育内容那条）。

**输出**：`docs/clients/<client>/<date>-opportunity-keywords.md`（按 volume 降序，每行带 KD / CPC / intent）

---

### Step 5 · Cross 比对客户现有页面 → 缺口分类

**目的**：把机会词分成 3 桶 — ✅有页对应 / ⚠️有页但内容弱 / ❌完全没页。

**操作**：

1. 拉客户站点 88 个 route（从 git 仓 `src/app/**/page.tsx` 或 sitemap.xml）
2. 用关键词 fuzzy 匹配到最相关的 route
3. 对每个机会词归一到下面 3 类：

| 桶 | 判断 | 行动 |
|---|---|---|
| ✅ **有页对应** | 关键词跟某个现有 page 主题 ≥80% 匹配 | 直接拿这页 URL 当 Google Ads Final URL + 让 SEO 改写 H1 / title / meta 把这词塞进去 |
| ⚠️ **有页但内容弱** | 关键词只匹配到一个泛页（如 `/blog`），没专题页 | 改造现有相关页（如 `/china-tours` 加这个长尾的 anchor section）+ 加内链 |
| ❌ **完全没页** | 关键词跟所有 88 个 page 都没有强匹配 | 新建专题页（blog or landing），列入 SEO 内容 backlog |

**输出**：`docs/clients/<client>/<date>-page-keyword-mapping.md`（一张大表，3 列：机会词 / 状态 / 行动）

---

### Step 6 · 写广告 + 落地页 + SEO 内容三件套

**目的**：把缺口落地为可执行的 3 类产出。

#### 6.1 · Google Ads 计划

按 Step 5 桶 ✅ + ⚠️ 出 1-3 个 Ad Group：

| Ad Group | 词来源 | Match | 落地页 |
|---|---|---|---|
| AG_HighIntent | Step 5 ✅ 桶里 transactional 词 | Exact + Phrase | Step 5 对应的客户域名 page |
| AG_Education | Step 5 ✅ 桶里 commercial info 词 | Phrase | 对应 blog / guide |
| AG_LongTail | Step 5 ⚠️ 桶 | Exact only | 改造后的现有页 |

**Day 1-14 规则**：
- 全部 Exact / Phrase，**禁 Broad**
- Maximize clicks（不上 tCPA）
- 否定词清单从 GSC 杂质搜索词 + 业务边界外词 + 通用屏蔽词出
- 单 Ad Group NZ$10-20/日

#### 6.2 · 落地页改造（SEO 同步）

对 Step 5 ✅ + ⚠️ 桶涉及的每个现有页：
- 在 H1 / first paragraph 自然嵌入机会词
- 加 internal anchor section（针对长尾词）
- 加 JSON-LD Schema（Article / Product / FAQ / TouristTrip 任选）
- 加 internal links 互联（每页 3-5 条）

#### 6.3 · SEO 内容生产（针对 ❌ 桶）

把 Step 5 ❌ 桶的关键词送进 ME 后台 SEO 内容引擎（双信号模式：unified）：
- 选题 = 机会词
- mode = unified（带 SEO + GEO 信号）
- output = blog post → publish 到客户域名 `/blog/<slug>`

每个新 blog 写完后 30 天回查 GSC 是否上排名 → 进 Step 1 下一轮。

---

### Step 7 · 写 Airtable Decisions Log + ROADMAP 登记

**目的**：让 PM 在 Airtable 一眼看到本轮决策，让历史可溯。

**Airtable**：客户专属 Decisions Log 表（如 CTS = `app8Hlx28jAfGabdH/tbllcR9tkSFQaEjfT`）写 1 条记录：
- `Date (NZST)`：今天
- `Decision`：本轮 SOP 结论摘要（200 字内）
- `Approved By`：PM
- `Executed By`：诸葛亮
- `ME Audit ID`：相关 `flywheel_actions.id`（如适用）
- `Status`：Planned / Executing / Done

**git 仓**：本轮调研报告写到 `docs/clients/<client>/<date>-keyword-gap-research.md`，commit message `feat(<client>): keyword gap attack round <N> [PXX.XX]`

**ROADMAP.md**：登记到对应 Phase 的执行日志（§ 9 功能完成日志），格式 `<date> <client> keyword gap round <N>: X 个新页面 + Y 个 ads 词 + Z 个 SEO 改写`。

---

## 4 · 输出文件清单（每轮必出）

```
docs/clients/<client>/
  <date>-gsc-signal-buckets.md           # Step 1
  <date>-industry-baseline-position.md   # Step 2
  <date>-keyword-gap-raw.csv             # Step 3
  <date>-opportunity-keywords.md         # Step 4
  <date>-page-keyword-mapping.md         # Step 5
  <date>-google-ads-plan.md              # Step 6.1
  <date>-seo-page-rewrites.md            # Step 6.2
  <date>-seo-content-backlog.md          # Step 6.3
  <date>-keyword-gap-research.md         # 总报告（包含 1-6 的精要）
```

---

## 5 · 这套 SOP 不做什么（边界）

- ❌ 不替 PM 决定预算分配（行业 vs 品牌 vs 教育的比例 PM 拍板）
- ❌ 不直接执行 Google Ads 上线 — 必须 PM 签字（参考 Google Ads 配置 SOP Step 8）
- ❌ 不改客户网站内容 — 出 brief 给 FDE 改（如果客户用 WordPress / 自管 CMS）
- ❌ 不投 KD>40 的词到 SEO（SEO 投入产出比差）— 改投 Google Ads
- ❌ 不动客户已稳定的品牌词自然排名（不抢自己的有机流量）

---

## 6 · 历史版本

| 版本 | 日期 | 改动 |
|---|---|---|
| v1.0 | 2026-06-11 | 诸葛亮 + 子牙起草，CTS Tours NZ 首轮跑通后沉淀 |
