# Magic Engine — Claude Code 实施提示词
# Diagnostic Engine (Phase 8.5)

> 使用方式：按 Sprint 顺序，将对应章节的提示词完整复制给 Claude Code。
> 每个 Sprint 完成后，等代码通过验收再进入下一个 Sprint。

---

## Sprint 1 — 数据库基础设施

```
你是 Magic Engine 项目的后端工程师，使用 TDD 模式工作。

【项目背景】
Magic Engine 是一个 Next.js 14 + Supabase 的数字营销 SaaS 工具。
当前工作目录是项目根目录，已有 Supabase 集成、TypeScript strict 模式、Jest 测试框架。

【本次任务：创建 Diagnostic Engine 的数据库表和 TypeScript 类型】

请先阅读以下文件理解上下文：
- DIAGNOSTIC_ENGINE_SPEC.md（数据模型见第 2 节）
- src/types/magic-engine.ts（已有 TypeScript 类型，保持风格一致）
- supabase/migrations/（已有迁移文件，参考命名格式）

【TDD 要求】
1. 先写 TypeScript 类型文件（无需测试，但需完整覆盖数据模型）
2. 再写迁移 SQL，运行前先写验证脚本
3. 最后写类型守卫函数（带 Jest 测试，目标覆盖率 ≥ 90%）

【具体任务】

**Step 1 — TypeScript 类型**
新建文件：src/types/diagnostic.ts
内容要求：
- DiagnosticDimension（'seo'|'ai_visibility'|'ads'|'social'|'reputation'|'competitor'）
- DiagnosticSeverity（'critical'|'high'|'medium'|'low'|'info'）
- FixType（'me_auto'|'fde_manual'|'third_party'）
- DiagnosticRun 接口（字段见 DIAGNOSTIC_ENGINE_SPEC.md §2.1）
- DiagnosticFinding 接口（字段见 §2.2）
- Prescription 接口（字段见 §2.3）
- ExecutionItem 接口（字段见 §2.4）
- PrescriptionIntake 接口（字段见 §4.1）
- PrescriptionContent 接口（字段见 §4.3，含 PrescriptionPhase / PrescriptionAction / KPITarget）
- FindingType 联合类型（见附录 A）

**Step 2 — Supabase 迁移文件**
新建文件：supabase/migrations/20260513000001_diagnostic_engine.sql
内容：四张表（diagnostic_runs / diagnostic_findings / prescriptions / execution_items）
- 完整字段、索引、外键约束，完全按 DIAGNOSTIC_ENGINE_SPEC.md §2 执行
- 表名和字段名用 snake_case
- 每张表加 RLS policies（参考项目内已有迁移文件的 RLS 模式）

**Step 3 — 评分常量**
新建文件：src/lib/diagnostic/constants.ts
内容：
- DIMENSION_WEIGHTS（各维度权重，见 DIAGNOSTIC_ENGINE_SPEC.md §3.2）
- SCORE_THRESHOLDS（green/amber/red 分界线：70/40）
- MAX_COLLECTOR_TIMEOUT_MS = 30000
- SOCIAL_CACHE_TTL_DAYS = 7

**Step 4 — 类型守卫 + 测试**
新建文件：src/lib/diagnostic/__tests__/types.test.ts
测试内容：
- isDiagnosticDimension(value) 类型守卫
- isDiagnosticSeverity(value) 类型守卫
- isValidScore(value) — 0–100 整数
- computeOverallScore(breakdown) — 按 DIMENSION_WEIGHTS 加权，结果取整

【约束】
- TypeScript strict，无 any
- 函数 < 50 行，文件 < 400 行
- 按项目已有 export 风格（具名导出，无默认导出）
- commit message 格式：feat(diagnostic): add DB schema and TypeScript types [P8.5.1-P8.5.2]

【验收标准】
- npm run build 通过
- npm test src/lib/diagnostic/__tests__/types.test.ts 全部通过，覆盖率 ≥ 90%
- 迁移文件语法正确（可用 supabase db lint 检查）
```

---

## Sprint 2 — SEO Collector + 诊断运行器

```
你是 Magic Engine 项目的后端工程师，使用 TDD 模式工作。

【项目背景】
Magic Engine — Next.js 14 + Supabase，TypeScript strict 模式。
Sprint 1 已完成：diagnostic_runs / diagnostic_findings 两张表已存在，
src/types/diagnostic.ts 已定义所有类型，src/lib/diagnostic/constants.ts 已定义权重常量。

【本次任务：SEO Collector + 诊断运行 API】

请先阅读以下文件：
- DIAGNOSTIC_ENGINE_SPEC.md（§3.1 运行器架构、§3.3 SEO Collector 详细规格）
- src/lib/dataforseo/（已有 DataForSEO 集成，了解调用方式）
- src/lib/semrush/（或 src/app/api/ 中调用 SEMrush 的路由，了解 API Key 加载方式）
- src/lib/site-audit/job-executor.ts（参考异步执行模式）
- src/app/api/clients/[id]/blog/[postId]/route.ts（参考路由鉴权模式）

【TDD 顺序：先写测试，再写实现】

**Step 1 — SeoCollector 单元测试（先写）**
新建文件：src/lib/diagnostic/collectors/__tests__/seo-collector.test.ts

Mock 所有外部依赖（DataForSEO / SEMrush API / Supabase），测试：
- collect() 正常返回 { score: number, findings: DiagnosticFinding[] }
- score 在 0–100 之间
- 关键词覆盖率 = 0 时，产生 severity=critical 的 finding（finding_type='keyword_gap_critical'）
- DataForSEO 超时（reject after 30s）时，返回降级结果（空 findings + score=0）而不是抛异常
- 全部 keywords 有排名时，无 keyword_gap_critical finding
- domain_rank < 20 时，产生 finding_type='low_domain_rank'

**Step 2 — SeoCollector 实现**
新建文件：src/lib/diagnostic/collectors/seo-collector.ts

实现 SeoCollector 类，方法：
- async collect(clientId: string, clientDomain: string, keywords: string[]): Promise<CollectorResult>
- 内部 timeout wrapper：Promise.race([actualCall(), timeoutPromise(30000)])
- 评分逻辑按 DIAGNOSTIC_ENGINE_SPEC.md §3.3 SEO Collector 表格
- OpenAI / Anthropic API key 在 handler 内部初始化（不在模块顶层）
- 只产生 severity ∈ ['critical','high'] 的 findings，medium/low 本阶段暂跳过

**Step 3 — DiagnosticRunner 单元测试（先写）**
新建文件：src/lib/diagnostic/__tests__/runner.test.ts

Mock SeoCollector.collect()，测试：
- runDiagnostic(clientId, 'seo') 创建 diagnostic_run，status 从 pending → running → completed
- Collector 失败时，run status → failed，error 写入 summary_text
- overall_score 用 DIMENSION_WEIGHTS 计算（仅 seo 模块时，score = seo_score）
- findings 批量写入 diagnostic_findings

**Step 4 — DiagnosticRunner 实现**
新建文件：src/lib/diagnostic/runner.ts

实现 runDiagnostic(supabase, clientId, module) 函数：
- 创建 diagnostic_run 记录（status=running）
- 按 module 参数决定运行哪些 Collector（本次只实现 seo）
- Promise.allSettled 并发（本次只有一个 Collector，为将来并发预留接口）
- 汇总 score，写 findings，更新 run status=completed

**Step 5 — API 路由**
新建文件：src/app/api/clients/[id]/diagnostic/run/route.ts
新建文件：src/app/api/clients/[id]/diagnostic/latest/route.ts
新建文件：src/app/api/clients/[id]/diagnostic/runs/route.ts

参考 src/app/api/clients/[id]/blog/[postId]/route.ts 的鉴权模式（requireBearerToken）。
run 路由：接受 { module: string }，异步触发 runDiagnostic，立即返回 { run_id }。
latest 路由：返回最近一次 completed 的 run + 对应 findings（按 severity 排序）。

**Step 6 — 路由测试**
新建文件：src/app/api/clients/[id]/diagnostic/__tests__/run.test.ts
- 无 Bearer token → 401
- 无效 module → 400
- 正常请求 → 202，返回 run_id
- GET latest，无历史记录 → 404

【约束】
- TypeScript strict，无 any
- 所有 Supabase 调用和外部 API 调用必须在测试中 mock
- 文件 < 400 行；runner.ts 可以到 200 行
- SDK 客户端在函数内部初始化，不在模块顶层

【验收标准】
- npm test src/lib/diagnostic/ 全部通过，覆盖率 ≥ 80%
- npm test src/app/api/clients/[...]/diagnostic/ 全部通过
- npm run build 通过
- commit：feat(diagnostic): add SEO collector and run API [P8.5.3-P8.5.6]
```

---

## Sprint 3 — Social + Reputation Collector

```
你是 Magic Engine 项目的后端工程师，使用 TDD 模式工作。

【项目背景】
Sprint 1+2 已完成：数据库表、TypeScript 类型、DiagnosticRunner、SeoCollector、诊断 API 均已就位。
runner.ts 使用 Promise.allSettled 并发，新增 Collector 只需注册进 module 映射即可。

【本次任务：Social Collector + Reputation Collector】

请先阅读：
- DIAGNOSTIC_ENGINE_SPEC.md §3.3（Social Collector + Reputation Collector 规格）
- src/lib/apify/social-scraper.ts（已有 scrapeInstagramProfile / scrapeFacebookPage）
- src/lib/apify/client.ts（了解 runActorAndGetResults 的调用方式）
- src/lib/places/client.ts（已有 getBusinessReviews）
- src/lib/diagnostic/runner.ts（了解如何注册新 Collector）

【TDD 顺序】

**Step 1 — Social Collector 测试（先写）**
文件：src/lib/diagnostic/collectors/__tests__/social-collector.test.ts

Mock scrapeInstagramProfile / scrapeFacebookPage，测试：
- collect() 返回 { score, findings }
- 近30天发布 = 0 → finding_type='low_posting_frequency'，severity=critical
- 近30天发布 = 3 → severity=high
- 近30天发布 ≥ 12 → 无 low_posting_frequency finding
- engagement_rate < 0.5% → finding_type='low_engagement_rate'
- 无 Instagram handle（client_brief 未填）→ 返回 severity=high finding，提示完善档案，score=0
- Apify 调用抛异常 → 降级返回，不崩溃
- 7天内有缓存（Supabase 中有 social_cache 记录）→ 不重新调用 Apify（验证 Apify mock 未被调用）

**Step 2 — Social Collector 实现**
文件：src/lib/diagnostic/collectors/social-collector.ts

缓存策略：
- 查询 Supabase，看 diagnostic_findings WHERE client_id=? AND dimension='social' AND created_at > 7天前
- 若存在：复用上次数据，不重新抓取
- 若不存在：调用 Apify，结果写入缓存字段

评分按 DIAGNOSTIC_ENGINE_SPEC.md §3.3 Social Collector 表格（发布频率30% + 互动率40% + 内容多样性30%）

**Step 3 — Reputation Collector 测试（先写）**
文件：src/lib/diagnostic/collectors/__tests__/reputation-collector.test.ts

Mock getBusinessReviews（src/lib/places），测试：
- rating=4.8, reviews=250 → score ≥ 80
- rating=3.2, reviews=8 → score < 40，finding_type='low_rating' severity=high
- reviews=5 → finding_type='few_reviews' severity=medium
- Google Places 返回空结果 → finding_type='no_review_platform'，score=0
- API 超时 → 降级，不崩溃

**Step 4 — Reputation Collector 实现**
文件：src/lib/diagnostic/collectors/reputation-collector.ts
评分公式按 DIAGNOSTIC_ENGINE_SPEC.md §3.3 Reputation Collector 部分。

**Step 5 — 注册进 Runner**
更新 src/lib/diagnostic/runner.ts：
- module='full' 时，并发运行 [SeoCollector, SocialCollector, ReputationCollector]
- 更新 overall_score 计算（使用 DIMENSION_WEIGHTS，未运行的维度不参与加权）
- 更新对应测试

【约束】
- Apify 调用必须在测试中验证"是否被调用"（通过 mock.calls.length 断言）
- 缓存逻辑测试需独立验证（缓存命中时 Apify mock 调用次数=0）
- 无 any，文件 < 400 行

【验收标准】
- npm test src/lib/diagnostic/ 全部通过，覆盖率 ≥ 80%
- npm run build 通过
- commit：feat(diagnostic): add social and reputation collectors [P8.5.7-P8.5.9]
```

---

## Sprint 4 — Competitor Collector

```
你是 Magic Engine 项目的后端工程师，使用 TDD 模式工作。

【项目背景】
前三个 Sprint 已完成：SEO / Social / Reputation Collector，DiagnosticRunner 支持 Promise.allSettled 并发。
本次添加最后一个 Collector：竞品全景。

【本次任务：Competitor Collector】

请先阅读：
- DIAGNOSTIC_ENGINE_SPEC.md §3.3 Competitor Collector 规格
- src/lib/dataforseo/（了解 DataForSEO API 调用方式，特别是 competitors_domain 接口）
- src/lib/semrush/（了解 SEMrush domain_ranks 调用方式）
- src/lib/apify/ad-library.ts（已有 scrapeCompetitorMetaAds）

【TDD 顺序】

**Step 1 — Competitor Collector 测试（先写）**
文件：src/lib/diagnostic/collectors/__tests__/competitor-collector.test.ts

Mock DataForSEO competitors_domain / SEMrush domain_ranks / scrapeCompetitorMetaAds，测试：
- collect() 返回 { score, findings, competitorList }
- DataForSEO 返回 5 个竞品 → findings 中有 evidence_json 包含竞品流量对比表
- 客户流量 / 竞品平均流量 < 0.1 → score < 20，finding_type='traffic_gap_large'，severity=critical
- 客户流量 / 竞品平均流量 ≥ 0.8 → score ≥ 80，无 traffic_gap_large finding
- DataForSEO 返回空（无竞品数据）→ score=50（无数据不惩罚），finding_type=info
- SEMrush domain_ranks API 失败 → 降级，仅用 DataForSEO 数据，不崩溃
- competitorList 最多返回 5 个，按 overlap_score 降序

**Step 2 — Competitor Collector 实现**
文件：src/lib/diagnostic/collectors/competitor-collector.ts

串行执行顺序（有速率限制，不全并发）：
1. DataForSEO competitors_domain → 发现 Top 5 竞品
2. SEMrush domain_ranks × 5（并发，Promise.allSettled）
3. scrapeCompetitorMetaAds × Top 3（串行，避免 Apify 速率限制）

评分：Math.min(100, Math.round((clientTraffic / avgCompetitorTraffic) * 100))

**Step 3 — 注册进 Runner + 更新 full 模式**
更新 runner.ts：
- module='full' → 并发 [SeoCollector, SocialCollector, ReputationCollector, CompetitorCollector]
- module='competitor' → 仅运行 CompetitorCollector
- overall_score 用 DIMENSION_WEIGHTS 加权（本阶段 ads/ai_visibility 维度缺失时，权重重新分配给已有维度）

**Step 4 — AI Visibility Collector（轻量版）**
文件：src/lib/diagnostic/collectors/ai-visibility-collector.ts

仅读取已有的 ai_visibility_runs 表数据，不触发新的 AI Tracker 运行。
- 查最近一次 ai_visibility_run（Supabase query）
- 按 avg_rank 映射 score（见 DIAGNOSTIC_ENGINE_SPEC.md §3.3）
- 若无数据：finding_type='not_mentioned_by_ai'，severity=critical，提示 FDE 先运行 AI Tracker

测试文件：src/lib/diagnostic/collectors/__tests__/ai-visibility-collector.test.ts

【约束】
- 串行调用用 for...of await，不用 Promise.all（Apify 速率限制）
- 竞品域名列表必须写入 evidence_json（作为后续处方的数据依据）
- 无 any，文件 < 400 行

【验收标准】
- 所有 Collector 测试通过，覆盖率 ≥ 80%
- module='full' 运行 5 个 Collector（含 AI Visibility 轻量版）
- npm run build 通过
- commit：feat(diagnostic): add competitor and ai-visibility collectors [P8.5.10-P8.5.12]
```

---

## Sprint 5 — 诊断 UI

```
你是 Magic Engine 项目的前端工程师，使用 TDD 模式工作。

【项目背景】
Magic Engine — Next.js 14 App Router + Tailwind CSS。
后端 API 已就绪：
- POST /api/clients/[id]/diagnostic/run → { run_id }
- GET  /api/clients/[id]/diagnostic/latest → { run, findings[] }
- GET  /api/clients/[id]/diagnostic/runs → 历史列表

【本次任务：诊断仪表板 UI】

请先阅读：
- DIAGNOSTIC_ENGINE_SPEC.md §6（UI 组件规格，详细见 §6.1 DiagnosticDashboard / §6.3 DiagnosticFindingCard）
- src/types/diagnostic.ts（所有类型定义）
- src/lib/diagnostic/constants.ts（SCORE_THRESHOLDS）
- src/app/dashboard/clients/[id]/site-audit/page.tsx（参考相似页面的结构和风格）
- src/app/dashboard/clients/[id]/site-audit/_components/ProgressCard.tsx（参考进度展示组件）

【TDD 顺序：组件先写测试，再写实现】

**Step 1 — useDiagnosticStatus Hook 测试（先写）**
文件：src/app/dashboard/clients/[id]/diagnostic/_hooks/use-diagnostic-status.test.ts
- 轮询 /api/clients/[id]/diagnostic/runs/[runId]/status
- status=running 时，每 3 秒轮询一次
- status=completed → 停止轮询，返回 run 数据
- status=failed → 停止轮询，暴露 error
- 页面离焦时暂停轮询，恢复焦点时继续
（参考已有 src/app/dashboard/clients/[id]/site-audit/_hooks/use-site-audit-status.ts 实现）

**Step 2 — DiagnosticFindingCard 测试（先写）**
文件：src/components/diagnostic/__tests__/DiagnosticFindingCard.test.tsx
- 渲染 severity badge：critical=红色, high=橙色, medium=黄色
- fix_type='me_auto' → 显示蓝色 badge "ME 可修复"，且有深链按钮
- fix_type='fde_manual' → 显示紫色 badge "FDE 操作"
- fix_type='third_party' → 显示灰色 badge "第三方工具"
- onDismiss 被调用时，finding 从 UI 消失
- 无 fix_deeplink 时，不渲染深链按钮（不报错）

**Step 3 — DiagnosticFindingCard 实现**
文件：src/components/diagnostic/DiagnosticFindingCard.tsx

**Step 4 — ScoreGauge 测试（先写）**
文件：src/components/diagnostic/__tests__/ScoreGauge.test.tsx
- score=85 → 渲染绿色样式（≥70）
- score=55 → 渲染橙色样式（40-69）
- score=25 → 渲染红色样式（<40）
- 展示数字 + 文字（健康/待改善/危险）

**Step 5 — ScoreGauge 实现**
文件：src/components/diagnostic/ScoreGauge.tsx
（纯数字展示，不需要 SVG 雷达图，保持简洁，雷达图为 v2 功能）

**Step 6 — 诊断仪表板页面**
文件：src/app/dashboard/clients/[id]/diagnostic/page.tsx
文件：src/app/dashboard/clients/[id]/diagnostic/loading.tsx

页面逻辑：
- 进入页面 → GET /api/clients/[id]/diagnostic/latest（若无记录，显示空状态）
- 空状态：显示"尚未运行诊断"卡片 + [运行首次诊断] 按钮
- 有数据：显示6维度分数卡片（2×3 grid）+ findings 列表
- findings 列表支持按 dimension 筛选 Tab
- [运行新诊断] 按钮 → POST /api/.../diagnostic/run，轮询 status
- 运行中：每个维度卡片显示 skeleton loading

**Step 7 — 侧边栏导航**
在客户详情侧边栏加入"诊断" 菜单项，图标建议用 Stethoscope（lucide-react）。
参考已有侧边栏导航文件位置，在正确位置插入链接。

【命名规则（UI 文案）】
- Google Places / Google Business Profile → 使用真实名称
- OpenAI / Claude → 使用真实名称
- Instagram / Facebook / Meta Ads → 使用真实名称
- SEMrush → "Keyword Intelligence"
- DataForSEO → "SEO Analytics Engine"
- Apify → 根据用途："社媒情报采集器" / "广告情报采集器"

【约束】
- 无 any；组件 props 必须有 interface 定义
- 每个组件 < 150 行；复杂逻辑抽成 custom hook
- 乐观更新：点击"运行诊断"立即显示 loading 状态，不等 API 响应

【验收标准】
- 所有组件测试通过，覆盖率 ≥ 80%
- 页面可访问 /dashboard/clients/[clientId]/diagnostic 不报错
- 运行诊断按钮正常触发，轮询正常显示进度
- npm run build 通过
- commit：feat(diagnostic): add diagnostic dashboard UI [P8.5.13-P8.5.15]
```

---

## Sprint 6 — 处方生成 + 执行看板

```
你是 Magic Engine 项目的全栈工程师，使用 TDD 模式工作。

【项目背景】
前五个 Sprint 已完成诊断引擎全部后端和 UI。
本 Sprint 完成链路的最后两环：处方生成 + 执行进度看板。

【本次任务：处方生成 API + UI + 执行看板】

请先阅读：
- DIAGNOSTIC_ENGINE_SPEC.md §4（处方生成全部规格）
- DIAGNOSTIC_ENGINE_SPEC.md §5（FDE 执行工作流）
- DIAGNOSTIC_ENGINE_SPEC.md §6.2（处方生成 UI 规格）
- src/types/diagnostic.ts（所有类型，包括 PrescriptionIntake / PrescriptionContent）
- src/app/api/clients/[id]/blog/[postId]/route.ts（参考路由鉴权模式）
- src/lib/strategy/analyzer.ts（参考 Claude/OpenAI 调用方式）

【TDD 顺序】

**Step 1 — 处方生成库测试（先写）**
文件：src/lib/diagnostic/__tests__/prescription-generator.test.ts

Mock Anthropic SDK（Claude Sonnet），测试：
- generatePrescription(runId, intake) 调用 Claude Sonnet（不是 GPT，处方是策略层）
- 返回结构符合 PrescriptionContent schema（有 phases[3] / kpi_targets / budget_allocation）
- intake.monthly_budget_aud = 3000 → budget_allocation 总和 ≤ 3000
- phases[0].actions 全部 phase=1
- 每条 action 有 owner_type 字段（'me_auto'|'fde_manual'|'third_party'）
- Claude API 失败 → 抛出有意义的错误，不崩溃无声

**Step 2 — 处方生成库实现**
文件：src/lib/diagnostic/prescription-generator.ts

关键实现：
- buildPrescriptionPrompt(run, findings, intake) → 拼接 prompt（见 DIAGNOSTIC_ENGINE_SPEC.md §4.2）
- Anthropic SDK 在函数内部初始化（不在模块顶层）
- response_format: JSON（使用 Claude 的 structured output）
- 处方 findings 只传 severity ∈ ['critical','high'] 的条目（控制 token）

**Step 3 — generateExecutionItems 函数测试（先写）**
文件：src/lib/diagnostic/__tests__/execution-generator.test.ts

测试：
- 一条 me_auto action → 一条 execution_item，附带 me_deeplink
- 一条 third_party action → 一条 execution_item，steps_json 包含 steps[] 和 verification
- 3个 Phase 的 actions → execution_items 按 phase + sort_order 存储
- 同一个 prescription_id 不能重复生成（幂等检查）

**Step 4 — generateExecutionItems 实现**
文件：src/lib/diagnostic/execution-generator.ts

逻辑：PrescriptionAction → ExecutionItem 映射
- me_auto：steps_json 包含 ME 深链路由
- fde_manual：steps_json 包含分步骤说明（使用封装名）
- third_party：steps_json 包含详细 checklist（见 DIAGNOSTIC_ENGINE_SPEC.md §5.2 示例结构）

**Step 5 — 处方 API 路由**
文件：src/app/api/clients/[id]/prescription/generate/route.ts
文件：src/app/api/clients/[id]/prescription/[pId]/route.ts（GET + PATCH）
文件：src/app/api/clients/[id]/execution/route.ts（GET）
文件：src/app/api/clients/[id]/execution/[itemId]/route.ts（PATCH）

PATCH prescription：
- body: { status: 'approved' | 'rejected', approved_by?: string, rejection_note?: string }
- status → 'approved' 时，自动触发 generateExecutionItems(prescriptionId)
- 已 approved 的处方不可再修改（返回 409）

PATCH execution_item：
- body: { status: 'completed' | 'in_progress' | 'skipped', notes?: string }

**Step 6 — 处方生成 UI**
文件：src/app/dashboard/clients/[id]/prescription/new/page.tsx

步骤流程（参考 DIAGNOSTIC_ENGINE_SPEC.md §6.2）：
Step 1：选择诊断快照（默认最新）
Step 2：Intake Form（必填：business_goal, timeline_urgency, monthly_budget_aud）
Step 3：生成中（Claude Sonnet 处理，显示进度提示）
Step 4：处方审阅 + [批准] / [要求修改] 按钮

**Step 7 — 执行进度看板**
文件：src/app/dashboard/clients/[id]/execution/page.tsx

显示结构（参考 DIAGNOSTIC_ENGINE_SPEC.md §5.3）：
- 按 Phase 分组（Phase 1/2/3 各一个手风琴区块）
- 每条 item 显示：owner_type icon（ME/FDE/第三方）+ 标题 + 状态 + [标记完成] 按钮
- Phase 1 默认展开，Phase 2/3 折叠
- 整体完成进度条（已完成项 / 总项数）

【命名规则（同 Sprint 5）】
Google / OpenAI / Anthropic / Meta 产品 → 真名
SEMrush / DataForSEO / Apify / WordPress 等 → 封装名

处方和执行单中 owner_tool 字段值规范：
- "SEO 内容引擎" / "GEO Composer" / "社媒内容矩阵"（ME 功能）
- "Keyword Intelligence"（SEMrush 封装名）
- "Google Business Profile"（Google 服务，真名）
- "Meta Ads Manager"（Meta 产品，真名）
- "客户网站后台"（CMS 封装名）

【约束】
- 处方 content_json 存储完整 PrescriptionContent JSON，不做字段拆分
- approved 处方生成 execution_items 是同步操作（在 PATCH 响应返回前完成）
- 无 any，TypeScript strict

【验收标准】
- 所有新增测试通过，覆盖率 ≥ 80%
- 完整链路测试：运行诊断 → 生成处方 → 批准 → 看到执行看板
- npm run build 通过
- commit：feat(diagnostic): add prescription generation and execution board [P8.5.16-P8.5.18]
```

---

## 提示词使用说明

**发给 Claude Code 前的检查清单**：
- [ ] Sprint 1 完成并通过验收，再发 Sprint 2
- [ ] 每个 Sprint 完成后，运行 `npm run build` + `npm test` 确认无回归
- [ ] Sprint 2-4 完成后，在真实客户（Oztop / CTS Tours）上手动测试 API
- [ ] Sprint 5 完成后，截图确认 UI 显示正确再进 Sprint 6
- [ ] Sprint 6 完成后，走一遍完整链路：诊断 → 处方 → 批准 → 执行看板

**常见问题处理**：
- 若 Claude Code 问"缺少某个文件路径"：告诉它先 `grep -r` 搜索相关函数名
- 若测试覆盖率不达标：要求补充边界测试（null / 空数组 / 超时场景）
- 若 build 报类型错误：要求修复类型，不允许用 `as any` 绕过
```

---

*文档维护：Sprint 完成后，在对应章节标注完成日期。*
