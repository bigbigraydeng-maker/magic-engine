# Magic Engine — 技术架构总览

> 更新于 2026-10-24。本文描述逻辑架构，不是生产运行清单。产品语义以[冻结版产品定义](./strategy/ME_PRODUCT_DEFINITION.md)为准；代码路径和运行证据见[系统状态](./STATE.md)。

主要产品规格：[功能地图与人机分工 v1](./specs/2026-10-16-feature-map-and-human-ai-division-v1.md) · [ME 闭环工作流骨架](./specs/2026-10-18-me-closed-loop-skeleton-min-cost.md)。模块细节见[`docs/specs/`](./specs/)中的单项规格。

## 1. 总体结构

```mermaid
flowchart LR
  G[业务目标与客户上下文] --> C[受治理的 Connector]
  C --> IM[Inspect 与 Measure]
  IM --> P[六个营销 Intelligence 支柱]
  P --> N[机会排序与 Next Best Action]
  N --> R[Prescribe]
  R --> A[审批、授权与受控执行]
  A --> X[Act：Kernel / Agent / Connector]
  X --> V[执行回执、Activation 与 Outcome]
  V --> CK[Check：验证与归因]
  CK --> T[Tune：Memory、Playbook 与下一轮判断]
  T --> IM
```

这是一条产品级 IMPACT 闭环。用户界面、API、Agent、Cron 和事件工作流是承载它的运行入口，不是另一套产品闭环。

## 2. 架构层

| 层 | 责任 | 主要对象或代码入口 |
|---|---|---|
| **目标与营销计划** | 保存目标、活动和阶段性营销动作 | Goal、Initiative、Marketing Plan、`plan_data.promo` |
| **数据接入** | 读取渠道状态、接收事件、在获准范围内执行动作 | API、Webhook / Event、MCP、Connector 与 Adapter |
| **Growth State 与 Measurement** | 形成有来源的当前状态、Baseline、Metric 与比较窗口 | 支柱数据、Measurement / Verification 合约 |
| **Intelligence** | 发现并比较六个支柱中的机会 | SEO、AI Visibility / GEO、Social、Ads、Reputation、Competitor |
| **处方与编排** | 把排序后的机会变成下一步动作和受控任务 | DAPE、Agent、Inngest、`execution_items` |
| **Governance 与执行** | 检查权限、授权、预算和风险，记录动作与回执 | Kernel、审批闸、`action_runs` / lineage、Connector |
| **Check 与 Tune** | 核验结果、归因、沉淀有边界的学习 | Outcome、Attribution、Flywheel、Memory、Playbook |

### IMPACT 和 DAPE

IMPACT 是产品、数据、执行和验收共同遵守的端到端 Operating Contract：Inspect → Measure → Prescribe → Act → Check → Tune。DAPE（Discovery → Analysis → Prescription → Execution）是内部工作方法，只服务其中一部分；没有 Check 和 Tune，不能宣称闭环完成。

## 3. 六个支柱共用底座

SEO、AI Visibility / GEO、Social、Ads、Reputation 和 Competitor Intelligence 可以定义各自的证据、指标和动作语义，但共用同一套目标、测量、验证、治理执行、归因和学习边界。不得为每个支柱另建平行 Kernel、Connector、Measurement 或 Memory。

## 4. 当前代码入口

以下路径在本文件所记录的 `main` 仓库快照中存在。路径存在只证明代码组织，不代表能力已接线、可用或在生产运行。

| 产品域 | 仓库代码入口 |
|---|---|
| SEO | `src/lib/seo/` · `seo-agent/` · `seo-intelligence/` · `keywords/` · `site-audit/` · `seo-meta/` |
| AI Visibility / GEO | `src/lib/ai-tracker/` · `geo/` · `geo-baseline/` · `geo-measurement*/` · `industry-ai-visibility/` |
| Social 与内容 | `src/lib/social/` · `content/` · `campaign/` · `reels/` · `factory/` · `content-factory/` |
| Ads | `src/lib/ads/` · `ads-strategy/` · `meta/` · `google-ads/` · `tiktok-ads/` |
| Reputation | `src/lib/reputation/` · `local-reviews/` · `gbp/` · `review/` |
| Competitor Intelligence | `src/lib/competitors/` · `market-intel/` · `dataforseo/` |
| 共享策略与执行 | `src/lib/strategy/` · `marketing-plan/` · `execution/` · `kernel/` · `kernel-approval/` · `action-bridge/` |
| 接线与学习 | `src/lib/inngest/` · `cron/` · `mcp/` · `flywheel/` · `memory/` · `ledger/` |

模块状态、API 路由与调度配置的数量，以及哪些事实有生产证据，统一记录在[系统状态](./STATE.md)并附核验时间。

## 5. 数据与治理边界

- **外部业务系统保有业务真相**：CRM、预约、订单、库存、支付、财务等系统通过 Connector 供 ME 获取必要事实或执行获准动作；ME 不复制它们的完整流程或数据集。
- **保存最少必要证据**：保存稳定外部对象引用、授权快照、动作 / 审批 / 回执、可比较 Outcome 和明确作用域的学习。
- **共享、行业、客户三层分离**：平台共用通用能力；行业差异放入 Playbook / Profile / Policy / Benchmark；客户差异放入配置、批准证据、账户连接和私有 Memory。
- **动作必须可审计**：Act 通过治理边界记录授权、执行者、执行结果和后续验证；产品规格不等于生产接线已经完成。

## 6. 规格与实现证据

- [产品定义](./strategy/ME_PRODUCT_DEFINITION.md)：产品职责、闭环、Connector、Build vs Connect 和行业边界。
- [功能地图](./specs/2026-10-16-feature-map-and-human-ai-division-v1.md)：Goal、营销计划、Agent 队列与人机职责。
- [闭环工作流骨架](./specs/2026-10-18-me-closed-loop-skeleton-min-cost.md)：各业务线连接 IMPACT 的检查结果和断点。
- [ME2 Kernel 契约](./specs/2026-08-08-me2-execution-kernel-v1.md)及相关规格：执行治理的细节。
- [系统状态](./STATE.md)：精确代码提交、仓库配置快照、生产证据日期和未知项。

## 7. 系统地图（动手前先读这一节）

> 核对于 2026-10-25，基线 `main` @ `a454ef4`（本地快照，未刷新远端）。路径来自仓库 `ls` / `grep`，表名来自 `src/lib` 里的 `.from('…')`；**路径存在不等于已接线、已在生产运行**——运行状态以 [STATE.md](./STATE.md) 为准，不确定的写「待确认」。未合并 PR 里的东西不在地图里，改前请先查开着的 PR（见 CLAUDE.md「动手前三步」）。

### 7.1 IMPACT 六步：每一步的代码落点

| 步 | 做什么 | 目录 / 关键文件 | 主要表 | 负责 agent | 现状 |
|---|---|---|---|---|---|
| **I 记录**（Inspect） | 采集站点、关键词、AI 可见度、竞品；形成客户 brief 与基线 | `src/lib/zhangqian/`（`agent.ts` `persistor.ts`）· `diagnostic/collectors/` · `brief/` · `strategy/baseline-audit.ts` | `master_briefs` `clients` `diagnostic_runs` `diagnostic_findings` | 张骞（采集）· 华佗（诊断） | 代码在 main；张骞周一定时（`zhangqian-sweeper`） |
| **M 度量**（Measure） | 目标当前值、渠道指标、取数口径 | `strategy/auto-fetch.ts` `strategy/goals.ts` · `flywheel/metrics/` `flywheel/metric-registry.ts` · `gsc/` `ga4/` · `cron/goal-current-value-refresh` | `goals` `flywheel_metrics` `gsc_performance_snapshots` `ga4_traffic_snapshots` `ad_daily_insights` | 鲁班（落数据，flywheel adapter）· 各支柱 agent | 代码在 main；取数口径 / 成交层级校验在未合并 PR 中（#3064 #3078 #3080 #3085），待确认 |
| **P 处方**（Prescribe） | 打分、出处方、排优先级、拆成动作 | `diagnostic/runner.ts`（6 维打分）· `diagnostic/prescription-generator.ts` `auto-prescribe.ts` `prescription-landing.ts` · `huatuo/` · `zhuge/` · `marketing-plan/generator.ts` | `prescriptions` `initiatives` `marketing_plans` `execution_items` | 华佗 + 诸葛亮 | 代码在 main；华佗无定时，由接口触发 |
| **A 执行**（Act） | 授权后受控执行、留回执 | `kernel/`（`authorize.ts` `runner.ts` `lineage.ts`）· `kernel-approval/` · `action-bridge/` · `execution/` · `luban/` · `marketing-plan/task-dispatcher.ts` · `inngest/functions/` | `action_runs` `action_run_steps` `execution_items` `client_automation_policies` | 鲁班（执行）· 诸葛亮（编排） | Kernel 代码在 main，**哪些支柱真走内核待确认**；社媒发布、GBP 发帖有绕过内核的已知路径（见台账） |
| **C 检查**（Check，验证） | 到期回看、对账、归因、判成败 | `strategy/verdict.ts` · `marketing-plan/promo/reconcile.ts` `daily-watch.ts` `board.ts` · `flywheel/attribution/` `flywheel/execution-outcomes.ts` · `inngest/functions/calendar-closure-audit.ts` `daily-plan-post-measurement.ts` `promo-plan-daily-watch.ts` | `flywheel_outcomes` `flywheel_actions` `cron_run_logs` `goals` | 各支柱 agent + 夜巡 | 推广计划的每周对账 / 每日检查在 main；检查证据接线（PR-C1）**未做** |
| **T 调整**（Tune） | 把结果写回记忆与下一轮判断 | `memory/`（`service.ts` `write-lesson.ts` `learning-rollup.ts`）· `flywheel/tune/` · `huatuo/memory.ts` · `dashboard/learning` | `client_decision_history` `client_learned_preferences` `client_proven_patterns` `client_failed_experiments` `zhuge_feedback_events` | 诸葛亮（兼管，FDE 确认） | 部分在 main；**「调整记录」（`promo/adjust.ts`）尚不存在**，计划在 PR-T1；`agent-learning-rollup` 已知从未写入（#3088） |

跨步骤公共件：`pm-todo/`（今日待办，人工任务三件套 what/how/href）· `cron/registry.ts`（定时任务登记）· `inngest/`（事件与定时函数，`functions/` 下 46 个文件）· `ledger/` + `docs/ledger/`（台账卡）。

### 7.2 六大业务：目录、表、agent、现状

| 业务 | 模块 / 目录（`src/lib/…`） | 关键文件 | 主要表 | 负责 agent | 现状 |
|---|---|---|---|---|---|
| **社媒** | `social/` · `content/` · `campaign/` · `reels/` · `factory/` · `content-factory/` · `maliang/` · `assets/` | `factory/publish/publish-worker.ts` `social/facebook-publisher.ts` `social/comment-autoreply-engine.ts` `social/outbound-claims.ts` · `inngest/functions/daily-plan-auto-publish.ts` `factory-*` | `content_work_orders` `content_posts` `social_plans` `viral_reference_library` `video_clips` `story_packs` `content_factory_render_jobs` | 苏东坡（社媒）· 马良（视觉质检）· 李白（文案） | 代码在 main；**视频只许走 `factory/`**；发布一律需 Ray 授权，草稿→人工转公开，回执不回写人工转公开（已知断点） |
| **SEO** | `seo/` · `seo-agent/` · `seo-intelligence/` · `seo-meta/` · `keywords/` · `site-audit/` · `gsc/` | `seo-meta/cycle/` `seo-intelligence/keyword-snapshots.ts` `seo/post-publish-monitor.ts` `site-audit/job-runner.ts` | `keyword_snapshots` `seo_meta_log` `site_audit_jobs` `client_site_pages` `gsc_performance_snapshots` | 孔子 | 周二巡检在跑（`seo-patrol-daily`）；自动改文案受「信息完整闸门」限制（CLAUDE.md §8） |
| **广告** | `ads/` · `ads-strategy/` · `meta/` · `google-ads/` · `tiktok-ads/` · `meta-oauth/` · `jev/` | `ads-strategy/evaluate.ts` `ads-strategy/draft-and-gate.ts` `ads-strategy/circuit-*.ts` `ads-strategy/agents/` `inngest/functions/ads-*.ts` | `ad_daily_insights` `ad_entity_snapshots` `client_meta_ad_accounts` `ad_strategy_configs` `ads_circuit_events` `ads_growth_states` | 卫青 | 代码在 main；自动权限仅 `bounded_auto` 客户，其余观察模式；Meta 令牌连接问题见 #3092 |
| **口碑** | `reputation/` · `local-reviews/` · `gbp/` · `review/` | `reputation/simaqian-drafts.ts` `reputation/snapshots.ts` `inngest/functions/simaqian-reputation-weekly.ts` | `reputation_snapshots` `review_items` `platform_oauth_connections` | 司马迁 | 每周四读评价、起草回复；回评与 GBP 发帖一律审批；执行路径待确认 |
| **AI 可见度**（GEO） | `ai-tracker/` · `geo/` · `geo-baseline/` · `geo-measurement*/` · `geo-remeasure/` · `industry-ai-visibility/` | `ai-tracker/orchestrator.ts` `ai-tracker/weekly-fanout.ts` `geo/composer.ts` `inngest/functions/ai-visibility-weekly.ts` | `ai_visibility_runs` `ai_visibility_snapshots` `ai_visibility_queries` `industry_ai_visibility_*` `geo_deployments` | 孟子 | 每周三探测；没有直接「手」，处方转内容（苏东坡 / 李白）；「没测成 ≠ 零」 |
| **竞品** | `competitors/` · `market-intel/` · `dataforseo/` | `competitors/watch.ts` `competitors/snapshot.ts` `inngest/functions/competitor-watch-weekly.ts` | `competitor_snapshots` `market_intel_sources` `market_intel_items` `market_intel_digests` | 张骞（挂名） | 周度监控在 main；无独立手册，待确认 |
| **网站** | `cms/` · `page-optimization/` · `page-rewriter/` · `website-publish/` · `tour-catalog/` · `site-audit/` | `cms/seo-fix-orchestrator.ts` `cms/page-upgrade-plan.ts` `cms/github-page-upgrade-publisher.ts` `page-optimization/draft.ts` | `cms_connections` `client_site_pages` `geo_deployments` `blog_posts` | 待确认（页面改动归孔子，行业目录归各客户配置） | 代码在 main；客户落地页必须建在客户自己域名（CLAUDE.md §8）；`tour-catalog/` 带行业语义，改前先过平台层级门 |

> 「网站」在产品定义里不是独立的 6 大支柱（支柱是 SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品）。这里单列是因为改站点的代码（`cms/` `page-*`）被 SEO 与 GEO 共用，找文件时更好找；是否升格为独立业务线：待确认。

### 7.3 Agent 名单（以 [agent 自治运营计划 §4](./specs/2026-09-24-agent-autonomy-operating-plan-v1.md) 为准）

业务：诸葛亮（业务大脑，`zhuge/`）· 卫青 · 孔子 · 孟子 · 苏东坡 · 司马迁 · 张骞（`zhangqian/`）· 华佗（`huatuo/`）· 鲁班（`luban/`）· 马良（`maliang/`）· 李白（`blog/` `geo/`）。工程审查：子牙 · 魏征 · 狄仁杰；达芬奇已撤。手册在 [`docs/agents/`](./agents/)；`docs/agents/00-architecture.md` 的职责表是 6 月版，已过时。代码里多数 agent 不以人名出现，按目录找。

### 7.4 找东西的捷径

- 调外部服务前先查 [STATE.md §5](./STATE.md) 的「已有封装」或 `ls src/lib | grep -i <服务>`。
- 路由层只在 `src/app/api/`（含 `cron/` 72 个目录）；可复用逻辑在 `src/lib/`；页面在 `src/app/dashboard/`。
- 数据库表以 `supabase/migrations/` 为准；新表 RLS 必须 `FOR ALL TO service_role USING (true)`。
- 改了模块边界（新增 / 移动 / 删除目录，或某一步换了负责 agent），**同一个 PR 里改本节**，并按 [`docs/ledger/`](./ledger/README.md) 的现有格式写一张台账卡。不另建地图系统。
