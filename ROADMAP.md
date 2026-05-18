# Magic Engine — Roadmap

> 最后更新：2026-05-17 · 当前阶段：**🔥 Phase 12 飞轮数据闭环（活跃）— 建立 actions/metrics/outcomes 数据骨架，让 4 飞轮（SEO/GEO/Ads/社媒）执行后数据回流并自动归因。试点：CTS（GEO+SEO+Ads）/ Oztop（SEO+GEO）**
> 
> **策略更新（2026-05-05）**：GEO Directive 部署机制确认采用 **Phase 1 静态模型**（MVP），**Phase 2 动态脚本延缓至 Q3+ 2026**（需 PoC 验证）。详见 [§3.3.1 部署机制决策](#geoDirectiveDecision)。
> 配套：[PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)（产品视角）· [ARCHITECTURE.md](./ARCHITECTURE.md)（技术架构）

---

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
📋 Phase 8.M     Marketing Agent 记忆系统（每客户长期 Agent 智能化，中长期）
✅ Phase 8.D     DNZ诊断策略层（Stage 1✅ Stage 2✅ Stage 3✅ E2E验证✅ P8.0.7✅ P8.0.8✅ — 全部完成）
✅ Phase 8.1     三维内容策略分析（P8.1.1–P8.1.6 全部完成，2026-05-07）
⏸ Phase 8.P     Paid Social Studio（暂缓 — 待客户明确 Meta 广告需求触发）
✅ Phase 8.5+   Sprint 1 评分修复（P8.5.19-26，2026-05-13 完成）
🔥 Phase 8.10   Synthesis Layer + Deep Research 报告（5 Sprints，~12 工作日）
                ├─ S0 张骞 Discovery Agent（最先做，~3 天）⭐⭐⭐
                ├─ S2 数据源深化（~2 天）
                ├─ S3 Synthesis 层（~3 天）
                ├─ S4 Report Composer（~2 天）
                └─ S5 引用/证据追溯（~1 天）
🔥 Phase 8.12    AU/NZ 本地化能力扩展（MVP：S3.1 鲁班 tool loop 开发中 · 其余 13 项 MVP 后补充）
✅ Phase 12.A    飞轮数据骨架 + CTS GEO 端到端 demo（15 任务全部完成，2026-05-17）
🔄 Phase 12.B    SEO/Ads/社媒 adapter 接入（待细化）
🔄 Phase 9.0     Visual Queue UX Polish（P9.0.1✅P9.0.3✅P9.0.4-9✅ 进行中 · 待：P9.0.2+P9.0.10-17集成测试+浮动卡）
📋 Phase 9       报告化 + 客户 Portal
📋 Phase 10      多语言 + Magic Lab Academy 沉淀
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
- [ ] **P8.3.2** Dashboard 简单鉴权（Magic Link，防止数据泄露）

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
- [ ] **P8.5.19** `SeoCollector`: 无关键词配置 → `score: null` + finding `keywords_not_configured`（severity: high, fix_type: fde_manual）
- [ ] **P8.5.20** `ReputationCollector`: Google Place 未找到商家 → `score: null` + finding `business_not_listed`（severity: critical, fix_type: fde_manual）
- [ ] **P8.5.21** `CompetitorCollector`: 竞品 < 3 → `score: null` + finding `competitor_data_insufficient`（severity: medium, fix_type: me_auto，建议跑 SEMrush competitive research）
- [ ] **P8.5.22** `AiVisibilityCollector`: 无 snapshot 数据 → `score: null` + finding `ai_visibility_not_tracked`（severity: critical, fix_type: me_auto，引导启用 AI Tracker 周跑）
- [ ] **P8.5.23** `SocialCollector`: 无 IG/FB 账号配置 → `score: null` + finding `social_accounts_not_linked`（severity: high, fix_type: fde_manual）
- [ ] **P8.5.24** `computeOverallScore`: 忽略 `null` 维度，权重重新归一化；UI 显示「N/A」灰色图标
- [ ] **P8.5.25** UI `/diagnostic` 加返回按钮 + null 维度引导链接（「立即配置」跳转客户设置抽屉）
- [ ] **P8.5.26** `DiagnosticRun` 增加 `dimensions_skipped: string[]` 字段，记录哪些维度因数据缺失被跳过

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
- [ ] **P8.10.S0.1** 新建 `client_discovery` 表
  - 字段：`id, client_id, domain, status, payload(JSONB), generated_at, cost_usd, model, expires_at`
  - JSONB payload 结构：`{ business, social_profiles[], gbp, review_platforms[], seed_keywords[], competitors[], ai_tracker_questions[] }`
  - 单客户单条（UPSERT），expires_at = generated_at + 30 天
- [ ] **P8.10.S0.2** 新建 `client_discovery_jobs` 表用于异步任务追踪（status / error_message / cost_usd / tool_call_count）

**核心库（Day 2-3）**：
- [ ] **P8.10.S0.3** `src/lib/zhangqian/types.ts` — DiscoveryReport / DiscoveredCompetitor / DiscoveredSocial 等类型
- [ ] **P8.10.S0.4** `src/lib/zhangqian/agent.ts` — 主入口 `runZhangqian(domain): Promise<DiscoveryReport>`
  - Claude Sonnet + Anthropic Web Search tool + URL Fetch tool（Jina Reader）
  - System prompt 严格定义输出 JSON schema
  - Tool loop：最多 15 轮工具调用，超过则截断
  - 成本上限：单次 $1（超过则提前终止）
- [ ] **P8.10.S0.5** `src/lib/zhangqian/prompts.ts` — 拆分系统提示词（business / social / competitor / keywords 四段）
- [ ] **P8.10.S0.6** `src/lib/zhangqian/validators.ts` — Zod schema 验证 Claude 输出
- [ ] **P8.10.S0.7** `src/lib/zhangqian/persistor.ts` — 把 DiscoveryReport 写入 `client_discovery` + 触发后续 collector

**API（Day 3-4）**：
- [ ] **P8.10.S0.8** `POST /api/clients/[id]/zhangqian/discover` — 触发异步发现（返回 202 + job_id）
- [ ] **P8.10.S0.9** `GET /api/clients/[id]/zhangqian/status` — 轮询任务状态
- [ ] **P8.10.S0.10** `GET /api/clients/[id]/zhangqian/latest` — 读取最新 DiscoveryReport
- [ ] **P8.10.S0.11** `PATCH /api/clients/[id]/zhangqian/confirm` — 用户编辑确认后写入 clients/keywords/competitors 等表

**前端（Day 4-5）**：
- [ ] **P8.10.S0.12** 客户接入向导**简化为 2 步**：
  - Step 1: 输入域名 + 「🧭 派遣张骞」按钮
  - Step 2: 展示发现结果（卡片式，可编辑：业务信息 / 社媒 / 关键词 / 竞品 / AI 问句） → 「确认入库」
- [ ] **P8.10.S0.13** 张骞进度面板（实时显示「正在搜索 Instagram… / 正在分析竞品官网…」）—— 复用 P9.0 的环形进度组件
- [ ] **P8.10.S0.14** 已有客户加 `/dashboard/clients/[id]/zhangqian` 页面，可手动重跑张骞（更新过期发现）

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
- [ ] **P8.10.S2.1** SEO Collector 加 DataForSEO backlinks 详情 + SERP rankings 抓取
- [ ] **P8.10.S2.2** Competitor Collector 加 Jina 抓竞品官网（解析 USP / CTA / 落地页类型 / 类目深度）
- [ ] **P8.10.S2.3** Social Collector 加最近 30 天热门 3 条 post 内容采样（含点赞 / 评论 / hashtag）
- [ ] **P8.10.S2.4** Ads Collector 从零实现（Apify Meta Ad Library + Google Ads Transparency）
- [ ] **P8.10.S2.5** AI Visibility 加实时调用层（诊断时同步跑 3 个核心问句，不只读 cron snapshot）
- [ ] **P8.10.S2.6** 统一 evidence schema：`{ raw, parsed, sources: [{url, fetched_at}], collected_at }`

**Sprint 3 — Synthesis 层（P8.10.S3，~3 天，核心）**：
- [ ] **P8.10.S3.1** 新增 `src/lib/diagnostic/synthesis/competitor-analyst.ts`（Claude Sonnet 合成市场结构 + 对标路径）
- [ ] **P8.10.S3.2** 新增 `src/lib/diagnostic/synthesis/dimension-narrator.ts`（每维度 narrative）
- [ ] **P8.10.S3.3** 新增 `src/lib/diagnostic/synthesis/score-explainer.ts`（每个分数的解释段落）
- [ ] **P8.10.S3.4** 新增 `src/lib/diagnostic/synthesis/market-context.ts`（Anthropic Web Search 抓行业现状）
- [ ] **P8.10.S3.5** 新增 `diagnostic_narratives` 表：`run_id, dimension, narrative_md, generated_at, model, cost_usd`
- [ ] **P8.10.S3.6** Synthesis 结果注入 prescription-generator prompt（让处方更精准）

**Sprint 4 — Report Composer（P8.10.S4，~2 天）**：
- [ ] **P8.10.S4.1** `src/lib/diagnostic/report-generator.ts` — 合成完整 Markdown 报告
- [ ] **P8.10.S4.2** 报告结构：执行摘要 / 客户基线 / 6 维度深度分析 / 竞品对比表 / 处方摘要 / 证据附录
- [ ] **P8.10.S4.3** 新增页面 `/dashboard/clients/[id]/diagnostic/report` 渲染 Markdown（含目录 / 表格 / 折叠段）
- [ ] **P8.10.S4.4** **保留** `/dashboard/clients/[id]/diagnostic` 6 维度评分卡作为「速览」入口

**Sprint 5 — 引用/证据追溯层（P8.10.S5，~1 天）**：
- [ ] **P8.10.S5.1** 每个 finding / narrative 段落带 `evidence_refs: string[]`
- [ ] **P8.10.S5.2** UI 上标 `[1]` 可点开证据抽屉（类似 deep-research `citeturn`）
- [ ] **P8.10.S5.3** 导出 DOCX 按钮（用 `anthropic-skills:docx` 渲染）

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
- [ ] **P8.12.S2.2** 华佗 `retrieve_similar_cases` skill（`src/lib/case-library/retriever.ts`）— 按行业 / 危机类型 / 预算档结构化检索历史处方（v0 不用 embedding）
- [ ] **P8.12.S2.3** 效果反馈闭环：处方 KPI 90 天实际回流（`prescription_outcomes` 录入 API + cron 提醒，SEMrush 可测指标自动回填）
- [ ] **P8.12.S2.4** 行业基准自动累积：从 outcome 聚合 P50/P75/P90 写回 `industry_benchmarks`（cron，需最低样本阈值）
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
- [ ] **P8.12.S3.4** 鲁班 `publish_to_gbp` skill — 依赖 GBP API 写权限申请，未通过则降级为「生成草稿 + 人工发布」（弹性项）
- [ ] **P8.12.S3.5** 本地行业目录竞品发现 connector（Yellow Pages AU / Localsearch via Jina）— 优先级最低，弹性缓冲

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

- [ ] **P9.0.10** `src/components/visual/__tests__/GenerationProgress.test.tsx`：测试进度环 0%-95% 过渡、倒计时每秒刷新、取消按钮在 1.5x 倍数时激活
- [ ] **P9.0.11** 网络延迟模拟测试：验证本地 1Hz 平滑隐藏 5s 轮询波动
- [ ] **P9.0.12** 多提供商时间估算测试：针对 wavespeed（3min）、seedance（4min）、heygen（2min）验证 getCancelThresholdMs() 的计算
- [ ] **P9.0.13** 边界场景测试：0ms 倒数、NaN 估算、提供商超时重分类后的进度重置
- [ ] **P9.0.14** 覆盖率验证：运行 `npm test --coverage`，确保 ≥ 80%

#### Phase 9.0.5 — 队列概览浮动卡（Phase 3）

**目标**：为长队列场景提供浮动卡片，一览所有在生成的资产，点击跳转到对应资产详情。

- [ ] **P9.0.15** 创建 `src/components/visual/QueueOverviewCard.tsx`：显示 activeGenerations 列表（资产 ID、进度、倒计时），支持展开/收缩，固定在右下角（`fixed bottom-4 right-4`），点击行项目滚动到对应资产
- [ ] **P9.0.16** Hook 集成：从 `useGenerationQueue` 获取 `activeGenerations`，支持 `showQueueCard` 状态切换（10+ 任务时自动显示）
- [ ] **P9.0.17** E2E 测试：验证卡片在多资产生成时可用，滚动跳转功能正常

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

- [x] **P12.B.1** — SEO adapter（`SeoContentAdapter`）：vocabulary 填 SEO_ACTION_TYPE + SEO_METRIC_KEY；execute() 落 flywheel_actions；pullMetrics() 拉 SEMrush domain_ranks + blog_posts 计数写 flywheel_metrics；9 个单元测试全过；build 通过 ✅ 2026-05-18
- [x] **P12.B.2** — Meta Ads adapter（`MetaAdsAdapter`）：CTS 真实广告账户接入，Meta MCP；execute() 落 flywheel_actions；pullMetrics() 拉 ROAS / spend / impressions ✅ 2026-05-18
- [x] **P12.B.3** — 社媒内容 action 落库：SocialContentAdapter；vocabulary 填 SOCIAL_ACTION_TYPE(3) + SOCIAL_METRIC_KEY(2)；execute() 落 flywheel_actions；pullMetrics() 统计 content_posts 发布/排期数；publer/create-post 挂 .catch() 静默写；11 单元测试；build 通过 ✅ 2026-05-18
- [x] **P12.B.4** — SEMrush 周快照 cron：定时拉 domain_ranks 写 flywheel_metrics（所有客户）；GET /api/cron/flywheel-seo-weekly；CRON_SECRET 鉴权；逐客户调 SeoContentAdapter.pullMetrics()；9 单元测试；build 通过 ✅ 2026-05-18

---

### Phase 8.S — SEMrush → DataForSEO 关键词接口迁移（成本优化）

> 登记于 2026-05-18。背景：SEMrush 关键词 API 按 units 计费（10 units/词 ≈ $0.05/词），DataForSEO Labs 同等接口按 task 计费（$0.01–0.02/task，批量无限词）；实测相同数据量节省 96–99%。
> 迁移优先级：按当前用量成本从高到低排序。

- [ ] **P8.S.1** — `getRelatedKeywords`（`phrase_related`）→ `dataforseo_labs/google/related_keywords/live`
  - 最高优先：500 units/次，日志里已有 4 次重复调用（浪费 1500 units）
  - 验收：同一种子词返回 50 条关键词，含 volume / KD / CPC / intent，单次成本 ≤ $0.02
- [ ] **P8.S.2** — `getDomainOrganicKeywords`（`domain_organic`）→ `dataforseo_labs/google/ranked_keywords/live`
  - 验收：输入域名返回 ≥50 条排名词，含 position，格式与现有 `SemrushKeywordData` 接口兼容
- [ ] **P8.S.3** — `getKeywordGap`（`phrase_kgap`）→ `dataforseo_labs/google/domain_intersection/live`
  - 验收：输入客户域名 + 3 竞品域名，返回竞品有排名但客户无排名的关键词列表
- [ ] **P8.S.4** — `getDomainCompetitors`（`domain_organic_organic`）→ `dataforseo_labs/google/competitors_domain/live`
  - 验收：输入域名返回 ≥5 个竞品域名，含 overlap_score
- [ ] **P8.S.5** — `getQuestionKeywords`（`phrase_questions`）→ `dataforseo_labs/google/keyword_suggestions/live`（过滤 question intent）
  - 验收：FAQ 内容选题流程产出结果正常，含 "how/what/why" 类问题词
- [ ] **P8.S.6** — `getDomainMetrics`（`domain_ranks`）→ `dataforseo_labs/google/domain_rank_overview/live`
  - 验收：返回 organic_keywords / organic_traffic / authority_score，误差与 SEMrush ≤20%
- [ ] **P8.S.7** — `getDomainTrafficTrend`（`domain_rank_history`）→ `dataforseo_labs/google/historical_rank_overview/live`
  - 验收：12 个月趋势数据正常返回，用于华佗 Agent KPI 锚点
- [ ] **P8.S.8** — `batchKeywordOverview`（`phrase_these`）→ `keywords_data/google_ads/search_volume/live` + `bulk_keyword_difficulty`（两次 task 合并）
  - 低优先：批量 overview 数据量通常少，暂缓至前 7 项完成后评估

> **⚠️ 注意**：DataForSEO KD 分数算法与 SEMrush 不同，数值不可横向比较。切换后需在客户报告 + UI 中注明口径变更，或统一改用 DataForSEO KD 标准。
> **保留 SEMrush API key**：`batchKeywordOverview` P8.S.8 完成前 + 任何降级回退用。

### Phase 12.C —（预告）

- 跨客户 outcome 聚合视图（`action_type × crisis_type × verdict_rate`）
- 反哺华佗：处方生成时查询历史 outcome 给推荐打置信度
- markisfact adapter（如商务谈成）
- 社媒发布数据回流（Publer + 平台 API）

### Phase 12 风险跟踪

| 风险 | 等级 | 应对 |
|---|---|---|
| 归因窗口太短导致 verdict 都是 `too_early` | MEDIUM | 默认窗口 14 天；GEO 反馈快，CTS 试点用 7 天 |
| AI Tracker 重跑成本（每次 query 费 token）| MEDIUM | 沿用现有 budget cap（22 tools / $1.80）|
| 受控词表覆盖不全，FDE 想做的事没法落 action_type | HIGH | Phase 12.A 只支持 GEO 的 3-4 个 action_type；其他飞轮先用 `ExecutionLog` 自由文本兜底 |
| 6 客户存量数据回填出错 | LOW | 先在 staging 跑回填脚本，校验 100% 通过再上生产 |

---

## 8. 决策日志

> 重大决策记录在此，便于追溯。

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

## 9. 功能完成日志

> 每次上线新功能时在此追加。格式：**[完成日期]** — Phase ID + 描述 + Commit 引用。
> 此日志从 CLAUDE.md §十五.C 迁移至此（2026-05-10），CLAUDE.md 不再维护历史日志。

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
