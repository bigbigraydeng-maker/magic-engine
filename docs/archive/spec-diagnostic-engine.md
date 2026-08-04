# Magic Engine — Diagnostic Engine 开发规格

> 版本：v1.0 · 日期：2026-05-12 · 对应 ROADMAP Phase 8.5
>
> 本文档是 Claude Code 的实施指南，覆盖三层完整链路：
> **① 六维诊断报告** → **② AI 处方生成** → **③ FDE 执行工作流**

---

## 目录

1. [系统总览](#1-系统总览)
2. [数据模型](#2-数据模型)
3. [Layer 1 — 诊断引擎](#3-layer-1--诊断引擎)
4. [Layer 2 — 处方生成](#4-layer-2--处方生成)
5. [Layer 3 — FDE 执行工作流](#5-layer-3--fde-执行工作流)
6. [UI 组件规格](#6-ui-组件规格)
7. [API 路由汇总](#7-api-路由汇总)
8. [实施顺序与验收标准](#8-实施顺序与验收标准)

---

## 1. 系统总览

### 1.1 三层链路

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: 诊断引擎                                               │
│  FDE 点击"运行诊断" → ME 并发拉取6维数据 → 评分 → 写快照         │
│  输出：diagnostic_run（健康度快照）+ diagnostic_findings（发现项）│
└──────────────────────────────┬──────────────────────────────────┘
                               │ run_id
┌──────────────────────────────▼──────────────────────────────────┐
│  LAYER 2: 处方生成                                               │
│  FDE 填写客户访谈摘要 → Claude Sonnet 生成处方草稿 → FDE 审批    │
│  输出：prescription（Phase 1/2/3 行动计划）                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ prescription_id
┌──────────────────────────────▼──────────────────────────────────┐
│  LAYER 3: FDE 执行工作流                                         │
│  每条行动项 → 分类路由 → ME自动执行 / FDE手动 / 第三方操作单     │
│  输出：execution_items（执行进度追踪）                            │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 六维评战场（Six Battlefields）

| ID | 维度 | 封装名（UI展示） | 数据来源 |
|----|------|----------------|---------|
| `seo` | 搜索 SEO | SEO 可见度 | SEMrush + DataForSEO SERP + Site Audit |
| `ai_visibility` | AI 曝光 | AI 曝光度 | AI Tracker (OpenAI/Google/Perplexity) |
| `ads` | 广告投放 | 广告情报 | Meta Ads CSV / OAuth（未来）|
| `social` | 社交媒体 | 社媒矩阵 | Apify Instagram/Facebook Scraper |
| `reputation` | 口碑评价 | 口碑分析 | Google Places API（真名）|
| `competitor` | 竞品全景 | 竞品雷达 | SEO Analytics Engine + Keyword Intelligence + 广告情报采集器 |

### 1.3 权限边界

- 诊断触发：FDE 专属（内部后台）
- 处方生成：FDE 专属
- 处方审批：FDE 专属（`approved_by` 记录审批人）
- 执行进度查看：FDE 专属（客户 Portal 为未来功能，本期不做）

---

## 2. 数据模型

### 2.1 `diagnostic_runs` 表

```sql
CREATE TABLE diagnostic_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  triggered_by    TEXT NOT NULL,                    -- FDE 用户名或 'system'
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|running|completed|failed
  module          TEXT NOT NULL DEFAULT 'full',     -- full|seo|social|competitor
  overall_score   INTEGER,                          -- 0-100，completed 后填入
  score_breakdown JSONB,                            -- { seo: 45, ai_visibility: 12, ... }
  summary_text    TEXT,                             -- AI 生成的一句话总结
  data_collected_at TIMESTAMPTZ,                   -- 数据拉取完成时间
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX ON diagnostic_runs (client_id, created_at DESC);
CREATE INDEX ON diagnostic_runs (status);
```

### 2.2 `diagnostic_findings` 表

```sql
CREATE TABLE diagnostic_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES diagnostic_runs(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  dimension       TEXT NOT NULL,    -- seo|ai_visibility|ads|social|reputation|competitor
  severity        TEXT NOT NULL,    -- critical|high|medium|low|info
  finding_type    TEXT NOT NULL,    -- 机读分类，见附录 A
  title           TEXT NOT NULL,    -- 人读标题，≤ 80 字符
  description     TEXT NOT NULL,    -- 详细描述，含数据证据
  evidence_json   JSONB,            -- 原始数据快照（数字/表格/列表）
  recommendation  TEXT NOT NULL,    -- 具体建议
  fix_type        TEXT NOT NULL,    -- me_auto|fde_manual|third_party
  fix_deeplink    TEXT,             -- ME 内部路由或第三方 URL（可选）
  is_dismissed    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON diagnostic_findings (run_id, dimension);
CREATE INDEX ON diagnostic_findings (client_id, severity);
```

### 2.3 `prescriptions` 表

```sql
CREATE TABLE prescriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  run_id          UUID REFERENCES diagnostic_runs(id),
  intake_json     JSONB NOT NULL,   -- FDE 访谈摘要输入
  content_json    JSONB NOT NULL,   -- 处方内容（见 4.3 处方结构）
  status          TEXT NOT NULL DEFAULT 'draft',  -- draft|approved|rejected|superseded
  approved_by     TEXT,             -- FDE 姓名
  approved_at     TIMESTAMPTZ,
  rejection_note  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON prescriptions (client_id, created_at DESC);
CREATE INDEX ON prescriptions (status);
```

### 2.4 `execution_items` 表

```sql
CREATE TABLE execution_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phase           INTEGER NOT NULL,   -- 1|2|3
  dimension       TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  owner_type      TEXT NOT NULL,      -- me_auto|fde_manual|third_party
  owner_tool      TEXT,               -- ME路由 / 工具名（封装名）
  steps_json      JSONB,              -- 分步骤说明（第三方操作用）
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|in_progress|completed|skipped
  completed_by    TEXT,
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON execution_items (prescription_id, phase, sort_order);
CREATE INDEX ON execution_items (client_id, status);
```

---

## 3. Layer 1 — 诊断引擎

### 3.1 诊断运行器架构

```
POST /api/clients/[id]/diagnostic/run
        │
        ├── 创建 diagnostic_run（status=running）
        │
        ├── 并发启动6个 Collector（Promise.allSettled）
        │   ├── SeoCollector.collect()
        │   ├── AiVisibilityCollector.collect()
        │   ├── AdsCollector.collect()
        │   ├── SocialCollector.collect()
        │   ├── ReputationCollector.collect()
        │   └── CompetitorCollector.collect()
        │
        ├── 每个 Collector → Scorer → 返回 { score, findings[] }
        │
        ├── 汇总 overall_score（加权平均）
        ├── 写入 diagnostic_findings（批量 INSERT）
        └── 更新 diagnostic_run（status=completed）
```

**超时策略**：每个 Collector 独立 30s 超时；超时的维度 findings 标注 `severity=info`，`title="数据暂时不可用"`，不影响其他维度评分。

### 3.2 评分权重

```typescript
const DIMENSION_WEIGHTS = {
  seo:            0.25,   // 搜索可见度最重要
  ai_visibility:  0.20,   // 增长最快的流量来源
  ads:            0.20,   // 直接ROI关联
  social:         0.15,
  reputation:     0.10,
  competitor:     0.10,
}

// overall_score = Σ(dimension_score × weight)
// 各维度 score 为 0–100 整数
```

### 3.3 各维度 Collector 规格

#### SEO Collector

**文件**：`src/lib/diagnostic/collectors/seo-collector.ts`

**数据拉取（并发）**：
- DataForSEO `/serp/google/organic/live` × 客户 primary_keywords（最多 20 个）
- DataForSEO `/dataforseo_labs/google/keyword_gap` vs 竞品主域名
- Supabase query: `client_site_pages WHERE client_id = ?`（Site Audit 结果）
- SEMrush `domain_ranks` for client domain
- DataForSEO `/backlinks/summary` for client domain

**评分子维度**（各 0–100，加权合并）：

| 子维度 | 权重 | 计算逻辑 |
|--------|------|---------|
| 关键词排名覆盖 | 30% | 前10名关键词数 / 目标关键词总数 |
| 有机流量估算 | 25% | SEMrush organic_traffic，线性映射到分段得分 |
| 内容健康度 | 25% | (word_count≥500的页面比例×60%) + (有GEO block的页面比例×40%) |
| 外链权威 | 20% | domain_rank 0–100 直接映射 |

**典型 Findings 类型**：
- `keyword_gap_critical`：竞品前10但客户无排名的高价值词（≥500月搜）
- `thin_content`：word_count < 500 的 landing/product 页面（超过30%）
- `no_geo_block`：全站 has_geo_block = false
- `low_domain_rank`：domain_rank < 20
- `missing_local_pages`：城市关键词无对应落地页

#### AI Visibility Collector

**文件**：`src/lib/diagnostic/collectors/ai-visibility-collector.ts`

**数据拉取**：
- Supabase query: `ai_visibility_runs WHERE client_id = ? ORDER BY created_at DESC LIMIT 1`
- 若无数据：返回单条 `severity=critical` finding，建议先运行 AI Tracker

**评分逻辑**：
```typescript
// avg_rank: 1=最好, null=未被提及
const score = avg_rank === null ? 0
  : avg_rank <= 1.5 ? 90
  : avg_rank <= 2.0 ? 70
  : avg_rank <= 2.5 ? 50
  : avg_rank <= 3.0 ? 30
  : 10;
```

**典型 Findings 类型**：
- `not_mentioned_by_ai`：品牌从未出现在 AI 推荐中
- `low_ai_rank`：avg_rank > 2.5
- `no_geo_directives`：GEO block 未部署（关联 Site Audit）
- `competitor_ai_dominant`：竞品在 AI Tracker 问句中排名 1，客户未出现

#### Ads Collector

**文件**：`src/lib/diagnostic/collectors/ads-collector.ts`

**数据拉取**：
- Supabase query: `ad_diagnostic_runs WHERE client_id = ? ORDER BY created_at DESC LIMIT 1`（已有 Phase 8.P 数据，若有）
- 若 Meta OAuth 已连接：拉取账户健康度快照
- 若无广告数据：返回 `severity=high` finding，建议 CSV 上传或连接账户

**评分**：直接复用 Ads Intelligence 模块已有的 `health_score` 字段。

#### Social Collector

**文件**：`src/lib/diagnostic/collectors/social-collector.ts`

**数据拉取**：
- 从 `client_briefs` 提取 instagram_handle / facebook_page_url
- 调用 `scrapeInstagramProfile(handle)`（src/lib/apify 已有）
- 调用 `scrapeFacebookPage(pageUrl)`（src/lib/apify 已有）
- ⚠️ Apify 调用有成本，**缓存策略**：若 7 天内已有社媒快照，复用缓存数据，不重复抓取

**评分子维度**：

| 子维度 | 权重 | 计算逻辑 |
|--------|------|---------|
| 发布频率 | 30% | 近30天发布数。≥12篇=100，6-11=70，3-5=40，<3=10 |
| 互动率 | 40% | (赞+评论)/粉丝数。≥2%=100，1-2%=70，0.5-1%=40，<0.5%=10 |
| 内容多样性 | 30% | 包含 Reels/视频内容=+30分；纯图文=基础分 |

#### Reputation Collector

**文件**：`src/lib/diagnostic/collectors/reputation-collector.ts`

**数据拉取**：
- 调用 `getBusinessReviews(clientName + city)`（src/lib/places 已有）
- ProductReview.com.au：Apify `apify/web-scraper` 抓取公开评论数（行业地图已配置）

**评分逻辑**：
```typescript
// Google rating: 1.0–5.0 → 0–100
const ratingScore = ((rating - 1) / 4) * 100;
// Review count bonus: <10=0, 10-50=+10, 50-200=+20, >200=+30
const countBonus = reviewCount > 200 ? 30 : reviewCount > 50 ? 20 : reviewCount > 10 ? 10 : 0;
const score = Math.min(100, ratingScore * 0.7 + countBonus);
```

#### Competitor Collector

**文件**：`src/lib/diagnostic/collectors/competitor-collector.ts`

**数据拉取（串行，有速率限制）**：
1. DataForSEO `competitors_domain/live` → 自动发现 Top 5 竞品域名
2. SEMrush `domain_ranks` × 5 竞品 → organic_traffic, paid_traffic, domain_rank
3. Apify `scrapeCompetitorMetaAds()` × Top 3 竞品 → 广告活跃度

**评分**（差距越小分越高）：
```typescript
// 客户流量 / 竞品平均流量，上限 100
const trafficRatio = Math.min(1, clientTraffic / avgCompetitorTraffic);
const score = Math.round(trafficRatio * 100);
```

---

## 4. Layer 2 — 处方生成

### 4.1 处方触发前置：FDE 访谈摘要（Intake Form）

**目的**：AI 生成处方前，FDE 填写和客户对话后的关键信息，确保处方有业务背景。

**字段规格**（`intake_json` 结构）：

```typescript
interface PrescriptionIntake {
  // 必填
  business_goal: 'grow_revenue' | 'reduce_cost' | 'brand_awareness' | 'launch_product' | 'other';
  business_goal_detail: string;       // 一句话补充，≤200字
  timeline_urgency: 'urgent_1mo' | 'standard_3mo' | 'long_term_6mo_plus';
  monthly_budget_aud: number;         // 数值（整体数字营销预算）

  // 选填
  client_stated_priorities: string;   // 客户自己说的重点，FDE 直接记录原话
  constraints: string;                // 不能做什么（如：不能动官网、只做 Meta）
  competitor_client_mentioned: string; // 客户提到在意的竞品
  recent_changes: string;             // 近期业务变化（新产品、搬迁、换供应商等）
  fde_notes: string;                  // FDE 的主观判断
}
```

### 4.2 处方生成 Prompt 结构

**模型**：Claude Sonnet（Strategy Engine）

**System Prompt**：
```
You are a senior digital marketing strategist for an AU/NZ agency.
You write precise, actionable marketing prescriptions for SMB clients.
Always use Australian English spelling. Never mention third-party tool names (SEMrush, Apify, etc.).
Output must be structured JSON matching the PrescriptionContent schema.
```

**User Prompt 构建**（`buildPrescriptionPrompt()`）：

```
## Client Brief
{client_name} operates in {industry}, based in {city}.
Domain: {domain} | Website: {website_url}

## Diagnostic Summary (Six Battlefield Scores)
- SEO Visibility: {seo_score}/100 — {seo_top_findings}
- AI Exposure: {ai_visibility_score}/100 — {ai_top_findings}
- Paid Advertising: {ads_score}/100 — {ads_top_findings}
- Social Media: {social_score}/100 — {social_top_findings}
- Reputation: {reputation_score}/100 — {reputation_top_findings}
- Competitor Landscape: {competitor_score}/100 — {competitor_top_findings}

## Key Findings (severity: critical + high only)
{findings_formatted_as_numbered_list}

## Client Context (from FDE intake)
Goal: {business_goal_detail}
Budget: AUD ${monthly_budget_aud}/month
Timeline: {timeline_urgency}
Client priorities: {client_stated_priorities}
Constraints: {constraints}
FDE notes: {fde_notes}

## Instructions
Generate a 3-phase prescription with specific, measurable actions.
Phase 1: Quick wins (0-30 days, highest ROI per effort)
Phase 2: Foundation building (30-90 days)
Phase 3: Scale & optimize (90+ days)

Each action must include:
- dimension (seo/ai_visibility/ads/social/reputation/competitor)
- effort_level (S/M/L) — S=<1day FDE, M=1-3days, L=3+ days
- impact_level (H/M/L)
- owner_type (me_auto/fde_manual/third_party)
- specific tool or ME feature to use (using encapsulated names only)
- success_metric — how to measure success

Budget guidance: allocate across phases respecting ${monthly_budget_aud} AUD/month.
```

### 4.3 处方内容结构（`content_json`）

```typescript
interface PrescriptionContent {
  executive_summary: string;          // ≤150字，给客户看的一句话结论
  overall_score: number;              // 诊断总分
  score_summary: string;              // "整体处于红色警报状态，六个战场中四个需要立即干预"
  
  phases: PrescriptionPhase[];        // 3 个 Phase
  
  kpi_targets: KPITarget[];           // 90天后的可测量目标
  budget_allocation: BudgetLine[];    // 预算分配建议
  
  what_not_to_do: string[];           // 陷阱清单（≤5条）
  risk_notes: string[];               // 风险提示
}

interface PrescriptionPhase {
  phase: 1 | 2 | 3;
  label: string;                      // "Phase 1 — 速效行动（0–30天）"
  rationale: string;                  // 为什么先做这些
  actions: PrescriptionAction[];
}

interface PrescriptionAction {
  id: string;                         // "P1-SEO-01"
  dimension: DiagnosticDimension;
  title: string;                      // ≤80字
  description: string;                // 具体做什么
  effort_level: 'S' | 'M' | 'L';
  impact_level: 'H' | 'M' | 'L';
  owner_type: 'me_auto' | 'fde_manual' | 'third_party';
  owner_tool: string;                 // 封装名，如 "SEO 内容引擎" / "Content Workspace"
  me_deeplink?: string;               // ME 内部路由
  success_metric: string;             // 可量化的成功标准
  estimated_days: number;             // 预计完成天数
}

interface KPITarget {
  metric: string;
  current_value: string;
  target_value: string;
  timeframe: string;
  dimension: DiagnosticDimension;
}
```

### 4.4 处方审批流程

```
[FDE 生成处方草稿] → status: draft
        │
        ├── FDE 审阅，可编辑任意字段
        │
        ├── [批准] → status: approved
        │   ├── approved_by = FDE 姓名
        │   ├── approved_at = now()
        │   └── 系统自动从 actions 创建 execution_items
        │
        └── [要求修改] → status: draft（保留，可重新生成）
            若重新生成：旧处方 status → superseded，新建一条
```

**审批后自动化**：处方 `approved` → 触发 `generateExecutionItems(prescriptionId)` 函数，将每条 `PrescriptionAction` 转化为对应的 `execution_item`，包含分步骤操作指南。

---

## 5. Layer 3 — FDE 执行工作流

### 5.1 三种执行类型

#### Type A：ME 自动执行（`me_auto`）

ME 直接完成，FDE 点击确认即可。

| 行动 | ME 模块 | 操作说明 |
|------|--------|---------|
| 生成 SEO 落地页草稿 | SEO 内容引擎 | 深链到 `/dashboard/clients/[id]/strategy`，点击"生成" |
| 生成双信号博客 | SEO 内容引擎 | 深链到博客生成页，预填关键词 |
| 生成 GEO 指令 | GEO Composer | 深链到 GEO Composer，选择对应页面 |
| 生成社媒内容 | 社媒内容矩阵 | 深链到 Campaign Studio，预填话题 |
| 生成广告文案 | Paid Social Studio | 深链到广告生成器 |
| 更新关键词监控列表 | SEO 内容引擎 | API 自动写入 |

#### Type B：FDE 手动执行（`fde_manual`）

ME 生成内容或指令，FDE 在外部完成操作，回到 ME 标记完成。

| 行动 | 操作说明 | 第三方工具 |
|------|---------|---------|
| 发布落地页到客户网站 | FDE 复制 ME 生成的内容 → 发布到 CMS | WordPress / Shopify |
| 上传 GEO 指令到网站 | FDE 将 ME 生成的 HTML snippet → 插入指定页面 | 网站后台 |
| 设置 301 重定向 | 按 ME 提供的重定向表，在 DNS/Cloudflare 操作 | Cloudflare |
| 更新 GBP 商业档案 | ME 生成优化后的描述 → FDE 在 GBP 后台粘贴 | Google Business Profile |
| 发送客户评价邀请 | 按 ME 提供的模板，在 CRM 发送 SMS/邮件 | 客户 CRM / 手动发 |
| 发布社媒内容 | ME 生成内容 → Publishing Hub 排期 → FDE 确认发送 | Publishing Hub |

#### Type C：第三方操作（`third_party`）

ME 提供操作单（checklist），FDE 完全在第三方工具中操作，完成后回 ME 记录。

| 行动 | 第三方工具（封装名） | ME 提供 |
|------|-------------------|---------|
| 搜索广告账户优化 | 广告管理平台 | 优化建议清单 + 关键词报告 |
| 产品评价平台建档 | 商家评价平台 | 注册步骤 checklist |
| 竞品广告监测设置 | 广告情报工具 | 监测目标列表 |
| DNS 配置 | 域名管理面板 | 配置规格说明 |

### 5.2 执行项详情结构（`steps_json`）

每条 Type B / Type C 的 `execution_item.steps_json`：

```typescript
interface ExecutionSteps {
  context: string;              // 为什么要做这件事（1-2句）
  pre_check?: string;           // 前置检查（可选）
  steps: ExecutionStep[];
  verification: string;         // 如何验证完成
  me_assets?: MEAssetLink[];    // 相关的 ME 生成内容链接
}

interface ExecutionStep {
  order: number;
  action: string;               // 动词开头的具体动作
  detail?: string;              // 更多说明
  tool?: string;                // 使用的工具（封装名）
  screenshot_required?: boolean; // 是否需要截图存档
}

interface MEAssetLink {
  label: string;                // "查看 ME 生成的博客草稿"
  route: string;                // "/dashboard/clients/[id]/blog/[postId]"
}
```

**示例**（发布 GEO 指令到 WordPress）：
```json
{
  "context": "AI 搜索引擎通过页面中的结构化指令识别并推荐品牌。当前客户全站缺失此指令，是 AI 曝光度 1/10 的主因。",
  "pre_check": "确认已在 ME 中审核并批准 GEO Directive（GEO Composer 状态：approved）",
  "steps": [
    { "order": 1, "action": "在 ME 中打开 GEO Composer，复制目标页面的 HTML snippet", "tool": "GEO Composer", "me_route": "/dashboard/clients/[id]/geo-composer" },
    { "order": 2, "action": "登录客户 WordPress 后台 → 打开目标页面的编辑器" },
    { "order": 3, "action": "切换到 HTML 模式，将 snippet 粘贴到 </body> 标签前", "detail": "如使用 Elementor，在自定义 HTML widget 中插入" },
    { "order": 4, "action": "保存并发布，访问页面 → 查看源码验证 snippet 存在", "screenshot_required": true }
  ],
  "verification": "用浏览器查看页面源码，搜索 'Instructions for AI Agents'，确认文本存在"
}
```

### 5.3 执行进度看板

**路由**：`/dashboard/clients/[id]/execution`

**视图结构**：
```
[处方标题] — 批准于 2026-05-15 by [FDE名]    [健康度: 36/100 → 目标: 65/100]

Phase 1 — 速效行动（0–30天）              ████░░░░  3/8 完成
  ✅ [ME自动] 生成 /hybrid-spc-flooring-brisbane/ 草稿    完成 2026-05-14
  🔄 [FDE手动] 发布落地页到 WordPress                      进行中
  ⏳ [ME自动] 生成 GEO Directive × 5个核心页面             待开始
  ⏳ [FDE手动] 上传 GEO Directive 到网站                   待开始
  ⏳ [ME自动] 生成 5篇博客（双信号）                       待开始
  ...

Phase 2 — 基础建设（30–90天）             ░░░░░░░░  0/6 完成
  [折叠显示]

Phase 3 — 规模扩张（90天+）               ░░░░░░░░  0/5 完成
  [折叠显示]
```

---

## 6. UI 组件规格

### 6.1 诊断仪表板（`/dashboard/clients/[id]/diagnostic`）

**页面结构**：
```
┌─ Header ──────────────────────────────────────────────────────┐
│  客户名称 · 上次诊断：2026-05-10 · [运行新诊断] 按钮           │
└───────────────────────────────────────────────────────────────┘

┌─ Overall Score Card ──────────────────────────────────────────┐
│  健康度  36/100  🔴 危险                                       │
│  vs 上次：+0（首次诊断）                                        │
└───────────────────────────────────────────────────────────────┘

┌─ Six Battlefield Grid（2×3 或 3×2）───────────────────────────┐
│  [SEO可见度 20/100 🔴]  [AI曝光度 10/100 🔴]  [广告 30/100 🟠] │
│  [社媒矩阵 20/100 🔴]  [口碑分析 45/100 🟠]  [竞品雷达 25/100 🔴] │
│  点击任一维度卡片 → 展开该维度的 Findings 列表                  │
└───────────────────────────────────────────────────────────────┘

┌─ Findings List（按 severity 排序）────────────────────────────┐
│  [全部] [Critical(3)] [High(5)] [Medium(4)] [Low(2)]          │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ 🔴 CRITICAL · SEO可见度                                  │  │
│  │ 关键词排名严重缺失：竞品覆盖 847 个词，客户仅 12 个         │  │
│  │ 证据：SEMrush 数据显示...  [ME自动修复] 深链→策略面板      │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ... （更多 findings）                                         │
└───────────────────────────────────────────────────────────────┘

┌─ Actions ─────────────────────────────────────────────────────┐
│  [生成处方 →]   （跳转到处方生成页面）                          │
└───────────────────────────────────────────────────────────────┘
```

**颜色规则**：
- `score >= 70`：绿色 🟢 健康
- `score 40–69`：橙色 🟠 待改善
- `score < 40`：红色 🔴 危险

### 6.2 处方生成页（`/dashboard/clients/[id]/prescription/new`）

**Step 1**：选择诊断快照（默认最新一次）

**Step 2**：填写访谈摘要（Intake Form）
- 表单字段见 4.1
- 必填字段标红，防止空提交

**Step 3**：AI 生成（进度提示）
- "Strategy Engine 正在分析六维数据..."
- 预计 30–60 秒

**Step 4**：处方审阅
- 处方内容按 Phase 展开显示
- 每条 Action 可内联编辑
- 底部：[批准处方] [要求修改] 按钮

### 6.3 DiagnosticFindingCard 组件

```typescript
interface DiagnosticFindingCardProps {
  finding: DiagnosticFinding;
  onDismiss: (id: string) => void;
}
```

**卡片结构**：
```
[severity badge] [dimension tag]          [dismiss ×]
标题文字（粗体）
描述文字（含数据证据）
──────────────────────
[fix_type badge]  建议：recommendation文字
[深链按钮（若有）→ 打开 ME 对应功能]
```

**fix_type badge 颜色**：
- `me_auto`：蓝色，文字 "ME 可自动修复"
- `fde_manual`：紫色，文字 "需 FDE 操作"
- `third_party`：灰色，文字 "第三方工具操作"

---

## 7. API 路由汇总

| Method | Route | 说明 |
|--------|-------|------|
| POST | `/api/clients/[id]/diagnostic/run` | 触发诊断，body: `{ module }` |
| GET | `/api/clients/[id]/diagnostic/runs` | 历史诊断列表 |
| GET | `/api/clients/[id]/diagnostic/runs/[runId]` | 单次诊断详情 + findings |
| GET | `/api/clients/[id]/diagnostic/latest` | 最新诊断快照 |
| PATCH | `/api/clients/[id]/diagnostic/findings/[findingId]` | 忽略/恢复某条 finding |
| POST | `/api/clients/[id]/prescription/generate` | 生成处方（body: `{ run_id, intake }` ） |
| GET | `/api/clients/[id]/prescriptions` | 处方列表 |
| GET | `/api/clients/[id]/prescriptions/[pId]` | 处方详情 |
| PATCH | `/api/clients/[id]/prescriptions/[pId]` | 审批/修改处方 |
| GET | `/api/clients/[id]/execution` | 执行项列表（按 phase 分组）|
| PATCH | `/api/clients/[id]/execution/[itemId]` | 更新执行状态 + 备注 |

---

## 8. 实施顺序与验收标准

### Sprint 1（Day 1–2）：数据库基础

**任务**：创建4张表的迁移文件 + TypeScript types

**验收**：`npm run build` 通过；Supabase 迁移成功执行

### Sprint 2（Day 3–6）：SEO Collector + Runner

**任务**：`seo-collector.ts` + `seo-scorer.ts` + `POST /api/.../diagnostic/run（seo模式）`

**验收**：
- 对 Oztop 运行 `module=seo`，3分钟内写入 `diagnostic_run` + ≥5条 `diagnostic_findings`
- findings 中包含至少 1 条 severity=critical
- `npm test` 覆盖率 ≥ 80%

### Sprint 3（Day 7–10）：Social + Reputation Collector

**任务**：`social-collector.ts` + `reputation-collector.ts`

**验收**：
- Apify 抓取 7天缓存正常工作（不重复请求）
- Google Places 返回真实评分

### Sprint 4（Day 11–13）：Competitor Collector

**任务**：`competitor-collector.ts`（DataForSEO + SEMrush）

**验收**：
- 自动发现 Top 5 竞品域名，附带流量数据
- 竞品数据写入 `evidence_json`

### Sprint 5（Day 14–16）：诊断 UI

**任务**：诊断仪表板页面 + Finding卡片组件

**验收**：
- 显示6维度分数 + 颜色编码
- Findings 可按 severity 筛选
- 点击"运行诊断"显示 loading 状态，完成后刷新

### Sprint 6（Day 17–18）：处方生成 + 执行看板

**任务**：处方生成页面 + 执行进度看板

**验收**：
- Intake Form 填写后，30–60秒生成处方草稿
- FDE 可审批锁定处方
- 执行看板按 Phase 分组，每项可标记完成

---

## 附录 A — Finding Type 枚举

```typescript
// SEO
'keyword_gap_critical' | 'keyword_gap_medium' | 'thin_content' | 'no_geo_block' |
'low_domain_rank' | 'missing_local_pages' | 'no_schema_markup' | 'page_speed_issue'

// AI Visibility
'not_mentioned_by_ai' | 'low_ai_rank' | 'no_geo_directives' | 'competitor_ai_dominant' |
'brand_entity_weak'

// Ads
'no_ads_data' | 'high_cac' | 'low_roas' | 'ad_fatigue' | 'missing_retargeting' |
'budget_misallocation'

// Social
'low_posting_frequency' | 'low_engagement_rate' | 'no_video_content' | 'no_social_presence' |
'competitor_social_dominant'

// Reputation
'low_rating' | 'few_reviews' | 'unanswered_reviews' | 'no_review_platform' |
'negative_sentiment_spike'

// Competitor
'traffic_gap_large' | 'competitor_ads_aggressive' | 'competitor_seo_dominant' |
'market_share_loss' | 'new_competitor_detected'
```

---

## 附录 B — 命名规则（UI层强制执行）

### 使用真实名称（以下服务直接展示真名）

| 服务 | 归属 | UI 展示 |
|------|------|---------|
| Google Places API | Google | Google Places |
| Google Business Profile | Google | Google Business Profile |
| Google Search Console | Google | Google Search Console |
| Google Ads | Google | Google Ads |
| OpenAI GPT-4o-mini | OpenAI | OpenAI GPT-4o-mini |
| OpenAI GPT-4o | OpenAI | OpenAI GPT-4o |
| Claude Sonnet / Haiku / Opus | Anthropic | Claude Sonnet（或具体型号）|
| Meta Ads Manager | Meta | Meta Ads Manager |
| Facebook Pages | Meta | Facebook |
| Instagram | Meta | Instagram |
| WhatsApp Business | Meta | WhatsApp Business |

### 使用封装名称（所有其他第三方服务）

| 真实服务 | 封装名（UI展示） | 内部代号（日志/路由可用）|
|---------|----------------|------------------------|
| SEMrush | Keyword Intelligence | semrush |
| DataForSEO | SEO Analytics Engine | dataforseo |
| Apify（通用） | 数据采集引擎 | apify |
| Apify 社媒抓取 | 社媒情报采集器 | apify-social |
| Apify Meta Ads 抓取 | 广告情报采集器 | apify-ads |
| Airtable | Content Workspace | airtable |
| Publer | Publishing Hub | publer |
| WordPress / Shopify / 任意 CMS | 客户网站后台 | client-cms |
| HeyGen | Avatar Studio | heygen |
| WaveSpeed / Atlas | Visual Studio | atlas |
| Seedance | Video Studio | seedance |
| Jina.ai Reader | Site Analyzer | jina |

### 规则说明

- **UI 文案**（页面标题、按钮、说明文字、处方内容）：严格按上表
- **API 路由内部**（route.ts、lib/*.ts）：可使用内部代号，便于调试
- **错误日志**：可含真实名称（仅写入服务端 console.error）
- **环境变量**：保留真实命名（如 `SEMRUSH_API_KEY`、`APIFY_API_KEY`）
- **给客户看的处方文档**：只用封装名，不暴露供应商

---

*文档维护：每次修改数据结构或 API 规格，需同步更新本文档对应章节。*
*关联文档：ROADMAP.md §Phase 8.5 · ARCHITECTURE.md · MODULE_MAP.md*
