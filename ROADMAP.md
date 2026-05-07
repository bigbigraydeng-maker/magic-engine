# Magic Engine — Roadmap

> 最后更新：2026-05-07 · 当前阶段：**Phase 8.2 全部完成（P8.2.1–P8.2.3 ✅）→ 下一步：Phase 8.3 客户接入向导**
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

- [ ] **P8.3.1** 向导 `/dashboard/clients/new`：Step 1 基本信息 → Step 2 上传 Brief 文件 → Step 3 触发 DNZ 采集 → Step 4 审核采集结果 → Step 5 激活（生成 Master Brief + active GEO Directive）
- [ ] **P8.3.2** Dashboard 简单鉴权（Magic Link，防止数据泄露）

**验收标准**：
- 全程 < 10 分钟完成新客户建档
- 建档完成后，客户主页显示：DNZ采集状态、已采集页面数、Master Brief 状态、GEO Directive 状态

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
- [ ] **P9.0.2** 升级 `src/lib/visual/generation-config.ts`：新增 `getStagesForType(assetType)` 和 `getCancelThresholdMs(provider, assetType)`（待做）
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

## 8. 决策日志

> 重大决策记录在此，便于追溯。

### 2026-04-30
- **战略**：确定 Magic Engine 三大核心：SEO + GEO + 社媒内容矩阵；GEO 为 2026 Q2 核心差异化
- **商业模式**：年度陪跑服务（5–15 万/客户/年），不做 SaaS 月费
- **目标市场** ⭐：2026 主战场 = 澳大利亚（AU）+ 新西兰（NZ）；地域性强，所有功能必须默认 AU/NZ 上下文
- **品牌封装**：第三方供应商封装规范（详见 CLAUDE.md §三）
- **Phase 7 决策（开工前）**：
  - P7.0.1 ✅ AI Tracker 接 OpenAI + Claude + Perplexity
  - P7.0.2 ⚠️ G