# Magic Engine — Roadmap

> 最后更新：2026-05-31 19:14 NZST · 当前阶段：**Phase 24.A Platform OAuth Connector ✅ 全部 8 任务完成 PR #125；Phase 14.C P14.C.1–6 ✅ PR 待合并；Phase 14.B ✅；Phase 23 Cross-Agent Memory Layer ✅；Phase 19 IDOR 修复 ✅**。
> 
> **策略更新（2026-05-05）**：GEO Directive 部署机制确认采用 **Phase 1 静态模型**（MVP），**Phase 2 动态脚本延缓至 Q3+ 2026**（需 PoC 验证）。详见 [§3.3.1 部署机制决策](#geoDirectiveDecision)。
> 配套：[PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)（产品视角）· [ARCHITECTURE.md](./ARCHITECTURE.md)（技术架构）

---

### Active hotfix registration - 2026-05-25

- [x] **P13.A.7 portal/prospect magic link repair** - Fix `/portal/login` being routed to internal admin login; add browser callback for magic-link hash sessions; allow `client_portal_users` emails to create first-time Auth users; add regression tests.
- [x] **P13.UI.3 website homepage production upgrade** - Replace the public homepage with the new Magic Engine product narrative and shared website-to-portal visual language.
- [x] **P13.UI.4 discover page UI refresh** - Upgrade `/discover` into the shared prospect entry experience aligned with the new homepage and portal visual language.
- [x] **P13.UI.5 prospect report UI refresh** - Upgrade `/prospect` loading, empty, failed, and completed report states into the shared prospect-to-portal report experience.
- [x] **P13.A.8 admin auth priority repair** - Ensure `ADMIN_EMAILS` accounts route to the admin dashboard before portal/prospect bindings; remove accidental CTS portal binding for the admin email.
- [x] **P13.UI.6 portal client experience refresh** - Upgrade `/portal/[clientId]` overview, monthly report, content library, and portal navigation into the shared Magic Engine client-facing UI system.
- [x] **P13.UI.7 entry shell visual refresh** - Align `/portal/login`, `/login`, and the admin dashboard shell/sidebar with the shared Magic Engine product UI language.
- [x] **P13.UI.8 admin workspace mobile refresh** - Align the admin content workspace and Content Studio drawer with the shared Magic Engine UI language; repair mobile usability.
- [x] **P13.UI.9 execution board drawer polish** - Clean up execution board sidebar scrolling, header actions, and task detail drawer so the admin workspace reads as one Magic Engine surface.
- [x] **P13.UI.17 inline prescription rail refresh** - Align the supplement/revision prescription drawer with the upgraded Magic Engine rail shell and stop it from fighting the execution board scroll layer.
- [x] **P13.UI.18 Zhangqian discovery deliverable refresh** - Align the customer-facing Zhangqian discovery report and downloadable PDF/DOCX deliverables with the shared Magic Engine visual language.
- [x] **P13.UI.19 inline status menu containment** - Keep the execution detail status menu inside the right-side FDE drawer instead of letting it float over the board layer.

## 当前进度速览

```
✅ Phase 1-6     社媒内容矩阵（已完成）
✅ Phase 7.0     决策窗口（7/7 决策完成，2026-04-30）
✅ Phase 7.1     AI Visibility Tracker（完成，含引擎修复 E1-E5）
✅ Phase 7.2     GEO Composer（完成，P7.2.1-P7.2.18 全部交付）
✅ Phase 7.3     双信号博客生成（核心库已交付：P7.3.1-5 安全修复完成 2026-05-05 | P7.3.6-20 已完成 | P7.3.21-23 完成 2026-05-05）
✅ Phase 7.4     月报 + PoC 验证（P7.4.8-P7.4.13 完成，等待追踪数据）
✅ Phase 8.6     Link Intelligence（DataForSEO 外链，2026-05-01 完成）
✅ Phase 8.7     SERP Intelligence（DataForSEO 排名追踪，2026-05-01 完成）
✅ Phase 8.8     Local Visibility（DataForSEO 本地搜索，2026-05-01 完成）
✅ Phase 8.9     Market Baseline（SEMrush 市场基准，2026-05-01 完成）
✅ Phase 8.11    Billing Monitor（DataForSEO 成本追踪，2026-05-01 完成）
✅ Phase 8.C.1   月报整合（完成，2026-05-01）
✅ Phase 8.R     Reels Studio（提示词生成 + 参考帧生成/上传 + I2V视频 + 对话修改，2026-05-02 完成）
🔄 Phase 8.Q     内容质控提升（8.Q.1外编版本管理✅ 8.Q.2 Brief编辑✅ 8.Q.3 Prompt预览部分✅ 8.Q.4待做）
📋 Phase 8.B     批量生产 + 自动排期 + 无缝发布（走向 Airtable-free 运营模式）
↗ Phase 8.M     Marketing Agent 记忆系统 — **升级整合至 Phase 23**（2026-05-26 重新定义为 Cross-Agent Memory Layer）
✅ Phase 8.D     DNZ诊断策略层（Stage 1✅ Stage 2✅ Stage 3✅ E2E验证✅ P8.0.7✅ P8.0.8✅ — 全部完成）
✅ Phase 8.1     三维内容策略分析（P8.1.1–P8.1.6 全部完成，2026-05-07）
⏸ Phase 8.P     Paid Social Studio（暂缓 — 待客户明确 Meta 广告需求触发）
✅ Phase 8.5+   Sprint 1 评分修复（P8.5.19-26，2026-05-13 完成）
🔥 Phase 8.10   Synthesis Layer + Deep Research 报告（5 Sprints，~12 工作日）
                ├─ S0 张骞 Discovery Agent ✅（14/14 任务完成，2026-05-18）
                ├─ S2 数据源深化（~2 天）
                ├─ S3 Synthesis 层（~3 天）
                ├─ S4 Report Composer（~2 天）
                └─ S5 引用/证据追溯（~1 天）
🔥 Phase 8.12    AU/NZ 本地化能力扩展（MVP：S3.1 鲁班 tool loop 开发中 · 其余 13 项 MVP 后补充）
✅ Phase 12.A    飞轮数据骨架 + CTS GEO 端到端 demo（15 任务全部完成，2026-05-17）
✅ Phase 12.B    SEO/Ads/社媒 adapter 接入（B.1–B.4 已完成，2026-05-18）
✅ UX 基础修复   全站标题/Login try-catch/客户可见供应商名/WorkflowProgress/ContentHub 简化（2026-05-20）
✅ Phase 12.Q   内容质量闭环（已完成，2026-05-21）
✅ Phase 12.G   诸葛亮策略调度引擎（P12.G.1–G.5 全部完成，2026-05-21）
✅ Phase 12.H   GitHub CMS 执行闭环（P12.H.1-3 全部完成，2026-05-25 核实）
✅ Phase 12.I   SEO Intelligence 页面 + 飞轮闭环接线（P12.I.1–I.10 全部完成，M3 待 PM 验证）
✅ Phase 12.J   博客头图配图生成（P12.J.1 ✅，P12.J.2 ✅）
✅ Phase 12.K   Campaign 视觉方向（P12.K.1 ✅，2026-05-23）
🔥 Phase 13.A   Prospect 注册流程（/discover Magic Link + 报告看板 + 处方门控）
📋 Phase 13     Production Package / 生产订单聚合层（已登记，待排期）
✅ Phase 9.0    Visual Queue UX Polish（全部完成，含测试 P9.0.10-14 + QueueOverviewCard P9.0.15-17，2026-05-25 核实）
📋 Phase 9      报告化 + 客户 Portal
📋 Phase 10     多语言 + Magic Lab Academy 沉淀
📋 Phase 14     Website Connector / 网站直连执行闭环（⭐ WordPress 连接器近期优先 — P14.A.5）
📋 Phase 15     Reputation Engine / 口碑监控与执行闭环（战略确认，待排期）
📋 Phase 16     Competitor Intelligence / 竞品雷达 + 信号驱动执行（战略确认，待排期）
✅ Phase 17     Unified Data Pullback / 统一数据回流层（Phase 17.A ✅ 全部完成 2026-05-27）
📋 Phase 18     Ads Execution Engine / 广告执行引擎（Meta + Google + TikTok，已登记）
✅ Phase 19     API 鉴权整改 / IDOR 修复（🟢 19.A–E 全部完成 2026-05-27，PR #95）
✅ Phase 20.D   统一看板入口 / 六支柱 FDE 手动录入 + 拖拽排序 + 客户 Portal 分组（Phase 20 子任务 — 2026-05-28 实施）
📋 Phase 21     AI Content Factory / AI 内容工厂（旗舰能力 — FDE 客户默认产能引擎）
📋 Phase 22     Data Intelligence Engine / 数据智能引擎（旗舰能力 — 采集+分析+反馈学习引擎）
📋 Phase 22.D   主动任务生成器 / AnomalyDetector + 诸葛亮 Proactive（Phase 22 子模块）
📋 Phase 23     Cross-Agent Memory Layer / 跨 Agent 记忆层（旗舰能力 — 升级自 Phase 8.M，补 L3 长期学习）
📋 Phase 24     Execution Loop Closure / 执行闭环修复（Phase 24.A Platform OAuth Connector ✅ 已完成 PR #125）
📋 Phase 26     Client Locale Intelligence / 客户地域智能层（国家→州→城市三层 + 业务范围 + AU/NZ 节日日历注入）✅ 已完成
📋 Phase 27     Visual Reference Library / 视觉参考库（图像版 viral analyzer — FDE 上传 + 客户提供 + 竞品爬取，构建行业视觉知识库）📋 待开发
📋 Phase 28     FDE Inbox / 待处理收件箱（⚠️ 待并入 Phase 20.D — 统一看板扩展）
```

**Phase 7 核心战略**：双信号博客（Dual-Signal Blog）— 每篇文章同时携带 SEO 信号（Google 排名）和 GEO 信号（AI 推荐），选题由 AI Tracker 弱项 × SEMrush 低KD机会交叉驱动，形成数据自强化飞轮。

**Phase 8 核心战略**：DataForSEO 集成补充 SEMrush 数据缺口，构建完整 SEO 可见度体系（外链、SERP 排名、本地搜索、市场基准）。Phase 8.C.1 月报整合将 6 大数据源聚合，交付完整月度洞察报告。

---

## 1. 战略路线图

### 2026 H1（已完成 + 当前）

```
Q1: 社媒内容矩阵建设          ✅ Phase 1-6
    ├── 多客户管理
    ├── Brand Brief Studio
    ├── Campaign Studio 批量生成
    ├── Visual / Video / Avatar Studio
    ├── Content Workspace 双向同步
    └── Publishing Hub 多平台发布

Q2: GEO 核心差异化建设        🔥 Phase 7
    ├── AI Visibility Tracker
    ├── GEO Composer
    ├── 长文博客生成线
    ├── 客户接入向导
    └── PoC 验证（CTS Tours）
```

### 2026 H2（规划）

```
Q3: 诊断驱动内容策略          📋 Phase 8
    ├── DNZ 采集（客户域名全量内容快照）
    ├── 三维策略分析（现有内容 × AI弱项 × 关键词缺口）
    ├── 策略驱动的内容执行（升级页面 / 新建博客 / 社媒联动）
    └── 客户接入向导（5步建档，集成 DNZ）

Q3-Q4: 报告化 + 服务交付     📋 Phase 9
    ├── 月报 PDF 自动生成 + 邮件发送
    ├── 客户 Portal（client-facing view）
    └── 站点权威度追踪（DA / 外链 / 内链）

Q4: 沉淀 + 扩展                📋 Phase 10+
    ├── 多语言内容支持
    ├── Magic Lab Academy 课程化
    ├── 部分模块对外 SaaS（远期）
    └── Plugin（WordPress/Webflow GEO 注入）
```

---

## 2. 任务跟踪机制 ⭐（防丢任务规则）

> 用户多次反馈"Code 会丢任务"。本节是强制流程。

### 2.1 三层跟踪体系

```
ROADMAP.md（持久层 / 本文件）
   │  所有任务的源头与归宿，按 Phase 分组，含验收标准
   ↓
TodoWrite（会话层）
   │  当前会话的细粒度执行追踪
   ↓
Git Commit（事实层）
   每个完整任务一个 commit，message 引用任务 ID
```

### 2.2 任务 ID 命名规则

`P<Phase>.<Section>.<Task>` 格式：
- `P7.0.3` = Phase 7 Section 0（决策） Task 3
- `P7.1.2` = Phase 7 Section 1（AI Tracker） Task 2
- `P7.2.1` = Phase 7 Section 2（GEO Composer） Task 1

每个任务在本文件中是**可勾选 checkbox**。完成后必须立即勾选并 commit。

### 2.3 强制流程（任何 Agent 必读）

**新需求进入时**：
1. 用户提需求 → Agent 先在 ROADMAP.md 对应 Phase 下登记任务（含 ID + 验收标准）
2. 同步用 TodoWrite 创建会话级追踪
3. 然后才能开始执行

**任务执行中**：
- 一次 in_progress 一个任务（TodoWrite 强制规则）
- 遇到阻塞 → 不要硬推，回写 ROADMAP.md 标注 ⚠️Blocked + 原因

**任务完成后**：
- ROADMAP.md 中的 checkbox 改为 [x]
- TodoWrite 标记 completed
- Git commit message 包含任务 ID：`feat(ai-tracker): add OpenAI runner [P7.1.3]`

**会话结束前**：
- 检查 TodoWrite 中所有未完成项 → 必须回写 ROADMAP.md（**禁止只在 TodoWrite 里**）
- 更新 ROADMAP.md 顶部"当前进度速览"

### 2.4 用户问"现在做到哪了"时

回答模板：
```
当前 Phase: <PhaseName>
已完成：P7.1.1, P7.1.2（AI Tracker 数据库 + 问句生成）
进行中：P7.1.3（OpenAI Runner，预计今日完成）
下一项：P7.1.4（Claude Runner）
风险：<如有>
```

---

## 3. Phase 7 — GEO + AI Tracker MVP ✅ 完成（2026-04-30 ~ 2026-05-05）

> 详细任务记录见 [docs/archive/ROADMAP-phase1-7.md](./docs/archive/ROADMAP-phase1-7.md)

| 子阶段 | 内容 | 状态 |
|--------|------|------|
| P7.0 | 架构决策（LLM选型、PoC客户、GEO方案） | ✅ |
| P7.1 | AI Visibility Tracker（多引擎排名追踪，OpenAI+Google+Perplexity） | ✅ |
| P7.2 | GEO Composer（指令生成、编辑器、Snippet部署助手） | ✅ |
| P7.3 | 双信号博客生成（SEO×GEO 内容飞轮，安全修复 5 项） | ✅ |
| P7.4 | 月报 + CTS Tours PoC（基线已建立，每周自动追踪中） | 🔄 追踪中 |

**关键产出**：AI Tracker avg_rank 1.49（CTS Tours 基线），GEO v1 directive 已部署 4 页，3 篇 GEO 博客已发布，内容审计防蚕食上线。

**P7.4 未完成任务**（持续进行）：
- [ ] **P7.4.14** 第 2/4 周复跑 AI Tracker，对比排名变化（2026-05-12 执行）
- [ ] **P7.4.15** 第 4 周生成首份月报（2026-05-26 执行）

---

## 4. 已完成历史（Phase 1-6）✅

> 详情见 [docs/archive/ROADMAP-phase1-7.md](./docs/archive/ROADMAP-phase1-7.md)

Phase 1-6 完成于 2026 Q1。核心产出：多客户管理、Brand Brief Studio、Campaign Studio 批量生成（Route A/B/C）、Visual/Video/Avatar Studio、Content Workspace 双向同步（Airtable）、Publishing Hub 多平台发布。

---

## 5. 后续 Phase（H2 规划）

### Phase 8.A/B/C — DataForSEO 集成 + 客户接入 ✅ 全部完成（2026-05-01）

> 详细任务记录见 [docs/archive/ROADMAP-phase1-7.md](./docs/archive/ROADMAP-phase1-7.md)

| 模块 | 内容 | 状态 |
|------|------|------|
| P8.1 | 客户接入向导（3步：基本信息→Airtable配置→关键词参数） | ✅ |
| P8.6 | Link Intelligence（DataForSEO 外链数据） | ✅ |
| P8.7 | SERP Intelligence（关键词排名追踪） | ✅ |
| P8.8 | Local Visibility（AU/NZ 14城市本地搜索） | ✅ |
| P8.9 | Market Baseline（SEMrush 行业对标） | ✅ |
| P8.11 | Billing Monitor（DataForSEO 成本追踪） | ✅ |
| P8.C.1 | 月报整合（6大数据源聚合，10节报告页） | ✅ |

---

### Phase 8.D — DNZ 诊断驱动内容策略 ⭐（规划中）

> **设计背景（2026-05-01 确立）**
>
> CTS Tours PoC 过程中发现根本问题：Magic Engine 在不了解客户已有什么内容的情况下直接生成博客，
> 导致两个缺陷：① 可能与客户现有页面形成关键词蚕食；② 无法判断是升级已有页面还是新建内容。
>
> 解决方案：**先诊断，再生成**。所有内容执行都应由数据驱动的策略层输出，而不是凭感觉选题。

**三层架构**：

```
Layer 1: DNZ 采集（Domain Network Zone）
   客户域名全量内容快照 → 知道"客户已有什么"

Layer 2: 三维策略分析
   现有内容 × AI弱项（Tracker）× 关键词缺口（SEMrush）
   → 输出：每个机会的类型（升级/新建/社媒）+ 优先级评分

Layer 3: 策略驱动执行
   按策略面板点击生成：上下文注入、防重叠、类型匹配
```

---

#### Phase 8.0 — DNZ 采集基础设施 ⭐（Stage 1 完成 2026-05-04）

**目标**：能够抓取客户域名上的所有页面，并将其内容结构化存储，作为后续分析的基础。

**Stage 1: 数据收集层** ✅ **2026-05-04 完成**
- [x] **P8.0.1** 新建 `client_site_pages` 表 + 迁移文件 ✅
  - ✅ Migration: `supabase/migrations/20260504000001_client_site_pages.sql`
  - ✅ Schema: id, client_id, url, page_type, topics[], primary_keyword, word_count, has_geo_block, title, markdown_content, crawled_at, created_at, updated_at
  - ✅ Indexes: (client_id, url) unique, (client_id, page_type), updated_at
  - ✅ RLS policies: 4 policies for select/insert/update/delete
  
- [x] **P8.0.2** `src/lib/site-audit/crawler.ts` — sitemap.xml 解析 → 提取所有 URL，对每个 URL 调用 Jina.ai 抓取正文 ✅
  - ✅ `discoverSitemapUrls(domain)`: 4-level fallback (sitemap.xml → sitemap_index.xml → robots.txt → BFS crawl)
  - ✅ `crawlPages(urls, opts)`: Rate limiting (1 req/sec), Jina markdown extraction, returns CrawlResult[]
  - ✅ 100% test coverage (64 tests, 100% statements, 97.05% branches)
  - ✅ TDD: RED → GREEN → REFACTOR cycle completed
  
- [x] **P8.0.3** `src/lib/site-audit/classifier.ts` + `geo-detector.ts` — GPT-4o mini 分类 ✅
  - ✅ Classifier: `classifyPage(url, title, markdown)` → { page_type, topics[], primary_keyword, confidence }
    - Pages types: landing, product, service, blog, contact, about, other
    - Markdown truncation: 3000 chars (token limit protection)
    - Batch processing: `classifyPages(pages)` with fallback on failures
    - Test coverage: 20 tests, 100% pass rate, 97.26% statements
  - ✅ GEO Detector: `detectGEOBlock(markdown)` → { has_geo_block, detection_method, confidence }
    - Detection priority: aria-hidden (0.95) → seo-instructions (0.9) → Instructions for AI Agents (0.85) → suspicious patterns (0.65) → code blocks (0.5)
    - Regex: /aria-hidden\s*=\s*["'&]?(?:true|false|quot)["\';]?/i (handles HTML entities)
    - Test coverage: 19 tests, 100% pass rate, 78.87% statements, 93.75% branches
  
**验收标准（Stage 1）**：✅ 完成
- ✅ 103 个单元测试通过（crawler 64 + classifier 20 + geo-detector 19）
- ✅ 整体覆盖率 95.14% statements，95.49% branches（目标 ≥80%）
- ✅ 代码审查通过：Security 8/8，Performance ✅，Code Quality ✅
- ✅ 已提交 commit 48243e1：2150 lines added

**Stage 2: 异步执行框架** 🔄 进行中
- [x] **P8.0.4** `src/lib/site-audit/job-runner.ts` — Supabase-based 状态机，无需 Redis ✅ **2026-05-04 完成**
  - ✅ 7 个核心方法：createJob, getJob, startJob, updateProgress, completeJob, failJob, cleanupOldJobs
  - ✅ 27 个单元测试，100% 通过率（13ms）
  - ✅ 测试覆盖率：96.4% statements，96.2% branches（目标 ≥80%）
  - ✅ TDD 周期完成：RED → GREEN → REFACTOR
  
- [x] **P8.0.5.0** 规划与设计 ✅ **2026-05-05 完成**
  - ✅ 规划文档：7 phase，13-20h 工作量估算
  - ✅ 关键设计决策：Render 30s 超时 → fire-and-forget，Cron 兜底，多租户隔离，GIN index 优化
  
- [x] **P8.0.5.1** 执行编排模块 ✅ **2026-05-05 完成**
  - ✅ 文件：`src/lib/site-audit/job-executor.ts`（286 行）
  - ✅ 导出：`executeJob(supabase, jobId, options)` 主函数
  - ✅ 流程：discover sitemap → crawl → classify → detect GEO → upsert pages → update progress → complete/fail job
  - ✅ 测试：34 个单元测试，100% 通过率（15ms）
  - ✅ 覆盖率：100% statements/lines/functions，86.36% branches（目标 ≥85%）✅
  - ✅ TDD 周期：RED (初始 29 个测试) → GREEN (word_count 修复) → REFACTOR (追加 5 组边界测试)
  - ✅ 安全审查：0 critical/high/medium issues，Security Risk Level: LOW

- [x] **P8.0.5.2-P8.0.5.5** API endpoints ✅ **2026-05-05 完成**:
  - [x] **P8.0.5.2** `POST /api/clients/[id]/site-audit/crawl` — 触发全站采集（异步，最多 100 页） ✅
  - [x] **P8.0.5.3** `GET /api/clients/[id]/site-audit/status` — 查询当前 job 进度 ✅
  - [x] **P8.0.5.4** `GET /api/clients/[id]/site-audit/pages` — 列出已采集页面（支持 type / topic 筛选） ✅
  - [x] **P8.0.5.5** `GET /api/clients/[id]/site-audit/pages/[pageId]` — 单页详情 ✅

- [x] **P8.0.5.6** `POST /api/cron/site-audit-jobs` — Cron 清理过期 job 记录 ✅ **2026-05-05 完成**
  - ✅ 文件：`src/app/api/cron/site-audit-jobs/route.ts`（158 行）
  - ✅ 导出：`POST(request)` 路由处理
  - ✅ 功能：
    - **Cleanup**：删除超过 30 天的已完成 job
    - **Watchdog**：检测并记录失败的 job（status='failed' + error_message NOT NULL）
    - **Recovery**：恢复卡住超过 1 小时的 pending job（自动重启）
  - ✅ 鉴权：CRON_SECRET header 验证（401 未授权）
  - ✅ 测试：8 个单元测试，100% 通过率（23ms）
  - ✅ 覆盖率：100% statements/lines/functions（8/8 测试全部通过）
  - ✅ 响应格式：`{ timestamp, cleaned_jobs, failed_jobs_found, resumed_jobs }`
  - ✅ 错误处理：完整的 try-catch，500 错误返回详细信息

- [x] **P8.0.5.7** GIN index migration + render.yaml cron 配置 ✅ **2026-05-05 完成**
  - ✅ 文件：`supabase/migrations/20260505000002_gin_index_site_audit_pages.sql`
  - ✅ 功能：
    - **tsvector** 列：支持全文搜索（title + url + primary_keyword + markdown_content）
    - **GIN 索引**：加速全文搜索、数组查询（topics）、常见过滤条件
    - **复合索引**：(client_id, page_type, has_geo_block) 查询优化
    - **触发器**：自动维护 search_vector，支持 insert/update 时实时更新
  - ✅ 文件：`render.yaml` Cron 配置（site-audit-cron）
  - ✅ 调度：每天 2 AM UTC（~2 PM NZST）触发 POST /api/cron/site-audit-jobs
  - ✅ 认证：使用 CRON_SECRET header

- [x] **P8.0.5.8** E2E 验证（CTS Tours 真实域名）✅ **2026-05-05 完成**
  - ✅ 测试套件：`src/__tests__/e2e/site-audit.e2e.test.ts`（49 个测试用例）
  - ✅ 覆盖范围：
    - URL 发现验证（ctstours.co.nz sitemap，≥30 页，无重复）
    - 35 页完整管道执行（爬虫 → 分类 → GEO 检测 → 入库）
    - 7 类分类准确性（landing/product/blog/contact/about/service/other）
    - GEO 检测集成（NZ 市场识别）
    - 数据库一致性（字段完整、时间戳、upsert 冲突解决）
    - 错误韧性（超时、网络失败、速率限制、爬虫失败、DB 失败、无效 HTML、Unicode）
    - 并发隔离（多客户端无交叉污染）
    - 性能基准（100 页 <2 秒）
    - 状态机转移（作业生命周期）
  - ✅ 覆盖率：97.41% statement / 94.9% branch / 96.55% function（远超 80% 最低要求）
  - ✅ 测试结果：295/295 通过（包括现有单元测试 + 集成测试 + 49 个新增 E2E 测试）

**Stage 3: UI 仪表板** ✅ 完成（2026-05-05）
- [x] **P8.0.6** UI：`/dashboard/clients/[id]/site-audit` — 采集进度条 + 已采集页面表格

**Phase 2 实现细节 & 验收标准** ✅ **2026-05-05 完成**

##### P8.0.6-M1: use-site-audit-status.ts Hook
- **文件**: `src/app/dashboard/clients/[id]/site-audit/_hooks/use-site-audit-status.ts`
- **测试**: 9 个测试用例，100% 通过，98% 覆盖率
- **功能**:
  - ✅ 每 2 秒自动轮询一次 `/api/clients/[id]/site-audit/status`
  - ✅ 检测终态（completed / failed），自动停止轮询（防止内存泄漏）
  - ✅ 页面离焦时暂停轮询，恢复焦点时恢复（visibility-aware）
  - ✅ 网络错误时指数退避重试机制
- **集成**: ProgressCard 和 page.tsx 的数据源

##### P8.0.6-M2: ProgressCard.tsx 展示组件
- **文件**: `src/app/dashboard/clients/[id]/site-audit/_components/ProgressCard.tsx`
- **测试**: 36 个测试用例，100% 通过，100% 覆盖率
- **功能**:
  - ✅ 实时进度条（0-100%），基于已爬取 / 总页面数计算
  - ✅ 4 指标展示：已爬取数 / 分类完成数 / GEO 检测数 / 错误数
  - ✅ ETA 倒计时计算（基于当前进度和爬取速率）
  - ✅ 终态样式：completed 绿色、failed 红色
  - ✅ Skeleton loading 状态

##### P8.0.6-M3: CrawlButton.tsx 操作按钮
- **文件**: `src/app/dashboard/clients/[id]/site-audit/_components/CrawlButton.tsx`
- **测试**: 33 个测试用例，100% 通过，~95% 覆盖率
- **功能**:
  - ✅ 4 态按钮：idle enabled ("Start Audit") → loading ("Starting...") → in_progress disabled → completed/failed enabled ("Start New Audit")
  - ✅ 409 冲突处理：已有运行中的 job，弹出确认对话框，用户可选择覆盖或取消
  - ✅ 错误区分：400 (缺失 domain) / 409 (existing job) / 500 (server error) / network timeout
  - ✅ Toast 通知：成功 / 失败 / 冲突消息
  - ✅ 防多击：loading 时按钮禁用
- **API 端点**: `POST /api/clients/[clientId]/site-audit/start`
- **安全**: LOW 风险，OWASP Top 10 合规

**整体验收标准** ✅ **2026-05-05 通过**:
- ✅ 输入 ctstours.co.nz，能开始新 audit，显示进度条更新
- ✅ 每个页面有：url、page_type、topics[]、primary_keyword、word_count、has_geo_block
- ✅ 若存在运行中的 job，409 冲突流程正常工作
- ✅ 3 个模块共 78 个单元测试全部通过（100% pass rate）
- ✅ 代码覆盖率：使用端口 98% / 进度卡 100% / 抓取按钮 ~95%

**Stage 4: Site Audit UI 数据修复** 📋 待做（Phase 8.1 前置）

> E2E 验证（2026-05-05）发现两个数据展示问题，是 8.1 策略分析 UI 的前置依赖。

- [x] **P8.0.7** 修复 `SiteAuditPanel.tsx` 中 `geo_detected` 硬编码 0 的 Bug ✅ 2026-05-07
  - **问题**：`adaptJobForProgressCard()` 中 `geo_detected: 0` 是硬编码，永远显示 0
  - **原因**：`site_audit_jobs` 表不追踪 GEO 检测数，需从 `client_site_pages` 查询
  - **方案**：在 GET `/status` API 响应中额外附带 `geoDetectedCount`（query `client_site_pages WHERE job_id = ? AND has_geo_block = true`）
  - **验收**：ProgressCard "GEO Detected" 显示真实值（CTS Tours 预计为 0，部署 GEO 指令后变为非零）

- [x] **P8.0.8** 新建 Site Audit 页面清单 UI（Site Audit 完成后的下一步 CTA）✅ 2026-05-07
  - **问题**：用户看到绿色完成卡片后无任何引导，93 页数据无处查看
  - **方案**：
    - 在 ProgressCard 完成态下方增加 "查看页面清单 →" 按钮
    - 新建 `/dashboard/clients/[id]/site-audit/pages` 列表页
    - 调用已有 `GET /api/clients/[id]/site-audit/pages` 端点（P8.0.5.4 已完成）
    - 列表支持按 `page_type` 筛选（blog / product / service / other 等 Tab）
    - 每行展示：URL、标题、类型、字数、是否有 GEO block
  - **验收**：从 Site Audit 完成卡片能一键跳转查看 93 条页面记录，可按类型筛选

---

#### Phase 8.1 — 三维内容策略分析

> **前置依赖**：P8.0.7 + P8.0.8 完成（Site Audit 数据展示修复）  
> **数据来源**：`client_site_pages`（P8.0 采集）× `ai_visibility_runs`（P7.1 AI Tracker）× SEMrush 关键词库

**目标**：将 DNZ 采集结果、AI 弱项、关键词缺口三维交叉，输出有数据依据的优先级策略列表。

**背景（2026-05-05 E2E 验证后更新）**：
- CTS Tours 已完成首次采集：93 页，分类分布 blog 40 / product 34 / service 7 / other 12
- GEO block 现状：0（全站无部署），这正是我们需要改善的基线
- 可执行策略路径：product/service 页优先部署 GEO block；blog 中 word_count < 500 的升级

- [x] **P8.1.1** 新建 `content_strategy_items` 表 + 迁移文件 + 共享 TypeScript 类型
- [x] **P8.1.2** `src/lib/strategy/analyzer.ts` — 三维交叉逻辑（23 tests）：
  - 维度A：AI Tracker 弱项（brand_rank = null 或 rank > 3 的 query）
  - 维度B：SEMrush 关键词缺口（竞品排名的词，客户没有对应页面）
  - 维度C：客户现有页面内容薄弱点（word_count < 500 或无 GEO 块）
- [x] **P8.1.3** `src/lib/strategy/scorer.ts` — 优先级评分（41 tests）：
  - `unified` 机会（AI弱项 + SEO缺口同时满足）：最高分
  - `geo_only` 机会（AI弱项，但 SEO 价值低）：中分
  - `upgrade` 机会（已有页面，但内容薄弱 / 缺 GEO 块）：视缺口大小评分
- [x] **P8.1.4** `POST /api/clients/[id]/strategy/generate` — 触发一次完整策略分析，写入 content_strategy_items（16 tests）
- [x] **P8.1.5** `GET /api/clients/[id]/strategy` — 返回策略列表（按 priority_score 降序，21 tests）
- [x] **P8.1.6** UI：`/dashboard/clients/[id]/strategy` — 策略面板：
  - 顶部：Stats 卡片（总建议数 / 紧急+高优 / 升级现有页面 / 新建博客）
  - 主列表：每条推荐有 Action Type 标签（🔄 升级 / ✨ 新建 / 📱 社媒）、优先级、理由
  - 过滤 Tab + 一键"重新生成策略" + 忽略单条建议

**验收标准**：
- 对 CTS Tours 跑分析，输出 ≥ 10 条策略建议，每条有 action_type + priority_score + rationale
- "升级现有页面" 类型的推荐中，能关联到 client_site_pages 中的具体页面

---

#### Phase 8.2 — 策略驱动的内容执行

**目标**：所有内容生成都通过策略面板触发，携带完整上下文（现有内容 + 关键词 + AI弱项），消除盲目生成问题。

- [x] **P8.2.1** 博客生成注入 `existing_pages_context`：`pages-context.ts` 话题词匹配 + `buildPagesContextBlock` prompt 格式化；blog route 自动注入（19 tests）
- [x] **P8.2.2** 升级现有页面流程：`upgrade-generator.ts`（Jina 抓取 + Claude 重写）+ `POST /api/clients/[id]/pages/[pageId]/upgrade` + 升级详情 UI（diff 对比 + 批准→保存草稿）（18 tests）
- [x] **P8.2.3** 内容审计范围扩展：`fetchSitePagesAsCandidates` 从 `client_site_pages` 拉取全站页面，与 web 爬取结果合并去重，blog route 自动传入 clientId（11 tests）
- [ ] **P8.2.4** 社媒联动：博客 approved 后，自动在策略面板生成 3 条对应社媒话题建议（Facebook / Instagram / LinkedIn）

**验收标准**：
- 从策略面板点击生成一篇博客，prompt 中包含话题相关的现有页面摘要
- 升级流程可展示 diff，客户操作后写入 blog_posts（mode = 'seo_only' 或 'unified'）

---

#### Phase 8.3 — 客户接入向导（集成 DNZ）

**目标**：5 分钟完成新客户建档，DNZ 采集作为标准步骤嵌入，确保每个客户上线前即有内容现状数据。

- [x] **P8.3.1** 向导 `/dashboard/clients/new`：Step 1 基本信息 → Step 2 上传 Brief 文件 → Step 3 触发 DNZ 采集 → Step 4 审核采集结果 → Step 5 激活（生成 Master Brief + active GEO Directive）✅ **2026-05-07 完成**
- [x] **P8.3.2** Dashboard 简单鉴权（Magic Link，防止数据泄露）✅ **2026-05-22 收尾** — middleware matcher + layout 守卫重新启用；AI Tracker dashboard API 加 session + client scope 守卫；38 个 auth 相关测试全过；生产前 PM 需在 Render 填 `ADMIN_EMAILS` + Supabase Auth 后台白名单 `https://crazycontent-27u3.onrender.com/auth/callback`

**验收标准**：
- 全程 < 10 分钟完成新客户建档
- 建档完成后，客户主页显示：DNZ采集状态、已采集页面数、Master Brief 状态、GEO Directive 状态

---

### Phase 8.P — Paid Social Studio（Meta 广告生成器）⏸ 暂缓

> **设计背景（2026-05-03 确立）**
>
> 借鉴外部实践："URL 输入 → Brand DNA → 40 条 Meta 广告格式 × 配图提示词"全链路。
> Magic Engine 已有品牌底稿（Brand Brief Studio）和 Visual Studio，可直接复用；
> 新增价值在于**结构化 Meta 广告格式矩阵**——将 Campaign Studio 扩展到付费社媒方向。
>
> **定位**：Campaign Studio 的"付费社媒路线"——有机内容走原有路线，Paid Social 走本 Phase。
>
> **当前状态**：⏸ 暂缓 — 待客户明确 Meta 广告需求后触发。规格文档已就位，随时可启动。

**核心链路**：

```
客户 Brand Brief（已有）+ 可选产品图/素材
      ↓
Strategy Engine 提炼 Brand DNA（价值主张 / 目标受众 / 核心差异化）
      ↓
批量生成 N 条广告文案（按格式矩阵分类）
      ↓
每条广告同步输出 Visual Studio 配图提示词
      ↓
一键批量送入 Visual Studio 生成配图
      ↓
Publishing Hub 归档 / 排期
```

**广告格式矩阵（6 大类，共 ~20-40 条）**：

| 格式类型 | 说明 | 数量 |
|---------|------|------|
| `testimonial` | 客户见证文案（引用 + 社会证明） | 6-8 |
| `ugc_angle` | UGC 视角（第一人称体验描述） | 6-8 |
| `review_card` | 评分卡式（星级 + 简评 + CTA） | 4-6 |
| `stat_callout` | 数据驱动（一个核心数字 + 上下文） | 4-6 |
| `comparison` | 对比表（客户方案 vs 通用选项） | 3-4 |
| `us_vs_them` | 差异化对比（品牌优势 vs 竞品） | 3-4 |

**任务清单**：

**数据库（Day 1）**
- [ ] **P8.P.1** 新建 `paid_ad_sets` 表（client_id / brief_id / set_name / format_matrix / status / created_at）
- [ ] **P8.P.2** 新建 `paid_ad_copies` 表（set_id / format_type / headline / body / cta / visual_prompt / visual_asset_id / status）

**核心库（Day 2-3）**
- [ ] **P8.P.3** `src/lib/paid-social/brand-dna-extractor.ts` — 从 Master Brief 提炼 Brand DNA（价值主张 / 受众痛点 / 差异化 / 证据点），Strategy Engine（Claude）输出结构化 JSON
- [ ] **P8.P.4** `src/lib/paid-social/ad-copy-generator.ts` — 按格式矩阵批量生成广告文案，Content Engine（GPT-4o-mini）输出，AU/NZ 本地英语拼写强制约束
- [ ] **P8.P.5** `src/lib/paid-social/visual-prompt-builder.ts` — 为每条广告生成配图提示词（结合产品图描述 + 品牌色调 + 格式规格）

**API（Day 4）**
- [ ] **P8.P.6** `POST /api/clients/[id]/paid-social/generate` — 触发一次完整生成（brief_id + 可选 format_filter + 可选 reference_image_desc）
- [ ] **P8.P.7** `GET /api/clients/[id]/paid-social/sets` — 广告集列表
- [ ] **P8.P.8** `GET /api/clients/[id]/paid-social/sets/[setId]/copies` — 单集文案列表
- [ ] **P8.P.9** `PATCH /api/clients/[id]/paid-social/copies/[copyId]` — 编辑单条文案 / 更新状态
- [ ] **P8.P.10** `POST /api/clients/[id]/paid-social/copies/[copyId]/generate-image` — 单条文案触发 Visual Studio 配图生成

**前端页面（Day 5-7）**
- [ ] **P8.P.11** 路由 `/dashboard/paid-social/[clientId]` 创建（含客户选择 landing）
- [ ] **P8.P.12** 生成面板：选择 Brief + 勾选格式类型 + 可选填产品图描述 → [Generate Ad Set] 按钮（预估 10 分钟）
- [ ] **P8.P.13** 广告集列表视图（按格式分组 Tab，每条展示 headline / body / CTA / 状态）
- [ ] **P8.P.14** 单条广告卡片：文案内联编辑 + 右侧配图提示词展示 + [Generate Image] 按钮
- [ ] **P8.P.15** 批量操作：[Generate All Images] 一键触发全集配图生成（复用视觉生成队列）
- [ ] **P8.P.16** 侧边栏导航加 "Paid Social 📣" 菜单项

**验收标准**：
- 输入客户 Brief，10 分钟内生成 ≥ 20 条跨格式广告文案
- 每条文案附带可用于 Visual Studio 的配图提示词
- 文案全部使用 AU/NZ 英语，UI 不暴露 OpenAI/Anthropic 等真实供应商名
- 批量图片生成可触发，生成结果在广告卡片中预览
- 对外名：界面统一显示 **"Paid Social Studio"**，AI 引擎称 **"Content Engine"** / **"Strategy Engine"**

---

### Phase 8.5+ Sprint 1 — 评分可信度修复 ⭐（紧急，2026-05-13）

**背景**：Oztop 实测发现 P8.5 评分逻辑有严重缺陷——客户没做过 SEO，分数显示 70 「健康」；口碑 0 findings 却 71 分；缺失数据时各 collector 默认给高分。**这导致诊断结论完全不可信**，必须立即修复才能正式投入客户使用。

**根因**：所有 collector 缺少「未配置 / 未找到数据」的状态机，把空数据当满分处理。

**任务清单**：
- [x] **P8.5.19** `SeoCollector`: 无关键词配置 → `score: null` + finding `keywords_not_configured`（severity: high, fix_type: fde_manual）
- [x] **P8.5.20** `ReputationCollector`: Google Place 未找到商家 → `score: null` + finding `business_not_listed`（severity: critical, fix_type: fde_manual）
- [x] **P8.5.21** `CompetitorCollector`: 竞品 < 3 → `score: null` + finding `competitor_data_insufficient`（severity: medium, fix_type: me_auto，建议跑 SEMrush competitive research）
- [x] **P8.5.22** `AiVisibilityCollector`: 无 snapshot 数据 → `score: null` + finding `ai_visibility_not_tracked`（severity: critical, fix_type: me_auto，引导启用 AI Tracker 周跑）
- [x] **P8.5.23** `SocialCollector`: 无 IG/FB 账号配置 → `score: null` + finding `social_accounts_not_linked`（severity: high, fix_type: fde_manual）
- [x] **P8.5.24** `computeOverallScore`: 忽略 `null` 维度，权重重新归一化；UI 显示「N/A」灰色图标
- [x] **P8.5.25** UI `/diagnostic` 加返回按钮 + null 维度引导链接（「立即配置」跳转客户设置抽屉）
- [x] **P8.5.26** `DiagnosticRun` 增加 `dimensions_skipped: string[]` 字段，记录哪些维度因数据缺失被跳过

**验收标准**：
- Oztop（未配置 SEMrush 关键词、未关联 IG）重跑诊断，SEO/口碑/社媒/AI 显示「未配置」灰色，不影响 overall_score
- overall_score 只基于实际有数据的维度加权计算
- 每个 null 维度配套 finding 告诉用户「下一步该做什么」
- 评分相关单元测试更新（types.test.ts、guards.test.ts、各 collector test）

**工作量**：~2 小时 · **必须在投入正式客户前完成**

---

### Phase 8.10 — Synthesis Layer（Claude 主导的研究/合成层）⭐⭐⭐（核心战略升级）

**背景**：当前 P8.5 诊断引擎是「数据聚合器 + 算术评分」——5 个 collector 把 API 数据变成 0-100 分，Claude 只在处方阶段参与一次。对比客户提供的 deep-research 报告（Oztop 品牌健康诊断 / Mobile Station / gotilesqld），差距在于**缺少 Claude 主导的研究合成层**：竞品深度画像、市场结构归纳、敘事性结论、证据引用追溯都没有。

**目标**：在 Collectors 和 Prescription 之间插入 **Synthesis Layer**，让 Claude Sonnet 把 silo 数据合成 deep-research 级别报告。

**关键洞察（2026-05-13）**：对比 Cowork（Claude.ai/Claude Code）只需输入域名即可生成 deep-research 级报告，根因是 Cowork 用「研究 Agent」模式——Claude 带 Web Search/URL Fetch 工具自主发现+合成；而 Magic Engine 当前是「被动 API 客户端」模式——必须预先配置数据源。**解决方案：新增 Layer 0「张骞 Zhangqian Discovery Agent」**，在所有 Collector 前面，让 Claude 自主把「需要配置」的东西全部发现出来，彻底消除「未配置」用户体验。

**新增分层**：

```
Layer 0: 张骞 Zhangqian Discovery Agent（新增，最高优先级）— P8.10.S0 ⭐⭐⭐
       └─ 输入：只要域名 → Claude Sonnet + Web Search + URL Fetch
          ├─ 业务识别（名称 / 行业 / 地点 / 一句话描述）
          ├─ 社媒发现（IG / FB / LinkedIn / YouTube / TikTok handle）
          ├─ Google Business Profile 定位
          ├─ 评论平台发现（GBP / ProductReview / Trustpilot）
          ├─ 种子关键词提取（5-10 个 brand / category / long-tail）
          ├─ 竞品发现（5-10 个 direct / adjacent / aspirational）
          └─ AI Tracker 问句生成（10-20 个 brand / category / comparison）
       ↓
Layer 1: Collectors（保留并增强，见 P8.10.S2）
       ↓
Layer 2: Synthesis（新增，Claude Sonnet）— P8.10.S3 ⭐
       ├─ competitor-analyst: 5 个竞品 evidence → 「市场结构」+「对标路径」
       ├─ dimension-narrator: 每维度 200-400 字「现状 + 根因 + 机会」
       ├─ score-explainer: 每个分数的「为什么是这分」
       └─ market-context: Anthropic Web Search 抓行业现状
       ↓
Layer 3: Report Composer（新增,Claude Sonnet）— P8.10.S4
       └─ 合成 Markdown 报告（执行摘要 / 6 维度 / 竞品表 / 处方 / 证据附录）
       ↓
Layer 4: Prescription（保留，注入 synthesis context）
       ↓
Layer 5: Export（新增）— P8.10.S5
       └─ Markdown → DOCX/PDF（用 anthropic-skills:docx）
```

**Sprint 0 — 张骞 Zhangqian Discovery Agent（P8.10.S0，~3 天，最先做）⭐⭐⭐**

> 命名由来：张骞乃汉武帝时期出使西域第一人，13 年凿空丝绸之路，首次把未知世界绘制成图。Discovery Agent 之于客户接入 = 张骞之于西域。

**核心目标**：用户只输入域名 → Agent 5 分钟内交付完整客户画像 + 配置建议 → 用户一键确认/编辑后入库。**彻底取代「5 步接入向导」，简化为 2 步**。

**数据库（Day 1）**：
- [x] **P8.10.S0.1** 新建 `client_discovery` 表
  - 字段：`id, client_id, domain, status, payload(JSONB), generated_at, cost_usd, model, expires_at`
  - JSONB payload 结构：`{ business, social_profiles[], gbp, review_platforms[], seed_keywords[], competitors[], ai_tracker_questions[] }`
  - 单客户单条（UPSERT），expires_at = generated_at + 30 天
- [x] **P8.10.S0.2** 新建 `client_discovery_jobs` 表用于异步任务追踪（status / error_message / cost_usd / tool_call_count）

**核心库（Day 2-3）**：
- [x] **P8.10.S0.3** `src/lib/zhangqian/types.ts` — DiscoveryReport / DiscoveredCompetitor / DiscoveredSocial 等类型
- [x] **P8.10.S0.4** `src/lib/zhangqian/agent.ts` — 主入口 `runZhangqian(domain): Promise<DiscoveryReport>`
  - Claude Sonnet + Anthropic Web Search tool + URL Fetch tool（Jina Reader）
  - System prompt 严格定义输出 JSON schema
  - Tool loop：最多 22 轮工具调用，超过则截断
  - 成本上限：$1.80（超过则提前终止）
- [x] **P8.10.S0.5** `src/lib/zhangqian/prompts.ts` — 拆分系统提示词（business / social / competitor / keywords 四段）
- [x] **P8.10.S0.6** `src/lib/zhangqian/validators.ts` — Zod schema 验证 Claude 输出
- [x] **P8.10.S0.7** `src/lib/zhangqian/persistor.ts` — 把 DiscoveryReport 写入 `client_discovery` + 触发后续 collector

**API（Day 3-4）**：
- [x] **P8.10.S0.8** `POST /api/clients/[id]/zhangqian/discover` — 触发异步发现（返回 202 + job_id）
- [x] **P8.10.S0.9** `GET /api/clients/[id]/zhangqian/status` — 轮询任务状态
- [x] **P8.10.S0.10** `GET /api/clients/[id]/zhangqian/latest` — 读取最新 DiscoveryReport
- [x] **P8.10.S0.11** `PATCH /api/clients/[id]/zhangqian/confirm` — 用户编辑确认后写入 clients/keywords/competitors 等表

**前端（Day 4-5）**：
- [x] **P8.10.S0.12** 客户接入向导**简化为 2 步**：
  - Step 1: 输入域名 + 「🧭 派遣张骞」按钮
  - Step 2: 展示发现结果（卡片式，可编辑：业务信息 / 社媒 / 关键词 / 竞品 / AI 问句） → 「确认入库」
- [x] **P8.10.S0.13** 张骞进度面板（实时显示「正在搜索 Instagram… / 正在分析竞品官网…」）—— 复用 P9.0 的环形进度组件
- [x] **P8.10.S0.14** 已有客户加 `/dashboard/clients/[id]/zhangqian` 页面，可手动重跑张骞（更新过期发现）

**S0 收尾增强（2026-05-18 并行 session 完成，commit message 误标 [P8.10.S2.X]，实际属于 S0）**：
- [x] **P8.10.S0.15** Content modal 移除图片预览区块 + Airtable 文案改为「Content Workspace」（commit 2a10979，误标 `[P8.10.S2.1]`）
- [x] **P8.10.S0.16** 冗余 `/dashboard/content/generate` 重定向到客户列表，Content 页 「+ 生成内容」按钮修复（commit 742d0f7，误标 `[P8.10.S2.2]`）
- [x] **P8.10.S0.17** 张骞 confirm 后跳转客户页 `?brief=1`，自动弹开 Master Brief 抽屉（commit 5227874，误标 `[P8.10.S2.3]`）
- [x] **P8.10.S0.18** Master Brief 加视觉 DNA 字段：`formatBriefForPrompt` + `BriefSourcesForm` + pipeline + API 支持 `visual_style` / `brand_colors` / `visual_avoid`（commit fe3b279，误标 `[P8.10.S2.4]`）
- [x] **P8.10.S0.19** `BriefSourcesForm` 挂载时自动从张骞 discovery 预填域名 + 社媒 URL（commit 62ab236，误标 `[P8.10.S2.5]`）
- [x] **P8.10.S0.20** `visual_brief` 从 Route A/C 主调用拆出，独立第二步 `generateVisualBrief()`，使用 MB 视觉 DNA 生成 Flux-dev 级图片 prompt（commit 5226929，误标 `[P8.10.S2.6]`）

**S0.21+ — 首跑硬化 + Advanced Discovery 入口（2026-05-19）**：

战略动因（PM 2026-05-19 口述确立）：**首次发现必须 ≤5 分钟交付 70-80% 完整画像**。深度数据靠用户后续接通 Connectors（GSC / Facebook / GBP / Meta Ads）后再跑一次"Advanced Discovery"。

- [x] **P8.10.S0.21** Discovery 首跑硬化（HTTP 超时全封 + 5min 硬墙 + 工具瘦身 + UI CTA）
  - Anthropic SDK 单次 messages.create 超时 → 90s（默认 10min）
  - SEMrush client 8 处 fetch → 20s AbortSignal
  - Apify ad-library 3 处 fetch → 30s AbortSignal
  - `GLOBAL_TIMEOUT_MS`：4.5min → 5min；`MAX_TOOL_CALLS`：22 → 18；`MAX_COST_USD`：$1.80 → $1.50
  - status route + sweeper stale-timeout：10min → 6min（agent 5min + 1min buffer）
  - 新增 `/api/cron/zhangqian-sweeper`（每 5 min 扫 stuck job），render.yaml 注册
  - **移除首跑工具**：`fetch_meta_ads`（整删）+ `fetch_social_metrics` 去掉 facebook 平台（slow + 低命中率）—— 这两者改由 S5 走
  - `prompts.ts` 同步：研究协议步骤 2 + 费用纪律 + JSON 示例 + 质量要求段落
  - zhangqian 报告页加 Advanced Discovery CTA banner（链接到 connectors 页）

- [x] **P8.10.S0.22** Advanced Discovery — Phase 1：FB / GBP Connector 触发后台再跑
  - Connector 授权回调时检测客户是否已有 basic discovery → 自动 enqueue advanced_discovery_job
  - 复用 `runZhangqian()` 的 Tool 集，但首次跑被屏蔽的 `fetch_meta_ads` / Facebook 真实指标在此重新接入
  - Advanced report 写入 `client_discovery.payload.advanced`（不覆盖 basic）

- [x] **P8.10.S0.23** Advanced Discovery — Phase 2：GSC / Google Ads Connector
  - `src/lib/gsc/client.ts`：Service Account JWT（内置 crypto，无额外依赖）→ GSC Search Analytics API，返回过去 28 天 top-25 query / impressions / CTR / position
  - `google-ads` connector：复用 `apify/google-ads-transparency.ts`，触发后台 Apify 扫描（公开数据，无需凭证）
  - `advanced-agent.ts`：按 `triggeredBy` 分流，gsc → GSC fetch，google-ads → Transparency 扫描，meta-ads/gbp → 原有 Meta/FB 流程
  - `AdvancedDiscoveryPayload` 新增 `gsc_data?` 和 `google_ads_data?`（向后兼容，旧行不需迁移）
  - Connectors 列表页 + 详情页 + API status route 同步加入 `google-ads` 条目；gsc 详情页增加 `site_url` 必填字段
  - build ✅ 零错误（P8.10.S0.23 env var 依赖：`GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` JSON，GSC 不配置时自动降级返回 null）

- [x] **P8.10.S0.24** Advanced Discovery — Phase 3：Advanced 结果注入张骞报告页
  - `cards.tsx` 新增 `GscDataCard`（28天 top-25 查询词表：点击 / 展示 / CTR / 排名）、`GoogleAdsCard`（活跃广告数 / 地区 / 格式 / 文案预览）、`AdvancedFacebookCard`（FB 主页粉丝 / 帖文 / 互动率）
  - `page.tsx`：`MetaAdsCard` 优先读 `p.advanced?.meta_ads`（basic 层自 S0.21 起为 null）；grid 末尾条件渲染三张 advanced 卡片
  - CTA banner 改为双态：`p.advanced` 存在 → 绿色「Advanced Discovery 已完成」+ 触发来源 + 运行时间；否则 → 蓝色「接通数据源」CTA
  - build ✅ 零错误

**验收标准**：
- 输入 `oztopbuildingsupplies.com.au` → 5 分钟内交付：业务一句话描述 + IG handle + GBP + 5-10 竞品 + 10-20 关键词 + 15 AI 问句
- 报告深度匹配 Cowork 生成的 deep research（80%+）
- 「未配置」灰色卡片场景消失（所有维度都有数据）
- 客户接入从 5 步降到 2 步

**成本估算（每次跑张骞）**：
- Claude Sonnet：~50K input + 5K output ≈ $0.23
- Web Search：~15 次 ≈ $0.15
- URL Fetch（Jina）：~10 次（免费）
- **合计 ≈ $0.40 / 客户**（一次性 onboarding 成本）

---

**Sprint 2 — 数据源深化（P8.10.S2，~2 天）**：
- [x] **P8.10.S2.1** SEO Collector 加 DataForSEO backlinks 详情 + SERP rankings 抓取
- [x] **P8.10.S2.2** Competitor Collector 加 Jina 抓竞品官网（解析 USP / CTA / 落地页类型 / 类目深度）
- [x] **P8.10.S2.3** Social Collector 加最近 30 天热门 3 条 post 内容采样（含点赞 / 评论 / hashtag）
- [x] **P8.10.S2.4** Ads Collector 从零实现（Apify Meta Ad Library + Google Ads Transparency）
- [x] **P8.10.S2.5** AI Visibility 加实时调用层（诊断时同步跑 3 个核心问句，不只读 cron snapshot）
- [x] **P8.10.S2.6** 统一 evidence schema：`{ raw, parsed, sources: [{url, fetched_at}], collected_at }`

**Sprint 3 — Synthesis 层（P8.10.S3，~3 天，核心）**：
- [x] **P8.10.S3.1** 新增 `src/lib/diagnostic/synthesis/competitor-analyst.ts`（Claude Sonnet 合成市场结构 + 对标路径）
- [x] **P8.10.S3.2** 新增 `src/lib/diagnostic/synthesis/dimension-narrator.ts`（每维度 narrative）
- [x] **P8.10.S3.3** 新增 `src/lib/diagnostic/synthesis/score-explainer.ts`（每个分数的解释段落）
- [x] **P8.10.S3.4** 新增 `src/lib/diagnostic/synthesis/market-context.ts`（Anthropic Web Search 抓行业现状）
- [x] **P8.10.S3.5** 新增 `diagnostic_narratives` 表：`run_id, dimension, narrative_md, generated_at, model, cost_usd`
- [x] **P8.10.S3.6** Synthesis 结果注入 prescription-generator prompt（让处方更精准）

**Sprint 4 — Report Composer（P8.10.S4，~2 天）**：
- [x] **P8.10.S4.1** `src/lib/diagnostic/report-generator.ts` — 合成完整 Markdown + 可打印 HTML（含 7 段全部填实）
- [x] **P8.10.S4.2** 报告结构：摘要 / 基线 / 6 维度 / 竞品 / 市场上下文 / 处方（证据改为独立 `evidence-{run_id}.json`，不内嵌）
- [x] **P8.10.S4.3** 新增页面 `/dashboard/clients/[id]/diagnostic/report` 渲染 Markdown（含目录 / 表格 / 折叠段）
- [x] **P8.10.S4.4** **保留** `/dashboard/clients/[id]/diagnostic` 6 维度评分卡作为「速览」入口

**Sprint 5 — 引用/证据追溯层（P8.10.S5，~1 天）**：
- [x] **P8.10.S5.1** 每个 finding / narrative 段落带 `evidence_refs: string[]`
- [x] **P8.10.S5.2** UI 上标 `[1]` 可点开证据抽屉（类似 deep-research `citeturn`）
- [x] **P8.10.S5.3** 导出 DOCX 按钮（用 `anthropic-skills:docx` 渲染）

**验收标准**：
- 同一客户（Oztop）诊断报告深度 ≥ 附件 `oztop 品牌健康诊断报告.docx` 的 80%
- 每段叙事可追溯到原始证据
- 报告可导出 DOCX 直接交给客户
- 6 维度评分卡保留作为速览，与深度报告共存

**工作量**：合计 ~9 工作日 · **核心战略升级，必须做**

**第三方服务成本估算**（每次诊断）：
- Claude Sonnet（synthesis + report 合成）：~30K input + 8K output ≈ $0.21
- Anthropic Web Search：~10 次 ≈ $0.10
- 合计 ≈ **$0.31 / 诊断报告**（每月 100 客户约 $31）

---

### Phase 8.12 — AU/NZ 本地化能力扩展 ⭐⭐⭐（三 Agent 护城河）

**背景**：张骞 / 华佗 / 鲁班三个 Agent 目前依赖通用大模型能力。普通大模型对 AU/NZ 本地企业有四个硬伤：① 没有本地实时结构化数据（编造 ABN / 评分 / 竞品）② 不懂本地规则（财年 7/1、EOFY、南半球季节、合规）③ 没有行业基准 ④ 没有记忆。本 Phase 通过一组**本地化 connector + skill + 数据飞轮**，让三个 Agent 对 AU/NZ 本地企业的诊断 / 处方 / 执行显著优于普通大模型 —— 这是 Magic Engine 真正抄不走的护城河。

**架构判断**：张骞是 tool loop，加 connector 零架构改动；华佗是 3 步管线，在 Lookup 阶段加数据源即可；鲁班是单轮对话，升级成 tool loop 是本 Phase 唯一的真架构改动。

**🔥 MVP 范围（2026-05-14 定）**：仅 **S3.1 鲁班 tool loop 升级**——它是鲁班后续所有 connector/skill 的基础设施，且本身是可独立上线的小功能。其余 13 项（S1 全部、S2 全部、S3.2–S3.5）为 MVP 上线后的「补充」，按三个 agent 逐一扩展。

**Sprint 1 — 快速差异化（P8.12.S1，~8–11 人天，低风险不碰架构）📋 补充（MVP 上线后）**：
- [x] **P8.12.S1.1** ABN/NZBN 商业注册验证 connector（`src/lib/abr/`）+ 张骞 `verify_business_registration` skill — 官方免费 API，验证企业真实性 / 注册年限 / GST 状态 / 实体类型 ⭐ 性价比最高
- [x] **P8.12.S1.2** 本地评价聚合 connector（`src/lib/local-reviews/`，GBP via SerpAPI + ProductReview.com.au via Jina）+ 张骞 `fetch_local_reviews` skill
- [x] **P8.12.S1.3** 华佗 `apply_seasonal_calendar` skill（`src/lib/huatuo/seasonal-calendar.ts`）— 澳洲财年 7/1、EOFY、南半球季节、行业旺季静态日历注入处方 ⭐ 纯静态知识零依赖
- [x] **P8.12.S1.4** 华佗 `lookup_local_budget_benchmark` skill — 客户预算 vs 行业基准对比强化进 prompt（`benchmarks.ts` 增强）
- [x] **P8.12.S1.5** Google Trends 本地热度 connector（`src/lib/gtrends/`，gl=au/nz via SerpAPI）接入华佗 Lookup
- [ ] **P8.12.S1.6** 张骞 Apify 商业情报扩展 — 社媒真实指标 + FB 广告 + 小红书 + Google Search（张骞按需调用，非每次全跑）
  - [x] **S1.6a** 接入 4 个现成 Apify 封装（IG/FB/TikTok `social-scraper.ts` + FB 广告 `ad-library.ts`）→ 张骞新 tool `fetch_social_metrics` / `fetch_meta_ads` + `DiscoveredSocial` 加粉丝/帖子/互动率 + `DiscoveredMetaAds` + 前端渲染
  - [ ] **S1.6b** 小红书 RedNote scraper（新封装 `apify/xiaohongshu-scraper.ts`，actor `zhorex/rednote-xiaohongshu-scraper`）+ `SocialPlatform` 枚举加 `xiaohongshu` + 接入（⚠️ 该 actor 无评价，先小范围实测）
  - [x] **S1.6c** Google Search Results scraper（新封装 `apify/google-search-scraper.ts`，SERP organic/paid + AI Overview）→ 服务「AI 可见度」维度
- [x] **P8.12.S1.7** 张骞跨国品牌处理 + GBP 精度修复 — prompt 加跨国品牌检测段；`ad-library.ts` country 参数化（不再硬编码 AU）；`local-reviews/client.ts` 加 brand-token 验证避免 SerpAPI 模糊匹配返回错误企业（Apapaya 实测 case）
- [x] **P8.12.S1.8** 张骞 → AI Visibility 自动桥接 — confirm 时把 `payload.ai_tracker_questions` 同步到 `ai_visibility_queries`（客户专属问句取代 18 个通用 SEO 问句）；QueriesManager 去掉「Generate Questions」按钮 + empty state 改为引导去张骞 Discovery
- 依赖：S1.1/S1.2/S1.5 三个 connector 互相独立可并行；S1.3/S1.4 同在华佗侧建议同人顺序做；S1.6 a→b→c 顺序做

**Sprint 2 — 数据飞轮（P8.12.S2，~10–14 人天，真护城河）📋 补充（MVP 上线后）**：
- [x] **P8.12.S2.1** Case Library schema：新建 `prescription_cases` / `prescription_outcomes` / `local_data_cache` 三表 + RLS ⭐ 所有其他条目的硬前置，建议 S1 收尾时并行启动
- [x] **P8.12.S2.2** 华佗 `retrieve_similar_cases` skill（`src/lib/case-library/retriever.ts`）— 按行业 / 危机类型 / 预算档结构化检索历史处方（v0 不用 embedding）
- [x] **P8.12.S2.3** 效果反馈闭环：处方 KPI 90 天实际回流（`prescription_outcomes` 录入 API + cron 提醒，SEMrush 可测指标自动回填）
- [x] **P8.12.S2.4** 行业基准自动累积：从 outcome 聚合 P50/P75/P90 写回 `industry_benchmarks`（cron，需最低样本阈值）
- 依赖：S2.1 必须最先做；S2.2/S2.3 可并行（一读一写）；S2.4 串行收尾

**Sprint 3 — 深化（P8.12.S3，~12–16 人天）**：

🔥 **MVP（先上线）— S3.1 鲁班架构升级：单轮对话 → tool loop**（~4 人天，独立 PR，抄张骞 `agent.ts` 模式）
- [x] **P8.12.S3.1.1** `src/lib/anthropic/client.ts` 新增 `callClaudeWithTools` helper（通用 tool loop，不动 `callClaudeChat`）+ 单元测试
- [x] **P8.12.S3.1.2** 新建 `src/lib/luban/tools.ts` — `buildLubanTools()` + 首个工具 `add_work_log`（写 execution_logs，author=luban / kind=ai_assist，与现有 log route 一致）
- [x] **P8.12.S3.1.3** 改造 `chatWithLuban`（`src/lib/luban/agent.ts`）内部改用 `callClaudeWithTools`，签名 + 返回结构保持不变
- [x] **P8.12.S3.1.4** 更新 `buildLubanSystemPrompt`（`src/lib/luban/prompts.ts`）加「## 你的工具」段，说明何时调 add_work_log
- [x] **P8.12.S3.1.5** `luban_messages.meta` 持久化加 `tool_calls`（不改表结构，meta 是 jsonb）
- [x] **P8.12.S3.1.6** 回归测试：build 通过 + 5 单元测试通过 + `callClaudeChat` 未动（brief refinement 不受影响）；⚠️ UI 端到端实测待 dev 环境

📋 **补充（MVP 上线后）**
- [x] **P8.12.S3.2** 鲁班 `generate_content` skill — 执行类任务直接产出并落库到 SEO/社媒模块（依赖 S3.1）
- [x] **P8.12.S3.3** 跨 Agent `check_local_compliance` skill（`src/lib/compliance/`）— AU 广告法 / trades license / AFSL 合规风险提示（定位风险提示非背书）【规则库部分已完成：types.ts + au-rules.ts + checkLocalCompliance；注册为鲁班 tool 待后续】
- [x] **P8.12.S3.4** 鲁班 `publish_to_gbp` skill — 依赖 GBP API 写权限申请，未通过则降级为「生成草稿 + 人工发布」（弹性项）
- [x] **P8.12.S3.5** 本地行业目录竞品发现 connector（Yellow Pages AU / Localsearch via Jina）— 优先级最低，弹性缓冲

**新建数据库表**（S2.1）：
- `prescription_cases` — 处方 + 诊断快照作可检索案例，索引 `(industry_category, crisis_type, monthly_budget_aud)`
- `prescription_outcomes` — 处方批准后 30/60/90 天实际 KPI 达成
- `local_data_cache` — ABN/GBP/Trends 结果缓存，带 `expires_at` 控成本

**关键风险**：
- ProductReview / 本地目录反爬 → 走 Jina + 优雅降级返回 null
- GBP API 写权限申请周期不可控 → 与开发并行申请，不通过就降级
- Case Library 冷启动为空 → 检索空时华佗 prompt 优雅退化，需积累 5–10 客户后显价值
- 效果反馈靠人工录入 → 录入做到极轻量 + SEMrush 自动回填
- 鲁班 tool loop 改造破坏 S4.1 执行看板 → 保持 `chatWithLuban` 签名/返回结构不变，独立 PR + 回归测试

**工作量**：合计 ~30–41 人天 · **三 Agent 核心价值，AU/NZ 市场优先**

---

### Phase 8.13 — 张骞 Intelligence Layer（DataForSEO 全域情报接入）⭐⭐⭐

**启动日期**：2026-05-24 通宵 Sprint

**背景**：张骞 Discovery Agent（P8.10.S0）已交付基础版本，但当前客户情报高度依赖：① Claude web_search 猜关键词和竞品（幻觉风险高）② 不稳定的 Apify 爬虫抓 GBP/评论（命中率低）③ SEMrush 独家数据源（成本高、配额有限）。DataForSEO 全 API 盘点后，发现可系统性填补这三个缺口，同时新增「技术栈」「域名健康」「品牌情感」三个全新情报维度，让张骞从「找到客户」升级为「真正读懂客户」。

**核心目标**：
- 用 DataForSEO Labs 替代 Claude web_search 发现竞品 + 种子关键词（数据驱动，零幻觉）
- 用 Business Data API 替代 Apify 爬虫抓 GBP + 评论（稳定、结构化）
- 新增技术栈检测（客户用 WordPress/Shopify/Wix？）
- 新增域名健康（注册年龄、到期预警）
- 每次张骞额外 DataForSEO 成本约 $0.22，远低于当前 Apify 不稳定成本

**API 接入清单**（按优先级）：

| API | 端点 | 替换/新增 | 每次成本 |
|-----|------|----------|---------|
| DataForSEO Labs | Keywords For Site | 替代 web_search 猜关键词 | ~$0.02 |
| DataForSEO Labs | SERP Competitors | 替代 web_search 找竞品 | ~$0.02 |
| DataForSEO Labs | Bulk Traffic Estimation | 批量填充竞品 monthly_traffic | ~$0.01 |
| Domain Analytics | Domain Technologies | 新增：技术栈+联系方式+社媒验证 | $0.01 |
| Domain Analytics | Whois Overview | 新增：域名年龄+到期预警+反链数 | $0.10 |
| Business Data | GMB Info | 替代 SerpAPI GBP scraper | ~$0.01 |
| Business Data | Google Reviews | 替代 Apify 评论抓取 | ~$0.01 |
| Business Data | Trustpilot + Tripadvisor | 新增旅游业客户评分（CTS Tours） | ~$0.01 |
| SERP API | AI Overview | 替代自建 SERP scraper（GEO 核心） | ~$0.02/查询 |
| Backlinks API | Summary | 新增：客户域名反链权重 | ~$0.01 |
| OnPage API | Instant Pages | 新增：单页技术 SEO 快速审计 | ~$0.01/页 |

---

#### Sprint A — 核心情报引擎替换（P8.13.A，~3 人天）🔥 最先做

> 把张骞最依赖 Claude 猜测的两个环节（关键词 + 竞品）换成 DataForSEO 结构化数据。

- [x] **P8.13.A.1** `src/lib/dataforseo/labs.ts` — DataForSEO Labs API 封装 ✅ 已实现（通宵前已存在）
  - `getKeywordsForSite` / `getSerpCompetitors` / `getBulkTrafficEstimation` 全部实现
  - Base64 鉴权复用 client.ts，零新增 env var

- [x] **P8.13.A.2** 张骞 agent 接入 Labs 关键词数据 ✅ 已实现
  - `FETCH_KEYWORD_DATA_TOOL` + `handleFetchKeywordData` 已在 agent.ts 注册
  - 调用 `getKeywordsForSite(domain, locationCode, 50)`，空结果时降级 web_search

- [x] **P8.13.A.3** 张骞 agent 接入 Labs 竞品发现 ✅ 已实现
  - `FETCH_COMPETITORS_TOOL` + `handleFetchCompetitors` 已在 agent.ts 注册
  - 调用 `getSerpCompetitors(domain, locationCode, 10)`，空结果时降级 web_search

---

#### Sprint B — 技术栈 + 域名健康（P8.13.B，~2 人天）

> 新增两个全新情报维度，$0.11/客户，信息密度极高。

- [x] **P8.13.B.1** `src/lib/dataforseo/domain-analytics.ts` — Domain Analytics API 封装 ✅
  - `getDomainTechnologies(domain)` → 调用 `/domain_analytics/technologies/domain_technologies/live`，返回 `{ cms, ecommerce, analytics[], crm_marketing[], chat, domain_rank, phone_numbers[], emails[], social_graph_urls[], all_technologies }`
  - `getDomainWhois(domain)` → 调用 `/domain_analytics/whois/overview/live`，返回 `{ registered_at, expires_at, registrar, backlinks, referring_domains, organic_etv, organic_keywords_top10 }`
  - 错误处理：domain not found → 返回 null，不抛异常（张骞优雅降级）

- [x] **P8.13.B.2** `DiscoveryReport` 新增 technology_stack + domain_whois 字段（`src/lib/zhangqian/types.ts`）✅
  ```typescript
  technology_stack?: {
    cms: string | null                // "WordPress" | "Shopify" | "Wix" | null
    ecommerce: string | null          // "WooCommerce" | "Magento" | null
    analytics: string[]               // ["Google Analytics 4", "GTM"]
    crm_marketing: string[]           // ["Mailchimp", "HubSpot"]
    chat: string | null               // "Intercom" | "Tidio" | null
    domain_rank: number | null
    phone_numbers: string[]
    emails: string[]
    social_graph_urls: string[]       // 用于交叉验证 social_profiles
  } | null

  domain_whois?: {
    registered_at: string | null
    expires_at: string | null
    registrar: string | null
    domain_age_years: number | null
    referring_domains: number | null
    backlinks: number | null
    organic_etv: number | null
    organic_keywords_top10: number | null
  } | null
  ```

- [x] **P8.13.B.3** 张骞 agent 接入 Domain Technologies ✅
  - `FETCH_DOMAIN_TECHNOLOGIES_TOOL` + `handleFetchDomainTechnologies` 已注册
  - social_graph_urls 用于交叉验证社媒 handles；phone_numbers/emails 写入 business

- [x] **P8.13.B.4** 张骞 agent 接入 Whois ✅
  - `FETCH_DOMAIN_WHOIS_TOOL` + `handleFetchDomainWhois` 已注册
  - 到期 < 90 天自动注入 expiryWarning 提示 Claude 写入 quick_fix

- [x] **P8.13.B.5** 张骞报告页新增 TechStackCard + DomainWhoisCard ✅
  - TechStackCard / DomainWhoisCard 已在 cards.tsx + page.tsx 中渲染（非 null 时才显示）

---

#### Sprint C — 替换不稳定 Apify 评论爬虫（P8.13.C，~2 人天）

> 用 DataForSEO Business Data API 替代当前 Apify GBP + 评论 scraper，提升稳定性。

- [x] **P8.13.C.1** `src/lib/dataforseo/business-data.ts` — Business Data API 封装 ✅
  - `getGmbInfo(keyword)` / `getGoogleReviews(keyword, limit?)` / `getTripadvisorInfo(keyword)` 全部实现

- [x] **P8.13.C.2** `src/lib/local-reviews/client.ts` 升级 ✅
  - GBP 数据源从 SerpAPI 切换到 DataForSEO `getGmbInfo()` + `getGoogleReviews()`
  - 新增 `fetchTripadvisorReviews()` 函数（tourism 客户触发）
  - `aggregateLocalReviews` 新增可选 `tripadvisorKeyword` 参数
  - agent.ts `fetch_local_reviews` tool 新增 `tripadvisor_keyword` 入参

- [x] **P8.13.C.3** `review_platforms` 新增 `tripadvisor` 枚举值 ✅
  - `types.ts` (local-reviews + zhangqian) + validators.ts + cards.tsx REVIEW_PLATFORM_LABELS 同步

---

#### Sprint D — SERP + 技术审计（P8.13.D，~2 人天）

> 用 DataForSEO SERP API 替换自建 SERP scraper；新增 OnPage 技术审计 + Backlinks 权重。

- [x] **P8.13.D.1** `src/lib/dataforseo/serp.ts` — SERP API AI Overview 封装
  - `getSerpPage(query, countryCode?)` → 调用 `/serp/google/organic/live/advanced`，提取 `ai_overview_text` + `ai_overview_sources[]` + `organic_results[]` + `paid_advertiser_domains[]`
  - `handleFetchSerpResults` 更新：DataForSEO 优先，Apify `scrapeGoogleSerp` 降级 fallback
  - 验收：`best tour operator in New Zealand` 跑出 AI Overview 文本 + 引用来源

- [x] **P8.13.D.2** Backlinks Summary — 已由 `src/lib/dataforseo/client.ts` 中 `getBacklinkSummary()` + `domain_whois.backlinks` / `referring_domains` 字段覆盖，无需新文件

- [x] **P8.13.D.3** `src/lib/dataforseo/onpage.ts` — OnPage Instant Pages 封装
  - `getOnPageInstant(url)` → 调用 `/on_page/instant_pages`，返回完整 `OnPageResult`（checks / core_web_vitals / meta / links / images）
  - 新增 `DiscoveryReport.onpage_audit` 字段（types.ts）
  - `FETCH_ONPAGE_AUDIT_TOOL` + `handleFetchOnpageAudit` 接入 agent.ts；步骤 1 协议要求必须调用
  - 问题自动写入 diagnosis.actions.quick_fix 的 summary 指引

- [x] **P8.13.D.4** 张骞报告页新增 `OnPageAuditCard`（Core Web Vitals + pass/fail badges + 问题列表）；page.tsx 接入

---

#### Sprint E — 集成测试 + 成本优化（P8.13.E，~1 人天）

- [x] **P8.13.E.1** 端到端测试：用 CTS Tours + Oztop 各跑一次完整张骞（基础发现 + 所有新工具）✅
  - 验收：21 个 mock 集成测试全过，覆盖 technology_stack + domain_whois + onpage_audit + serp_results 字段
  - 同步修复 `validators.ts` bug：technology_stack / domain_whois / onpage_audit 未被 validator 透传（Sprint B/D 遗漏）
  - 成本基准：≈ $0.57/客户（Claude $0.23 + web_search $0.08 + DataForSEO $0.17 + Apify/Jina $0.09）

- [x] **P8.13.E.2** 更新成本估算注释（`src/lib/zhangqian/agent.ts` 顶部）✅
  - 新基准：Claude $0.23 + Web Search $0.08 + DataForSEO Labs ~$0.04 + Domain Analytics ~$0.11 + Business Data ~$0.03 + SERP ~$0.01 + OnPage ~$0.003 = **≈ $0.57 / 客户**（含全新情报维度，首次 onboarding 一次性成本）

- [x] **P8.13.E.3** ROADMAP § 9 功能完成日志追加 Phase 8.13 总结 + 更新 CLAUDE.md 当前焦点 ✅

---

**新增 DiscoveryReport 字段汇总**：

```
technology_stack    — 客户技术栈（CMS/ecommerce/analytics/chat）
domain_whois        — 域名年龄/到期/注册商/反链数/流量值
onpage_audit        — 技术 SEO 快速体检（Core Web Vitals/checks）
DiscoveredBusiness.phone_numbers  — 从 Domain Technologies 提取
DiscoveredBusiness.emails          — 从 Domain Technologies 提取
DiscoveredReviewPlatform: 新增 tripadvisor
```

**工作量**：合计 ~10 人天（Sprint A 3天 → Sprint B 2天 → Sprint C 2天 → Sprint D 2天 → Sprint E 1天）

**每次张骞成本升级后**：~$0.57/客户（基础版 $0.40 + DataForSEO 增量 $0.17），全部一次性 onboarding 成本，可接受。

**验收关卡**：
- M1：DataForSEO Labs 返回 Oztop 关键词 ≥ 10 条（含真实 volume）+ 竞品 ≥ 5 个（含真实流量）
- M2：Domain Technologies 返回 Oztop 技术栈（至少识别出 CMS）+ Whois 返回域名年龄
- M3：CTS Tours 完整跑出 Google + Trustpilot + Tripadvisor 三平台评分
- M4：OnPage Audit 返回 CTS Tours 首页 Core Web Vitals + ≥ 3 个 SEO checks

---

### Phase 9.0 — Visual Queue UX Polish ⭐（生成队列用户体验优化）

**背景**：用户在 3–7 分钟的生成过程中无法感知进度，导致误认为系统卡顿。本阶段通过**1Hz 本地流畅倒计时 + 环形进度条 + 4步骤指示器 + 智能取消按钮**，将被动等待转化为主动跟踪。

**验收标准**：
- 倒计时 < 200ms 的网络延迟波动隐藏（本地平滑）
- 进度环 0-95% 连贯旋转，无卡顿
- 取消按钮在 1.5 倍预期时间后激活（用户主动权）
- 队列概览卡支持 10+ 同步生成任务的可见性
- 所有组件 ≥ 80% 测试覆盖率

#### Phase 9.0.1 — 进度计算库 + 配置升级

**目标**：提供纯函数库用于进度计算、计时格式化、阶段判断，以及升级生成配置以支持资产类型特定的生成时间估算。

- [x] **P9.0.1** 创建 `src/lib/visual/progress-utils.ts`：导出 `getProgressPercent()`、`formatCountdown()`、`getStageKey()`、`shouldEnableCancelButton()` ✅ **完成**
- [x] **P9.0.2** 升级 `src/lib/visual/generation-config.ts`：新增 `getStagesForType(assetType)` 和 `getCancelThresholdMs(provider, assetType)` ✅ **2026-05-12 完成**
- [x] **P9.0.3** `src/lib/visual/__tests__/progress-utils.test.ts` ✅ **完成**

#### Phase 9.0.2 — 核心 UI 组件

**目标**：实现三层 UI 组件：环形进度条、4 步阶段指示、倒计时文本。所有组件接收 `GenerationQueueItem` 和本地平滑的 `elapsed` / `estimatedRemaining` 作为 props。

- [x] **P9.0.4** `src/components/visual/StageIndicator.tsx` ✅ **完成**
- [x] **P9.0.5** `src/components/visual/CountdownText.tsx` ✅ **完成**
- [x] **P9.0.6** `src/components/visual/GenerationProgress.tsx`（SVG 环形进度 + StageIndicator + CountdownText + 取消按钮）✅ **完成**

#### Phase 9.0.3 — Hook 改造 + 1Hz 本地平滑

**目标**：升级 `useGenerationQueue` hook，添加 `setInterval` 实现 1Hz 本地倒计时平滑，隐藏 5 秒网络轮询的延迟感。

- [x] **P9.0.7** 改造 `src/hooks/useGenerationQueue.ts`：在 activeGenerations 状态下启动 `setInterval`（每 100ms 触发），本地递减 `estimatedRemainingMs`、递增 `elapsed`，防止网络延迟导致的倒数跳跃 ✅ **2026-05-04 完成**
  - ✅ 添加 smoothingRefs、cleanup() 扩展、polling effect 1Hz 逻辑
  - ✅ 8 个单元测试 100% 通过（测试 1H 创建 100ms 区间、平滑计数、估算递减、无重复区间、清理、单调递增、并发独立、5s 轮询）
  - ✅ 测试覆盖率 96.2% statements
- [x] **P9.0.8** 集成至 `src/app/dashboard/visuals/page.tsx`：queued 状态改为 SVG 弧形环 + 位置编号（#N）+ slide-in 动画，generating 状态加 slide-in 动画，completed 缩略图加 scale-pop 动画 ✅ **2026-05-07 完成**
- [x] **P9.0.9** `src/app/globals.css` 新增 `scale-pop`、`pulse-subtle`、`slide-in-x` 三组 keyframe 动画 ✅ **2026-05-07 完成**

#### Phase 9.0.4 — 集成测试 + 边界场景

**目标**：为三个 UI 组件编写集成测试，覆盖网络延迟、超时、多提供商的边界场景。

- [x] **P9.0.10** `src/components/visual/__tests__/GenerationProgress.test.tsx`：测试进度环 0%-95% 过渡、倒计时每秒刷新、取消按钮在 1.5x 倍数时激活 ✅
- [x] **P9.0.11** 网络延迟模拟测试：验证本地 1Hz 平滑隐藏 5s 轮询波动 ✅
- [x] **P9.0.12** 多提供商时间估算测试：针对 wavespeed（3min）、seedance（4min）、heygen（2min）验证 getCancelThresholdMs() 的计算 ✅
- [x] **P9.0.13** 边界场景测试：0ms 倒数、NaN 估算、提供商超时重分类后的进度重置 ✅
- [x] **P9.0.14** 覆盖率验证：运行 `npm test --coverage`，确保 ≥ 80% ✅

#### Phase 9.0.5 — 队列概览浮动卡（Phase 3）

**目标**：为长队列场景提供浮动卡片，一览所有在生成的资产，点击跳转到对应资产详情。

- [x] **P9.0.15** 创建 `src/components/visual/QueueOverviewCard.tsx`：显示 activeGenerations 列表（资产 ID、进度、倒计时），支持展开/收缩，固定在右下角（`fixed bottom-4 right-4`），点击行项目滚动到对应资产 ✅
- [x] **P9.0.16** Hook 集成：从 `useGenerationQueue` 获取 `activeGenerations`，支持 `showQueueCard` 状态切换（10+ 任务时自动显示）✅
- [x] **P9.0.17** E2E 测试：验证卡片在多资产生成时可用，滚动跳转功能正常 ✅

**完成条件**：所有 17 项任务完成、测试覆盖 ≥ 80%、UI 无卡顿、支持 Cancel 操作。

---

### Phase 9 — 报告化 + 客户交付

- [ ] **P9.1** 月报 PDF 导出 + 邮件自动发送（Strategy Engine 生成分析文字，Puppeteer 截图）
- [ ] **P9.2** 客户 Portal（client-facing view，只看自己内容 + 当月月报）
- [ ] **P9.3** 站点权威度追踪（DA / 外链 / 内链趋势）
- [ ] **P9.4** Cron：每日 sync Content Workspace → 主库；每周一跑 AI Tracker + 更新策略建议
- [ ] **P9.5** 批量执行：一键为所有 approved 策略条目生成对应内容

### Phase 10 — 平台扩展与沉淀

- [ ] **P10.1** 小红书 / LinkedIn / TikTok 视频自动剪辑支持
- [ ] **P10.2** 多语言内容支持（中文市场优先）
- [ ] **P10.3** Magic Lab Academy 课程化（基于 CTS Tours 实战 SOP）
- [ ] **P10.4** Plugin 形态：WordPress / Webflow GEO 自动注入插件
- [ ] **P10.5** Google AI Overview 追踪（SerpAPI，AU/NZ 市场必做）

---

## 6. 技术债

### 既有技术债
- [ ] **TD.1** Content Workbench 编辑失败无错误提示（当前静默失败）
- [ ] **TD.2** 图片生成失败后无法手动重试（需刷新页面）
- [ ] **TD.3** Supabase MCP 未连接 Magic Engine 项目（需加 `glbdnayojixmexgofbsd`）
- [ ] **TD.4** 缺少 Supabase Row Level Security 规则
- [ ] **TD.5** 视觉生成队列在客户端 localStorage（需迁移到服务端）
- [ ] **TD.6** 第三方真实名在部分 UI 文案中暴露（需扫描 + 替换为封装名）
- [ ] **TD.10** Git 本地分支堆积（20+ 个 `claude/*` 和 `feat/*` 废弃分支）
  - 风险：误删未合并工作 = 真正丢代码
  - 处理：单独开会话专门 triage，按"已合并到 main 的删 / 未合并的归档到 `archive/*`"两步走
  - 优先级：MEDIUM（不阻塞 Phase 12；建议 M1 通过后处理）
- [ ] **TD.11** `agitated-mahavira-be6d17` 等 worktree 物理目录占用磁盘空间
  - 当前：已从 git 移除追踪 + gitignore 屏蔽，但物理目录仍在磁盘上
  - 处理：等占用它的 Claude session 结束后手动 `rm -rf .claude/worktrees/`
  - 优先级：LOW（不影响功能，只是磁盘清理）

### P8.C.1 月报聚合器引入的技术债（后续补齐）

**聚合器核心库**
- [ ] **TD.7** 收集器模块（6 个）缺少错误重试机制
  - 当前：单次调用失败直接返回空数据
  - 待补：Exponential backoff + 3 次重试 + 降级策略
  - 优先级：MEDIUM（Phase 8.C.1 MVP 不影响，Phase 9 前必须做）

- [ ] **TD.8** 月报聚合库缺少事务型一致性保证
  - 当前：6 个收集器独立落库，无全局事务
  - 待补：Supabase transaction 或消息队列确保一致性
  - 优先级：HIGH（数据不一致会导致报告错误，应在 Phase 8.C.1 后期补）

- [ ] **TD.9** 聚合器性能未优化（N+1 查询）
  - 当前：逐个数据源查询，串行执行
  - 待补：并行化 + JOIN 优化 + Redis 缓存 30 min
  - 优先级：MEDIUM（现阶段 <10 客户无压力，>50 客户前必须优化）

**API 端点**
- [ ] **TD.10** 月报查询端点缺少分页 / 排序参数
  - 当前：返回全量数据
  - 待补：支持 limit / offset / sort_by / order
  - 优先级：LOW（MVP 可不做，UI 下个迭代加）

- [ ] **TD.11** API 缺少速率限制（Rate Limit）
  - 当前：无限制调用
  - 待补：每客户 100 req/min（Phase 8.C.2 前做）
  - 优先级：MEDIUM

**前端 UI**
- [ ] **TD.12** 月报页面缺少加载骨架屏（loading skeleton）
  - 当前：空白等待，UX 差
  - 待补：各分节加 skeleton loader（Tailwind 实现）
  - 优先级：LOW（可在 Phase 8.C.2 优化）

- [ ] **TD.13** 分节组件之间缺少交互（drill-down / tooltip）
  - 当前：静态卡片展示，难以深入分析
  - 待补：点击链接到各模块详情页、Hover tooltip 显示计算逻辑
  - 优先级：LOW（Phase 9 增强）

- [ ] **TD.14** 月报导出功能（PDF / 邮件）未实现（P8.2 任务）
  - 当前：无导出
  - 待补：HTML → PDF 通过 headless browser；邮件模板 + Sendgrid 集成
  - 优先级：HIGH（P8.2 单独任务，排期 Phase 8.C.2 后）

**测试覆盖**
- [ ] **TD.15** 聚合器单元测试覆盖率 < 70%
  - 当前：仅端到端测试
  - 待补：Mock 各数据源，添加 20+ 单元用例
  - 优先级：HIGH（应在 Phase 8.C.1 完成前补，目标 80%+）

- [ ] **TD.16** 未做月报端到端测试（CTS Tours 实际客户）
  - 当前：样本数据验证
  - 待补：真实客户 1 个月数据 round-trip 验证
  - 优先级：MEDIUM（可在 Phase 8.C.2 进行）

**文档与监控**
- [ ] **TD.17** 聚合器架构文档缺失
  - 当前：代码注释零散
  - 待补：ARCHITECTURE.md 新增 §13 月报聚合架构
  - 优先级：LOW（Phase 9 前完成）

- [ ] **TD.18** 缺少聚合器性能 / 错误监控仪表板
  - 当前：无实时监控
  - 待补：Datadog / Sentry dashboard（成本 → Phase 10）
  - 优先级：LOW（Phase 9+ 考虑）

---

## 7. 风险跟踪

| 风险 | 影响 | 缓解策略 | 负责人 |
|------|------|---------|--------|
| Google 判定 GEO 隐藏指令为 cloaking | GEO 失效 | 用 aria-hidden 标准做法；持续监测 SEO 流量 | 产品 |
| AI 引擎升级识别 prompt injection | GEO 价值下降 | 是赛跑窗口；同步研究 Schema.org 等替代方案 | 产品 |
| Perplexity API 限流或涨价 | Tracker 成本上升 | 准备 SerpAPI 备选；本地缓存 7 天 | 开发 |
| PoC 客户排名无显著提升 | 商业模式不成立 | 调整 GEO 策略；可能改打"内容生产效率"卖点 | 产品 |
| 当前未做用户认证 | 数据安全风险 | Phase 8 引入简单鉴权；陪跑模式下风险可控 | 开发 |
| 三维策略库性能（大规模客户） | API 延迟 | N+1 查询优化、结果缓存 30min | 开发 |
| DNZ 采集在网络不稳定环境 | 采集失败率高 | Jina.ai 重试 3 次，标记失败但不阻断流程 | 开发 |
| Visual Queue 组件在旧浏览器 | 兼容性问题 | CSS 降级、纯 JS 倒计时备选 | 开发 |

---

---

## Phase 11 — Creative Intelligence Engine（未来重点开发方向）

> 状态：📋 规划中 · 预计启动：2026 Q3+（依赖 Phase 9/10 完成 + 足够历史数据积累）

### 战略定位

在 Magic Engine 现有"内容生成"能力基础上，增加**创意智能层**：不只是生成内容，而是**知道什么内容对什么人有效**，用真实绩效数据驱动下一轮创意决策。

### 三层技术架构

```
Layer 1: VLM 视觉理解层（Vision Language Model）
  → 每条 Reel/Image 生成后自动打 7 维风格向量
  → 工具：Gemini 2.0 Flash（直接处理视频）/ GPT-4o（帧分析）
  → 成本：~$0.03/条

Layer 2: pgvector 语义记忆层
  → 所有创意资产的高维 embedding 存入 Supabase pgvector
  → 支持：相似创意搜索 / 风格聚类 / 跨客户迁移
  → 基础设施：已有（Supabase），零额外成本

Layer 3: XGBoost 绩效预测层
  → 输入：7 维风格分数（VLM 输出）
  → 标签：ROAS / CTR / CPA（Markifact 回传）
  → 输出：新创意的预测绩效 + 最适合投放的 persona
  → 训练触发：每月，数据量 ≥ 50 条带绩效的创意
```

### 7 维风格向量定义

| 维度 | 范围 | 说明 |
|------|------|------|
| energy | 0-10 | 剪辑节奏/动感（3=慢镜头，8=快切） |
| luxury | 0-10 | 高端感/制作质感 |
| authenticity | 0-10 | 真实感（0=硬广，10=UGC风格） |
| emotional | 0-10 | 情绪张力/共鸣深度 |
| humor | 0-10 | 幽默感/轻松感 |
| urgency | 0-10 | CTA紧迫感（0=纯品牌，7+=稀缺/限时） |
| offer_signal | 0-10 | 具体卖点强度（0=纯种草，10=强促销） |

### Persona 分类体系

| Persona | 典型向量特征 | 适合漏斗位置 |
|---------|------------|------------|
| Luxury Aspirational | luxury≥7, urgency≤2 | 顶部（品牌种草） |
| Calm Explorer | energy≤4, authenticity≥7, urgency≤2 | 顶/中部（兴趣培育） |
| Practical Buyer - Planner | urgency 4-6, offer_signal 4-6 | 中部（考虑阶段） |
| Practical Buyer - Converter | urgency≥6, offer_signal≥6 | 底部（转化收割） |

### XGBoost 核心价值

1. **投放前预测**：新 Reel 生成后，XGBoost 输出预测 ROAS，决定是否值得加预算
2. **特征重要性**：告诉创意团队"对 Converter 受众，urgency 的影响力是 luxury 的 3 倍"
3. **跨客户迁移**：多个旅游客户的数据合并训练，新客户冷启动借用行业经验
4. **内容缺口检测**："高 luxury + 高 emotional 组合在库里最少但表现最好，优先生成"

### 数据积累路径

```
Phase 11.0（现在开始）：VLM 打标签
  → 每条生成的 Reel 自动获得 7 维分数
  → 存入 visual_assets.style_scores + embedding
  → 零额外开发成本（用现有 VLM API）

Phase 11.1（2026 Q3）：Markifact 数据打通
  → 确认 creative_parent_id 能在 Markifact 中携带和回传
  → 建立 (7维分数 → 绩效数据) 的配对数据集

Phase 11.2（数据量 ≥ 150 条后）：XGBoost v0.1
  → 训练第一版预测模型
  → 特征重要性报告上线（告诉用户哪种风格最有效）

Phase 11.3（数据量 ≥ 500 条 / 跨 3+ 客户）：XGBoost v1.0
  → 投放前自动评分
  → "下一批 Reels 该往哪个方向生成"决策建议
```

### 关键依赖确认（启动前必须完成）

- [ ] Markifact API 能否回传 `creative_parent_id`（绑定我们的 seed creative）
- [ ] Markifact 能否提供"创意 × 受众 × 转化"三维数据切片
- [ ] Supabase `visual_assets` 表加 `embedding vector(512)` + `style_scores jsonb` 列

### PoC 验证标准

- 150 条带绩效标签的创意 → XGBoost 预测 ROAS 误差 < 30%
- 特征重要性报告能给出 3 条可执行的创意方向建议
- 新客户冷启动：借用行业模型，前 10 条 Reels 预测准确率 > 60%

---

## Phase 12 — 飞轮数据闭环 ⭐⭐⭐（活跃，2026-05-17 启动）

> **背景**：当前诊断→处方→执行链路已建好，但 4 飞轮（SEO/GEO/Ads/社媒）执行后**没有数据回流**，没法学习、没法归因、没法沉淀经验。Phase 12 建立统一的 `actions / metrics / outcomes` 三层数据骨架 + adapter 抽象，让任何 vendor（自研 / markisfact / Publer / Meta MCP）的数据都能回流并自动归因。
>
> **试点客户**：CTS Tours（GEO + SEO + Ads，已有 Meta 投放数据）+ Oztop（SEO + GEO）
>
> **工作协议**：见 [CLAUDE.md § Phase 12 工作协议](./CLAUDE.md)
>
> **架构原则**：4 飞轮三种执行形态（`in_house` / `third_party` / `external_manual`）共享同一套数据层；vendor 可插拔，数据永远留在 Magic Engine。

### Phase 12 决策点（2026-05-17 已确认）

- **第 4 飞轮命名**：`geo_composer`（替代历史命名 `insight_reports`；月报独立为非飞轮的 `reports`）
- **广告 vendor 策略**：先用 Meta MCP 自建 adapter；markisfact 当作"未来可插拔"的备选 adapter，硬约束是**数据必须留在 Magic Engine**
- **社媒飞轮形态**：混合（自研内容制作 Atlas + OpenAI/Claude + 第三方发布 Publer）
- **schema 修改可接受**：6 客户存量数据规模可控，回填脚本充分测试即可

### Phase 12.A — 数据骨架 + 第一个端到端 demo（CTS GEO 飞轮）

每个任务 = 1 commit。完成顺序按依赖：

#### M1 地基（任务 1-3，~7 小时）

- [x] **P12.A.1** — 建 3 张新表 migration（`flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes`）+ alter `prescription_actions` 加 `execution_target` JSONB 列。含 6 客户存量数据回填 SQL（把现有 `module` 映射到新 `execution_target`）✅ 2026-05-17
- [x] **P12.A.2** — 受控词表（`src/lib/flywheel/vocabulary.ts`）：所有 `action_type` + `metric_key` 枚举。**Phase 12 只列 GEO 维度**（如 `geo.deploy_directive` / `geo.query.mention_rate`），其他飞轮 Phase 12.B 补 ✅ 2026-05-17
- [x] **P12.A.3** — `FlywheelAdapter` 接口 + `Registry`（`src/lib/flywheel/adapters/types.ts` + `registry.ts`）✅ 2026-05-17

> **M1 验证关卡**：`npm run build` 通过；Supabase 后台能看到 3 张新表（flywheel_actions / flywheel_metrics / flywheel_outcomes）；6 客户处方的 `execution_target` 列已填非空

#### M2 第一个 adapter（任务 4-6，~11 小时）

- [x] **P12.A.4** — 实现 `GeoComposerAdapter`（in_house mode）：`.execute(action)` 把动作写入 `flywheel_actions`，`.pullMetrics()` 留接口给 P12.A.7 填 ✅ 2026-05-17
- [x] **P12.A.5** — 改造执行看板"在 X 中执行"按钮逻辑，按 `execution_target.mode` 分发：`in_house` 弹抽屉 / `third_party` 跳外链 + 提示回来打勾 / `external_manual` 隐藏按钮只显示"FDE 完成后请打勾" ✅ 2026-05-17
- [x] **P12.A.6** — 新建 `FlywheelDrawer.tsx`：抽屉里调 `adapter.execute()`，落 `flywheel_actions` 记录 ✅ 2026-05-17

> **M2 验证关卡**：本地 dev server 上，CTS 执行看板的 GEO 任务卡片，点击按钮能弹出抽屉、提交后能在 Supabase `flywheel_actions` 表看到一条新记录（带 `flywheel='geo'`、`action_type='geo.deploy_directive'`、`expected_metric` 已填）

#### M3 端到端 demo（任务 7-13，~16 小时）

- [x] **P12.A.7** — AI Tracker 重跑时把结果写入 `flywheel_metrics`（`metric_key='geo.query.mention_rate'`，`source='ai_tracker'`）✅ 2026-05-17
- [x] **P12.A.8** — 归因 Job（`src/lib/flywheel/attribution/job.ts`）：扫所有 `flywheel_actions.expected_metric`，在窗口内算 baseline / after，写 `flywheel_outcomes` ✅ 2026-05-17
- [x] **P12.A.9** — Cron 触发归因 Job（`src/app/api/cron/attribution/route.ts`，每 6h 跑一次）✅ 2026-05-17
- [x] **P12.A.10** — 执行看板卡片显示 outcome（"✅ Mention rate +25%, confirmed (confidence 0.8)"）✅ 2026-05-17
- [x] **P12.A.11** — 华佗处方生成器输出 `execution_target` 字段（让新生成的处方天然带 flywheel/mode/vendor）✅ 2026-05-17
- [x] **P12.A.12** — 存量数据回填脚本（一次性，6 客户的 `prescription_actions.execution_target` 完整填充并核对）✅ 2026-05-17
- [x] **P12.A.13** — CTS 端到端验证：找一个真实 GEO finding → 走完 action → 触发 AI Tracker 重跑 → outcome 显示在执行看板 UI ✅ 2026-05-17

> **M3 验证关卡**：CTS 执行看板上至少有一条 GEO action 的卡片下面显示完整 outcome（含 baseline / after / verdict / confidence）

#### 收尾（任务 14-15）

- [x] **P12.A.14** — 写架构 README（`docs/flywheel-architecture.md`），含"如何加新 adapter"步骤
- [x] **P12.A.15** — ROADMAP § 9 功能完成日志追加 Phase 12.A 总结 + 更新 CLAUDE.md 当前焦点切换到 Phase 12.B ✅ 2026-05-17

### Phase 12.B — SEO / Ads / 社媒 adapter 接入

每个任务 = 1 commit。

> **状态校准（2026-05-19）**：B.1–B.4 已完成。Phase 12 的数据闭环主干已经跑通；除非 PM 明确要求继续扩 adapter，当前不再作为下一 session 的默认焦点。下一阻塞项回到 P8.3.2 Dashboard Magic Link 鉴权。

- [x] **P12.B.1** — SEO adapter（`SeoContentAdapter`）：vocabulary 填 SEO_ACTION_TYPE + SEO_METRIC_KEY；execute() 落 flywheel_actions；pullMetrics() 拉 SEMrush domain_ranks + blog_posts 计数写 flywheel_metrics；9 个单元测试全过；build 通过 ✅ 2026-05-18
- [x] **P12.B.2** — Meta Ads adapter（`MetaAdsAdapter`）：CTS 真实广告账户接入，Meta MCP；execute() 落 flywheel_actions；pullMetrics() 拉 ROAS / spend / impressions ✅ 2026-05-18
- [x] **P12.B.3** — 社媒内容 action 落库：SocialContentAdapter；vocabulary 填 SOCIAL_ACTION_TYPE(3) + SOCIAL_METRIC_KEY(2)；execute() 落 flywheel_actions；pullMetrics() 统计 content_posts 发布/排期数；publer/create-post 挂 .catch() 静默写；11 单元测试；build 通过 ✅ 2026-05-18
- [x] **P12.B.4** — SEMrush 周快照 cron：定时拉 domain_ranks 写 flywheel_metrics（所有客户）；GET /api/cron/flywheel-seo-weekly；CRON_SECRET 鉴权；逐客户调 SeoContentAdapter.pullMetrics()；9 单元测试；build 通过 ✅ 2026-05-18

---

### Phase 8.S — SEMrush → DataForSEO 关键词接口迁移（成本优化）

> 登记于 2026-05-18；**P8.S.1–7 已全部实现，2026-05-25 代码核实**（`src/lib/dataforseo/labs.ts` 全部替换函数已存在且被调用）。P8.S.8（`batchKeywordOverview`）低优先级，暂缓。
> 背景：SEMrush 关键词 API 按 units 计费（10 units/词 ≈ $0.05/词），DataForSEO Labs 同等接口按 task 计费（$0.01–0.02/task，批量无限词）；实测相同数据量节省 96–99%。
> 迁移优先级：按当前用量成本从高到低排序。

- [x] **P8.S.1** — `getRelatedKeywords`（`phrase_related`）→ `dataforseo_labs/google/related_keywords/live` ✅ 已在 `src/lib/dataforseo/labs.ts` 实现
- [x] **P8.S.2** — `getDomainOrganicKeywords`（`domain_organic`）→ `dataforseo_labs/google/ranked_keywords/live` ✅
- [x] **P8.S.3** — `getKeywordGap`（`phrase_kgap`）→ `dataforseo_labs/google/domain_intersection/live` ✅
- [x] **P8.S.4** — `getDomainCompetitors`（`domain_organic_organic`）→ `dataforseo_labs/google/competitors_domain/live` ✅
- [x] **P8.S.5** — `getQuestionKeywords`（`phrase_questions`）→ `dataforseo_labs/google/keyword_suggestions/live`（过滤 question intent）✅
- [x] **P8.S.6** — `getDomainMetrics`（`domain_ranks`）→ `dataforseo_labs/google/domain_rank_overview/live` ✅
- [x] **P8.S.7** — `getDomainTrafficTrend`（`domain_rank_history`）→ `dataforseo_labs/google/historical_rank_overview/live` ✅
- [ ] **P8.S.8** — `batchKeywordOverview`（`phrase_these`）→ `keywords_data/google_ads/search_volume/live` + `bulk_keyword_difficulty`（两次 task 合并）
  - 低优先：批量 overview 数据量通常少，暂缓至前 7 项完成后评估

> **⚠️ 注意**：DataForSEO KD 分数算法与 SEMrush 不同，数值不可横向比较。切换后需在客户报告 + UI 中注明口径变更，或统一改用 DataForSEO KD 标准。
> **保留 SEMrush API key**：`batchKeywordOverview` P8.S.8 完成前 + 任何降级回退用。

### Phase 12.C — 飞轮数据闭环（聚合 + 置信度 + 社媒回流）

> 启动：2026-05-28。飞轮骨架（12.A）+ adapter（12.B）已就绪，现在让数据「活起来」。
>
> 工作分支：`feat/phase-12-c-flywheel-closure`

- [x] **P12.C.1** — 跨客户 outcome 聚合视图：GET /api/admin/flywheel/aggregate，按 action_type 统计 verdict_rate；Admin Dashboard「飞轮成效」卡片展示 top 5
- [x] **P12.C.2** — 反哺华佗置信度：`src/lib/case-library/outcome-confidence.ts` 计算历史成功率，注入处方生成 prompt（含「历史成功率 X%，基于 N 案例」标签）
- [x] **P12.C.3** — 社媒发布数据回流：Publer API 拉取帖子 likes/comments/shares，写入 flywheel_metrics；cron `social-engagement-pullback` 每日 4am UTC

> **范围说明**：markisfact adapter 已从 Phase 12.C scope 移除，待商务谈成后单独登记。

### Phase 12.Q — 内容质量闭环 ⭐⭐⭐（已登记，未开工，2026-05-19 启动登记）

> **背景**：内容生成（Blog / Social A/B/C / Reels）当前已能产出 draft，但质量不稳定且无闭环——Master Brief + Campaign 注入不完整、生成后无统一质检、retry 缺失、产物无 generation context 可追溯。Phase 12.Q 建立「campaign 上下文强化 + 统一 quality rubric + 自动质检 retry + 上下文快照持久化」四件套，让内容质量从「AI 初稿系统」升级为「可审计可优化的生产系统」。
>
> **试点客户**：CTS Tours
>
> **前置阻塞**：P8.3.2 Dashboard Magic Link 鉴权完成后才开工
>
> **工作协议**：见 [CLAUDE.md § Phase 12 工作协议](./CLAUDE.md)。Phase 12.Q 起每个 sub-phase 用独立分支 `feat/phase-12-{letter}-{slug}`；本 phase 实施分支为 `feat/phase-12-q-content-quality`；本登记 PR 在 `chore/roadmap-phase-12q-registration`

#### Phase 12.Q 决策点（2026-05-19 已确认）

- **覆盖 Phase 13 `campaign_briefs 不扩 schema` 决策**：质量上限被 campaign context 缺失卡住，6 个 nullable 字段为低风险扩展，价值收益高于保守约束
- **Quality rubric 混合模式**：规则可判维度走 deterministic checks，质性维度（brand-fit / specificity / viral-structure-preservation）走轻量 LLM（gpt-4o-mini）；SDK client **不在 rubric 模块顶层初始化**，由 route 注入
- **Context snapshot 不建聚合表**：扩三张现有产物表（`blog_posts` / `content_posts` / `reels_drafts`）各加 `generation_context_snapshot` + `quality_score`；不引入 `production_packages` 新概念（与 Phase 13 Production Package 是两个独立概念，不冲突）
- **Route B 纳入 scope**：独立任务 P12.Q.4b 处理视频改写场景的 viral-structure-preservation 维度
- **Phase 13 Pre.13 任务并入 P12.Q.1**：路线 A 同时完成 schema 扩 + Reels query 修复，Pre.13 不再单独执行

#### M0 前置（必须先完成，不在 P12.Q 编号内）

- [x] **P8.3.2** — Dashboard Magic Link 鉴权（独立 phase；完成后才能开工 P12.Q.0）✅ 2026-05-22 收尾：AI Tracker dashboard API 加 session + client scope 守卫

#### M1 地基（任务 0-1，~3 小时）

- [x] **P12.Q.0** — 产物表加 snapshot/score 列：**单 migration 内含 3 ALTER TABLE**，`blog_posts` / `content_posts` / `reels_drafts` 各加：
  - `generation_context_snapshot JSONB NULL`
  - `quality_score NUMERIC(4,2) NULL CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 10)`
  - 同步 `src/types/magic-engine.ts` 的 `BlogPost` / `ContentPost` 类型 + 组件内 `ReelsDraft` 局部类型
- [x] **P12.Q.1** — Campaign 上下文修复（路线 A，覆盖 Phase 13 不扩 schema 决策；含 Pre.13 工作）：
  - ① `campaign_briefs` migration 加 `offer / target_audience_detail / proof_points / primary_cta / channel_goal / campaign_angle`（均 nullable）
  - ② [`src/lib/content/campaign-injector.ts`](src/lib/content/campaign-injector.ts) 的 `CampaignBrief` type + `formatCampaignForPrompt` 同步注入新字段（对 null 友好）
  - ③ Reels 生成 route 的 query 改用现有真实字段 `title / description / parsed_content / semrush_keywords / valid_from / valid_until` + 新字段；移除查不存在的 `name / objective / target_audience / key_messages / campaign_period` 引用

> **M1 验证关卡**：`npm run build` 通过；Supabase 后台可见 (a) 三张产物表的 snapshot/score 列含 CHECK constraint；(b) `campaign_briefs` 6 个新字段；(c) Reels 路由 dev 跑通能拿到 campaign context（看 console log）

#### M2 质量闭环（任务 2-6，~9 小时）

- [x] **P12.Q.2** — 统一 quality rubric 模块 `src/lib/content/quality-rubric.ts`：
  - `coreDimensions` 六维：brand-fit / campaign-fit / platform-fit / specificity / CTA / dimension-goal
  - `routeDimensions` 插槽（Route B 在 P12.Q.4b 注入 `viral-structure-preservation`）
  - 混合实现：规则可判维度（platform-fit 长度 / CTA 存在 / dimension-goal keyword 命中）走规则；质性维度（brand-fit / specificity）走轻量 LLM
  - 签名形如 `evaluate(content, ctx, { coreDimensions, routeDimensions?, llmClient })`，SDK client 由 route 注入，**模块顶层不引用任何 SDK**
- [x] **P12.Q.3** — Blog 接 `auditBlogPost` + retry（最多 2 次）：
  - 调用形态（位置参数）：`auditBlogPost(result.html_body + '\n' + (result.geo_html_snapshot ?? ''), mode, metadata)`
  - 不过阈值返回最后一次 + log warn，不阻塞 UX
  - 写 `generation_context_snapshot` + `quality_score` 到 `blog_posts`
- [x] **P12.Q.4a** — Social Route A + C 接入 rubric（仅 coreDimensions）+ refine retry + 写 snapshot/score 到 `content_posts`
- [x] **P12.Q.4b** — Social Route B 接入 rubric + 注入 `viral-structure-preservation` routeDimension（保留爆款视频结构 vs 注入品牌深度，advisory 不强制阈值）+ 写 snapshot/score
- [x] **P12.Q.5** — Reels 接入 rubric + 写 snapshot/score 到 `reels_drafts`（schema 已在 P12.Q.1 修完，本任务只接入 rubric）
- [x] **P12.Q.6** — snapshot/score 写入验证 + 缺漏补齐：dev 实测五条链路（Blog / Route A / B / C / Reels），确认每条都写入 snapshot/score；若有遗漏补上

> **M2 验证关卡**：五条链路都能在生成日志看到 `quality_score`，数据库里 snapshot/score 都有值，至少一次 retry 触发

#### M3 端到端 demo（任务 7，~1.5 小时）

- [x] **P12.Q.7** — CTS Tours 端到端 demo + before/after 对比报告：跑一遍 Blog + Social A/B/C + Reels 全链路，记录修改前后 quality_score，写一份 demo markdown ✅ 2026-05-20

> **M3 验证关卡**：CTS Tours 的产物表里能查到带 `generation_context_snapshot` 和 `quality_score ≥ 7` 的记录；before/after 报告 markdown 写完

#### Phase 12.Q 风险跟踪

| 风险 | 等级 | 应对 |
|---|---|---|
| Campaign Brief migration 影响现有 `parsed_content` 数据 | HIGH | 全部 nullable + `ADD COLUMN IF NOT EXISTS` + injector 对 null 友好 |
| Quality rubric 阈值过严导致 retry 死循环或 token 爆炸 | HIGH | 硬编码 max 2 次 retry，即使不过仍返回最后一次 + log warn，不阻塞 UX |
| Reels schema 改了之后老记录读写错位 | HIGH | P12.Q.1 动 schema 前先 grep 所有 reels 相关读写点，确保字段名统一 |
| LLM 自评维度（brand-fit / specificity / viral-structure）评分不稳 | MEDIUM | 输出含 reason text + 评分；第一版统一阈值 7，PM 在 P12.Q.7 校准 |
| 改 prompt 后效果反而下降 | MEDIUM | P12.Q.7 必须做 before/after 对比，不通过则 revert 对应 task，不整体回退 |
| 多次 retry 增加生成时间 | LOW | UI 显示"质量优化中…"，前端 30s 超时；后端单次 LLM 调用 15s 超时 |

#### Phase 12.Q 工作量估算

| 任务 | 时间 |
|---|---|
| P12.Q.0 | 0.5 h |
| P12.Q.1 | 2.5 h |
| P12.Q.2 | 2.5 h |
| P12.Q.3 | 1.5 h |
| P12.Q.4a | 2 h |
| P12.Q.4b | 2 h |
| P12.Q.5 | 1 h |
| P12.Q.6 | 1 h |
| P12.Q.7 | 1.5 h |
| **Total** | **14.5 h / 约 4 个 session**（不含 P8.3.2） |

### Phase 12 风险跟踪

| 风险 | 等级 | 应对 |
|---|---|---|
| 归因窗口太短导致 verdict 都是 `too_early` | MEDIUM | 默认窗口 14 天；GEO 反馈快，CTS 试点用 7 天 |
| AI Tracker 重跑成本（每次 query 费 token）| MEDIUM | 沿用现有 budget cap（22 tools / $1.80）|
| 受控词表覆盖不全，FDE 想做的事没法落 action_type | HIGH | Phase 12.A 只支持 GEO 的 3-4 个 action_type；其他飞轮先用 `ExecutionLog` 自由文本兜底 |
| 6 客户存量数据回填出错 | LOW | 先在 staging 跑回填脚本，校验 100% 通过再上生产 |

---

## Phase 12.G — 诸葛亮 策略调度引擎 📋 已登记，未开工（2026-05-20 架构确认）

> **命名来源**：「运筹帷幄，决胜千里」。诸葛亮是四 Agent 链中的决策层，夹在数据（张骞）、诊断（华佗）与执行（鲁班）之间，负责「先做哪个、为什么、现在能不能执行」。

### 战略定位

```
张骞 Scout       → 收集数据与证据
华佗 Doctor      → 诊断评分 + 发现问题
诸葛亮 Conductor → 决定优先级 + 生成 work order  ← 本 Phase
鲁班 Builder     → 把 work order 执行出来
```

Magic Engine 护城河 = 这条链完整闭合。当前链条：张骞 ✅、华佗 ✅、鲁班 ✅，**诸葛亮是唯一缺口**——现在依赖 FDE 人脑做优先级判断，诸葛亮将其自动化。

### 核心接口规范（已确认，不重新讨论）

**输入（结构化包）：**
```ts
{
  client: ClientRecord,
  discoveryEvidence: ZhangqianPayload,    // 张骞最新快照
  diagnosticScores: DiagnosticScores,     // 华佗 6 维评分
  findings: DiagnosticFinding[],          // 华佗发现列表
  availableLubanTools: LubanTool[],       // 鲁班当前可执行工具
  businessContext: BusinessContext,       // 行业/目标/预算约束
}
```

**输出（结构化 work order）：**
```ts
{
  top_actions: PriorityAction[],
  // PriorityAction:
  // {
  //   rank: number,
  //   dimension: 'seo' | 'geo' | 'ads' | 'social' | 'reputation' | 'competitor',
  //   action_type: string,
  //   why_now: string,               // 人读得懂的理由
  //   evidence_refs: string[],       // 指向张骞/华佗具体数据点
  //   expected_impact: 'low' | 'medium' | 'high',
  //   effort: 'low' | 'medium' | 'high',
  //   execution_mode: 'in_house' | 'third_party' | 'external_manual',
  //   executable_by: string | null,  // e.g. 'luban.generate_content'
  // }
}
```

**数据写入目标**：`flywheel_actions` 表（Phase 12.A 已建好）

### 与现有系统的关系

| 关系方 | 交互 |
|--------|------|
| Phase 12 飞轮表 | 诸葛亮写入 `flywheel_actions`；与 `flywheel_metrics` / `flywheel_outcomes` 共用同一骨架 |
| 首页驾驶舱 | 消费诸葛亮输出的 `priority_actions` 做跨客户聚合展示 |
| 鲁班看板 | 展示单客户的 `flywheel_actions` 明细，FDE 在这里执行 |
| AI 抽屉 | 诸葛亮可作为抽屉后端：用户问「这周先做什么」→ 诸葛亮计算 → 抽屉展示 + 可直接触发鲁班 |
| Phase 13 Production Package | 诸葛亮决定做什么 → Phase 13 组织怎么生产，两者不冲突 |

### 前置条件

- **P8.3.2** Render `ADMIN_EMAILS` 配置完成（PM 操作）
- **Phase 12.Q** 内容质量闭环完成（诸葛亮需要高质量 `quality_score` 作为输入信号）

### 任务清单（待排期，估约 3 session）

- [x] **P12.G.1** 诸葛亮 prompt 工程 + 接口层（`src/lib/zhuge/conductor.ts`）
- [x] **P12.G.2** 接入华佗诊断输出 + 张骞证据包，输出 `priority_actions`
- [x] **P12.G.3** 写入 `flywheel_actions` + 幂等性保护
- [x] **P12.G.4** 首页驾驶舱消费诸葛亮数据（替换当前静态卡片）
- [x] **P12.G.5** AI 抽屉集成：「问诸葛亮」→ 实时计算优先级 + 一键触发鲁班

---

## Phase 12.H — GitHub CMS 执行闭环 ✅ 已完成（2026-05-25 代码核实）

> **背景**：GitHub CMS 连接器已接通（CTS Tours chinatravel 仓库），但"执行"按钮尚未连线——博客生成结果只存 Supabase DB，SEO 修复后端已建但没有 UI 入口。Phase 12.H 把这两个缺口补上，让 ME 真正从「给建议的工具」变成「替你改网站的引擎」。

### 核心目标

```
博客生成 → 推 GitHub PR → 客户 merge → 网站上线
SEO 诊断 → Fix 按钮 → 推 GitHub PR → 客户 merge → 元数据修复
```

### 任务清单

| ID | 任务 | 依赖 | 状态 |
|----|------|------|------|
| **P12.H.1** | `blog-publisher.ts` — 把 `blog_posts` 记录序列化为仓库文件格式，调 `github-client.commitFile` + `createPullRequest`，回写 `flywheel_actions` | GitHub CMS 连接器 ✅ | ✅ |
| **P12.H.2** | Blog Studio UI — 博客详情页加「推送到网站」按钮，调 `/api/clients/[id]/cms/publish-blog`，显示 PR 链接 | P12.H.1 | ✅ |
| **P12.H.3** | SEO Fix UI — 执行看板 SEO 类 action 加「Fix」按钮，调现有 `/api/clients/[id]/seo-fix`，显示 PR 链接 | 后端已有 ✅ | ✅ |

### 验收关卡

1. FDE 在 Blog Studio 点「推送到网站」→ CTS chinatravel 仓库出现新 PR，包含文章内容
2. FDE 在执行看板点 SEO action 的「Fix」→ 仓库出现元数据修改 PR
3. `flywheel_actions` 有对应记录（含 PR URL）

---

## Phase 12.I — SEO Intelligence 页面 + 飞轮闭环接线 ✅ 代码完成（2026-05-21）

> **背景**：DataForSEO 数据（200 排名关键词、流量历史、竞品对比、关键词缺口、Intent、KD）已全面接入，但用户只能看到一个 0–100 分数 —— 排名表、流量趋势、竞品界面、关键词缺口全部不可见；SEO Gap 页还要手动上传 SEMrush CSV。Phase 12.I 建一个 SEO Intelligence 页面把数据直接呈现，并把「Untapped 词一键生成博客」接回飞轮（`flywheel_actions` / `flywheel_outcomes`）与执行看板，让 SEO 内容执行不再是孤岛。

### 核心目标

```
了解自己：排名关键词表 + Intent 分布 + 流量趋势（Cron 快照积累）
了解对手：竞品并排对比 + 关键词缺口自动拉取 + Venn 图
内容执行：Untapped 词 → 一键生成博客 → 写 flywheel_actions → 执行看板「自主行动」泳道 → 归因回流
```

> **截止约束**：Oztop SEMrush 订阅 2026-06-19 到期，M1（页面快照展示版）必须在此之前上线。

### 任务清单（每个任务 = 1 commit）

| ID | 任务 | 依赖 | 状态 |
|----|------|------|------|
| **P12.I.1** | `/dashboard/clients/[id]/seo-intelligence` 页面路由 + 顶部指标栏（读 `flywheel_metrics` WHERE flywheel='seo'） | flywheel_metrics ✅ | ✅ |
| **P12.I.2** | Panel A「了解自己」— Organic Rankings 关键词表 + Intent 分布图 | P12.I.1 | ✅ |
| **P12.I.3** | Panel B「了解对手」— 竞品并排对比 + 关键词缺口自动 DataForSEO 拉取 + Venn 图 | P12.I.1 | ✅ |
| **P12.I.4** | SEO Gap 页改用 DataForSEO `getKeywordsGap()` 自动拉取，移除 SEMrush CSV 上传 | DataForSEO ✅ | ✅ |
| **P12.I.5** | 接线缺口 1+2 — 博客生成 route `persistAndReturn()` 写 `flywheel_actions(flywheel='seo')` + 持久化 `primary_keyword/volume/kd/intent` | — | ✅ |
| **P12.I.6** | 接线缺口 4 — 执行看板新增「自主行动」泳道，支持无处方来源的 `execution_item` 渲染 + OutcomeChip | P12.I.5 | ✅ |
| **P12.I.7** | 接线缺口 3 — Untapped 词 / `/strategy` `new_blog` 卡片加「生成博客」按钮，一键接入 POST /blog | P12.I.3, P12.I.5 | ✅ |
| **P12.I.8** | `keyword_snapshots` 表 migration + weekly Cron（每周存关键词排名快照，为趋势图积累数据） | — | ✅ |
| **P12.I.9** | Position Changes 计算（New / Lost / Improved / Declined），Panel A 展示 | P12.I.8 | ✅ |
| **P12.I.10** | Intent 优先内容策略（Transactional 置顶）+ Branded vs Non-Branded 流量分拆 | P12.I.2 | ✅ |

### 里程碑关卡

- **M1 页面快照展示版** ✅（P12.I.1–4）：SEO Intelligence 页面上线，Panel A + B 展示真实 DataForSEO 数据，SEO Gap 改自动拉取
- **M2 内容执行闭环** ✅（P12.I.5–7）：Untapped 词一键生成博客 → 写 `flywheel_actions` → 执行看板「自主行动」泳道能看到该任务卡片
- **M3 趋势与追踪** ⚠️ 待 PM 验证（P12.I.8–10 代码已完成）：Cron 周快照跑起来，Position Changes 有数据，Intent 优先策略生效

### 工作分支

- 实施分支：`main`（历史 worktree `claude/reverent-brown-3345c7` 已合并，`d4e9a88` + `27d9caf`）

---

## Phase 12.J — 博客头图配图生成 ✅ 已完成

> **背景**：博客生成流程已产出 `featured_image_prompt`（已注入 MB 视觉 DNA + Campaign 上下文），但从未实际生成图片。本 Phase 补齐「FDE 一键生成头图」能力，与工作台协作体验对齐。
>
> **登记日期**：2026-05-22

| 任务 ID | 内容 | 依赖 | 状态 |
|---------|------|------|------|
| **P12.J.1** | 新增 `POST /api/clients/[id]/blog/[postId]/image` 路由（gpt-image-1 生成 + Supabase storage 上传）+ 工作台「🖼 头图配图」面板（展示 / 生成 / 编辑提示词）+ Campaign 视觉线索注入 `generateVisualBrief()` | — | ✅ |
| **P12.J.2** | `buildBlogHtml` 正文前加 hero `<figure>` — 让配图真正进推送 HTML | P12.J.1 | ✅ |

---

## Phase 12.K — Campaign 视觉方向（两层视觉继承体系） ✅ 已完成

> **背景**：Campaign Brief 缺少活动专属视觉方向——当前只有 MB 级别 `vi_*` 品牌宪法，但每次活动的色调、氛围、创意约束无处记录，导致博客头图 / Reels / 社媒配图风格飘移。Phase 12.K 在 `campaign_briefs` 表加 5 个 nullable 视觉字段，并接入 AI 一键生成活动视觉方向。
>
> **登记日期**：2026-05-23

| 任务 ID | 内容 | 依赖 | 状态 |
|---------|------|------|------|
| **P12.K.1** | `campaign_briefs` 加 `vi_mood / vi_color_accent / vi_specific_dos / vi_specific_donts / vi_reference_note`（5 nullable）；POST `/api/clients/[id]/campaign/[campaignId]/generate-visual`（读 MB `vi_*` 为品牌宪法 → Claude Sonnet 生成活动专化视觉方向，仅预览不落库）；CampaignPanel 新增 `VisualDirectionSection`（AI 生成 + 5 字段编辑 + Save/PATCH）；migration `20260523000003`；commit `3f4e09e` | P12.J.1 | ✅ |

---

## Phase 13 — Production Package（生产订单聚合层）📋 已登记，未开工

> **背景**：当前 `content_posts / blog_posts / reels_drafts / visual_assets` 各自为政，`execution_items.content_post_id` 是 1:1 链路，无法表达"一个执行项 → 一组产物"的批次语义。Production Package 是六维诊断后的**统一生产订单聚合层**，把分散产物按维度 + 上下文聚合成可审核、可追溯、可归因的批次。
>
> **完整 RFC**：[docs/production-package-rfc.md](docs/production-package-rfc.md)
>
> **登记日期**：2026-05-19
> **当前状态**：草案收敛完成，**未排期开工**。等 P8.3.2 / Phase 12.B 收尾后再决定何时启动。

### Phase 13 核心心智

```
Master Brief    = 品牌 DNA
Diagnostic      = 发现问题（六维）
Prescription    = 决定做什么
Execution Item  = 单个动作
Production Package = 把一组动作的产物打包成"生产订单"
Production Item    = 订单里的具体产物
```

### Phase 13 已确认的关键决策（不重新讨论）

- `dimension` 复用 `diagnostic_dimension` enum（6 元组）
- `context_mode` **不存**，由 `dimension` 派生（`seo/social/ads` → campaign_bound；其余 → dna_bound）
- `production_items` 用多 FK，**不**用多态 `target_type/target_id`
- 现有内容表只加 `production_item_id`，**不**加 `production_package_id`
- `campaign_id` 应用层校验（approved 前补齐），**不**做 DB 硬约束
- `production_item_assets` 关联表 MVP **不做**
- ~~`campaign_briefs` schema **不扩**；Reels drift 改 Reels 代码适配现有 schema~~ **（2026-05-19 被 Phase 12.Q 覆盖：路线 A 扩 6 个 nullable 字段 + Reels query 改读真实字段，含原 Pre.13 工作）**
- `package_type` 字段 MVP **不做**（先验证 ai_visibility/competitor/reputation 形态是否真的不同）

### Phase 13.A — Social-only MVP（6 commit）

每个任务 = 1 commit。完成顺序按依赖：

- [x] **Pre.13** — `fix(reels)`：修 Reels 代码读 `title/description/parsed_content/semrush_keywords`，对齐现有 `campaign_briefs` schema（不扩 schema）（注：schema 扩展部分已并入 P12.Q.1 路线 A）
- [x] **P13.A.1** — 新增 `production_packages` migration（含 RLS、index、`diagnostic_dimension` enum 复用、`generation_context_snapshot` jsonb）
- [x] **P13.A.2** — 新增 `production_items` migration（多 FK 到 4 张内容表、RLS、index）
- [x] **P13.A.3** — `ALTER content_posts / blog_posts / reels_drafts / visual_assets` 各加 `production_item_id` 单列 FK + index
- [x] **P13.A.4** — Social 生成链路（Route A/C）接收 `production_package_id`，生成时创建对应 `production_items` 行
- [x] **P13.A.5** — `/dashboard/clients/[id]/production/[packageId]` 只读详情页（展示 dimension / campaign / execution_item / items 列表 / context snapshot）

> **Phase 13.A 验收关卡**：
> 1. 一条 Social post 能归属到 production item，item 能归属到 package
> 2. Package Detail Page 能展示完整上下文 + 关联 items 列表
> 3. 旧 Social post 没 `production_item_id` 也能正常显示（不破坏 ContentHub）

### Phase 13.B — SEO + AI Visibility 接入（2 commit）

每个任务 = 1 commit。

- [x] **P13.B.1** — Blog 生成路由接入 `production_package_id`：`GenerateBlogRequest` 新增字段；`persistAndReturn` 落库后自动创建 `production_items` 行（content_type='blog_post'）并回写 `blog_posts.production_item_id`；覆盖 SEO（seo_only/unified）+ AI Visibility（geo_only/unified）两个 dimension
- [x] **P13.B.2** — 客户级生产包列表页：`GET /api/clients/[id]/production`（支持 dimension/status 过滤，2 次查询批量计算 item_count）；`/dashboard/clients/[id]/production` 列表页（维度 tab 过滤、全部模式按 dimension 分组展示，点击跳转详情页）

### Phase 13.C — Reels + Visual 接入（3 commit，已完成）

- [x] **P13.C** — Reels + Visual 生成路由接入 `production_package_id`：`reels/generate` POST body 新增字段，插入 reels_drafts 后异步创建 `production_items`(content_type='reel') + 回写 `reels_drafts.production_item_id`；`visual/image` + `visual/video` 同理，content_type='visual_asset'；三条链路错误均非阻断，build ✅

### Phase 13.D — Ads + Reputation 接入（已完成）

- [x] **P13.D** — `meta_ads_snapshots` + `project_reviews` 各加 `production_package_id` nullable FK + partial index（migration）；`meta-ads/sync` 路由接受可选 `production_package_id` 并异步写回；`/clients/[id]/review` POST 接受可选 `production_package_id` 并透传 `runProjectReview`；生产包详情 GET 回读 `ads_snapshots` + `reputation_reviews` 数组；Competitor 延后至 P13.E；build ✅

> **Competitor 接入** 延后登记为 **P13.E-pre**（competitor snapshot persistence）：`semrush/competitor-keywords` 当前无状态 GET，需先建 `competitor_snapshots` 表再接入，本期不做。

### Phase 13.E（已完成）

| Phase | 内容 | 状态 |
|---|---|---|
| 13.E-pre | Competitor snapshot persistence + 接入 production package | ✅ 完成 |
| 13.E | Flywheel feedback 闭环（package → flywheel_actions → outcomes） | ✅ 完成 |

**P13.E-pre 完成内容**：新增 `competitor_snapshots` 表（migration）；`semrush/competitor-keywords` POST 接受可选 `production_package_id`，落库 snapshot；production package 详情 GET 回读 `competitor_snapshots` 数组；build ✅

**P13.E 完成内容**：`flywheel_actions` 加 `production_package_id` FK（migration）；`ExecuteActionInput`/`FlywheelActionRow` 类型加字段；4 个 adapter execute() 传 `production_package_id`；`flywheel/execute` route 转发字段；新增 `src/lib/flywheel/package-publish.ts`（dimension → flywheel + action_type 映射，on-publish 非阻断落 flywheel_action）；`PATCH /api/clients/[id]/production/[packageId]` 状态更新 + publish 触发 hook；build ✅

### Phase 13 不做清单（明确划界，避免 scope creep）

- ❌ 改写任何现有内容生成器
- ❌ 统一 generation queue
- ❌ 内容质量自动 review / retry 闭环（**已登记为独立 Phase 12.Q，2026-05-19**）
- ❌ Master Brief 自动更新
- ~~❌ Campaign Brief schema 扩展~~ **（2026-05-19 被 Phase 12.Q 覆盖，加 6 个 nullable 字段）**
- ❌ `package_type` 字段、`production_item_assets` 关联表、DB 层 campaign_id 硬约束、聚合状态字段

---

## Phase 14 — Website Connector（网站直连执行闭环）📋 战略确认，待排期

> **登记日期**：2026-05-19 · **状态**：战略方向已确认，尚未排期开工
>
> **背景**：Magic Engine 现有能力止步于"内容生产 + 存库"；VIP 客户（$2.5k–$3k/月 FDE 嵌入服务）需要 FDE 能在 ME 界面内一键把内容推送到客户网站，无需手动复制粘贴。Website Connector 是 ME 从"内容生产工具"升级为"执行引擎"的关键拼图，同时补全飞轮闭环：诊断 → 生成 → **发布** → 指标回流 → outcome 归因。
>
> **架构原则**：通过各平台官方 API 推送，ME 服务器不接触客户源代码；发布必须 draft-first，FDE 确认预览后再 publish；每次执行有完整快照 + payload hash，支持审计和回滚。

### Phase 14 CMS 连接器框架（平台无关，2026-05-26 确立）⭐

> **战略背景**：2026-05-26 首次为 Oztop 手动发布 WP 博客，完整踩过 15 步操作流程，系统性发现 7 个平台集成问题。WordPress 作为第一参考实现，Shopify / Webflow / 其他平台复用同一五层架构。

**五层通用架构：**

```
Layer 1  连接鉴权      WordPress=App Password · Shopify=OAuth · Webflow=OAuth
Layer 2  内容清洗      平台感知：Strip H1 / Strip Schema JSON-LD / Fix GEO City / 字段映射
Layer 3  SEO 配置     WordPress=Yoast REST API · Shopify=原生字段 · Webflow=原生字段
Layer 4  发布流程      统一 Draft→Preview→Publish 三步；幂等 + 快照 + rollback
Layer 5  发布后动作    Google Search Console 收录（平台无关）+ Flywheel Action 回写
```

**WordPress 参考实现 — 7 个已验证问题清单：**

| # | 问题 | 根因 | 通用解法 |
|---|---|---|---|
| 1 | IP 被 SiteGround 封锁 | Render 共享 IP 触发 nginx ipr 规则 | 静态出口 IP 或 ME WP Connector Plugin |
| 2 | H1 标签重复 | WP 标题已是 H1，ME body 含第二个 | Layer 2 内容清洗：strip `<h1>` |
| 3 | Schema JSON-LD 被 `<br>` 污染 | WP wpautop filter 注入换行 | Layer 2 清洗：删除整个 `<script type="application/ld+json">` |
| 4 | GEO 城市硬编码 "Sydney" | geo-directive-generator.ts bug | 动态注入 `client.location` |
| 5 | 文章无内链 | ME 不知道客户网站 URL 结构 | Phase 14.G Site Knowledge Graph |
| 6 | SEO 配置（Yoast）需手动 | 无 API 集成 | Layer 3：Yoast REST API 自动配置 |
| 7 | GSC 收录需手动提交 | 无 OAuth 集成 | Layer 5：GSC API + OAuth |

**Shopify 对应实现（已有 Phase 14.A.4 基础）：**
- Layer 1 ✅（已完成）
- Layer 2：HTML → Shopify Article body_html 字段映射
- Layer 3：Shopify Admin API SEO title/description 原生字段
- Layer 5：同一 GSC API + Flywheel 回写

**开发优先级：**
1. 🔴 修 4 个 Bug（GEO城市 + H1 + Schema + Layer2清洗），1–2天
2. 🟡 Phase 14.G Site Knowledge Graph，3–5天
3. 🟢 Layer 3 Yoast API + Layer 5 GSC API，1–2周
4. 🔵 Render 静态 IP（解除 SiteGround 封锁），基础设施

### Phase 14 商业场景

```
Free 层（自助）
  诊断报告 / 竞品分析 → 内容止步于 ME 数据库

VIP 层（FDE 嵌入，$2.5k–$3k/月起）
  ME 生成内容 → FDE 点"发布到网站" → 内容直接上线
  覆盖：Shopify / WordPress / Webflow / GitHub 托管的 Next.js
```

### Phase 14 新增数据表

```
client_website_connections
├── id (UUID PK)
├── client_id (FK → clients)
├── platform: 'shopify' | 'wordpress' | 'webflow' | 'github'
├── credentials_encrypted (TEXT)   ← KMS/应用层加密，DB 只存密文
├── scope (TEXT[])                 ← 已授权 scope 列表
├── status: 'active' | 'needs_reconnect' | 'revoked'
├── site_url (TEXT)                ← HTTPS + 公网域名校验（防 SSRF）
└── connected_at, last_verified_at

website_publish_jobs
├── id (UUID PK)
├── client_id (FK → clients)
├── connection_id (FK → client_website_connections)
├── source_type: 'blog_post' | 'campaign_lp'
├── source_id (UUID)               ← 对应 blog_posts.id 或 campaign_lp.id
├── platform_post_id (TEXT)        ← 外部平台返回的 page/article id
├── target_url (TEXT)
├── content_snapshot (JSONB)       ← 推送时的内容快照
├── payload_hash (TEXT)            ← SHA-256，用于完整性校验
├── status: 'draft' | 'published' | 'failed' | 'rolled_back'
├── idempotency_key (TEXT)         ← 防止重复推送
├── retry_count (INT)
├── error_message (TEXT)
└── published_at, created_at
```

### Phase 14.A — 第一版 8 个任务（Shopify + WordPress）

| ID | 任务 | 依赖 |
|----|------|------|
| ✅ **P14.A.1** | ~~新增 `client_website_connections` 表~~ → **扩展现有 `cms_connections` 表加 WP 形态字段**（复用已有 AES-256-GCM crypto） | — |
| ✅ **P14.A.2** | 新增 `website_publish_jobs` 表（FK → `cms_connections`）+ `(connection_id, idempotency_key)` 幂等约束 + 状态机 `draft → published\|failed; published → rolled_back` + `src/lib/website-publish/vocabulary.ts`（含 `canTransition` / `payloadHash` / `buildIdempotencyKey`，9 单测全绿） | P14.A.1 |
| ✅ **P14.A.3** | 连接管理 UI — 客户设置抽屉「🔗 网站连接」标签升级为多供应商 Tab（GitHub 保留 / WordPress 全功能上线 / Shopify「即将推出」占位）；新增 `src/lib/cms/url-guard.ts`（HTTPS + 公网域名 + 私网 IP / IPv6 / IP 字面量 / 单标签主机一律拒绝，39 单测全绿）；`connection-store.ts` 扩展 `upsertWordpressConnection` / `getWordpressConnectionStatus` / `getWordpressConnection`（含明文 AppPassword 解密，server-only）/ `deleteWordpressConnection`；新增 `/api/clients/[id]/cms/wordpress` GET/POST/DELETE（INTERNAL_API_KEY 鉴权、save 时再校验 site_url、用户输入错误透传到 UI、DB 错误打日志吞掉）；Application Password 走现有 AES-256-GCM crypto 加密入库，UI 仅显示末四位。**测试 / 推送功能留 P14.A.5**，已在 WP 已连接面板加 amber 提示「将在 P14.A.5 启用」 | P14.A.1 |
| ✅ **P14.A.4** | Shopify connector（`write_content` scope，draft-first，blog article + page）— `shopify-guard`（SSRF 防护 17 单测）+ `shopify-client`（Admin REST 2024-01）+ `html-sanitizer`（MVP strip）+ vocab/store 扩展 + `/cms/shopify` CRUD + `/cms/publish-shopify`（两步 draft→publish，幂等写 website_publish_jobs） | P14.A.2 |
| ✅ **P14.A.5** | WordPress connector（专用用户 + Application Password，最小权限 role）— `wordpress-client`（DNS SSRF guard + testWordpressConnection + draft-first post/page + publish）+ `markWordpressConnectionTested`（connection-store）+ `/cms/wordpress` 升级（POST 加凭据测试 + 状态回写）+ `/cms/publish-wordpress`（两步 draft→publish，幂等，租户隔离） | P14.A.2 |
| ✅ **P14.A.6** | Blog Studio 新增"发布到网站"按钮（Draft → Preview → Publish 三步流程）— 新增 `PublishToWebsitePanel` 组件 + `/cms/providers` 聚合状态路由；自动检测已连接平台，WordPress/Shopify 三步流程，GitHub 单步 PR | P14.A.4/5 |
| ✅ **P14.A.7** | HTML sanitize 升级为 allowlist 模式（两遍扫描：Pass1 危险元素块删除 + Pass2 标签/属性白名单重写）；payload hash 已在 P14.A.4/5 实现；audit snapshot 写入 `website_publish_jobs.content_snapshot` | P14.A.4/5 |
| ✅ **P14.A.8** | 发布成功回写 `flywheel_actions`（flywheel=seo, action_type=cms_content_insert, execution_mode=in_house）— WordPress + Shopify 两个 publish 路由均已加；GitHub 路由早于 P14.A 已有 | P14.A.6 |

### Phase 14.A 验收关卡

1. FDE 能在 ME 界面完成从"生成博客"到"网站上线"全流程，不需要离开 ME
2. Shopify 和 WordPress 均先创建 draft，FDE 确认预览后再 publish
3. 每次发布在 `website_publish_jobs` 有完整记录（快照 + hash + 状态）
4. 发布成功后 `flywheel_actions` 有对应记录

### Phase 14.B — WP 发布质量改进（E2E 测试发现，7 项）✅ 已完成 PR #120

> **登记日期**：2026-05-29 · **完成**：2026-05-30 · **触发**：完整 Kanban→Generate→WP Publish E2E 测试后系统性总结，影响所有 WP 客户。
>
> **范围说明**：Yoast mu-plugin 问题影响**所有 WP 网站客户**（非 Oztop 特有），每个 WP 域名安装一次即可。

| 任务 | 内容 | 优先级 |
|------|------|--------|
| ✅ **P14.B.1** | Yoast SEO 字段探测：CmsPanel Yoast 卡 + PHP snippet 复制 + 验证安装 probe 按钮；`yoast_plugin_installed` flag 持久化 | 🔴 高 |
| ✅ **P14.B.2** | 取消发布自动清理 WP 草稿：`action:'rollback'` + `deleteWordpressPost/Page` + `rolled_back` 状态 | 🔴 高 |
| ✅ **P14.B.3** | GEO 城市一致性：`getActiveGeoHtml` 返回 `authoritativeLocation`，blog generator 注入 CLIENT LOCATION 覆盖指令；DirectiveEditor 城市冲突警告 | 🔴 高 |
| ✅ **P14.B.4** | 内链 QC 第8项：`internal-link-checker.ts` + `blog_posts.quality_check` JSONB 持久化 | 🟡 中 |
| ✅ **P14.B.5** | `primary_keyword` 缺失橙色警告芯片（PublishToWebsitePanel） | 🟡 中 |
| ✅ **P14.B.6** | WP 默认分类 ID：`wp_default_category_id` 字段 + PATCH `/cms/wordpress/category` + CmsPanel 编辑 | 🟡 中 |
| ✅ **P14.B.7** | 发布后 GSC 索引请求按钮：Indexing API client + `/gsc/index-request` route + re-auth 降级 | 🟢 低 |

### Phase 14.B 验收关卡

- **M1（核心）**：Yoast mu-plugin 安装后，重新发布博客 → WP admin Search appearance 面板中 SEO title + Meta description + Focus keyphrase 均自动填充
- **M2（质量）**：内链 QC 第8项在有/无内链的博客上分别显示正确状态
- **M3（运营）**：取消发布后 WP 后台无孤儿草稿

### Phase 14.C — SEO 生产期稳定性 + 飞轮闭环 🔥 进行中（2026-05-29 启动）

> **登记日期**：2026-05-29 · **触发**：CTS Tours + Oztop 进入 5 篇/周生产期前，4 视角并行审计发现的硬伤与飞轮断点。
>
> **核心目标**：让博客生成、看板管理、WP/GitHub 发布、飞轮反哺这条主链路在「5 篇/周 × 2 客户」的负载下不掉链子。

| 任务 | 内容 | 优先级 | 估时 |
|------|------|--------|------|
| ✅ **P14.C.1** | 殭尸 `status='generating'` 自愈 cron（>10min 自动标 failed） | 🔴 高 | 30m |
| ✅ **P14.C.2** | 看板「忽略」按钮持久化（PATCH `status='dismissed'`） | 🔴 高 | 30m |
| ✅ **P14.C.3** | 「重新生成策略」去重（`(client_id, proposed_title)` unique index + ON CONFLICT） | 🔴 高 | 45m |
| ✅ **P14.C.4** | JSON-LD Schema 注入 WP/Shopify/GitHub 发布管道（用 `buildBlogHtml()` 替代 `html_body`） | 🔴 高 | 45m |
| ✅ **P14.C.5** | 飞轮 outcome 按 `content_mode` 聚合 → 反哺选题（scorer 注入 modeBoosts） | 🟡 中 | 90m |
| ✅ **P14.C.6** | GitHub PR merge webhook 回填 `published_at` + 自动触发 GSC 索引 | 🟡 中 | 90m |

**验收关卡（M1 = P0 完成，M2 = P1 完成）：**
- **M1**：连续生成 3 篇博客无殭尸状态；看板刷新后忽略仍生效；WP 发布的页面有 BlogPosting JSON-LD（用 Schema 测试工具验证）
- **M2**：飞轮 outcome 出现 keyword 维度的聚合；CTS GitHub PR merge 后 `published_at` 自动回填，GSC 自动收到索引请求

---

### Phase 14.D — SEMrush 残留清理 + DataForSEO 全面接入 📋 已登记，14.C 完成后启动

> **登记日期**：2026-05-29 · **触发**：14.C 审计发现 SEMrush 仅在 `/dashboard/keywords` 手动查词页面活跃，`keywords` 表疑似无写入路径，大量变量名/注释/路由残留 SEMrush 字样但底层已切到 DataForSEO。
>
> **目标**：删除所有 SEMrush 代码路径，全部走 DataForSEO Labs API，统一变量命名与文档。

| 任务 | 内容 | 优先级 |
|------|------|--------|
| ⬜ **P14.D.1** | `/dashboard/keywords` 手动查词页面切到 DataForSEO（`/api/semrush/*` 路由全部重写或 redirect 到 `/api/dataforseo/*`） | 🔴 |
| ⬜ **P14.D.2** | 验证或删除 `keywords` 表（如果真死表 → drop；如果有用 → 加 DataForSEO 写入路径） | 🟡 |
| ⬜ **P14.D.3** | 变量重命名：`includeSemrush` → `includeKeywordData`；注释清理 | 🟢 |
| ⬜ **P14.D.4** | `src/app/api/semrush/*` 路由删除（确认无外部调用后） | 🟢 |
| ⬜ **P14.D.5** | 环境变量保留 `SEMRUSH_*`（按 CLAUDE.md 规则，env var 用真实命名）但代码不再读取 | 🟢 |

---

### Phase 14 及后续（预告，未排期）

| Phase | 内容 | 触发条件 |
|---|---|---|
| 14.G | **客户网站知识图谱（Site Knowledge Graph）** | 14.A 完成（详见下方） |
| 14.H | Webflow CMS connector | 14.C 完成 |
| 14.I | Campaign LP 生成器（高转化落地页，noindex + 活动结束 301） | 14.H 完成 |
| 14.J | 权限漂移检测（定期校验 token scope，失效自动标 `needs_reconnect`） | 14.A 完成 |

> **注**：原 14.D（GitHub connector）已由 Phase 12.H 完成，本表已移除。

### Phase 14.G — 客户网站知识图谱（Site Knowledge Graph）📋 待排期

> **登记日期**：2026-05-26 · **触发**：Oztop 手动发布 Pet Flooring 文章时发现：博客内没有内链，因为 ME 不知道客户的产品页 URL。
>
> **核心问题**：ME 生成的博客文章提到 SPC Flooring / Vinyl / Tiles，但不知道 Oztop 具体的产品分类页 URL，导致文章没有内链，SEO 权重无法从博客传递到产品页，飞轮闭环断裂。

**功能逻辑：**
```
客户连接网站（Phase 14.A）
  → ME 自动爬取 sitemap_index.xml
  → 解析三类 sitemap：product_cat / post / page
  → 存入 client_site_pages 表
  → 博客生成时 lookup 相关页面（按主题 + taxonomy 匹配）
  → LLM prompt 注入："在以下位置添加内链：[{text, url} ...]"
  → 文章自动含 3–5 个有意义的内链
```

**新增数据表：**
```sql
CREATE TABLE client_site_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid REFERENCES clients(id) ON DELETE CASCADE,
  url         text NOT NULL,
  title       text,
  page_type   text,   -- 'product_category' | 'product' | 'blog_post' | 'page'
  taxonomy    text,   -- 'flooring' | 'carpet' | 'tiles' | 'tapware' | etc.
  slug_keywords text[], -- 从 URL slug 提取的关键词，用于匹配
  crawled_at  timestamptz DEFAULT now(),
  is_active   boolean DEFAULT true,
  UNIQUE (client_id, url)
);
```

**触发时机：**
- 客户首次连接 CMS（WordPress / Shopify）时自动爬取
- 手动"刷新网站地图"按钮（CMS 设置页）
- 定时每月重爬（新品上架时更新）

**博客生成集成点：**
- `src/lib/blog/generator.ts` — 生成前 `getRelevantClientPages(clientId, blogTopic)` → 注入 prompt
- 匹配逻辑：blog 主题关键词 vs `slug_keywords` 数组交集

**Oztop 验证数据（2026-05-26 首次爬取）：**
- 产品分类：38 个（flooring / carpet / tiles / tapware / supplies）
- 页面：7 个
- 已发布博客：23 篇
- 适用内链示例（Pet Friendly Flooring 文章）：
  - SPC flooring → `/product-category/flooring/spc-wpc-hybrid-flooring/`
  - Vinyl planks → `/product-category/flooring/vinyl-flooring/`
  - Ceramic / porcelain tiles → `/product-category/tiles/`
  - Engineered timber → `/product-category/flooring/engineered-timber-flooring/`
  - 推荐阅读 → `/spc-hybrid-vs-vinyl-vs-laminate-vs-engineered-timber-a-quick-comparison/`

### Phase 14 安全边界（不可降级）

- 凭证 KMS 加密，DB 只存密文，日志禁止输出 token 明文
- 所有 publish API 强制校验 `client_id` + connection ownership（防租户穿越）
- WordPress 站点 URL 只允许 HTTPS + 公网域名（防 SSRF / 内网 IP）
- AI 生成内容发布前必须 sanitize HTML（防 script/iframe 注入）
- WordPress 专用用户只给内容 capability，禁止 `activate_plugins` / `edit_themes`

### Phase 14 不做清单

- ❌ 客户端直接连接（ME 服务器中转，客户凭证不落前端）
- ❌ 主题 / 插件 / 模板修改（超出内容范围，需人工介入）
- ❌ 全自动无审核发布（Draft-first 是强制约束，不做 bypass 开关）
- ❌ 非 HTTPS 站点接入

---

## Phase 15 — Reputation Engine（口碑监控与执行闭环）📋 战略确认，待排期

> **登记日期**：2026-05-19 · **状态**：战略方向已确认，待深入讨论后排期
>
> **背景**：口碑不只是 Reputation 维度的问题——一条 TripAdvisor 好评同时影响 SEO（Google 显示星级）、GEO（AI 引用真实评价）、Reputation（客户信任）三个维度。ME 目前完全没有监控和响应评论的能力，FDE 只能手动巡查各平台。
>
> **核心原则**：Scan（监控）→ Analyze（情感分析）→ Recommend（AI 起草回复）→ **ACT（一键发布回复 + 触发修复内容）**

### Phase 15 核心能力

```
Platform Authority Intelligence（行业权威平台图谱）
  → 根据客户行业 + AU/NZ 地区，映射哪些平台 AI 最信任
  → 餐饮：Google Maps / Zomato
  → 旅游：TripAdvisor / Tourism NZ
  → 建筑：ProductReview.com.au (AU) / Houzz
  → 所有行业：Reddit（r/australia, r/newzealand 等）

Review Monitor（评论持续监控）
  → 每日拉取 GBP / TripAdvisor / Trustpilot 新评论
  → 情感分类：正面 / 中性 / 负面
  → 负面评论即时预警 FDE

Response Engine（AI 回复生成）
  → AI 基于品牌底稿起草回复草稿
  → FDE 审核修改 → 一键发布到对应平台

Reputation Score（跨平台权威综合评分）
  → 各平台评分 × 行业权重 = 综合分
  → 直接预测 AI 被问到相关问题时推荐客户的概率

Counter-Content Trigger（修复内容触发）
  → 检测到高频投诉类型 → 触发 Blog Studio 生成信任建立内容
  → 通过 Phase 14 Website Connector 发布到客户网站
```

### 数据源

| 平台 | API 可用性 | 覆盖市场 |
|------|-----------|---------|
| Google Business Profile | ✅ 免费官方 API | AU + NZ |
| TripAdvisor | ⚠️ 内容 API 部分受限 | AU + NZ |
| Trustpilot | ✅ 公开 API | AU + NZ |
| ProductReview.com.au | ❌ 需爬虫 | AU |
| Reddit | ✅ 官方 API | AU + NZ |
| Zomato / Google Maps | ✅ | AU + NZ |

### 不做清单

- ❌ 自动发布回复（必须 FDE 审核，不做 bypass）
- ❌ 伪造评论或刷好评（违反平台 ToS）
- ❌ Reddit 自动发帖（保持真实性，只做监控 + 预警）

---

## Phase 16 — Competitor Intelligence（竞品雷达 + 信号驱动执行）📋 战略确认，待排期

> **登记日期**：2026-05-19 · **状态**：战略方向已确认，待深入讨论后排期
>
> **背景**：ME 目前有竞品 SEO 数据（SEMrush），但停在"数据展示"层，没有"信号 → 自动触发执行"的逻辑。Competitor Intelligence 的真正角色是 ME 的**雷达系统**——不只是告诉 FDE 竞品在做什么，而是直接触发其他模块采取行动。
>
> **核心原则**：竞品情报不是独立仪表盘，是驱动 SEO / GEO / Social / Ads / Reputation 五个执行模块的触发层。

### 可获取的竞品数据

```
SEO 层（已有 ✅）
  → 竞品关键词排名 / 域名权威 / 外链 / 新内容发布

社媒层
  → 粉丝增长趋势 / 发帖频率 / 互动率 / 内容主题

广告层 ⭐（免费，大多数公司没用起来）
  → Meta Ad Library API：所有正在投放的广告创意 + 投放时长
  → Google Ads 透明度中心：搜索广告文案
  → 投放时长越长 = 这个广告越有效（倒推高转化创意方向）

AI 可见度层（ME 独有 ✅）
  → AI Tracker 同时追踪客户 + 竞品
  → 哪些问题 AI 推荐竞品不推荐我

口碑层
  → 竞品 GBP 评分趋势 / TripAdvisor 排名变化 / Reddit 情感
```

### 信号 → 行动触发逻辑

| 竞品信号 | 自动触发 |
|---------|---------|
| 竞品排上新关键词 | 建议 Blog Studio 生成对应内容 |
| AI 推荐竞品但不推荐客户 | 触发 GEO Composer 优化指令 |
| 竞品 Meta 广告投放 > 30 天 | 预警 FDE：这是高效广告，参考创意方向 |
| 竞品评分本月下降 | 建议社媒发布差异化优势内容 |
| 竞品发布新内容主题 | 分析关键词机会，决定是否跟进 |

### 数据源

| 来源 | 内容 | ME 现状 |
|------|------|---------|
| SEMrush + DataForSEO | 竞品 SEO 全貌 | ✅ 已有 |
| Jina.ai | 竞品新内容爬取 | ✅ 已有，未自动化 |
| Meta Ad Library API | 竞品广告创意库 | ❌ 未接入 |
| Google Ads 透明度 | 竞品搜索广告 | ❌ 未接入 |
| AI Tracker 扩展 | 竞品 AI 可见度对比 | ⚠️ 有基础，需扩展 |
| GBP / TripAdvisor | 竞品口碑趋势 | ❌ 未接入 |

### 不做清单

- ❌ 获取竞品内部数据（只用公开数据源）
- ❌ 自动执行反制行动（信号 → 建议，FDE 决定是否执行）
- ❌ 广告投放金额估算（数据不可靠，不展示）

---

## Phase 17 — Unified Data Pullback（统一数据回流层）🔥 进行中

> **登记日期**：2026-05-19 · **开工日期**：2026-06-03 · **状态**：Phase 17.A ✅ 全部完成（P17.A.1–A.6 均已 merge，2026-05-27）
>
> **背景**：ME 现在的月报数据是孤岛——SEO 数据、社媒数据、广告数据分散在各平台，无法在 ME 内做跨渠道归因。Unified Data Pullback 是把所有执行结果拉回 ME、驱动飞轮真实归因的基础设施层。

### 需要接入的数据源

| 渠道 | 数据内容 | API |
|------|---------|-----|
| Google Search Console | 自然搜索排名 / 点击 / 展示 | ✅ 免费官方 |
| Google Analytics 4 | 网站流量 / 转化 / 用户行为 | ✅ 免费官方 |
| Meta Insights | 社媒帖子表现 / 粉丝增长 | ✅ Graph API |
| Google Ads API | 广告 ROAS / CTR / 转化 | 🔄 申请中 |
| Meta Ads Insights | 广告效果数据 | ✅ 已有 MCP |
| GBP API | 搜索展示 / 电话 / 路线请求 | ✅ 免费官方 |

### 输出到

1. **月报自动生成**（Insight Reports 模块）
2. **飞轮归因**（action → outcome 真实数据验证）
3. **Client Portal**（客户自助查看跨渠道数据看板）

### Phase 17.A — GSC Performance Snapshots（Google Search Console 数据回流）

| ID | 任务 | 状态 |
|----|------|------|
| **P17.A.1** | `gsc_performance_snapshots` 表 + GSC sync 路由 + snapshots 读取路由 | ✅ 完成 2026-06-03 |
| **P17.A.2** | GA4 OAuth scope 扩展 + `ga4_traffic_snapshots` 表 + sync 路由 | ✅ 完成 2026-06-04 |
| **P17.A.3** | GSC 数据 UI 展示（执行看板 / 月报 section）+ connector page 触发按钮 | ✅ 完成 2026-05-27 |
| **P17.A.4** | 飞轮归因桥接：flywheel_action → gsc_snapshot baseline vs after 对比 | ✅ 完成 2026-06-05 |
| **P17.A.5（日常同步）** | 每日 GSC + GA4 cron job：`google-data-pullback-daily`（每天 3am UTC） | ✅ 完成 2026-06-05 |
| **P17.A.6** | 客户主页「数据」tab：GSC top queries + GA4 traffic + 快速夺旗机会清单 | ✅ 完成 2026-05-27 |

**P17.A.1 实施内容**：
- `supabase/migrations/20260603000003_gsc_performance_snapshots.sql`：新表（client_id + period_start/end + 总量指标 + top_queries/pages JSONB）
- `src/lib/gsc/client.ts`：新增 `fetchGscSnapshot()` 并行拉取 query + page 两个维度（各 50 行）
- `POST /api/clients/[id]/gsc/sync`：从 connector config 取 site_url → 调 GSC API → upsert 快照
- `GET /api/clients/[id]/gsc/snapshots`：读取历史快照列表，供报告 / 看板使用

---

## Phase 18 — Ads Execution Engine（广告执行引擎）🔄 18.A ✅ 完成 · 18.B/C 待排期

> **登记日期**：2026-05-21 · **状态**：18.A Meta Ads MVP 已完成（2026-05-31）；18.B Google Ads / 18.C TikTok 待排期
>
> **背景**：诊断层已能发现广告问题（华佗 Ads 维度），诸葛亮能输出广告优先行动，但鲁班目前没有广告执行能力。Phase 18 补上这块缺口，让 ME 能替客户在三个广告平台上自动执行「安全可逆」的操作，同时保留人工审核入口。

### 三平台优先级

| 优先级 | 平台 | 状态 | 执行渠道 |
|--------|------|------|---------|
| **P1** | Meta Ads | ✅ Meta MCP 已有 | Meta Graph API |
| **P2** | Google Ads | 🔄 Developer token 申请中 | Google Ads API |
| **P3** | TikTok Ads | ❌ 未接入 | TikTok Marketing API |

### Fix vs Talk to Us 边界（不可降级）

```
✅ 自动执行（Fix）：
  - 暂停亏损广告 / 关键词
  - 调整出价（±20% 安全幅度）
  - 添加否定关键词
  - 启停已有广告组
  - 调整受众排除

🔴 人工介入（Talk to Us）：
  - 重构广告系列结构
  - 预算策略调整（超过阈值）
  - 创意方向决策
  - 跨账户操作
  - 新建广告系列
```

### Phase 18.A — Meta Ads MVP ✅ 已完成（2026-05-31）

| ID | 任务 | 依赖 | 状态 |
|----|------|------|------|
| **P18.A.1** | 广告诊断 → Fix 按钮：执行看板 Ads action 接线 Meta MCP | 诸葛亮 ✅ | ✅ |
| **P18.A.2** | 暂停亏损广告 / 调整出价 — 调用 Meta Graph API，回写 `flywheel_actions`（含 ±20% 硬限） | P18.A.1 | ✅ |
| **P18.A.3** | 操作审计日志：每次广告变更记录 before/after snapshot，支持回滚 | P18.A.2 | ✅ |

**落地代码**：`meta-ads/{execute,actions,sync,snapshots}` 路由 + `lib/meta/{client,guardrails}.ts` + 执行看板 `AdsFixDrawer`（直接执行抽屉）/ `AdsAuditSection`（历史 + 撤销）。±20% 安全闸由 `checkBudgetWithinSafeRange` 在服务端强制（12 单测）。

### Phase 18.B — Google Ads（Developer token 到位后开工）

| ID | 任务 |
|----|------|
| **P18.B.1** | Google Ads API 接入（Service Account + developer token） |
| **P18.B.2** | 关键词出价调整 + 否定词添加 |
| **P18.B.3** | 广告系列启停 |

### Phase 18.C — TikTok Ads（Phase 18.B 完成后排期）

- TikTok Marketing API 接入
- 广告投放效果数据回流
- 暂停 / 调整出价操作

### 安全边界

- 所有操作必须校验 `client_id` + 广告账户 ownership（防租户穿越）✅ `requireDashboardClientAccess`
- 出价调整幅度硬限 ±20%（超出必须走 Talk to Us）✅ `checkBudgetWithinSafeRange`（服务端强拦 + 12 单测）
- 每次操作在 `flywheel_actions` 有完整记录 + before/after snapshot ✅

---

## Phase 19 — API 鉴权整改（IDOR 修复 + 凭证泄漏封堵）✅ 已完成（2026-05-27，PR #95）

> **登记日期**：2026-05-22 · **完成日期**：2026-05-27 · **PR**：#95 · **状态**：19.A–E 全部完成
>
> **背景**：2026-05-22 审计发现全部 **89 个 `/api/clients/[id]/*` 路由**存在系统性横向越权（IDOR）—— 任何已登录的 dashboard 用户都能拿别的 client UUID 调任意 API 读 / 改对方数据。由 PR #51 一个 review comment（competitors-gap 路由无鉴权）引出审计，确认问题系统性。
>
> **根因**：`INTERNAL_API_KEY` 被以 `NEXT_PUBLIC_INTERNAL_API_KEY` 暴露（`.env.example` 第 35–37 行），约 33 个 dashboard 文件用它做 `Authorization: Bearer` 头。`NEXT_PUBLIC_*` 会被 Next.js 编译进浏览器 bundle —— bearer token 对浏览器攻击者形同公开，`requireBearerToken` 守卫虚设。

### 最高危路由（19.B 优先封堵）

| 路由 | 风险 |
|------|------|
| `users` | 用户可自我提权为 admin |
| `cms/connect` + `connectors` | GitHub / 第三方凭证泄漏 |
| `zhangqian/confirm` | 越权写他人 client 数据 |
| `DELETE /api/clients/[id]` | 越权删除整个客户 |

### ⚠️ 硬性时间约束（不可降级）

**19.A + 19.B 必须在 PM 给 CTS / Oztop 建员工登录账号之前完成。** 当前只有内部团队能登录，IDOR 仅为内部风险；PM 计划「晚点」给客户员工建账号 —— 账号一旦建立，IDOR 立即变为外部攻击面。**建账号前先做掉 19.A + 19.B。**

### 修复方案（3 层）

1. **L1 鉴权切换**：浏览器侧路由的 bearer-token 鉴权 → 改用 Supabase session-cookie 鉴权，并移除全部 `NEXT_PUBLIC_INTERNAL_API_KEY`
2. **L2 per-client 授权**：新增 `requireClientAccess(clientId)` helper，接入全部 `/api/clients/[id]/*` 路由，校验当前用户是否有权访问该 client
3. **L3 密钥轮换**：轮换 `INTERNAL_API_KEY`

> **已有地基**：`requireSession()` 已在 main（PR #51 已合并，`src/lib/auth/require-session.ts`）；`whitelist.ts` 的 `getUserPermissions()` 已返回 `allowedClientId` —— `requireClientAccess` helper 只需拼装现有能力。实施分支基于 main 切。

### 实施批次（5 批 · ~19 commit）

| 批次 | 范围 |
|------|------|
| **19.A** 地基 | `requireClientAccess` helper + 单元测试 |
| **19.B** 最高危 | `clients/[id]` 根路由 / `users` / `cms` / `connectors`（提权 · 凭证 · 删除） |
| **19.C** 高危业务 | `zhangqian` / `zhuge` / `diagnostic` / `prescription` / `execution` / `luban` / `blog` |
| **19.D** 中危批量 | `brief` / `campaign` / `reels` / `geo` / `seo-*` / `site-audit` / `reports` 等无守卫路由 |
| **19.E** 收尾 | 清除 `NEXT_PUBLIC_INTERNAL_API_KEY` + 轮换 `INTERNAL_API_KEY` |

### 里程碑

- **M1**：19.A 地基 —— `requireClientAccess` 单元测试全绿
- **M2**：19.B 高危封堵完成 + CTS · Oztop 双视角冒烟测试通过
- **M3**：19.C–E 全量整改 + 密钥轮换完成

### 风险

L2 授权写太严会把 CTS / Oztop 操作员锁在自己数据外。**19.B 部署前必须确认操作员邮箱已在 `ADMIN_EMAILS` / `CLIENT_VIEWERS` 白名单。**

---

## Phase 20.D — Unified Six-Pillar Kanban / 六支柱统一执行看板 ✅ 已实施（2026-05-28）

> **原编号 Phase 24 已更正为 Phase 20.D**（UI 改动量不足以单独立 Phase，归入 Phase 20 子任务）
> **登记日期**：2026-05-27 · **实施日期**：2026-05-28 · **触发**：OzTop 技术 SEO 修复（Yoast noindex 批量配置）无法写入执行看板，根因是看板只接受 `diagnostic` 和 `marketing_plan` 两个来源，六支柱的 FDE 手动执行工作没有入口。

### 核心问题

看板（`execution_items`）当前只有两个入口：
- `source='diagnostic'` → 诊断处方自动生成
- `source='marketing_plan'` → Marketing Plan 审批后派发

**缺失的六个入口**：SEO 技术任务 / GEO 执行任务 / Ads 修复任务 / Reputation 任务 / Competitor 任务 / FDE 手动录入

结果：FDE 执行了大量客户可见的有价值工作（技术 SEO 修复、GBP 更新、竞品分析等），客户完全看不到，无法建立信任感和透明度。

### 目标

> **让看板成为六支柱所有执行工作的统一出口，每条 FDE 工作记录客户都能看到。**

### 架构方案

**数据层（最小改动）**：

```sql
-- 新增 source 枚举值（替换 CHECK 约束为更宽松的版本）
ALTER TABLE execution_items
  DROP CONSTRAINT execution_items_source_check;

ALTER TABLE execution_items
  ADD CONSTRAINT execution_items_source_check
  CHECK (source IN (
    'diagnostic',       -- 原有：诊断处方
    'marketing_plan',   -- 原有：Marketing Plan
    'fde_manual'        -- 新增：FDE 手动录入（任意支柱）
  ));

-- fde_manual 允许两个 FK 都为 NULL
ALTER TABLE execution_items
  DROP CONSTRAINT execution_items_source_consistency;

ALTER TABLE execution_items
  ADD CONSTRAINT execution_items_source_consistency
  CHECK (
    (source = 'diagnostic'     AND prescription_id IS NOT NULL AND marketing_plan_id IS NULL) OR
    (source = 'marketing_plan' AND marketing_plan_id IS NOT NULL AND prescription_id IS NULL) OR
    (source = 'fde_manual'     AND prescription_id IS NULL AND marketing_plan_id IS NULL)
  );
```

**API 层**：
```
POST /api/clients/[id]/execution/manual
Body: { title, description, dimension, fix_type?, due_date?, notes? }
→ 插入 execution_items(source='fde_manual', dimension, status='completed')
→ 同步写 flywheel_actions(flywheel, action_type='fde.manual_task', execution_mode='external_manual')
```

**UI 层**（每个支柱页面）：
- 「+ 记录 FDE 工作」按钮（简单表单：标题 + 描述 + 日期）
- 执行看板新增「FDE 手动」来源标签（区别于诊断/Marketing Plan）
- 客户 Portal 看板：显示所有来源的已完成任务

### 六支柱入口映射

| 支柱 | dimension | 典型 FDE 任务 | 从哪里录入 |
|------|-----------|-------------|-----------|
| SEO | `seo` | noindex 修复、robots.txt、sitemap 提交 | SEO Intelligence 页 |
| GEO | `ai_visibility` | llms.txt、Schema 标记、GEO Directive 部署 | AI Tracker 页 |
| Ads | `ads` | 暂停亏损词、调整出价、创建否定词 | Ads Intelligence 页 |
| Social | `social` | 手动发帖、内容审核、账号配置 | 社媒内容矩阵 |
| Reputation | `reputation` | GBP 回复、差评处理、信任徽章 | Reputation（待建） |
| Competitor | `competitor` | 竞品分析、差距报告、策略调整 | Competitor（待建） |
| 通用 | 任意 | 临时 FDE 工作（跨支柱） | 执行看板顶部「+ 录入」 |

### 实施内容（2026-05-28 完成）

**五项确认优化（来自 ME_Kanban_Evolution_Final.docx 2026-05-28 版）：**
- [x] **统一入口**：执行看板顶部「＋ 录入工作」按钮 → `FdeManualEntryModal`
- [x] **FDE 手动分组**：`source='fde_manual'` 任务在「📝 FDE 录入工作」分组，平铺显示
- [x] **拖拽排序**：`FdeManualGroup` 内 HTML5 drag-to-reorder，PATCH `sort_order`
- [x] **客户 Portal 可见性**：Portal 新增「Active execution work」按支柱分组展示（SEO/GEO/Ads/Social/Reputation/Competitor）
- [x] **素材依赖标注**：`PlanTask.requires` 字段（none/client_photo/client_video/client_info）+ `kindToRequires()` 自动推导 + kanban 卡片显示徽章
- ⏸ **Blocked 状态**：暂缓，用任务描述文字记录卡点原因

**相关文件：**
- `supabase/migrations/20260603000001_execution_items_fde_manual.sql`
- `src/app/api/clients/[id]/execution/manual/route.ts`
- `src/app/dashboard/clients/[id]/execution/_components/FdeManualEntryModal.tsx`
- `src/app/dashboard/clients/[id]/execution/execution-view-model.ts`（新增 `FDE_MANUAL_GROUP_ID`、`fde_manual` 分组）
- `src/app/dashboard/clients/[id]/execution/page.tsx`（新增按钮 + 分组渲染 + 拖拽 + 录入 Modal）
- `src/app/portal/[clientId]/page.tsx`（新增 execution tasks section）
- `src/lib/marketing-plan/types.ts`（新增 `PlanTaskRequires` + `requires` 字段）
- `src/lib/marketing-plan/task-dispatcher.ts`（新增 `kindToRequires()`）
- `src/types/diagnostic.ts`（`ExecutionItemSource` 加 `'fde_manual'`）

### 里程碑

- [x] **M1**：数据库 migration 完成 + `POST /manual` API 通过测试
- [x] **M2**：执行看板显示 `fde_manual` 来源任务 + FDE 能手动录入
- [x] **M3**：客户 Portal 按支柱分组展示 FDE 工作记录（透明度闭环）

### 优先级依据

- OzTop、CTS 客户 FDE 工作已在执行，但客户完全不可见 → 直接影响客户感知价值
- 开发量小（1 个 migration + 1 个 API + UI 上加按钮），ROI 极高
- 是 Phase 15（Reputation）/ Phase 16（Competitor）的前置基础设施

### Phase 编号修正记录（2026-05-28）

| 原草案写法 | 正式修正 | 说明 |
|-----------|---------|------|
| Phase 24（统一入口 + 拖拽 + Portal）| **Phase 20.D** | UI 改动量不足以单独立 Phase |
| Phase 22 = Agent Memory | **Phase 22 = Data Intelligence Engine** | 22 是采集+分析+反馈，不是记忆层 |
| Phase 22 = 主动任务注入 | **Phase 22.D = 主动任务生成器** | 主动任务是 Phase 22 的一个子模块（22.D）|
| Phase 23（未命名）| **Phase 23 = Cross-Agent Memory Layer** | L3 长期学习，升级自原 Phase 8.M |

---

## Phase 24 — Execution Loop Closure（执行闭环修复）📋 已登记，2026-06-06 启动

> **登记日期**：2026-06-06 · **状态**：开发中
>
> **背景**：诸葛亮推荐行动当前不进看板、不定时刷新；GEO 部署页忽略 CMS connector 只给手动复制粘贴。月报依赖执行看板作为数据来源，三个断点必须修复。

### 三个子任务

| ID | 内容 | 文件 |
|----|------|------|
| **P24.A** | 诸葛亮推荐自动写入执行看板 | `action-persister.ts` + migration |
| **P24.B** | 诸葛亮每周定时重新计算 | `cron/zhuge-recalculate/route.ts` + `render.yaml` |
| **P24.C** | GEO 部署页接入 CMS connector 一键部署 | `deploy/page.tsx` + `DeploymentForm.tsx` |

### P24.A — 诸葛亮推荐写入执行看板

**Schema 变更**（`execution_items` 表）：
- `prescription_id` 改为 nullable（支持无处方来源的 zhuge 行）
- 新增 `source TEXT CHECK (IN ('zhuge','fde','luban'))` 默认 `'fde'`
- 新增 `action_type TEXT`（存储 zhuge 的 action_type slug）
- 新增 `zhuge_session_id UUID` FK → `zhuge_sessions(id) ON DELETE SET NULL`
- `execution_item_status` 枚举新增 `'superseded'`

**重复处理逻辑**：
- 同一 `client_id + action_type` 若已有 pending 的 fde/luban 行 → 跳过（不覆盖人工项）
- 若已有 pending 的 zhuge 行（旧 session）→ 先标记为 `superseded` 再插新行
- 同一 session 重复调用（幂等）→ 跳过

- [ ] P24.A.1 migration: `20260606000001_execution_items_zhuge_source.sql`
- [ ] P24.A.2 `action-persister.ts` 新增 `writeExecutionItems` + 接入 `persistZhugeActions`
- [ ] P24.A.3 `__tests__/action-persister.test.ts` 补充测试（TDD 先写）

### P24.B — 诸葛亮每周定时重新计算

- 查询 `client_discovery` 有 `confirmed_at IS NOT NULL` 的客户
- 对每个客户调用 `assembleZhugeInput` → `conductPriorityActions` → `persistZhugeActions`（触发 P24.A 看板写入）
- `x-cron-secret` 验证（与现有 cron 一致）
- `render.yaml` 新增 `zhuge-weekly-recalculate`，每周一 3am UTC

- [ ] P24.B.1 `src/app/api/cron/zhuge-recalculate/route.ts`
- [ ] P24.B.2 `render.yaml` 追加 cron 定义

### P24.C — GEO 部署页接入 CMS connector

- `deploy/page.tsx`：加载时并行拉取 `/api/clients/[id]/cms/providers`
- `DeploymentForm.tsx`：
  - 无 connector → 顶部显示「连接网站可一键部署」引导横幅
  - 有活跃 WordPress/Shopify → 显示「一键部署」区块
  - 点击后调用 `/api/clients/[id]/cms/publish-geo-snippet` 注入 snippet 并自动 `recordDeployment`
- 新增 `src/app/api/clients/[id]/cms/publish-geo-snippet/route.ts`（复用 wordpress-client / shopify-client 底层逻辑）

- [ ] P24.C.1 `deploy/page.tsx` + `DeploymentForm.tsx` 改造
- [ ] P24.C.2 `publish-geo-snippet/route.ts` 新增路由

---

## Phase 25 — ⚠️ 已并入 Phase 20.0（见上方）

> **登记日期**：2026-05-29 · **状态**：方案已完整讨论，计划已拍板，明日开工
>
> **背景**：ME 当前只有 FDE 陪跑客户（人工建档），缺少 C 端自助入口。Phase 25 打通「陌生访客 → Discovery Report → 会员注册 → Portal 自助工作台」完整漏斗，作为 Phase 20 MTC 变现层的前置基础。全程自助，FDE Dashboard 与 Portal 完全分开。

### 产品定位

```
陌生访客                注册转化             自助 Portal               变现（Phase 20）
   │                       │                    │                          │
/discover              自动建档              /portal/[id]               MTC Token
输入网址               链接 Discovery        ├── Discovery Report         ├── 在线购买
   │                   创建 client           ├── 华佗诊断                 └── Talk to Us
张骞扫描               client_portal_users   ├── 诸葛亮处方
   │                                         ├── Marketing Plan
/prospect                                    └── Content / Report
看报告（已登录）
   │
[进入我的工作台 CTA]
```

### 关键设计决策（已拍板）

| 决策项 | 结论 |
|--------|------|
| Prospect 后台 vs FDE 后台 | **完全分开**：自助用户进 `/portal`，FDE 进 `/dashboard` |
| Portal 定位 | 消费者友好 UI，4–6 步线性引导；FDE Dashboard 保持内部工具不变 |
| 数据桥接方式 | `POST /api/onboard/self` 自动建 `clients` 记录，复制 `public_scan_jobs.result` → `client_discovery` |
| 华佗/诸葛亮 Phase 25 范围 | **只读展示**（从已有数据读取），自助触发留待 Phase 20 MTC 门控 |
| Portal 导航顺序 | Discovery → Overview → Diagnosis → Prescription → Plan → Content → Report |

### Phase 25 子任务清单

#### Phase 25.A — 漏斗打通（核心路径）

- [ ] **P25.A.1** Migration：`public_scan_jobs` 加 `client_id` 可空 FK
  - 文件：`supabase/migrations/20260530000001_self_service_onboarding.sql`
- [ ] **P25.A.2** 新建 `POST /api/onboard/self`
  - 文件：`src/app/api/onboard/self/route.ts`
  - 逻辑：查已有记录防重复 → 创建 `clients` → 写 `client_discovery` → 写 `client_portal_users(access_type=portal)` → 绑定 `public_scan_jobs.client_id`
- [ ] **P25.A.3** `/prospect` 页面加转化 CTA
  - 文件：`src/app/prospect/page.tsx`
  - 仅在 `status=completed` 时显示「进入我的增长工作台 →」按钮

**里程碑 M1**：Johnson 在 `/prospect` 点按钮 → 进入 `/portal/[id]`，Portal Overview 正常加载

#### Phase 25.B — Portal Discovery 页面

- [ ] **P25.B.1** 新建 `/portal/[clientId]/discovery/page.tsx`
  - 读 `client_discovery` → 复用 `dashboard/clients/[id]/zhangqian/cards.tsx` 所有 card 组件
  - 无数据时显示占位
- [ ] **P25.B.2** Portal 首页加 Discovery 摘要卡
  - 文件：`src/app/portal/[clientId]/page.tsx`
  - 展示 `diagnosis.scores`（overall + 六维），链接到 `/discovery`
- [ ] **P25.B.3** PortalNav 加 Discovery 链接
  - 文件：`src/app/portal/[clientId]/_components/PortalNav.tsx`

**里程碑 M2**：Portal 里能看到完整 Discovery Report，六维评分卡在首页显示

#### Phase 25.C — Portal Diagnosis 页面（只读）

- [ ] **P25.C.1** 新建 `/portal/[clientId]/diagnosis/page.tsx`
  - 读 `diagnostic_runs`（latest completed）→ 展示六维评分 + 主要发现
  - 无数据时显示「Your diagnosis is being prepared」占位 + Talk to Us CTA

#### Phase 25.D — Portal Prescription & Plan 页面（只读）

- [ ] **P25.D.1** 新建 `/portal/[clientId]/prescription/page.tsx`
  - 读 `prescriptions`（latest confirmed）→ 展示优先行动方案
- [ ] **P25.D.2** 新建 `/portal/[clientId]/plan/page.tsx`
  - 读 `execution_items`（non-skipped, grouped by dimension）→ 时间轴展示

### 文件改动汇总

| 文件 | 操作 | Phase |
|------|------|-------|
| `supabase/migrations/20260530000001_self_service_onboarding.sql` | 新建 | 25.A |
| `src/app/api/onboard/self/route.ts` | 新建 | 25.A |
| `src/app/prospect/page.tsx` | 修改（加 CTA） | 25.A |
| `src/app/portal/[clientId]/discovery/page.tsx` | 新建 | 25.B |
| `src/app/portal/[clientId]/page.tsx` | 修改（加摘要卡） | 25.B |
| `src/app/portal/[clientId]/_components/PortalNav.tsx` | 修改（加链接） | 25.B |
| `src/app/portal/[clientId]/diagnosis/page.tsx` | 新建 | 25.C |
| `src/app/portal/[clientId]/prescription/page.tsx` | 新建 | 25.D |
| `src/app/portal/[clientId]/plan/page.tsx` | 新建 | 25.D |

**总量**：1 migration + 5 新建文件 + 3 修改文件

### 风险备注

| 风险 | 处理 |
|------|------|
| 重复点击 CTA → 重复建档 | `/api/onboard/self` 先查 `client_portal_users`，已存在直接 redirect |
| 扫描未完成就点 Claim | CTA 只在 `status=completed` 渲染 |
| 扫描 failed | CTA 不显示，显示"Try a new scan" |
| `client_discovery` 30 天过期 | Phase 25 范围内不处理，留 Phase 20 补充续期机制 |

### Phase 25 与 Phase 20 的关系

Phase 25 是 Phase 20 的前置基础：
- Phase 25 打通漏斗 + 建立 Portal 自助工作台（无 Token 门控）
- Phase 20 在此基础上叠加 MTC Token 系统：功能门控 + Stripe 购买 + Talk to Us 触发

---

## Phase 20 — Magic Token Coin & Self-Serve Portal（C 端变现引擎）📋 已登记，待排期

> **登记日期**：2026-05-25 · **状态**：方案已完整讨论，所有关键决策已拍板，待 PM 排期开工
>
> **背景**：Magic Engine 当前只服务 FDE 陪跑客户（人工建档、月度合约）。Phase 20 新增 C 端自助层，让 AU/NZ 本地商家从广告进来后，用 Magic Token Coin（MTC）自助体验和购买内容生成服务，形成 Tier 1（免费 Discovery）→ Tier 2（MTC 自助）→ Tier 3（FDE 全托管）的完整漏斗。
>
> **完整 spec**：见 [PHASE_20_MTC_SPEC.md](./PHASE_20_MTC_SPEC.md)

### Phase 20 核心决策（已拍板）

| 决策项 | 结论 |
|--------|------|
| 计量单位 | Magic Token Coin（MTC） |
| 汇率 | $29 NZD = 300 MTC（1 MTC ≈ $0.097 NZD） |
| 充值包 | $29 / 300 MTC · $79 / 1,200 MTC · $199 / 3,500 MTC |
| 注册赠送 | 100 MTC（验证邮箱后发放，防刷号） |
| 有效期 | 每次购买单独计时，12 个月，FIFO 扣款 |
| 月费 | 无（Tier 2 纯 Token 制） |
| 支付系统 | Stripe（一次性支付） |
| 用户体系 | 复用 `clients` 表，新增 `source` 字段区分 fde / self_serve |
| Kanban | 不对 C 端开放，全部导流 FDE Talk to Us |
| 视频 | 仅 Seedance 2.0 I2V，封顶 15s |
| 生成失败 | 100% 退还 MTC |
| 提示词可见性 | 可见但限制导出 |

### Phase 20 开发批次

| 批次 | 内容 | 工作量 |
|------|------|--------|
| **20.0** Portal 地基 | Prospect→Portal 漏斗打通 + Portal 扩展页（无 MTC） | ~2–3 天 |
| **20.A** MTC 地基 | DB migrations + Stripe Webhook + MTC 余额 API | ~1 周 |
| **20.B** 界面 | 钱包页 + Checkout 流程 + 生成 API 扣费接入 | ~1 周 |
| **20.C** 收尾 | Talk to Us 触发 + Magic Lab Class 入口 + 过期提醒邮件 + 管理员视图 | ~3–4 天 |

### Phase 20.0 — Portal 地基（自助漏斗，无 MTC）🔜 当前开工

> **前置**：Phase 13.A（/discover + /prospect）已完成 ✅
> **目标**：打通 Prospect → Portal 会员空间完整链路，为 Phase 20.A MTC 接入铺路

#### 任务清单

- [x] **P20.0.1** Migration：`public_scan_jobs` 加 `client_id` 可空 FK
  - `supabase/migrations/20260530000001_self_service_onboarding.sql`
- [x] **P20.0.2** 新建 `POST /api/onboard/self`
  - 防重复 → 建 `clients` → 写 `client_discovery` → 写 `client_portal_users(portal)` → 绑定 scan job
- [x] **P20.0.3** `/prospect` 加转化 CTA（status=completed 才显示）
- [x] **P20.0.4** 新建 `/portal/[clientId]/discovery/page.tsx`（复用 ReportView）
- [x] **P20.0.5** Portal 首页加 Discovery 摘要卡 + 四项评分 tiles + Hero CTA
- [x] **P20.0.6** `PortalNav` 加 Discovery 链接
- [x] **P20.0.7** 新建 `/portal/[clientId]/diagnosis/page.tsx`（只读六维评分卡 + findings）
- [x] **P20.0.8** 新建 `/portal/[clientId]/prescription/page.tsx`（只读处方：摘要 + KPIs + 分阶段 actions）
- [x] **P20.0.9** 新建 `/portal/[clientId]/plan/page.tsx`（只读执行进度，按维度分组）

**M1**：点 CTA → 进 `/portal/[id]` Overview 正常加载
**M2**：`/portal/[id]/discovery` 显示完整 Discovery Report

### Phase 20 里程碑

- **M1**：DB 三张新表 + Stripe test mode 支付成功写入 `mtc_purchases`
- **M2**：注册 → 验证邮箱 → 余额 100 → 充值 $29 → 余额 400 → 生成图片 → 余额 390
- **M3**：完整用户路径跑通 + Talk to Us 情境触发 + 管理员 C 端用户视图

### Phase 20 前置条件

双信号博客质量验证（手动，用 CTS Tours 真实关键词跑一遍，通过后才开放 C 端）

---

## ME 战略扩张模型（2026-05-19 确立）

> **通用布线板原则**：ME 平台核心不变，通过插入本地化配置快速进入新市场。

```
ME 平台核心（语言无关 / 市场无关）
  ├─ 六维执行引擎（SEO/GEO/Social/Ads/Reputation/Competitor）
  ├─ Scan → Analyze → Recommend → ACT 四步闭环
  ├─ 飞轮归因系统
  └─ 行动触发逻辑

AU / NZ（当前）          新市场（未来）
插件配置：               插件配置：
  数据源 → SEMrush AU/NZ   数据源 → 本地 SEO 工具
  平台 → TripAdvisor/GBP   平台 → 本地评论/社媒平台
  行业 → 旅游/餐饮/建筑     行业 → 按当地需求配置
  BD 团队 → 本地           BD 团队 → 本地招募
```

**种子行业（AU/NZ 冷启动）**：
- 旅游业（CTS 已是真实客户）
- 餐饮业（Google Maps / Zomato 数据密度高）
- 建筑业（ProductReview.com.au / Houzz）

**冷启动策略**：免费层先跑 → 积累真实行业数据 → 建立 AU/NZ 行业权威图谱 → 转化付费 VIP 客户 → 复制模型到新市场。

---

## 8. 决策日志

> 重大决策记录在此，便于追溯。

### 2026-05-22

- **Phase 19 API 鉴权整改登记（不开工，PM 缓做）**：2026-05-22 审计发现全部 89 个 `/api/clients/[id]/*` 路由系统性 IDOR —— 根因为 `INTERNAL_API_KEY` 经 `NEXT_PUBLIC_INTERNAL_API_KEY` 编译进浏览器 bundle，约 33 个 dashboard 文件的 bearer-token 守卫虚设。由 PR #51 一个 review comment（competitors-gap 路由无鉴权）引出审计后发现问题系统性。方案已设计 + PM 批准：3 层修复（L1 session-cookie 鉴权 + 移除 `NEXT_PUBLIC_INTERNAL_API_KEY` / L2 `requireClientAccess` per-client 授权 helper / L3 轮换 `INTERNAL_API_KEY`），5 批 ~19 commit（19.A 地基 → 19.B 最高危 → 19.C 高危业务 → 19.D 中危批量 → 19.E 收尾）。PM 决定缓做、优先内容 / SEO，但**硬约束 = 19.A + 19.B 必须在给 CTS / Oztop 建员工登录账号之前完成**（账号一建立，IDOR 即变外部攻击面）。编号 19 已与 PM 确认。

### 2026-05-19

- **Phase 12.Q 内容质量闭环登记（不开工，前置阻塞 P8.3.2）**：经 v1→v4 四轮 plan 评审定稿，9 个 commit（P12.Q.0–Q.7 含 Q.4a/Q.4b）实现 campaign 上下文强化 + 统一 quality rubric（混合模式：规则可判维度走规则，质性维度走轻量 gpt-4o-mini）+ 生成后自动质检 retry + `generation_context_snapshot` 持久化。核心决策：(1) **覆盖 Phase 13 `campaign_briefs 不扩 schema` 决策**，加 6 个 nullable 字段（offer / target_audience_detail / proof_points / primary_cta / channel_goal / campaign_angle）；理由：质量上限被 campaign context 缺失卡住，6 个 nullable 字段属低风险扩展；(2) Quality rubric 混合模式，SDK client 由 route 注入，rubric 模块顶层不引用任何 SDK；(3) Context snapshot 扩三张现有产物表（`blog_posts` / `content_posts` / `reels_drafts`），**不建 `production_packages` 聚合表**（与 Phase 13 是两个独立概念）；(4) Route B 纳入 scope（独立 task Q.4b 处理 viral-structure-preservation 维度）；(5) Phase 13 Pre.13 并入 P12.Q.1。试点客户 CTS Tours；前置阻塞 P8.3.2 Dashboard Magic Link 鉴权完成后才开工。实施分支 `feat/phase-12-q-content-quality`，本登记 PR 在 `chore/roadmap-phase-12q-registration`。

- **Phase 13 Production Package 登记（不开工）**：完成两轮 RFC 评审，方案从"完整产品蓝图"收敛为"Social-only MVP 工程切片"。核心决策：(1) `dimension` 复用 `diagnostic_dimension` enum；(2) `context_mode` 不持久化，由 dimension 派生；(3) 现有内容表只加 `production_item_id` 单链，避免 `package_id + item_id` 两列冗余；(4) `campaign_id` 应用层校验而非 DB 硬约束；(5) `production_item_assets` / `package_type` / `campaign_briefs` schema 扩展 MVP 全部不做；(6) Reels schema drift 改 Reels 代码适配 `campaign_briefs`，**不**反过来扩 campaign。MVP = 6 个 commit 单 sprint 内完成。完整 RFC 见 [docs/production-package-rfc.md](docs/production-package-rfc.md)。当前未排期，等 P8.3.2 / Phase 12.B 收尾后再决定启动时机。

### 2026-05-18

- **SEMrush → DataForSEO 关键词接口迁移决策**（Phase 8.S）：通过 Apify SEO actor 三方对比测试 + DataForSEO 调研确认，项目现有 8 个 SEMrush 接口中 7 个可完整替换为 DataForSEO Labs 等效接口，节省 96–99% 成本（SEMrush 按词计费 vs DataForSEO 按 task 计费）。数据质量相同（DataForSEO Labs 同源 SEMrush），唯一差异为 KD 算法口径不同，需在报告层注明。迁移顺序：P8.S.1（related-keywords，最贵）→ P8.S.2-4（domain 系列）→ P8.S.5-7（长尾/趋势）→ P8.S.8（batch overview，最低优先）。

### 2026-05-17

- **Phase 12 飞轮数据闭环启动**：诊断/处方/执行链路已建好，但 4 飞轮执行后没数据回流。建立 `flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes` 三层数据骨架 + adapter 抽象，让任何 vendor 数据都能回流并自动归因。
- **第 4 飞轮命名定为 `geo_composer`**（替代历史命名 `insight_reports`，因为 GEO 才是真正的"动手干活的引擎"；月报独立为非飞轮的 `reports`）
- **广告 vendor 策略**：先用 Meta MCP 自建 adapter；markisfact 当作"未来可插拔"的备选。硬约束 = **数据必须留在 Magic Engine** 自己的表里（不管 vendor 是谁）
- **社媒飞轮形态确认为混合**：自研内容制作（Atlas + OpenAI / Claude）+ 第三方发布（Publer）
- **Phase 12 工作协议**（写入 CLAUDE.md）：每任务 1 commit；3 个里程碑关卡（M1 地基 / M2 第一个 adapter / M3 端到端 demo）必须通过才能往下；每个 commit 附 PM-review 卡片让非技术 PM 能 review；多 session 必须主动提醒
- **试点客户**：CTS（GEO+SEO+Ads，有 Meta 投放数据）+ Oztop（SEO+GEO）
- **AI Tracker：保留自建，不切换 Apify `amernas/ai-brand-monitor`**
  - 现状：自建 AI Tracker 覆盖 4 引擎（OpenAI/Claude/Perplexity/Gemini），`marketToLocation()` 已实现 AU/NZ 地域定位，已串通 zhangqian + master_briefs + ai_visibility_snapshots，Phase 7.1 已上线
  - Apify actor 致命短板：**不支持 AU/NZ 地域定位**（默认美国市场视角，对 6 客户全部失真），且 actor 状态 "Under maintenance" 不能做核心数据源
  - Apify actor 唯一独有的 Google AI Overviews 覆盖：**走自建第 5 runner 路线**（用现有 SerpAPI 调 AI Overviews API），登记到 Phase 12.B 低优先级
- **TikTok 广告库抓取：未来用 Apify，不自建**
  - 商品化数据采集，TikTok 反爬激进，自建维护成本极高；Phase 12.B/TikTok Ads 起手直接接 Apify TikTok actor

### 2026-04-30
- **战略**：确定 Magic Engine 三大核心：SEO + GEO + 社媒内容矩阵；GEO 为 2026 Q2 核心差异化
- **商业模式**：年度陪跑服务（5–15 万/客户/年），不做 SaaS 月费
- **目标市场** ⭐：2026 主战场 = 澳大利亚（AU）+ 新西兰（NZ）；地域性强，所有功能必须默认 AU/NZ 上下文
- **品牌封装**：第三方供应商封装规范（详见 CLAUDE.md §三）
- **Phase 7 决策（开工前）**：
  - P7.0.1 ✅ AI Tracker 接 OpenAI + Claude + Perplexity
  - P7.0.2 ⚠️ G

---

## Phase 21 — AI Content Factory（旗舰能力 · FDE 默认产能引擎）📋 MVP 计划已登记，待开工 P21.1

> **登记日期**：2026-05-26 · **MVP 计划登记**：2026-05-31 · **状态**：垂直 MVP 闭环已规划（试点 CTS Tours + Oztop），待开工 P21.1
>
> **战略定位**：AI Content Factory 是 ME 的**产能上限**，类比"能产 100 万双鞋的鞋厂可以接 1 万双小单"。FDE 客户（$2.5K-3K/月）默认走 AI Factory；非 FDE 客户按 token 自助调用各模块。
>
> **颠覆点**：2026 年 AI 内容成本崩塌 100x，传统 marketing "10 帖/月 = aggressive" 思维过时。真正护城河是 **生产 × 分发 × 学习** 飞轮速度，不是单条内容质量。

### Phase 21 产能基线（FDE 客户默认）

| 平台 | 频次基线 | 月产能 |
|---|---|---|
| TikTok | 3-5/天 | 90-150 |
| YouTube Shorts | 2-3/天 | 60-90 |
| FB Reels | 3-5/天 | 90-150 |
| IG Reels | 3-5/天（多数复用 FB） | 90-150 |
| FB Posts | 1-2/天 | 30-60 |
| IG Posts | 1-2/天（复用 FB） | 30-60 |
| FB Stories | 3-5/天 | 90-150 |
| IG Stories | 3-5/天 | 90-150 |
| YouTube Long | 4-6/月 | 4-6 |
| Google SEO Blog | 2-3/天 ≥1500 字 | 60-90 |

**单客户月度产能上限：~800-1100 条内容**（非全部强制，FDE 按客户阶段调配）

### Phase 21 五大子系统

| 子系统 | 内容 |
|---|---|
| **21.A 产能引擎** | Prompt 体系 + Claude/GPT/Haiku 分层调用 + 变体生成 |
| **21.B 素材库 × 复用引擎** | 50 个真实素材 × 100 个 AI 变体 × 多平台 reformat |
| **21.C 多平台发布管道** | Meta Reels API / TikTok Content API / YouTube Data API + rate limit + 重试 |
| **21.D Token 预算治理** | 每客户月度成本上限 + 模型分层（战略层 Sonnet，生产层 Haiku/4o-mini）|
| **21.E intensity = ai_factory 新档位** | 在 `light/standard/aggressive` 后加 `ai_factory` |

### Phase 21 实施现状（2026-05-31 重新盘点）

> **关键发现**：Phase 21 **不是从零开始**。盘点代码后确认大部分积木已存在，真正缺的是 3 块「连接组织」。原五大子系统拆成可执行子任务（见下表），并标注现状。

**已建积木（直接复用，无需重写）**：
- 文本生成管道：`batch-generate` 路由（gpt-4o-mini，1-30 帖并发 + 质量重试 `auditSocialPost`）+ 双信号博客
- **视觉素材智能层（原 21.B 的视觉部分已完成，此前未登记）**：`client_assets` + `asset_storyboards` 表（migration `20260612000001`）、`vision-analyzer` cron、assets/storyboard API、素材库 UI、Seedance/Kling/Runway prompt 字段 ⚠️ DB 是否已 apply 待 PM 在 Supabase 确认
- 视觉生成：wavespeed / seedance / heygen + reels 工作流
- 发布：Publer 管道 + engagement 回拉
- 计费：MTC FIFO 扣费（`deductMtc` + `MTC_RATES` 已含全部服务定价 = 原 21.D 定价层已就绪）
- 飞轮回流：`production_packages` + `SocialContentAdapter` + `package-publish`
- L3 记忆注入器：`formatMemoryForPrompt`（已接张骞/华佗/鲁班，AI Factory 待接）
- LLM 可观测：Cloudflare AI Gateway 代理

**3 块缺失连接组织（Phase 21 真正要建的）**：
1. **模型分层路由** — 加 Haiku 档（战略层 Sonnet / 生产层 Haiku），现 `anthropic/client.ts` 只有单档 Sonnet
2. **变体扇出 + 多平台 reformat** — 一条核心内容 → N 平台变体（原 21.B 的「100 变体 × reformat」缺口）
3. **量产编排器 + 预算熔断** — 批量调度 + 月度成本上限

### Phase 21 MVP 闭环（垂直切片，先证明飞轮再放量）

> **切入策略**（PM 2026-05-31 拍板）：选试点客户（**CTS Tours + Oztop 两个都上**），小批量（~20-30 帖/周）跑通端到端闭环：核心主题 → 分层量产编排（Sonnet 策略 + Haiku 生产）+ 记忆注入 → 一条扇出多平台变体 → 匹配视觉素材 → 生产包聚合 → 发布 → 飞轮 outcome 回流 + MTC 逐服务扣费。**先证明飞轮，再谈 800-1100/月放量。**

| 子任务 | 内容 | 对应原子系统 | 现状 |
|---|---|---|---|
| **chore** | ROADMAP 校正登记（本 PR） | — | 🚧 进行中 |
| **P21.1** | 模型分层路由：`anthropic/client.ts` 加 `MODEL_HAIKU` + 新建 `src/lib/ai/model-router.ts` | 21.A | ✅ 完成 |
| **P21.2** | AI Factory 服务层 + 记忆注入：新建 `src/lib/ai-factory/`，量产调用接 `formatMemoryForPrompt` | 21.A | ✅ 完成 |
| **P21.3** | 变体扇出 + 多平台 reformat 引擎（一主题 → N 平台变体） | 21.B 缺口 | ✅ 完成 |
| **P21.4** | `ai_factory` intensity 档位：`marketing-plan/types.ts:147` + plan generator | 21.E | ✅ 完成 |
| **P21.5** | 量产编排器 + `production_packages` 聚合 | 21.A/21.C | ✅ 完成（`task-dispatcher.ts` `createProductionPackagesFromPlan`） |
| **P21.6** | Token 预算治理 + 熔断（叠在 `deductMtc` 上，月度成本上限） | 21.D | 📋 |
| **P21.7** | 发布 + 飞轮 outcome 回流接线 | 21.C | 📋 |
| **P21.8** | FDE 触发 UI（内部一键量产） | 21.A | 📋 |
| **P21.9** | CTS + Oztop 端到端 MVP 验收 | — | 📋 |

**里程碑关卡（不过不许往下，PM 验证）**：
- **M1 产能内核**（P21.1-2）：`npm run build` 通过 + 单测证明 Sonnet/Haiku 分层路由 + 记忆注入生效
- **M2 扇出闭环**（P21.3-5）：本地 dev 触发一个主题 → 生成多平台变体 → 落生产包
- **M3 端到端飞轮**（P21.6-9）：CTS/Oztop 真实跑出 20-30 帖 → 发布 → 飞轮 outcome 卡片 + MTC 扣费正确

**Git 工作流**：每子任务 1 commit 带 `[P21.x]` tag；M3 全过后一次性开 PR；分支 `feat/phase-21-ai-factory`（本 chore 登记走 `chore/roadmap-phase-21-registration`，已在 worktree 分支 `claude/objective-galileo-a1decb` 上）。

### Phase 21 不做清单（MVP 边界 — 控制工作量）
- ❌ MVP 不接 Meta/TikTok/YouTube 直连 API（先走已有 Publer 管道，省去 rate limit/审核地狱）
- ❌ MVP 不追 800-1100/月满产能（先 20-30/周证明闭环）
- ❌ MVP 不做 50×100 素材规模化（先跑通单素材 → 多变体路径）
- ❌ MVP 不做非 FDE 自助 UI（先 FDE 内部触发）
- ❌ 不强制非 FDE 客户走 AI Factory（按 token 自由调用）
- ❌ 不脱离 Data Engine 单独跑（Factory 是生产，Data 是反馈，必须双引擎并行）

---

## Phase 22 — Data Intelligence Engine（旗舰能力 · 与 AI Factory 同级别双引擎）📋 战略确认，待排期

> **登记日期**：2026-05-26 · **状态**：战略方向已确认，PM 明确为"与 AI Factory 同等量级独立旗舰"
>
> **战略定位**：Data Engine 不是 AI Factory 的子模块，是 ME 商业护城河的**双引擎之一**。AI Factory 解决"产出"，Data Engine 解决"学习"。两者结合 = 自强化飞轮。
>
> **覆盖范围**：6 大功能支柱全覆盖（SEO / GEO / Ads / Social / Reputation / Competitor），不限于 AI Factory 产出的内容。

### Phase 22 三层架构

| 层 | 职责 | 数据源 |
|---|---|---|
| **22.A 采集层** | 持续抓取所有执行产出的真实表现数据 | FB/IG Graph API · TikTok Insights · YouTube Analytics · DataForSEO · AI Tracker · GBP · Trustpilot |
| **22.B 分析层** | 归类、归因、学习、异常检测 | 哪种 hook 跑赢、哪个时段最优、哪类客户对哪种角度敏感 |
| **22.C 反馈层** | 把学习结果回流到执行决策 | → AI Factory（生成什么内容）· → FDE 仪表盘 · → 客户 Portal 月报 |

### Phase 22 与 AI Factory 的关系

```
AI Content Factory  ──生产──→  内容产出  ──发布──→  各平台
                                                       │
                                                       │ 抓取
                                                       ▼
AI Content Factory  ←──反馈──  Data Engine  ←──分析──  原始数据
（下一波次生成时         （22.C 反馈层）      （22.A 采集 + 22.B 分析）
 注入获胜角度）
```

### Phase 22 客户分层

- **FDE 客户**：完整 Data Engine 能力（采集 + 分析 + 反馈 + 仪表盘 + 月报）
- **非 FDE 客户（MTC）**：只看摘要级指标，不享受反馈层

### Phase 22 不做清单
- ❌ 不依赖第三方仪表盘（Looker、Tableau 等）— 数据归属 ME 是核心护城河
- ❌ 不只服务 AI Factory 产出 — 6 大支柱所有执行都要被采集和学习

### Phase 22.D — 主动任务生成器（AnomalyDetector + 诸葛亮 Proactive）📋 待开发

> **登记日期**：2026-05-28 · **前置**：Phase 22.A/B 数据采集在跑
>
> **架构**（两层分离，职责不混淆）：
> - **第一层 AnomalyDetectorJob**（纯规则，每日 cron，无 AI）：扫描 `flywheel_metrics`，输出标准化 `AnomalySignal`
> - **第二层 POST /api/ai/zhugeliang/proactive**（诸葛亮判断）：决策是否打扰客户、生成什么任务
> - 输出写入 `flywheel_actions(source: "proactive_signal")`，看板显示 ⚡ 系统检测 badge

**内置检测规则（MVP）：**

| 飞轮 | 指标 | 阈值 | Severity |
|------|------|------|---------|
| SEO | avg_position | 下跌 > 5 位（连续 3 天）| high |
| GEO | ai_visibility_score | 下降 > 15% | high |
| Ads | Meta CPA | 上涨 > 30%（环比）| high |
| Social | engagement_rate | 下降 > 40%（环比）| medium |
| SEO | total_clicks | 下降 > 20%（周环比）| medium |

**子任务：**
- `22.D.1` anomaly_signals 表 migration + AnomalyDetectorJob 规则引擎骨架 (~1 天)
- `22.D.2` POST /api/ai/zhugeliang/proactive endpoint (~1 天)
- `22.D.3` /api/cron/anomaly-detector cron route (~0.5 天)
- `22.D.4` 看板 UI：主动任务显示 ⚡ 系统检测 badge (~0.5 天)

---

## Phase 23 — Cross-Agent Memory Layer（旗舰能力 · 升级自 Phase 8.M）📋 战略确认，待排期

> **登记日期**：2026-05-26 · **状态**：战略方向已确认，由旧 Phase 8.M 升级整合，PM 拍板
>
> **战略定位**：ME 三大旗舰能力之一（生产 Phase 21 + 学习 Phase 22 + 记忆 Phase 23）。让 ME 从"每次重新生成的工具"升级为"每客户持续学习的共生体"，定义 FDE 服务的真正壁垒。
>
> **背景**：2025 年原 Phase 8.M 是"建一个 Marketing Agent 加记忆"的单 Agent 思路。2026 重新定义为**跨 Agent 共享记忆层**（L3 长期学习），整合现有的 L1/L2 记忆机制。

### Phase 23 现状盘点（code audit 2026-05-26）

**已存在的 L1/L2 记忆基础设施（无需重建）：**

| 层次 | 机制 | 代码位置 | 状态 |
|---|---|---|---|
| L1 工作记忆 | `luban_messages`（per-execution-item chat） | `src/lib/luban/agent.ts` | ✅ 实战使用，18 条记录 |
| L1 工作记忆 | `luban_project_messages`（project-level chat） | `src/lib/luban/project-agent.ts` | 🟡 脚手架已建，0 条记录 |
| L2 短期缓存 | `zhuge_sessions`（每次输出快照） | `src/lib/zhuge/action-persister.ts` | ✅ 写入实战，2 条记录；读取仅取"最新" |
| L3 长期学习 | — | — | ❌ **完全缺失** |
| 张骞 / 华佗记忆 | — | — | ❌ **完全无状态** |

### Phase 23 核心交付（L3 长期学习层）

**新增数据表：**
```sql
client_learned_preferences   -- FDE 标注 + 客户反馈累积
client_proven_patterns       -- 该客户跑赢过的 hook/角度/CTA
client_failed_experiments    -- 失败实验记录，避免重复犯错
client_decision_history      -- 为什么之前选 X 不选 Y
```

**喂养源（不重写采集层）：**
- Phase 22 Data Engine 输出 → 自动抽取"哪种内容跑赢"
- FDE 手动标注 UI → 让 FDE 给生成结果打"成功 / 失败 / 喜欢 / 不喜欢"标签
- flywheel_outcomes 表 → 历史结果即学习材料
- luban_messages + zhuge_sessions → 提取决策上下文

**被消费方（不改既有 prompt 结构，只增加可选注入）：**
- 张骞 (`src/lib/zhangqian/agent.ts`)：新增 memory 注入入口
- 华佗（diagnostic）：新增 memory 注入入口
- 诸葛亮 (`src/lib/zhuge/`)：增强 buildUserPrompt 注入历史决策
- 鲁班 (`src/lib/luban/agent.ts`)：从 per-execution chat 升级为 cross-execution 学习
- Phase 21 AI Factory：生成时注入"该客户的获胜模式"

### Phase 23 五个子任务

| 子任务 | 内容 | 工作量 | 状态 |
|---|---|---|---|
| 23.A | 4 张新表 migration + Memory Service 接口层 | ~3 天 | ✅ 完成 2026-06-10 |
| 23.B | FDE 标注 UI（执行看板 TaskDetailDrawer 内嵌：好模式/失败记录/偏好三类） | ~2 天 | ✅ 完成 2026-06-10 |
| 23.C | 自动抽取器：从 flywheel_outcomes + Data Engine 输出抽取 learned_preferences | ~3 天 | ✅ 完成 2026-06-10 |
| 23.D | **诸葛亮**记忆注入（memoryContext 注入 prompt；decision_history 自动写入） | ~1 天 | ✅ 完成 2026-06-10 |
| 23.D.2 | **张骞 / 华佗 / 鲁班** 记忆注入 + 共享 `formatMemoryForPrompt`（AI Factory 待 Phase 21 落地） | ~1 天 | ✅ 完成 2026-06-10 |
| 23.E | Memory 浏览/编辑/导出（FDE 可看到客户的累积记忆，可纠正可清除） | ~2 天 | ✅ 完成 2026-06-10 |

> **注**：23.D + 23.D.2 已覆盖现有四 Agent（张骞 / 华佗 / 诸葛亮 / 鲁班）；AI Factory 是 Phase 21 才开工的旗舰能力，等其代码落地后再加注入（用同一个 `formatMemoryForPrompt`）。

**总工作量预估：~13 天 / 2-3 周**

### Phase 23 与现有代码的兼容性（已审计 ✅）

| 维度 | 状态 |
|---|---|
| 不删除任何现有表 | ✅ |
| 不改现有 agent 函数签名 | ✅（注入为可选参数） |
| `luban_messages` | ✅ 保留并复用为 L3 数据源 |
| `luban_project_messages` | ✅ 启用并喂养 L3 |
| `zhuge_sessions` | ✅ 保留并扩展（不再只取最新，而是聚合学习） |
| `master_briefs` | ✅ 不动（DNA 静态 vs Memory 动态，分工不重叠） |
| `content_strategy_items` | ✅ 作为 Memory 的输入之一 |
| `flywheel_*` 三表 | ✅ 作为 Memory 的核心喂养源 |
| `generation_context_snapshot` | ✅ 作为 Memory 的细粒度证据 |

### Phase 23 不做清单
- ❌ 不重写 luban/zhuge 现有记忆机制（向后兼容）
- ❌ 不让 Memory 自动覆盖 Master Brief（DNA 由 FDE 显式维护）
- ❌ 不向客户暴露原始 Memory（仅 FDE 可见和编辑）
- ❌ 不依赖第三方向量数据库（pgvector 已够用，避免供应商绑定）

### Phase 23 与 Phase 21/22 的协同关系

```
        Phase 23 Memory Layer
        ┌─────────────────────────────┐
        │ L3 长期学习                  │
        │ ├─ 偏好 ├─ 模式             │
        │ ├─ 失败 ├─ 决策              │
        └────┬──────────────────┬─────┘
             │ 读              │ 写
             ▼                  ▲
   Phase 21 AI Factory  ←──  Phase 22 Data Engine
   （生成时注入获胜模式）    （从执行结果抽取学习信号）
             │
             ▼
         产出更聪明的内容 → 飞轮自强化
```

---

## Phase 26 — Client Locale Intelligence（客户地域智能层）✅ 已完成

> **完成日期**：2026-06-12 · **状态**：✅ 全部完成

**核心功能**：为每个客户添加地域层级数据（国家 → 州/省 → 城市三层）+ 业务服务范围 + AU/NZ 节假日日历注入，使 AI 内容生成自动携带正确的地域信号。

### Phase 26 任务清单

- [x] **P26.1** — DB migration：`clients` 表加 `locale_country / locale_state / locale_city / service_regions TEXT[]`
- [x] **P26.2** — 节假日日历表 `locale_holidays` + AU/NZ 公共假日种子数据
- [x] **P26.3** — 地域信号注入博客/社媒内容生成 prompt（"This is an [city] business serving [regions]…"）
- [x] **P26.4** — FDE Dashboard 客户档案页「地域设置」编辑 UI
- [x] **P26.5** — AI Tracker 问句自动带地域标签（"best X in [city]"）
- [x] **P26.6** — GEO Composer 指令自动注入地域信号（`Audience: [city] travelers`）
- [x] **P26.7** — SerpAPI 调用自动带 `gl=au/nz` + `location=[city, country]`
- [x] **P26.8** — 节假日日历：内容生成时检测近 14 天节假日并注入「节日相关性提示」

---

## Phase 27 — Visual Reference Library（视觉参考库）📋 已登记，待开发

> **登记日期**：2026-06-12 · **状态**：待实施

**产品定位**：图像版 viral analyzer。ME 目前有「视频爆款分析」能力（Phase 8.R / Phase 22.B），但缺少图像层面的参考积累。Visual Reference Library 让 FDE 上传竞品/客户/行业优质图片，AI 分析提取视觉模式（配色、构图、元素类型），形成可检索的视觉知识库，驱动后续图片/封面生成。

**与 AI Factory 的关系**：Phase 27 是 Phase 21（AI 内容工厂）的上游数据 — 工厂生产图片时，从 Visual Reference Library 抽取视觉风格约束，提升生成质量。

### 数据模型

```sql
CREATE TABLE visual_reference_library (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id),
  source            TEXT NOT NULL CHECK (source IN ('fde_upload', 'client_provided', 'competitor_crawl')),
  storage_url       TEXT NOT NULL,
  industry_tags     TEXT[] NOT NULL DEFAULT '{}',
  visual_attributes JSONB,   -- { colors: [], composition: '', elements: [], style: '' }
  viral_score       NUMERIC(4,2),
  analyzed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Phase 27 任务清单

- [ ] **P27.1** — DB migration：`visual_reference_library` 表
- [ ] **P27.2** — FDE 上传 UI：Assets 页面「参考库」标签，支持批量上传 + 标注来源（FDE/客户/竞品）
- [ ] **P27.3** — GPT-4o Vision 分析管道：提取配色 + 构图 + 元素类型 + 风格标签
- [ ] **P27.4** — 行业标签过滤 + 相似图搜索（pgvector embedding）
- [ ] **P27.5** — 视觉得分：参考 viral_score 逻辑，给每张图打 1-10 分
- [ ] **P27.6** — 竞品爬取接入：URL 输入 → Jina.ai 抓取 OG 图 → 自动入库分析
- [ ] **P27.7** — AI Factory 注入：图片/封面生成时，从参考库取 top-3 相似风格约束注入 prompt
- [ ] **P27.8** — 参考库浏览 UI：瀑布流展示 + 筛选 + 得分排序 + 删除

---

## Phase 28 — FDE Inbox（待处理收件箱）📋 已登记 · ⚠️ 待并入 Phase 20.D（统一看板扩展）

> **登记日期**：2026-06-12 · **状态**：待实施 · **注意**：本 Phase 应并入 Phase 20.D 子任务，不单独立 Phase

**问题根源**：Magic Engine 的内容产出来源越来越多——素材库发来的视频草稿、诸葛亮新增的执行项、博客/社媒内容自动生成完成……这些「系统自动创建、尚未被人工确认」的条目，目前分散在各个模块角落，FDE 需要翻遍整个看板才能找到待处理的新内容。随着 Phase 21 AI Factory 量产能力上线，这个问题会更严重。

**核心设计**：在执行看板顶部增加「📥 待处理」收件箱区域，聚合所有 `reviewed_at IS NULL` 的新建条目，时间倒序排列，FDE 处理后从收件箱消失归入对应列。

### 统一的「未读」字段

所有产物表统一加一列：

```sql
ALTER TABLE reels_drafts    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE blog_posts      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE content_posts   ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE execution_items ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
```

**收件箱查询** = `reviewed_at IS NULL AND created_at > NOW() - INTERVAL '7 days'`

**FDE 点开处理** → PATCH `reviewed_at = NOW()` → 条目从收件箱消失

### 收件箱内容来源

| 来源 | 条目类型 | 触发时机 |
|------|---------|---------|
| 素材库「发送到看板」 | 视频草稿 | 点击「发送到内容看板」按钮 |
| 诸葛亮处方 | 执行项 | 处方首次生成时 |
| AI Factory 批量生成 | 博客 / 社媒内容 | 内容生成完成后 |
| 飞轮自动建议 | 执行项 | AnomalyDetector 触发（Phase 22.D）|

### Phase 28 任务清单（待并入 Phase 20.D）

- [ ] **P28.1** — DB migration：4 张产物表各加 `reviewed_at TIMESTAMPTZ`
- [ ] **P28.2** — 执行看板顶部「📥 待处理」收件箱区域 UI（聚合查询 + 时间倒序）
- [ ] **P28.3** — 收件箱条目点击展开 + 「标记已读」动作（PATCH reviewed_at）
- [ ] **P28.4** — 「发送到看板」后写入 reviewed_at=NULL（已是默认，确认 reels_drafts 行为）
- [ ] **P28.5** — 收件箱 badge 计数：侧边栏「执行看板」入口显示未读数

---

## 9. 功能完成日志

### 2026-05-31（Phase 18.A — Meta Ads 执行引擎 ✅ 完成 + ±20% 安全闸补齐）

- **盘点确认** — P18.A.1/2/3 代码早已建成（execute / actions / sync / snapshots 路由 + AdsFixDrawer + AdsAuditSection，均已接线执行看板），属 ROADMAP 漏勾的 drift
- **P18.A.2 安全闸补齐** — 预算调整加 ±20% 硬限：纯函数 `lib/meta/guardrails.ts`（12 单测全绿），execute 路由服务端强拦超限（422 + Talk to Us 文案），AdsFixDrawer 加区间提示 + 超限友好报错

### 2026-05-31（Phase 21 MVP 计划登记 + 21.B 视觉素材层补登记）

- **chore** — 盘点代码后确认 Phase 21 大部分积木已存在，真正缺 3 块连接组织（模型分层路由 / 变体扇出 reformat / 量产编排+熔断）；原五大子系统拆成 P21.1-9 可执行子任务 + MVP 垂直闭环 + M1/M2/M3 里程碑写入 ROADMAP
- **P21.1** — `MODEL_HAIKU` 常量 + `src/lib/ai/model-router.ts`（routeModel / calcCost，strategy→Sonnet / production→Haiku，11 单测全绿）
- **P21.2** — `src/lib/ai-factory/`（types / prompts / generator / index）；runFactoryJob 接 loadMemoryForClient + formatMemoryForPrompt；production 档位 Haiku；19 单测全绿，类型零错误。M1 产能内核完成
- **21.B 视觉素材智能层补登记** — `client_assets`+`asset_storyboards` 表、vision-analyzer cron、assets/storyboard API、素材库 UI 早已建成但从未登记（migration `20260612000001`）；⚠️ DB 是否已 apply 待 PM 在 Supabase 确认

### 2026-05-31（Phase 21 P21.4 — ai_factory intensity 档位 ✅）

- **P21.4** — Marketing Plan 加第 4 档强度 `ai_factory`（全速量产）：`types.ts` 联合类型 + `generator.ts` 新 cadence 分支（posts 7-8/周，对齐 MVP 20-30/周上限）+ `PlanGenerator.tsx` UI 加「AI 工厂」按钮（grid 3→4 列）；编译通过

### 2026-05-31（Phase 21 P21.3 — 变体扇出 + 多平台 reformat 引擎 ✅）

- **P21.3** — `fan-out.ts`（fanOutToPlatforms，Promise.allSettled 并发，单平台失败不阻断）+ `reformat.ts`（reformatForPlatform，Haiku reformat，5 平台专属格式规则）；22 单测全绿，TypeScript 零新增错误

### 2026-05-31（Phase 19.F — 修复 Phase 20.D 引入的鉴权回归）

- **P19.F** — `execution/manual` 路由换 `requireDashboardClientAccess`；`FdeManualEntryModal` 去掉 `NEXT_PUBLIC_INTERNAL_API_KEY`/`Authorization` 头，改走 session cookie（IDOR + 凭证泄漏双修）

### 2026-05-29（Phase 24.A — Platform OAuth Connector 全部完成 8/8）

- **P24.A.1** — DB migration `platform_oauth_connections` + vocabulary layer（类型、常量、`toConnectionSummary`）
- **P24.A.2** — Token Manager：`getValidToken` auto-refresh + `markConnectionError` + 自定义异常类
- **P24.A.3** — OAuth start 路由：CSRF state cookie（nonce:clientId，HttpOnly，SameSite=Lax，600s），302 → Google
- **P24.A.4** — OAuth callback 路由：CSRF 验证 + token 交换 + GBP 账户 API + 加密存储 + 清 cookie + 302 → settings
- **P24.A.5** — Connection Store CRUD：`upsertConnection` / `revokeConnection` / `listConnections` / `getConnectionById`
- **P24.A.6** — Client API `GET+DELETE /api/clients/[id]/platform/gbp`（列出 + 撤销，含租户隔离校验）
- **P24.A.7** — Settings 页面 `/dashboard/clients/[id]/settings` + SettingsDrawer 「平台连接」Tab
- **P24.A.8** — GbpPanel 5 态 UI（loading / error / disconnected / needs_reconnect / connected）；80 tests 全绿 PR #125

### 2026-05-29（Phase 14.C — SEO 生产期稳定性 + 飞轮闭环 全部完成 6/6）

- **P14.C.6** — GitHub PR merge webhook：HMAC 验签 + 回填 published_at + 自动 GSC 索引
- **P14.C.5** — 飞轮闭环：SEO outcome 按 content_mode 聚合，scorer 按历史成功率 +2/+6/+10 boost
- **P14.C.4** — JSON-LD BlogPosting schema 注入 WP/Shopify/GitHub 三条发布路径
- **P14.C.3** — 「重新生成策略」加 (client_id, proposed_title) unique index，upsert ignoreDuplicates
- **P14.C.2** — 看板「忽略」按钮持久化到 DB（PATCH status='dismissed' + 乐观更新 + 回滚）
- **P14.C.1** — blog `status='generating'` 殭尸状态自愈 cron（每 5 分钟扫 > 10 分钟标 failed）

### 2026-05-30（Phase 14.B — WP 发布质量改进 7 项）

- **P14.B.1–7 全部完成（PR #120）** — Yoast 探测+mu-plugin snippet、rollback 草稿、GEO 城市一致性、内链 QC check、primary_keyword 警告、WP 默认分类 ID、GSC 索引请求按钮

- **P23.E** — Memory 浏览/编辑/导出：FDE 仪表盘新增「客户记忆库」页（四 tab + 行级编辑 + 抽取 + 导出 JSON）
- **P23.C** — L3 记忆自动抽取器：从 flywheel_outcomes 推导 patterns/failed/preferences + 回填 decision_history
- **P23.D.2** — 张骞/华佗/鲁班三 Agent 注入 L3 记忆 + 共享 `formatMemoryForPrompt`，AI Factory 待 Phase 21
- **P23.B** — FDE 标注 UI：执行看板抽屉一键标记好模式/失败/偏好，落 L3 记忆三张表
- **P23.A+D** — L3 记忆层地基：4 张新表 + MemoryService + 诸葛亮 prompt 注入 + 决策历史自动写入
- **P13.UI.3** — Website homepage upgraded to shared UI language
- **P13.A.7** — Portal magic link can reach client portal

### 2026-05-28（Phase 20.D — 六支柱统一看板入口）

- **Phase 20.0 P20.0.7-9 完整** — Portal 三只读页：Diagnosis（六维评分卡+findings）、Prescription（处方摘要+KPI+分阶段行动）、Plan（执行进度按维度分组），互相 CTA 串联成 Discovery→Diagnosis→Prescription→Plan 闭环
- **Phase 20.0 P20.0.1-6 实施完成** — 打通陌生人自助入会漏斗：migration 加 `client_id` FK、`POST /api/onboard/self` 建 clients 行并写 client_discovery/portal_users、`/prospect` 加 ClaimWorkspace CTA、Portal Discovery 页面（服务端组件复用 ReportView）+ PortalNav Discovery 导航项 + 概览页 Discovery 摘要卡含四项评分
- **Phase 20.D 实施完成** — 执行看板新增「＋ 录入工作」统一入口（FDE 可从任意支柱直接录入工作，不绑定处方/Marketing Plan）；migration `20260603000001` 添加 `fde_manual` 来源；`FdeManualEntryModal` 组件；看板新增「📝 FDE 录入工作」分组（平铺 + 拖拽排序）；客户 Portal 新增「Active execution work」按支柱分组展示（透明度闭环）；`PlanTask.requires` 素材依赖标注（none/client_photo/client_video/client_info）；Phase 编号修正：Phase 24→Phase 20.D、Phase 22 明确为 Data Intelligence Engine、新增 Phase 22.D 主动任务生成器
- **ROADMAP 编号修正登记** — 文档化 Phase 24/22/22.D/23 正式命名，与 ME_Kanban_Evolution_Final.docx 保持一致

- **P13.UI.19** — Execution detail status menu is now contained inside the right-side FDE drawer instead of using a body-level floating portal over the board.

### 2026-05-27（OzTop 技术 SEO 修复 + FDE 看板需求登记）

- **OzTop Yoast 归档页 noindex 批量修复** — FDE 执行；在 oztopbuildingsupplies.com.au WP 后台完成 11 项 Taxonomy/Archive 关闭操作，预计消灭 150–180 个「已抓取未收录」URL（原计 211 个）：Tags ✅ Product tags ✅ Categories ✅ Product categories ✅ Brands ×2 ✅ Product Colour ✅ Product Flooring Colours ✅ Product shipping classes ✅ Author archives ✅ Date archives ✅ Format archives ✅ Media pages ✅；llms.txt 确认已开启（GEO 信号激活）
- **发现：Brands 分类重复** — 站点同时安装两个 Brand 插件，生成 `/brand/` 和 `/brands/` 两套重复 URL；两者均已 noindex，但需在下一次 FDE 会话清理重复插件并做 301 合并
- **新需求登记 `FDE-KANBAN-1`** — 技术 SEO 执行任务缺乏看板归宿：诊断引擎发现的技术 SEO findings（noindex 问题、robots.txt 泄漏、sitemap 异常等）当前不会自动生成看板卡片；FDE 执行的技术 SEO 工作只能手动记录 ROADMAP，无法与 Marketing Plan 内容任务在同一看板追踪。**需求**：SEO 诊断 findings → 自动生成 `task_type: technical_seo` 看板任务，与内容任务并排显示；待排入 Phase 12.I 或 Phase 15 SEO 执行闭环

### 2026-05-26（Oztop 手动发布 + Site Knowledge Graph 设计）

- **Oztop Pet Flooring 发布** — 手动发布「Pet Friendly Flooring in Brisbane」至 oztopbuildingsupplies.com.au；确认 SiteGround IP 封锁根因（nginx ipr 封 Render IP 74.220.48.245）；修复 Astra 全大写 CSS；修正 GEO 指令 Sydney→Brisbane 6 处；Yoast SEO 配置完成（focus keyphrase / SEO title / slug / meta description）；Google Search Console 提交收录；已发布 URL：`/pet-friendly-flooring-brisbane/`
- **Phase 14.F 登记** — 客户网站知识图谱（Site Knowledge Graph）：ME 生成博客缺内链根因确认 → 设计 `client_site_pages` 表 + sitemap 爬取流程 + 博客生成集成点；Oztop 38 个产品分类 URL 已首次爬取记录
- **Marketing Plan UX 两个待修 Bug**（Oztop 清仓 campaign 配置时发现）：
  - `MP-UX-1` Marketing Plan 日期应从关联 Campaign 自动继承（当前需手动填，无场景需求差异化）；选了 Campaign 后字段应只读或锁定到 Campaign 周期内
  - `MP-UX-2` Marketing Plan「FDE 关注点」缺 AI Generate 按钮；应基于 MB + Campaign + 上传文件自动起草，类似 Visual Direction 的体验；降低 FDE 起草门槛
- **Marketing Plan 生成质量三个根因 Bug**（Oztop 清仓 Plan 输出后发现，根因已定位至 `src/lib/marketing-plan/generator.ts`）：
  - `MP-GEN-1` 内容强度参数过于模糊：`intensity === 'aggressive'` 只是单句 prompt 提示「high volume, accept some lower-quality tasks」，没有给 Claude 具体数量基准。应改为：light=2-3/周，standard=4-6/周，aggressive=8-12/周，且按 campaign 类型（清仓/launch/sustain）有不同 baseline
  - `MP-GEN-2` System prompt 有「prefer fewer high-quality tasks」一句话，导致 Claude 识别到"premium positioning"就自动降量，与清仓/促销场景直接冲突，导致博客 monthly_count 永远偏低（Oztop 5 周清仓只生成 1 篇博客）。应根据 campaign 类型动态调整该指令
  - `MP-GEN-3` ⚠️ **viral_reference_library 表完全未被引用** — `generate/route.ts` 只读 master_briefs / campaign_briefs / content_strategy_items 三张表，Viral Reference 数据虽然采集了但从未注入 Marketing Plan 生成。应在 Reel 任务生成时拉取行业相关的爆款 hook 结构，注入 prompt 让 Claude 借鉴而非通用模板
- **Marketing Plan 架构级洞察 — 波次执行模型**（PM 现场提出，2026-05-26）：
  - `MP-ARCH-1` ⚡ ME 当前是「一次性生成 5 周 33 任务」的预生成模型，与真实 marketing manager 工作方式背离。专业营销人的实际流程是：① 策略层（5周方向 + KPI + 渠道骨架，固定）② 波次层（1-2 周详细任务，迭代式生成）③ 波次结束后收集真实数据/反馈 → 重新生成下一波次任务
  - 当前模型问题：Week 5 任务在 Week 1 就写死，5 周内无法响应实际数据；浪费 LLM token 生成大概率会被改写的远期任务；FDE 拿到 33 个任务批量派发，与"先验证再投入"的现代营销原则冲突
  - 改造方向：Plan 保留策略层（exec summary + KPI + 社媒矩阵规格）；Tasks 字段从「全期任务」改为「当前波次任务」；新增「波次复盘 → 下一波次生成」按钮；后端在生成下一波次时注入上一波次的真实表现数据
  - 优先级比 MP-GEN-1/2/3 更根本，建议升级为独立 Phase（Phase 12.W 波次执行模型 或并入 Phase 8.M Marketing Agent 记忆系统），2-3 周内落地
- **Campaign 字段注入缺口两个 Bug**（Oztop 清仓配置时 PM 现场审计 `campaign-injector.ts` 发现，2026-05-26）：
  - `MP-GEN-4` ⚠️ **Visual Direction（vi_mood / vi_color_accent / vi_specific_dos / vi_specific_donts / vi_reference_note）完全未被注入 prompt** — 这些字段只在 UI 面板和 AI Generate 按钮里使用，`src/lib/content/campaign-injector.ts` 的 `formatCampaignForPrompt` 没有引用，因此 Marketing Plan 生成的任务 description 完全不知道这次活动的视觉方向。FDE 即使在 ME 里精心填写 Visual Direction（或点 AI Generate 让 ME 自动起草），生成的社媒任务 description 里也不会出现"深胡桃木色 + 浅墙 + 黄铜灯具"等关键视觉指令。**Visual Direction 当前是死端输入**。修复：在 `formatCampaignForPrompt` 添加 vi_* 字段块；下游 Reel/Post/Story 任务的视觉相关描述应受其约束。同时该数据应注入到 Phase 21 AI Factory 的图片/视频生成 prompt（更关键）
  - `MP-GEN-5` Campaign 的产品/落地页 URL（source_urls）也未被注入 prompt — Marketing Plan 任务即使提到产品也不知道客户网站的对应产品页 URL，无法生成内链锚点。修复：在 prompt 注入产品页清单，让 Claude 在任务 description 里使用（与 Phase 14.G Site Knowledge Graph 协同）

> 每次上线新功能时在此追加。格式：**[完成日期]** — Phase ID + 描述 + Commit 引用。
> 此日志从 CLAUDE.md §十五.C 迁移至此（2026-05-10），CLAUDE.md 不再维护历史日志。

### 2026-06-05

- **P17.A.4** — GSC 归因桥接：`gsc-bridge.ts`（runGscAttributionForClient：SEO action → GSC before/after → 3 维 flywheel_outcomes）+ POST `/flywheel/gsc-attribution` + vocabulary 扩充 3 GSC metric keys + attribution cron pass-2 接线 [P17.A.4]
- **P17.A.5** — 每日 Google 数据回流 cron：`google-data-pullback-daily`（遍历所有已连接 GSC/GA4 connector，自动快照写库）+ render.yaml 注册（每天 3am UTC）[P17.A.4]

### 2026-05-27

- **P17.A.6** — 客户主页「数据」tab：三 tab 切换器（概览/数据/工具）+ `ClientDataTab`（GSC 4 指标格 + top-10 关键词表、GA4 4 指标格 + top-10 来源/页面表、快速夺旗机会清单 position>10 && impressions>50） [feat/phase-17-a6-data-tab, PR #93]
- **P17.A.3** — GSC/GA4 快照 UI：`DataPullbackSection`（执行看板数据回流卡）+ connector 详情页「立即同步」按钮 + 快照指标预览 [feat/phase-17-a-gsc-pullback]
- **P13.UI.17** — Inline prescription supplement/revision drawer upgraded to the shared right-rail shell with stronger overlay layering, contained scrolling, and refreshed Magic Engine controls.
- **P13.UI.18** — Zhangqian customer-facing discovery report gained Save PDF + DOCX downloads; DOCX export refreshed into Magic Engine deliverable language and dashboard Zhangqian export controls aligned.

### 2026-06-04

- **P17.A.2** — GA4 数据回流：`GA4_SCOPE`/`COMBINED_GOOGLE_SCOPES` + `buildAuthUrl` scopes 参数 + `fetchGa4Snapshot()` 3 并行报告 + 新表 `ga4_traffic_snapshots` + POST `/ga4/sync` + GET `/ga4/snapshots` [feat/phase-17-a-gsc-pullback]

### 2026-06-03

- **P17.A.1** — GSC 数据回流基础设施：新表 `gsc_performance_snapshots`（含 top_queries/pages JSONB）+ `fetchGscSnapshot()` 并行拉取两维度 + POST `/gsc/sync` + GET `/gsc/snapshots` [feat/phase-17-a-gsc-pullback]

### 2026-05-20

- **UX 基础修复（两个 session）** — 全站标题 CrazyContent→Magic Engine；login-form try/finally 防卡死；BriefSourcesForm/zhangqian cards/Step2BriefUpload 客户可见供应商名替换；ContentHub 移除内嵌 Reels/图片 子Tab 改跳转快捷卡；客户页新增 WorkflowProgress（张骞→MB→执行）进度条；SEO 页标题/注释去 SEMrush 改 Keyword Intelligence（commits 34fe7fb, e7b2aff）
- **架构确认：四 Agent 链 + 诸葛亮命名** — C Agent 正式命名为「诸葛亮」（策略调度引擎）；确认定位：输入张骞证据+华佗诊断→输出 priority_actions→flywheel_actions，不直接执行；AI 抽屉为 UX 层（正交），首页驾驶舱与鲁班看板为两个缩放层级（不冲突）；登记为 Phase 12.G（接口规范已确认）
- **P8.3.2 代码收尾** — login try-catch 修复；middleware+whitelist 测试已在代码库；**剩余 PM 操作**：Render 后台填 `ADMIN_EMAILS=你的邮箱` + Supabase Auth Redirect URLs 加 `/auth/callback`

### 2026-05-31（Phase 14.A — Website Connector，插队 13.A）

- **P14.A.1** — 扩展 `cms_connections` 表加 WP 形态（`site_url`/`username`，per-provider CHECK），新增 `CMS_PROVIDER.WORDPRESS` + `WordpressConnectionStatus` 类型；复用已有 AES-256-GCM crypto（`CMS_TOKEN_ENCRYPTION_KEY`）零新代码；migration `20260531000001_cms_connections_wordpress.sql`
- **P14.A.2** — `website_publish_jobs` 表（FK 到 `cms_connections`），4 态状态机 CHECK（draft/published/failed/rolled_back）、`(connection_id, idempotency_key)` UNIQUE 防重复推送、SHA-256 `payload_hash`、`content_snapshot` JSON 快照；配套 `src/lib/website-publish/vocabulary.ts` 提供 `canTransition` / `payloadHash`（canonical JSON，键序无关）/ `buildIdempotencyKey`，9 个单测全绿；migration `20260531000002_website_publish_jobs.sql`
- **P14.A.3** — 客户设置抽屉「🔗 网站连接」标签升级多供应商 Tab（GitHub 现状保留 / WordPress 全功能上线 / Shopify「即将推出」占位）；新 `src/lib/cms/url-guard.ts` HTTPS+公网域名校验（拒绝 IP 字面量 / 私网 / IPv6 / `.local`/`.internal`/单标签主机），39 单测全绿；`connection-store.ts` 加 wordpress 系列函数（upsert/get-status/get（含解密 server-only）/delete）；新 `/api/clients/[id]/cms/wordpress` GET/POST/DELETE（INTERNAL_API_KEY 鉴权、site_url 保存时再校验、用户输入错误透传 UI、DB 错误吞掉）；Application Password 走现有 AES-256-GCM crypto，仅显示末四位。Test/Publish 留 P14.A.5（UI 已加 amber 提示）

### 2026-05-25（Phase 13.A — Prospect 注册流程）

- **P13.A.1（去 Apify）** — `agent.ts` 移除 `scrapeInstagramProfile`/`scrapeTiktokProfile` import + `FETCH_SOCIAL_METRICS_TOOL` + `handleFetchSocialMetrics()`；从 tools 数组和 switch case 中删除；社媒指标改由 web_search + fetch_url（Jina）原生发现；零外部 API 调用
- **P13.A.2（register API）** — 新建 `POST /api/discover/register`：validate → rate-limit → save discovery_leads → create public_scan_jobs → fire background Zhang Qian scan → `supabaseAdmin.auth.signInWithOtp(shouldCreateUser:true)` 发 magic link（redirectTo=/auth/callback?next=/prospect）→ 返回 202
- **P13.A.3（/discover 改版）** — `/discover` 表单切换到 `/api/discover/register`；成功后展示「Check your email」确认屏（不再跳扫描进度页）；移除 `useRouter` 依赖；按钮文案更新
- **P13.A.4（prospect 报告看板）** — 新建 `/prospect/page.tsx`：轮询 `/api/prospect/report`（按 email 查最新 scan）→ 扫描中显示 LoadingView + 实时日志流 → 完成显示 Discovery Report（含健康评分 / 竞品 / 关键词 / 社媒评价）→ 处方区域显示 `PrescriptionGate`（Talk to Us CTA）
- **P13.A.5（prospect report API）** — 新建 `GET /api/prospect/report`：Supabase session 鉴权 → 按 user.email 查 public_scan_jobs 最新行 → 返回 status + progress_log + result
- **P13.A.6（middleware + auth callback）** — middleware 加 `/prospect` 路由块（仅验证 Supabase auth，无角色要求）；matcher 加 `/prospect/:path*`；auth/callback 加 prospect 检测（有 public_scan_jobs 记录 + 无 portal/dashboard 权限 → 重定向 /prospect）；build ✅
- **P13.A.8（admin auth priority）** — 修复 admin 邮箱同时存在 portal/prospect 关系时被客户账号抢走的问题；`ADMIN_EMAILS` 优先进入 dashboard；清理 `bigbigraydeng@gmail.com` 的 CTS portal 绑定
- **P13.UI.4** — `/discover` 升级为新版官网一致的 prospect 入口；移除真实供应商名；表单、成功页、诊断产物预览统一视觉语言
- **P13.UI.5** — `/prospect` 报告页升级：扫描中、无报告、失败、完成报告四态统一为新版 prospect-to-portal 体验；报告卡片改为浅色可读版
- **P13.UI.6** — `/portal/[clientId]` 客户端 overview、monthly report、content library 与导航升级为新版 Magic Engine client portal 视觉语言
- **P13.UI.7** — `/portal/login`、`/login` 与 admin dashboard sidebar/layout 统一为新版 Magic Engine 入口外壳；清理乱码 icon/loading 文案
- **P13.UI.8** — admin mobile shell、Content Studio drawer、Social Plan Studio 与 Reels Studio 改为响应式新版工作区；移除右侧抽屉硬宽度
- **P13.UI.9** — execution board 修复 sidebar 内部滚动条、header action 旧按钮、task detail drawer 旧样式与主内容硬挤压
- **P14.A.4（Shopify connector）** — migration 扩展 provider shape 约束加 shopify；shopify-guard（SSRF 防护 17 单测全绿）；shopify-client（Admin REST 2024-01：testConnection / listBlogs / getOrCreateDefaultBlog / createArticleDraft / publishArticle / createPageDraft / publishPage）；html-sanitizer MVP；vocabulary 加 SHOPIFY + ShopifyConnectionStatus；connection-store 加 Shopify CRUD；/cms/shopify CRUD + 保存即测 token；/cms/publish-shopify 两步 draft→publish，幂等写 website_publish_jobs；TS 零错误，17 tests ✅
- **P14.A.5（WordPress connector）** — `wordpress-client.ts`（dns.promises.lookup SSRF guard；testWordpressConnection 验证 publish role；createWordpressPostDraft/Page draft-first；publishWordpressPost/Page status='publish'）；connection-store 加 `markWordpressConnectionTested`；/cms/wordpress 升级（保存即测）；/cms/publish-wordpress（两步 draft→publish，幂等，租户隔离，sanitizeHtml）；TS 新文件零错误
- **P14.A.6（Blog Studio 三步发布 UI）** — 新 `GET /api/clients/[id]/cms/providers` 聚合三平台状态；新 `PublishToWebsitePanel` 组件（WordPress/Shopify Draft→Preview→Publish 三步，GitHub 单步 PR）；blog/[postId]/page.tsx 替换旧 GitHub-only 按钮
- **P14.A.7（html-sanitizer allowlist 升级）** — 三遍扫描：Pass1 危险块删除（script/style/iframe/form/svg/math/…）+ Pass2 标签/属性白名单重写（仅允许 ~40 安全标签，href/src 限 https?，rel=noopener 强制注入）+ Pass3 未知关闭标签清除；零外部依赖
- **P14.A.8（飞轮回写）** — WordPress + Shopify publish 路由在成功 publish 后 insert `flywheel_actions`（flywheel=seo, action_type=cms_content_insert, execution_mode=in_house）；失败仅打日志不阻断响应

### 2026-05-24

- **P8.13.A** — DataForSEO Labs 关键词+竞品接入：`labs.ts` 新建；`fetch_keyword_data` + `fetch_competitors` 两个 tool 接入张骞 agent + prompts；零幻觉替换 web_search 猜关键词/竞品 (commit 175299a)
- **P8.13.B** — DataForSEO Domain Technologies + WHOIS 接入：`domain-analytics.ts` 新建；`fetch_domain_technologies` + `fetch_domain_whois` 注册到 agent；types.ts 新增 technology_stack / domain_whois 字段；TechStackCard + DomainWhoisCard 渲染；到期 < 90 天自动 quick_fix (commit a16e0ac)
- **P8.13.C** — Business Data API 替换 SerpAPI：`business-data.ts` 新建（getGmbInfo + getGoogleReviews + getTripadvisorInfo）；local-reviews/client.ts 切换到 DataForSEO + 新增 fetchTripadvisorReviews；tripadvisor 枚举加入 types + validators + cards；agent.ts fetch_local_reviews 新增 tripadvisor_keyword 参数
- **P8.13.D** — SERP DataForSEO 主/Apify 降级 + OnPage 审计接入：`serp.ts` 新建（getSerpPage，DataForSEO 优先）；handleFetchSerpResults 更新为双层 fallback；`onpage.ts` 新建（getOnPageInstant）；FETCH_ONPAGE_AUDIT_TOOL + handleFetchOnpageAudit 接入 agent；types.ts 新增 onpage_audit 字段；OnPageAuditCard + page.tsx 渲染；prompts.ts 步骤 1 新增必调 fetch_onpage_audit 要求

### 2026-05-25

- **P12.Q.0** — 产物表加 snapshot/score 列：blog_posts / content_posts / reels_drafts 各加 generation_context_snapshot JSONB + quality_score NUMERIC(4,2)；新增 ReelsDraft interface；build ✅
- **P12.Q.1** — Campaign 上下文修复（路线 A）：campaign_briefs 加 6 nullable 字段（offer/target_audience_detail/proof_points/primary_cta/channel_goal/campaign_angle）；CampaignBrief TS 类型同步；injector formatCampaignForPrompt 注入新字段；两个 Reels 路由 select 补齐；build ✅
- **P12.Q.2** — 统一 quality rubric 模块：src/lib/content/quality-rubric.ts，6 维混合评分（规则：platform-fit/cta/dimension-goal；LLM：brand-fit/campaign-fit/specificity），SDK 由 caller 注入，14 个 Vitest 测试全通过；build ✅
- **P12.Q.3** — Blog auditBlogPost + retry：新增 quality-audit.ts 包裹器，blog route 接入最多 3 次尝试，quality_score+snapshot 写入 blog_posts；7 Vitest 测试通过；build ✅
- **P12.Q.4a** — Social Route A/C 接入 rubric：新增 social-quality-audit.ts；batch-generate 接入 generatePostWithQualityRetry（refine retry 最多 3 次，失败维度回传下轮 prompt）；quality_score+snapshot 写入 content_posts；11 Vitest 测试通过；build ✅
- **P12.Q.4b** — Social Route B 接入 rubric：social_b contentType + viral-structure-preservation advisory 维度自动注入；Promise.allSettled 非阻断 audit 两变体；quality_score+snapshot 写入 content_posts；17 Vitest 测试通过；build ✅
- **P12.Q.5** — Reels 接入 rubric：新增 src/lib/reels/quality-audit.ts（auditReelsDraft，审计 fb_caption）；generate route 接入 generateWithQualityRetry（最多 3 次，失败维度回传 qualityHint）；quality_score+snapshot 写入 reels_drafts；14 Vitest 测试通过；build ✅
- **P12.Q.6** — 验证五条链路 snapshot/score 写入：发现 Route A/C 缺 audit 逻辑；补入 auditSocialPost（Promise.allSettled 非阻断）+ quality_score/snapshot 写入；build ✅，质量测试全绿
- **P12.Q.7** — CTS Tours 端到端 demo + before/after 对比报告：五条链路（Blog / Route A / B / C / Reels）Before 均分 3.5 → After 均分 8.4（+4.9），retry 机制全部触发，5/5 链路 pass=true；generation_context_snapshot 样例写出；报告写入 `docs/clients/cts-tours/p12q-quality-demo-report.md`（M3 ✅）
  `docs(quality): P12.Q.7 — CTS Tours before/after demo report [P12.Q.7]`
- **P12.G.1** — 诸葛亮接口层：types.ts（ZhugeInput/Output/PriorityAction/BusinessContext/LubanTool）+ conductor.ts（系统 prompt + buildUserPrompt + parseOutput + conductPriorityActions）；26 Vitest 测试全通过，build ✅
  `feat(zhuge): P12.G.1 — 诸葛亮 prompt 工程 + 接口层 [P12.G.1]`
- **P12.G.2** — 诸葛亮数据接入：tools-catalog.ts（5 个 Luban 工具）+ assembler.ts（从 Supabase 聚合张骞/华佗/处方数据）+ POST /api/clients/[id]/zhuge/conduct（真实 DB 查询，422/404 优雅降级）；34 Vitest 全通过，build ✅
  `feat(zhuge): P12.G.2 — assembler + conduct API route [P12.G.2]`
- **P12.G.3** — action-persister.ts：buildSessionKey（sha256 16-char 幂等键）+ persistZhugeActions（SELECT 检查 → INSERT）；dimension→flywheel 映射，reputation/competitor 跳过；conduct route 非阻断调用，响应加 persisted 字段；12 Vitest 全通过（zhuge 49 total），build ✅
  `feat(zhuge): P12.G.3 — persist priority actions to flywheel_actions + idempotency [P12.G.3]`
- **P12.G.4** — 首页驾驶舱接入诸葛亮：GET /api/clients/[id]/zhuge/latest-actions（读最新会话）+ ZhugePriorityWidget（行动卡 + 重新计算按钮）接入 page.tsx；54 Vitest 全通过，build ✅
  `feat(zhuge): P12.G.4 — 首页驾驶舱消费诸葛亮数据 [P12.G.4]`
- **P12.G.5** — ZhugeDrawer AI 抽屉：打开自动调 conduct，展示优先行动卡，每条 in_house 行动附一键「触发鲁班」跳转按钮（luban-router.ts 纯函数解析路由）；display-constants.ts 消除 DRY；Widget 移除内嵌 conduct 改为 onAskZhuge+refreshKey；57 Vitest 全通过，build ✅
  `feat(zhuge): P12.G.5 — ZhugeDrawer + luban-router + 一键触发鲁班 [P12.G.5]`
- **Phase 8.S.1–7（补录核实）** — SEMrush→DataForSEO 关键词 API 迁移全部完成：`src/lib/dataforseo/labs.ts` 含 7 个替换函数（getRelatedKeywords/getDomainOrganicKeywords/getKeywordGap/getDomainCompetitors/getQuestionKeywords/getDomainMetrics/getDomainTrafficTrend），调用方已全部切换，节省成本 96–99%（2026-05-25 代码核实）
- **Phase 9.0.10–17（补录核实）** — Visual Queue UX 测试套件 + QueueOverviewCard 全部完成：GenerationProgress/QueueOverviewCard 测试文件存在（`src/components/visual/__tests__/`），QueueOverviewCard 已集成进 visuals/page.tsx（2026-05-25 代码核实）
- **Phase 12.H.1–3（补录核实）** — GitHub CMS 执行闭环全部完成：`blog-publisher.ts`（博客序列化→PR），Blog Studio「推送到网站」按钮，执行看板「Fix」按钮，均已实现并回写 flywheel_actions（2026-05-25 代码核实）

### 2026-05-23

- **P13.E-pre** — Competitor snapshot persistence：新增 competitor_snapshots 表（含 production_package_id FK）；competitor-keywords POST 落库 snapshot + 接受可选 production_package_id；包详情 API 回读 competitor_snapshots 数组，build ✅
- **P13.E** — Flywheel feedback 闭环：flywheel_actions 加 production_package_id FK；4 adapter execute() + ExecuteActionInput/FlywheelActionRow 类型同步；新增 package-publish.ts（dimension→flywheel 映射 + on-publish 非阻断落 flywheel_action）；PATCH /api/clients/[id]/production/[packageId] 状态更新 + publish hook，build ✅
- **P12.J.1** — 博客头图配图：新增 `/api/clients/[id]/blog/[postId]/image` 路由（gpt-image-1 16:9 + Supabase blog-hero/ 存储）+ 工作台「🖼 头图配图」面板（一键生成/重新生成/编辑提示词）+ `generateVisualBrief()` 注入 Campaign 视觉线索，build ✅
- **P12.K.1** — Campaign 视觉方向（两层视觉继承体系）：`campaign_briefs` 加 5 nullable 字段（vi_mood/vi_color_accent/vi_specific_dos/vi_specific_donts/vi_reference_note）；新增 POST `/api/clients/[id]/campaign/[campaignId]/generate-visual`（读 MB vi_* 为品牌宪法 → Claude Sonnet 生成活动专化视觉方向，仅预览不落库）；CampaignPanel 新增 VisualDirectionSection（AI 生成按钮 + 5 字段编辑 + Save 触发 PATCH）；migration 20260523000003；commit `3f4e09e`
- **P12.I.fix** — 张骞 free tier 瘦身 + 超时根治：① `prompts.ts` 移除 `诊断评分标准`/`危机类型分类` 两节（~50行）+ JSON 示例中 diagnosis 块 + 所有 `diagnosis.actions.quick_fix` 引用改为 `notes`；② `agent.ts` `CLAUDE_FINAL_TIMEOUT_MS` 240s→90s + 6 个 DataForSEO 调用加 `withTimeout(30s)` 保护；③ `status/route.ts` 错误文案 "10 min"→"6 min"；④ `page.tsx` 用「⭐ 解锁完整诊断方案」会员 CTA 替换 DiagnosisCard/ActionPlanCard，时间估计 5-8分→3-4分；build ✅；commit `b3982b5`；push → Render 已触发部署
- **PR#61 review fix (P12.I.6 前置)** — `page.tsx` 的 `GroupData` 接口新增 `editable: boolean`，将可编辑性与归账状态解耦；`PrescriptionGroup` 改用 `group.editable` 传给 `PhaseColumn`；`prescriptionGroups.map()` 显式设 `editable: !archived`。自主行动泳道 view model 只需返回 `editable: false` 即可阻断 `prescription_id="__autonomous__"` 404 路径。
- **SEO Gap 竞品数据链路三层修复** — 根因：`seo-gap/route.ts` 完全没有过滤逻辑，直接把 DataForSEO 原始竞品（含 facebook.com）用于 gap 分析，且两条路由读的是 `clients.competitor_domains`（从未被任何流程写入）而非真实数据源；三个 commit 逐层修复：① `seo-gap/route.ts` 加入 GENERIC_DOMAIN_BLOCKLIST（含旅游聚合站）+ 动态跳过 SERP 调用（已有 ≥3 known domains 时）+ 域名 normalize（去 https://、/ 后缀）commits `42c0ea5`；② 两条路由改用 `getActiveBrief()` 读 `master_briefs.competitor_domains`（张骞 + 手动补充的真实来源）commit `ae10ded`；③ `zhangqian/confirm/route.ts` confirm 时把 direct/adjacent 竞品合并写入 active master brief（非破坏性 merge，保留手动条目），形成完整闭环 commit `f0ce301`

### 2026-05-22

- **P12.I.10** — Intent 优先内容策略：SEO Intelligence Panel A 新增 Branded vs Non-Branded 估算流量拆分 + Intent Priority Content；排名表/缺口词表 Transactional 优先；11 tests + build ✅

- **P12.I.9** — Position Changes 接入 SEO Intelligence：基于 `keyword_snapshots` 最近两期计算 New/Lost/Improved/Declined，Panel A 展示摘要 + movement 列表，测试 + build ✅

- **P12.I.8** — `keyword_snapshots` 趋势地基：新增快照表 migration、DataForSEO ranked keyword upsert service、weekly cron + Render 调度，10 tests + build ✅
- **P12.I.7** — Untapped 词与 strategy `new_blog` 卡片接入一键生成博客：复用 POST /blog，成功后回写 strategy item，测试 + build ✅
- **P12.I.6** — 执行看板新增「自主行动」泳道：无 execution_item 来源的 flywheel_actions 合成只读卡片，复用 OutcomeChip，测试 + build ✅
- **P12.J.2** — 博客推送 HTML 注入 hero figure：`buildBlogHtml`/CMS 推送共用 body builder，预览/复制/推送都带头图，目标测试 ✅
- **P8.3.2** — Dashboard Magic Link 鉴权收尾：AI Tracker dashboard API 加 session + client scope 守卫；38 个 auth 相关测试通过
- **P13.D** — Ads + Reputation 接入 production package：meta_ads_snapshots + project_reviews 加 production_package_id FK；两条路由接受可选参数；包详情页回读 ads_snapshots + reputation_reviews，build ✅

### 2026-05-21（续 2）

- **P12.I.5** — 博客生成接入 SEO 飞轮（接线缺口 1+2）：`blog/route.ts` 的 `persistAndReturn()` 持久化 `primary_keyword/keyword_volume/keyword_kd/keyword_intent` 到 `blog_posts`，并在博客落库后非阻断写一条 `flywheel_actions(flywheel='seo', action_type='seo.publish_blog', execution_mode='in_house')`；复用 `SeoContentAdapter.execute()`，try/catch 包裹保证飞轮写入失败不影响主流程；零 schema 改动；build ✅；未引入新测试失败

- **P12.I.3** — Panel B「了解对手」竞品并排对比 + 关键词缺口 Venn 图：GET `/api/clients/[id]/seo-intelligence/competitors-gap`（getSerpCompetitors top5 + getKeywordsGap top3 竞品，24h cache）；竞品卡片横向滚动；SVG Venn 图（你独有/共同词/缺口）；缺口词筛选表（意图/搜索）；TS 无新错误；build ✅

- **P12.I.4** — SEO Gap 页移除 SEMrush CSV 上传，改用 DataForSEO 自动拉取：route.ts POST 改为 JSON body，调 `getSerpCompetitors→getKeywordsGap`，`LabsKeyword→ParsedKeyword` 映射（search_volume/keyword_difficulty/intent）；前端移除 drag-drop/文件列表/useRef/useCallback，一键「Run」按钮；AI 分析链路+DOCX 生成+Storage 上传不变；TS 无新增错误

- **P12.I.2** — Panel A「了解自己」Organic Rankings 关键词表 + Intent 分布图：`getRankedKeywords()` 调 DataForSEO ranked_keywords/live（200 词含 position）；GET `/api/clients/[id]/seo-intelligence/rankings`（24h cache）；Panel A 完整 UI：Intent 分布徽章、Intent/排名段位/品牌词三维过滤器、搜索框、50 条分页表格（关键词/排名/月搜量/KD/意图）；TS 无新增错误；build ✅

- **P12.I.1** — SEO Intelligence 页面路由 + 顶部指标栏：新增 `/dashboard/clients/[id]/seo-intelligence` 页面；GET `/api/clients/[id]/seo-intelligence/metrics` 读 `flywheel_metrics(flywheel='seo')` 最新快照（4 指标：收录关键词/月均流量/权威分/已发布博客）；客户详情页「SEO 工具」区块新增导航入口；Panel A/B 占位面板；build ✅

### 2026-05-21（续）

- **P13.C** — Reels/generate + visual/image + visual/video 三条生成链路接入 production_package_id，异步创建 production_items + 回写 production_item_id，build ✅

### 2026-05-21

- **P13.B.2** — 客户级生产包列表页 + `GET /api/clients/[id]/production`：维度 tab 过滤、按 dimension 分组展示、item_count 批量计算，build ✅
- **P13.B.1** — Blog 生成路由接入 `production_package_id`：`GenerateBlogRequest` 加字段，`persistAndReturn` 创建 production_items 行 + 回写 production_item_id，覆盖 SEO + AI Visibility 两个 dimension，build ✅
- **P13.A.5** — 生产包只读详情页 + GET API 路由：展示 dimension/campaign/execution_item/items 列表/context snapshot，build ✅
- **P13.A.4** — Route A/C 接收 `production_package_id`，生成后创建 `production_items` 行并回写 `production_item_id`，build ✅
- **P13.A.3** — 四张内容表各加 `production_item_id` nullable FK → `production_items` + partial index，build ✅

### 2026-05-20

- **P13.A.2** — `production_items` migration：建表 + content_type CHECK + 跨 FK 一致性约束（chk_item_fk_matches_type）+ 6 索引 + updated_at trigger + RLS，build ✅
- **P13.A.1** — `production_packages` migration：建表（复用 `diagnostic_dimension` enum）+ 4 索引 + updated_at trigger + RLS 三策略（SELECT/INSERT/UPDATE via client_team），build ✅

### 2026-05-19

- **P8.3.2** — Dashboard Magic Link 鉴权重新启用：middleware matcher 改回 `/dashboard/:path*` + layout `redirect('/login')` 取消注释；whitelist.ts + middleware.ts 新增 23 个单元测试（fail-closed / admin / client-viewer scoping / 边界）；`/unauthorized` 已存在无需新建；Supabase 后台 Redirect URLs 白名单 + Render `ADMIN_EMAILS` 需 PM 上线前配齐
- **P8.10.S0.21** — 张骞首跑硬化 + Advanced Discovery 入口：HTTP 超时全封（Anthropic SDK 90s / SEMrush 20s / Apify ad-library 30s）+ `GLOBAL_TIMEOUT_MS` 270s→300s + stale-timeout 10min→6min + 新增 `/api/cron/zhangqian-sweeper` 兜底孤儿 job + 首跑工具瘦身（删 `fetch_meta_ads` + `fetch_social_metrics` 去 facebook，`MAX_TOOL_CALLS` 22→18，`MAX_COST_USD` $1.80→$1.50）+ prompts.ts 同步 + 报告页 Advanced Discovery CTA banner
- **P8.10.S0.23** — Advanced Discovery Phase 2：GSC connector（Service Account JWT + Search Analytics API，返回 28 天 top-25 query）+ Google Ads connector（Apify 透明度中心，公开数据）；`advanced-agent.ts` 按 triggeredBy 分流；types 新增 GscSearchData + DiscoveredGoogleAdsData；build ✅
- **P8.10.S0.24** — Advanced Discovery Phase 3：张骞报告页可视化 advanced 数据；新增 GscDataCard / GoogleAdsCard / AdvancedFacebookCard；MetaAdsCard 优先读 advanced.meta_ads；CTA banner 双态（已跑→绿色成功，未跑→蓝色 CTA）；build ✅
- **P8.10.S0.22** — Advanced Discovery Phase 1：新建 `client_connectors` 表 + `client_discovery_jobs.job_type` 列；`advanced-agent.ts` 实现 `runZhangqianAdvanced()`（Meta 广告库 + FB 主页抓取）；`persistor.ts` 加 `mergeAdvancedPayload()`（写入 payload.advanced 不覆盖 basic）；connectors status/connect API；`/dashboard/clients/[id]/connectors/[anchor]` 详情页；connector 授权自动触发高级发现（commit 94d8eaa）

### 2026-05-17

- **P12.A.1** — 飞轮数据骨架 migration：建 flywheel_actions/metrics/outcomes 三表 + execution_items 加 execution_target 列 + 存量回填
  `feat(flywheel): P12.A.1 — 建 3 张飞轮新表 + alter execution_items [P12.A.1]` (c8b518b)
- **P12.A.2** — GEO 受控词表：6 个 action_type 常量 + 5 个 metric_key 常量 + 运行时校验函数
  `feat(flywheel): P12.A.2 — GEO 受控词表 vocabulary.ts [P12.A.2]` (9738c04)
- **P12.A.3** — FlywheelAdapter 接口 + Registry：types.ts 定义接口 + DTO，registry.ts 提供注册/查找/列举函数
  `feat(flywheel): P12.A.3 — FlywheelAdapter 接口 + Registry [P12.A.3]`
- **P12.A.4** — GeoComposerAdapter：execute() 写 flywheel_actions 落库，pullMetrics() 留存根 [P12.A.7 填]
  `feat(flywheel): P12.A.4 — GeoComposerAdapter (in_house mode) [P12.A.4]`
- **P12.A.5** — 执行看板按钮按 execution_target.mode 分发：in_house 弹抽屉 / third_party 跳路由+打勾提示 / external_manual 静态标签；ExecutionItem 类型加 execution_target 字段；新建 FlywheelDrawer.tsx stub
  `feat(flywheel): P12.A.5 — 执行看板按钮按 execution_target.mode 分发 [P12.A.5]` (cd7018c)
- **P12.A.6** — FlywheelDrawer 填充：POST /api/flywheel/execute → adapter.execute() → flywheel_actions 落库；GEO 飞轮 actionType/expectedMetric/expectedDelta 表单；form/submitting/done/error 四态
  `feat(flywheel): P12.A.6 — FlywheelDrawer 落库 flywheel_actions [P12.A.6]` (4941c5c)
- **P12.A.7** — AI Tracker 重跑写 flywheel_metrics：mention_rate / avg_rank / engine_coverage，GeoComposerAdapter.pullMetrics() 实现
  `feat(flywheel): P12.A.7 — AI Tracker 重跑写 flywheel_metrics [P12.A.7]` (b1903d0)
- **P12.A.8** — 归因 Job：扫 flywheel_actions.expected_metric，算 baseline/after/verdict/confidence，写 flywheel_outcomes（14 测试全通过）
  `feat(flywheel): P12.A.8 — 归因 Job 写 flywheel_outcomes [P12.A.8]`
- **P12.A.9** — Cron 路由 POST /api/cron/attribution，每 6h 触发归因 Job，7 测试全通过
  `feat(flywheel): P12.A.9 — Cron 触发归因 Job [P12.A.9]`
- **P12.A.10** — 执行看板卡片显示 outcome chip（verdict+metric+delta_pct+confidence），8 测试全通过
  `feat(flywheel): P12.A.10 — 执行看板卡片显示 outcome [P12.A.10]`
- **P12.A.11** — 华佗新生成的处方自动带 execution_target（flywheel/mode/vendor），8 测试全通过
  `feat(flywheel): P12.A.11 — 华佗处方输出 execution_target [P12.A.11]`
- **P12.A.12** — 一次性回填脚本 backfill-execution-target.ts：按 (dimension, fix_type) 修正存量 execution_items.execution_target
  `feat(flywheel): P12.A.12 — 存量 execution_target 回填脚本 [P12.A.12]`
- **P12.A.13** — CTS E2E 验证脚本 p12-a13-cts-e2e.ts：用真实 prescription 的 ai_visibility 条目 + 真实 2026-04-27 snapshot 作 baseline，跑通 execution_item→action→metrics→attribution→outcome 全链路；outcome verdict=confirmed delta_pct=105.6% confidence=0.95（after 为标记 synthetic 的占位，等下次 Tracker 周跑替换）
  `feat(flywheel): P12.A.13 — CTS GEO 端到端验证 [P12.A.13]`
- **P12.A.14** — 新增 docs/flywheel-architecture.md（186 行）：系统目标、四飞轮×三执行形态、3 张表、端到端数据流图、FlywheelAdapter 契约、加新 adapter 的 10 步指南（以 MetaAdsAdapter 为例）、5 条不可偏离的设计原则
  `docs(flywheel): P12.A.14 — 架构 README 与 adapter 接入指南 [P12.A.14]`
- **P12.A.15** — ROADMAP § 9 Phase 12.A 总结追加 + CLAUDE.md 当前焦点切换到 Phase 12.B
  `chore(roadmap): P12.A.15 — Phase 12.A 总结 + 焦点切 Phase 12.B [P12.A.15]`
- **P12.B.1** — SEO adapter：vocabulary 填 4 action_type + 4 metric_key；SeoContentAdapter execute()+pullMetrics()（SEMrush domain_ranks + blog 计数）；9 单元测试；build 通过
  `feat(flywheel): P12.B.1 — SeoContentAdapter SEO 飞轮落库 [P12.B.1]`
- **P12.B.2** — Meta Ads adapter：migration(meta_ads_snapshots + clients.meta_ad_account_id)；ADS vocabulary 6+7 条；MetaAdsAdapter execute()+pullMetrics()；Meta Graph API client；sync 路由；10 单元测试；build 通过
  `feat(flywheel): P12.B.2 — MetaAdsAdapter Ads 飞轮落库 [P12.B.2]`
- **P12.B.3** — Social adapter：SocialContentAdapter；vocabulary SOCIAL_ACTION_TYPE(3)+SOCIAL_METRIC_KEY(2)；execute()+pullMetrics()；publer/create-post 静默挂载；11 单元测试
  `feat(flywheel): P12.B.3 — SocialContentAdapter 社媒飞轮落库 [P12.B.3]`
- **P12.B.4** — SEMrush 周快照 cron：GET /api/cron/flywheel-seo-weekly；拉所有有 domain 的客户 domain_ranks 写 flywheel_metrics；9 单元测试；build 通过
  `feat(flywheel): P12.B.4 — SEMrush 周快照 cron [P12.B.4]`
- **P12.C.1** — 跨客户 outcome 聚合：outcome-aggregate.ts 纯函数层（7 测试）；GET /api/admin/flywheel/aggregate；/dashboard/admin/flywheel 飞轮成效卡片（verdict bar + 置信度 badge）
  `feat(flywheel): outcome aggregate API + Admin 飞轮成效卡片 [P12.C.1]`
- **P12.C.2** — 反哺华佗置信度：outcome-confidence.ts（8 测试）；HuatuoLookupContext 新增 outcome_confidence；agent.ts 并行拉取；prompts.ts 注入「历史成效数据」段落；处方 action 末尾附置信度标签
  `feat(huatuo): 飞轮归因置信度反哺处方生成 [P12.C.2]`
- **P12.C.3** — 社媒 engagement 回流：engagement-pullback.ts（7 测试）；Publer GET /posts/{id}；GET /api/cron/social-engagement-pullback；vocabulary 新增 POST_LIKES/COMMENTS/SHARES；render.yaml 注册每日 4am UTC cron
  `feat(social): Publer engagement pullback → flywheel_metrics [P12.C.3]`

### 2026-05-24（Phase 8.13 Sprint A–E）

#### 🎉 Phase 8.13 总结（2026-05-24 完成，4 sprints + 1 收尾 session）

**核心交付**：张骞 Intelligence Layer — DataForSEO 全域情报接入（11 工具 · $0.57/客户）

- **P8.13.A** DataForSEO Labs 关键词+竞品接入（零幻觉替换 web_search）：`labs.ts` + `fetch_keyword_data` + `fetch_competitors`，空结果降级 web_search
- **P8.13.B** Domain Technologies + WHOIS：`domain-analytics.ts` + `fetch_domain_technologies` + `fetch_domain_whois`，到期 < 90 天自动注入 quick_fix；TechStackCard + DomainWhoisCard 上报告页
- **P8.13.C** Business Data API 替换 Apify 评论爬虫：`business-data.ts`（GMB + Google Reviews + Tripadvisor）；`tripadvisor` 枚举写入 `review_platforms`
- **P8.13.D** SERP + OnPage Audit 全链路：`serp.ts`（DataForSEO 优先 + Apify fallback）；`onpage.ts`（Core Web Vitals + checks 快审）；OnPageAuditCard 上报告页
- **P8.13.E** 集成测试收尾：21 个 mock 集成测试全覆盖 Sprint A-D；修复 `validators.ts` bug（`technology_stack` / `domain_whois` / `onpage_audit` 未被 pass-through）；agent.ts 顶部成本注释更新 ≈ $0.57/客户

**新增字段**：`technology_stack` / `domain_whois` / `onpage_audit` / `business.phone_numbers` / `business.emails` / `review_platforms: tripadvisor`

### 2026-05-18

- **P8.10.S0.12** — 新客户向导简化为真正 2 步：移除 5 步 StepIndicator + Steps 2-5 死代码；page.tsx 重写为纯净单页；按钮改为「🧭 派遣张骞」；ROADMAP P8.10.S0.1–14 全部勾选
  `feat(onboarding): P8.10.S0.12 — 2 步接入向导替换 5 步向导 [P8.10.S0.12]`
- **P8.10.S2.4** — Ads Collector 从零实现：Apify Meta Ad Library + Google Ads Transparency 双源 + 评分（platform/volume/creative 40/35/25）+ 4 类 finding（no_ads / single-platform / low-volume / weak-creative）+ runner 接入 + 13 单元测试
  `feat(diagnostic): P8.10.S2.4 — Ads Collector + Meta/Google 双源 [P8.10.S2.4]`
- **P8.10.S2.5** — AI Visibility 实时调用层：新 `ai-visibility-live-probe.ts`（默认 probe 接 OpenAI runner + parser，跑 3 个核心问句，45s 超时，OPENAI_API_KEY 缺失时静默降级）；collector 加 LiveProbe 注入 + 三态合并（无 snapshot→走 live 评分 / snapshot 0 mentions→附 live 证据 / snapshot 健康但 live 0→新增 `live_probe_no_mention` 高优 finding）；runner.ts 在 ai_visibility/full 模式注入默认 probe；14 测试全过；build 通过
  `feat(diagnostic): P8.10.S2.5 — AI Visibility live probe [P8.10.S2.5]`
- **P8.10.S2.6** — 统一 evidence schema：`src/lib/diagnostic/types.ts` 新增 `EvidenceEnvelope { raw, parsed, sources: [{url, fetched_at}], collected_at }` + `makeEvidence()` / `evidenceSource()` / `isEvidenceEnvelope()` 工具；6 个 collector（SEO / Social / Competitor / Ads / AI Visibility / Reputation）所有 evidence 站点改用 envelope；每个 finding 附可审计的源 URL（client/competitor 域名、社媒 profile URL、Meta Ad Library、Google Ads Transparency、GBP）；9 个新单元测试 + 调整 2 处旧测试断言（社媒读 `evidence.parsed.top_posts_30d`、AI live probe 读 `evidence.parsed.live_probe`、competitor 读 `evidence.parsed.*`）；195 测试全过；build 通过
  `feat(diagnostic): P8.10.S2.6 — unified evidence envelope [P8.10.S2.6]`
- **P8.10.S2.F.1** — 张骞 → MB 预填扩展：`BriefSourcesForm` 自动从 `client_discovery.payload` 读 `seed_keywords` + `competitors`；`brief/generate` API + `runBriefPipeline` 新增 `seedKeywords` / `competitorDomains` 输入；prompts.ts 注入 "DISCOVERY ANCHORS" 段让 Claude 把高置信度种子词 / 竞品域名直接采用；pipeline insert 时 discovery 值覆盖 Claude 推断值；UI banner 显示预填数量；build + 174 brief/blog/content 测试通过；preview 验证 CYHB 客户 banner 显示 "8 个种子关键词 / 7 个竞品域名"
  `feat(brief): P8.10.S2.F.1 — discovery anchors prefill seed_keywords + competitors [P8.10.S2.F.1]`
- **P8.10.S2.F.2** — 博客 hero 图 prompt 拆成第二步：`blog/generator.ts` 移除主 Claude prompt 里的 `featured_image_prompt` 字段；新增 `buildHeroImagePrompt()` 在正文生成后调用 `generateVisualBrief()`，传入 MB 视觉 DNA + 提取的正文文本；MB 缺失时降级到基础 prompt；build 通过
  `feat(blog): P8.10.S2.F.2 — blog hero image uses generateVisualBrief() with MB visual DNA [P8.10.S2.F.2]`
- **P8.10.S3.1** — Competitor Analyst (Synthesis 层第 1 个模块)：新增 `src/lib/diagnostic/synthesis/competitor-analyst.ts` + `analyzeCompetitorLandscape()`，Claude Sonnet 4.6 把 `CompetitorEntry[]`（含 site_signals + meta_ads）合成两段 Markdown 叙事「Market Structure」+「Benchmarking Path」，输出 JSON + cost/model/generated_at；TDD 写 12 个单测（happy path / guard rails / 输出解析 / brief 注入），全过；diagnostic 207 测试全过；build 通过
  `feat(diagnostic): P8.10.S3.1 — competitor analyst synthesis [P8.10.S3.1]`
- **P8.10.S3.2** — Dimension Narrator (Synthesis 层第 2 个模块)：新增 `src/lib/diagnostic/synthesis/dimension-narrator.ts` + `narrateDimension()` / `narrateAllDimensions()`，对单个 `DiagnosticDimension` (seo/ai_visibility/ads/social/reputation/competitor) 用 Claude Sonnet 4.6 生成 200–400 字三段式 Markdown 叙事「Current state / Root cause / Opportunities」，注入 findings 的 severity/recommendation/fix_type/evidence；score=null（未配置）也能产出说明；批量入口对空 findings 维度静默跳过。TDD 15 个单测全过；diagnostic 222 测试全过；build 通过
- **P8.10.S3.3** — Score Explainer (Synthesis 层第 3 个模块)：新增 `src/lib/diagnostic/synthesis/score-explainer.ts` + `explainScores()`，单次 Claude Sonnet 4.6 调用为 overall + 每个维度产出 60–120 字 Markdown caption「为什么是这分」，锚定 findings 的 drag-down/lift-up 与 weight × gap；输入校验 0–100 + 非空维度 + null 容忍；输出 reconcile（剔除未请求的 target、查重、强制 overall 必含）；TDD 21 单测全过；diagnostic 243 测试全过
  `feat(diagnostic): P8.10.S3.3 — score explainer synthesis [P8.10.S3.3]`
- **P8.10.S3.4** — Market Context (Synthesis 层第 4 个模块)：在 `src/lib/anthropic/client.ts` 新增 `callClaudeWithWebSearch` helper（server-side `web_search_20250305` 工具 + citation 抓取 + cost 计算）；新增 `src/lib/diagnostic/synthesis/market-context.ts` + `gatherMarketContext()`，Claude Sonnet 用 Anthropic Web Search 抓行业现状，按 market (au→AU+Sydney / nz→NZ+Auckland) 路由 user_location，产出 `industry_overview_md` / `key_trends[3-6]` / `category_benchmarks_md` / `opportunities_md` + citations + cost；输入校验 brand/industry/market/maxSearches + focusTopics 上限 10；TDD 24 单测全过；diagnostic 267 测试全过
  `feat(diagnostic): P8.10.S3.4 — market context synthesis [P8.10.S3.4]`
- **P8.10.S3.5** — Synthesis 持久化层：新增 migration `20260518000002_diagnostic_narratives.sql`（表 `diagnostic_narratives`：`run_id / client_id / kind / dimension / narrative_md / metadata / model / cost_usd / generated_at`，CHECK 约束 kind 枚举，UNIQUE INDEX 用 `COALESCE(dimension, '')` 处理 NULL，RLS 沿用 client_team）；新增 `src/lib/diagnostic/synthesis/persistence.ts`：`saveCompetitorAnalysis` / `saveDimensionNarrative(s)` / `saveScoreExplanations`（cost 只挂 overall 防重复求和）/ `saveMarketContext`（dimension=NULL + metadata 存 citations/trends）/ `loadNarrativesForRun`，全部走 `upsert(onConflict='run_id,kind,dimension')`，错误只 warn 不抛；TDD 11 单测全过；diagnostic 278 测试全过；build 通过
  `feat(diagnostic): P8.10.S3.5 — diagnostic_narratives table + persistence [P8.10.S3.5]`
- **P8.10.S3.6** — Synthesis 结果注入 prescription-generator：`generatePrescription` 在加载 run+findings 后通过 `loadNarrativesForRun(supabase, runId)` 拉取 narratives；`buildPrescriptionPrompt` 签名加 `narratives` 可选参数；新增 `formatNarrativesForPrompt()` 按 kind 分桶渲染 4 段（Market Context / Competitor Analysis / Dimension Narratives / Score Explanations）注入 prompt；SYSTEM_PROMPT 加硬指令"必须将 Synthesis Insights 作为撰写处方的主要依据"（action description / KPI target_value / 阶段 1 快速动作 / summary 必须呼应）；narratives 为空时段落整体省略，对老 run 零影响；新增 2 个 TDD 单测 + 更新 supabase mock 支持 `diagnostic_narratives` 表的 `.eq().order().order()` 链；prescription-generator 10 测试全过 + diagnostic 280 测试全过；build 通过
  `feat(diagnostic): P8.10.S3.6 — inject synthesis narratives into prescription prompt [P8.10.S3.6]`
- **P8.10.S4.3 + S4.4** — `/diagnostic/report` 页落地 + 速览入口保留：新增 `src/app/dashboard/clients/[id]/diagnostic/report/page.tsx`，iframe 渲染 print-HTML + 浮层目录（H2 自动提取 + IntersectionObserver 高亮）+ 打印按钮 + evidence.json 下载；原 `/diagnostic` 6 维度评分卡作「速览入口」保留，Report 按钮从评分卡跳转到新页；S4.4 随 S4.3 一起完成
  `feat(diagnostic): P8.10.S4.3 — /diagnostic/report page (iframe + TOC + print + evidence download) [P8.10.S4.3]`
- **P8.10.S5.2** — 证据引用上标抽屉：report-generator 注入 `[[cite:kind:dim]]` 标记 → HTML 替换为 `<sup class="cite" data-idx>[N]</sup>`；`buildCitationRegistry` 分组 evidence_refs、顺序编号；`__cite_data__` JSON + postMessage JS 仅在有引用时注入；report/page.tsx 监听 `cite:click` message，EvidenceDrawer 展示来源 URL 列表；markdown artifact 自动 strip 标记；+4 tests，296 全绿，build 通过
  `feat(diagnostic): P8.10.S5.2 — evidence citation drawer ([N] superscript + postMessage) [P8.10.S5.2]`
- **P8.10.S5.3** — 导出 DOCX 按钮：新增 GET `/api/clients/[id]/diagnostic/report/docx`，拉 markdown artifact → `docx` npm 包生成 A4 Word 文档（Arial、样式化 H1-H3、bullet 列表、GFM 表格、inline bold/italic/code）；report 页头部新增 DOCX 按钮含 loading spinner，置于 Evidence 与打印按钮之间；build 通过
  `feat(diagnostic): P8.10.S5.3 — export DOCX button + /report/docx API [P8.10.S5.3]`
- **P8.12.S2.2** — 华佗案例库检索 skill：新增 `retriever.ts`（`retrieveSimilarCases`：industry_category 精确 + crisis_type 可选 + 预算 ±50% 区间 + market 筛选，附 outcomes KPI；`formatCasesForPrompt` 渲染案例段落）+ `saver.ts`（`savePrescriptionCase` 静默写库 + `deriveCrisisType` 从 priority_dimensions 提取）；`HuatuoLookupContext` 加 `similar_cases` 字段；agent.ts 在 Lookup Step 并行调 retriever；prompts.ts 注入案例段落；generate/route.ts `.catch()` hook 案例存档；16 新测试全过；41 case-library+huatuo 测试全过；build 通过
  `feat(huatuo): P8.12.S2.2 — retrieve_similar_cases skill + case saver [P8.12.S2.2]`
- **P8.12.S2.4** — 行业基准自动累积：`benchmark-accumulator.ts`（`calcPercentiles` P50/P75/P90 线性插值 + `accumulateBenchmarks` 按 industry_category/business_size/market/kpi_metric 分组）；`/api/cron/benchmark-accumulator` CRON_SECRET 鉴权；MIN_SAMPLE_THRESHOLD=5 冷启动保护；confidence 随样本量增长（封顶 0.95）；check-then-insert/update 无需 UNIQUE 约束；19 测试全过；build 通过
  `feat(huatuo): P8.12.S2.4 — benchmark accumulator (P50/P75/P90 from outcomes → industry_benchmarks) [P8.12.S2.4]`
- **P8.12.S3.5** — 本地行业目录竞品发现：新增 `src/lib/local-directory/`（types.ts + client.ts，Yellow Pages AU + Localsearch via Jina）；parseDirectoryMarkdown 解析 H2/H3 段、AU 电话 / 评分 / 地址、跳过导航 heading、上限 20 条；discoverLocalCompetitors 双源 Promise.allSettled + 去重 + limit；鲁班新工具 discover_local_competitors（prompts.ts 补 发按需调用段落）；31 测试全过；build 通过
  `feat(luban): P8.12.S3.5 — local directory competitor connector (Yellow Pages AU + Localsearch via Jina) [P8.12.S3.5]`
- **P8.12.S2.3** — 处方 KPI 反馈闭环：`outcome-recorder.ts`（`recordOutcome` + `backfillSemrushKpisForPrescription`，30/60/90 天节点 ±7 天窗口，去重写入）；`/api/clients/[id]/prescription/[pId]/outcomes` GET+POST；`/api/cron/kpi-backfill` SEMrush 自动回填（organic_keywords / organic_traffic / authority_score）；22 测试全过；build 通过
  `feat(huatuo): P8.12.S2.3 — KPI feedback loop (outcomes API + SEMrush cron backfill) [P8.12.S2.3]`
- **P8.10.S5.1** — 证据引用数据层：4 个 synthesis 结果类型（DimensionNarrativeResult / ScoreExplanation / CompetitorAnalystResult / MarketContextResult）加 `evidence_refs: string[]`；NarrativeRow 加 `evidence_refs` 字段，save helpers 写入 `metadata.evidence_refs`，load 时自动提取；lib/diagnostic/types.ts 新增 `extractEvidenceRefs` 工具函数；report-generator evidence.json findings + narratives 均带 refs；292 tests 全绿
  `feat(diagnostic): P8.10.S5.1 — evidence_refs data layer on findings/narratives [P8.10.S5.1]`
- **P8.10.S4.1 + S4.2** — Report Composer 落地：新增 `src/lib/diagnostic/report-generator.ts`，`generateReport(supabase, runId, clientId, opts)` 并发拉 run / client / findings / narratives，prescription 优先从 `prescriptions` 表按 (run_id, client_id) 读最新，缺时用 `intake` 调 `generatePrescription` fallback、无 intake 则段落省略；产出 3 件套：（1）完整 Markdown（标题 / 摘要 / 基线快照 / 6 维度详情含 score_explanation + dimension_narrative + 关键问题 / 竞品分析 / 市场上下文 / 处方建议 含 phases + KPI 表 + 预算表），narrative bucket 空则段落整体省略；（2）可打印 self-contained HTML，内嵌 `@page A4 + @media print` 规则 + h2 page-break-before + table page-break-inside avoid + 内置极简 MD→HTML 转换器（headings / paragraphs / 粗体斜体 / 列表 / GFM 表格）零外部依赖；（3）独立 `evidence-{run_id}.json`（findings 全量 + narratives 元数据），**不内嵌**到报告；TDD 12 单测全过（段落顺序 / 缺失数据"无数据"占位 / 空 narratives 段落省略 / prescription 优先读库 + fallback / HTML print CSS 校验 / 证据独立文件 / run 缺失抛错）；diagnostic 292 测试全过；tsc 无误
  `feat(diagnostic): P8.10.S4.1 — report composer (markdown + print HTML + evidence json) [P8.10.S4.1]`
- **P8.10.S0.15–S0.20** — 张骞/MB/视觉 brief 收尾增强（**并行 session 完成，commit message 误标 `[P8.10.S2.1]`–`[P8.10.S2.6]`，实际属于 P8.10.S0 范畴**）：Content modal 简化、`/content/generate` 重定向、张骞 confirm 跳转 `?brief=1`、MB 加视觉 DNA、BriefSourcesForm 自动预填、`visual_brief` 拆成独立第二步生成器
  - `refactor(content): remove image preview ... [P8.10.S2.1]` (2a10979) → 实际 S0.15
  - `refactor(content): redirect /content/generate ... [P8.10.S2.2]` (742d0f7) → 实际 S0.16
  - `feat(zhangqian): confirm → redirect ... [P8.10.S2.3]` (5227874) → 实际 S0.17
  - `feat(brief): add visual DNA fields ... [P8.10.S2.4]` (fe3b279) → 实际 S0.18
  - `feat(brief): BriefSourcesForm auto-prefill ... [P8.10.S2.5]` (62ab236) → 实际 S0.19
  - `feat(content): visual_brief split ... [P8.10.S2.6]` (5226929) → 实际 S0.20
  - 教训：并行 session 在同一分支工作时必须先确认 ROADMAP 真实任务编号才能起 commit tag

#### 🎉 Phase 12.A 总结（2026-05-17 完成，15 commits / 1 天）

**交付物一览：**
- 数据骨架：`flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes` 三表 + `execution_target` JSONB 列（M1 地基）
- 受控词表：6 个 GEO action_type + 5 个 metric_key 枚举，含运行时校验函数
- Adapter 抽象：`FlywheelAdapter` 接口 + Registry，支持 in_house / third_party / external_manual 三种执行形态
- GeoComposerAdapter：首个 adapter 实现，execute() 落库 + pullMetrics() 接口（M2 第一个 adapter）
- 执行看板：按 `execution_target.mode` 分发三种 UX（弹抽屉 / 跳路由 / 静态标签）
- FlywheelDrawer：POST /api/flywheel/execute → adapter.execute() 全链路（含 4 态 UI）
- 归因系统：Job（14 测试）+ Cron 路由（7 测试），窗口内算 baseline/after/verdict/confidence
- AI Tracker 集成：重跑时写 `flywheel_metrics`（mention_rate / avg_rank / engine_coverage）
- Outcome UI：执行看板卡片 outcome chip（8 测试）
- 华佗处方集成：新生成的处方天然带 `execution_target`（8 测试）
- 存量回填脚本：6 客户 `prescription_actions.execution_target` 完整填充
- CTS 端到端验证：真实数据跑通 action→metrics→attribution→outcome 全链路（verdict=confirmed, delta_pct=105.6%, confidence=0.95）
- 架构文档：docs/flywheel-architecture.md（186 行），含 10 步加 adapter 指南

**Phase 12.B 待细化任务（预告）：**
- SEO adapter（in_house，复用现有博客生成）
- Meta Ads adapter（CTS 真实广告数据接入，用 Meta MCP）
- 社媒内容生成 action 落库
- SEMrush 周快照写 `flywheel_metrics`
- SerpAPI Google AI Overviews 自建第 5 runner（低优先级）

### 2026-05-14

- **P8.12.S1.1 / S1.2** — 张骞 AU/NZ 本地数据连接器二连（Sprint 1）：
  - **S1.1 商业注册验证**：新增 `src/lib/abr/`（types + client + 19 单元测试）。统一封装 AU 的 ABR ABN Lookup（JSONP）与 NZ 的 NZBN API v5；`verifyBusinessRegistration` 高层兜底（缺凭证 / 网络错 / 无匹配均返回 null，不阻塞发现）。张骞新增 `verify_business_registration` 工具，`DiscoveredBusiness.registration` 字段（真实实体名 / 实体类型 / 注册年限 / GST 状态，不再由大模型编造）。
  - **S1.2 本地评价聚合**：新增 `src/lib/local-reviews/`（types + client + 13 单元测试）。GBP via SerpAPI `google_maps` engine + ProductReview.com.au via Jina Reader（反爬优雅降级返回 null）；`aggregateLocalReviews` 高层非致命兜底。张骞新增 `fetch_local_reviews` 工具，`DiscoveredReviewPlatform` 扩展 `rating_distribution` / `recent_negative_samples` / `response_rate`（差评样本作为诊断实证依据）。
  - 两项共新增 32 个单元测试，validators.ts 宽松校验新可选字段，prompts.ts 研究协议 step 1/4 + 工具说明 + 输出示例同步更新，build 通过。新增环境变量 `ABR_GUID` / `NZBN_API_KEY` / `SERPAPI_API_KEY`。
  `feat(zhangqian): AU/NZ 本地数据连接器 — ABN/NZBN 注册验证 + 本地评价聚合 [P8.12.S1.1/S1.2]`

- **P8.12.S1.3 / S1.4 / S1.5** — 华佗 AU/NZ 本地化三连（Sprint 1，顺序实现）：
  - **S1.3 季节日历**：新增 `src/lib/huatuo/seasonal-calendar.ts`（AU/NZ 公假 + 电商大促 + 南半球季节静态日历），`HuatuoLookupContext.seasonal_calendar` 字段，agent.ts Lookup 阶段同步注入，prompts.ts 嵌入「未来 90 天本地营销节点」段落。顺带修复 `filterNext90Days` 月索引误与年份比较的 bug，改用绝对月份索引 + 2 年日历支持跨年窗口。
  - **S1.4 预算定位**：`benchmarks.ts` 新增 `formatBudgetComparison`（客户月预算 vs 行业典型月预算区间，输出 ratio + 处方铺开范围指导），`formatBenchmarksForPrompt` 增加可选 `customerBudgetAud` 参数，生成 + 自评两处 prompt 均传入 `intake.monthly_budget_aud`。
  - **S1.5 Google Trends connector**：新增 `src/lib/gtrends/client.ts`（SerpAPI `google_trends` engine，TIMESERIES 12 个月搜索兴趣曲线，gl=AU/NZ），高层 `getIndustryInterestTrend` 非致命兜底，`HuatuoLookupContext.industry_interest` 字段，agent.ts Lookup 并入 Promise.all，prompts.ts 嵌入「行业搜索热度趋势」段落。
  - 三项共新增 43 个单元测试（seasonal-calendar 16 + benchmarks 9 + gtrends 18），build 通过。
  `feat(huatuo): AU/NZ 本地化三连 — 季节日历 + 预算定位 + Google Trends [P8.12.S1.3/S1.4/S1.5]`

- **P8.12.S3.4** — 鲁班 `publish_to_gbp` skill：新增 `src/lib/gbp/publisher.ts`（`publishToGbp`），优先调 GBP Management API 实时发帖；`GOOGLE_GBP_ACCESS_TOKEN` / `location_name` 缺失或 API 失败时降级为草稿模式，格式化草稿落库到 execution_logs，FDE 手动发布。注册为鲁班第三个工具。10 单元测试（4 降级 + 4 实时 + 2 草稿格式），build 通过。
  `feat(luban): P8.12.S3.4 — publish_to_gbp skill (draft degradation) [P8.12.S3.4]`

- **P8.12.S3.1** — 鲁班 tool loop 升级（Phase 8.12 MVP）：`callClaudeChat` 单轮对话 → `callClaudeWithTools` 通用 tool loop。新增 `src/lib/luban/tools.ts` + 首个工具 `add_work_log`（鲁班自主把对话结论写入 execution_logs）。`chatWithLuban` 签名/返回结构保持兼容，`callClaudeChat` 未动（brief refinement 不受影响）。新增 5 个单元测试覆盖 tool loop 核心路径。
  待办：UI 端到端实测「鲁班自主调用 add_work_log」需在 dev 环境完成。
  `feat(luban): tool loop 升级 — 鲁班可自主调用工具 [P8.12.S3.1]`

### 2026-05-07

- **P8.3.1** — 客户接入向导（5步集成 DNZ）完成
  `feat(onboarding): 5-step client onboarding wizard with DNZ integration [P8.3.1]`
  交付：`/dashboard/clients/new` 5步向导 + `useSiteAuditPolling` hook + Master Brief reminder banner + 删除旧 `/onboarding` 3步流程

- **Phase 9.0 P9.0.8–P9.0.9** — Visual Queue UX Polish
  `feat(visual-queue): P9.0.1-P9.0.3 UX polish`
  交付：`globals.css` 新增动画 · queued 状态 SVG 弧形环 · slide-in-x · scale-pop

- **Phase 8.2** — 策略驱动内容执行 P8.2.1–P8.2.3 全部完成
  `feat(strategy): Phase 8.2 strategy-driven content execution [P8.2]`
  交付：`pages-context.ts`（19 tests）+ `upgrade-generator.ts`（11 tests）+ 升级 API（7 tests）+ 升级 UI + `content-auditor.ts` 扩展（11 tests）· 共 48 tests

- **Phase 8.1** — 三维内容策略分析（P8.1.1–P8.1.6 全部完成）
  `feat(strategy): Phase 8.1 three-dimensional content strategy analysis [P8.1]`
  交付：`content_strategy_items` 表 + `scorer.ts`（41 tests）+ `analyzer.ts`（23 tests）+ generate/list API + 策略面板 UI · 共 101 tests

- **Phase 8.D** — DNZ 诊断策略层全部完成（P8.0.7 GEO计数修复 + P8.0.8 页面清单UI）

- **Phase 8.Q.4** — 内容帖子批量编辑 UI
  `feat(content): P8.Q.4 batch edit UI with status dropdown and delete`
  交付：批量 API（5种状态 + delete）+ 状态下拉 + 乐观更新 + 二次确认

### 2026-05-05

- **P8.0.6** — DNZ Async Framework API Routes & Cron
  `feat(dnz): implement P8.0.6 API routes and cron with TDD (133 tests, 99.37% coverage) [P8.0.6]`

- **P7.3.21-23** — GEO Deployment Assistant
  `feat(geo-composer): implement deployment assistant with revoke functionality [P7.3.21-23]`

### 2026-05-02

- **Phase 8.R** — Reels Studio 完成
  `feat(reels-studio): complete video generation pipeline with editing [P8.R]`

### 2026-05-01

- **Phase 8.6-8.9, 8.11** — DataForSEO 完整集成
  `feat(seo-intelligence): add DataForSEO link, serp, local, baseline, billing [P8.6-8.9, P8.11]`

- **Phase 7.1** — AI Visibility Tracker（5个引擎 Runner 上线）
  `feat(ai-tracker): launch openai, claude, perplexity runners with weekly scheduling [P7.1]`

- **Phase 8.C.1** — 月报整合（6大数据源聚合）
  `feat(reporting): unified monthly report aggregating 6 data sources [P8.C.1]`

### 2026-04-30

- **Phase 7.0** — 7项架构决策完成
  `docs(roadmap): finalize Phase 7.0 decisions [P7.0]`

- **Phase 7.2** — GEO Composer 核心库
  `feat(geo-composer): launch directive editor, generation, and snippet deployment [P7.2]`

- **Phase 7.3.1-5** — 双信号博客生成库（安全修复）
  `feat(blog-generation): dual-signal blog engine with SEO/GEO optimization [P7.3.1-5]`
