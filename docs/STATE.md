# Magic Engine — 系统当前状态

> **唯一真相源。** 想知道「现在什么在跑 / 部署在哪 / 配了哪些东西」，只看这一份。
> 最后核对：**2026-08-12** —— 本次只重核了 §1 服务构成 · §3.1 ME2 · §4 定时任务全表（从 `render.yaml` / `.github/workflows/` / `src/app/api/cron/` / 生产库对象存在性实读，非人工回忆）。
> **§2 代码规模与 §8 doctor 结果仍是 2026-07-25 的旧数，本次未重跑**，别当现况用。
>
> 未完成的事 → [ROADMAP.md](./ROADMAP.md) · 已上线的事 → [history/CHANGELOG.md](./history/CHANGELOG.md)
> 为什么这么做 → [DECISIONS.md](./DECISIONS.md) · 别再踩的坑 → [PITFALLS.md](./PITFALLS.md) · 环境变量 → [ENV.md](./ENV.md)

---

## 1. 部署

| 项 | 值 |
|---|---|
| **生产地址** | `https://app.magicengine.com.au` |
| **官网**（独立静态站） | `https://magicengine.com.au` ← 源码在仓库 `website/` |
| **部署平台** | Render Blueprint，读 `render.yaml` |
| **部署分支** | **`main`**（推 main 自动部署，约 3-5 分钟） |
| **仓库** | `github.com/bigbigraydeng-maker/magic-engine` |
| **构建** | `npm install && npm run build` → `npm start` |
| **Supabase 项目** | `glbdnayojixmexgofbsd` |
| **AI 网关** | Cloudflare AI Gateway（OpenAI / Anthropic 都走 `*_BASE_URL` 代理） |

> ⚠️ 远程仍存在一个历史 `master` 分支。**部署跟它无关**，别往那推。

**服务构成**（2026-08-12 实读）：1 个 web service + **47 个 Render Cron Job** + 12 个 GitHub Actions workflow（其中 5 个带 `schedule:`）。
> 旧版这里写「28 个 Render Cron Job」，与 §4.1 表格自己的数（41）都对不上，两处都已更正。

**`main` 的分支保护（2026-08-12 实读，别再说「开不了」）**：ruleset **`Protect main`（id 20550157）enforcement=active** —— 禁删 · 禁 non-fast-forward · **只许 merge commit**（不许 squash / rebase）· **所有复审线程必须标记已解决** · 必过状态检查 `ai-orchestrator-tests`；approving review 数要求为 0。
另有两条同名旧 ruleset（`protect-main` / `protect-main Magic Engine`）处于 **disabled**，别被它们误导。

## 2. 代码规模

| 项 | 数量 |
|---|---|
| API 路由（`route.ts`） | **403** |
| 页面（`page.tsx`） | **92** |
| `src/lib/` 业务域 | **78 个目录 / 672 文件** |
| React 组件 | 43 |
| 测试文件 | 315（vitest）+ 5 个 Playwright spec |
| Supabase migration | **172 个文件 → 141 张表** |

技术栈：Next.js 14 App Router · TypeScript 5 strict · Tailwind 3.4 · Supabase(PG + Storage) ·
OpenAI GPT-4o-mini · Anthropic Claude Sonnet · Muapi/Atlas Cloud(图/视频) · HeyGen(头像) ·
DataForSEO(关键词主源) · Publer(发布) · Stripe(MTC 计费) · Resend(邮件)。

**数据访问模型**：全部走 `supabaseAdmin`（service-role key）+ Bearer-token API，**不用 end-user RLS**。
新建表的 RLS policy 一律 service-role 模板，见 [DECISIONS.md](./DECISIONS.md)。

## 3. 模块 ↔ 代码映射

| 模块 | 状态 | 主要代码 | 主要表 |
|---|---|---|---|
| **SEO 内容引擎** | ✅ 成熟 | `lib/{blog,keywords,seo-gap,seo-intelligence,seo-patrol,site-audit,page-rewriter,dataforseo,gsc}` · `api/clients/[id]/{blog,site-audit,strategy}` | `blog_posts` `keyword_snapshots` `client_site_pages` `content_strategy_items` `gsc_performance_snapshots` |
| **GEO / AI 可见度** | ✅ 成熟 | `lib/{geo,ai-tracker,industry-ai-visibility}` · `api/ai-tracker` · `api/baselines` | `geo_directives` `geo_deployments` `ai_visibility_{queries,runs,snapshots}` `industry_ai_visibility_*` `baseline_domains` |
| **社媒内容矩阵** | ✅ 成熟 | `lib/{brief,content,social,reels,visual,images,publer,scheduling}` · `api/clients/[id]/{brief,campaign}` · `api/content/route-{a,b,c}` · `api/visual` | `master_briefs` `campaign_briefs` `content_posts` `visual_assets` `reels_drafts` |
| **AI Content Factory** (P21) | 🔄 建设中 | `lib/{factory,ai-factory,winner-reel-sync}` · `api/factory` · `scripts/factory-worker/` | `content_work_orders` `content_work_order_clips` `factory_balance_ledger` `factory_angle_blocklist` |
| **Ads Intelligence** | 🔄 建设中 | `lib/{meta,google-ads,tiktok-ads,ads-strategy}` · `api/clients/[id]/ad-health` | `ad_daily_insights` `ad_strategy_configs` `ad_health_narratives` |
| **策略层**（Goal→Initiative→Action） | ✅ 上线 | `lib/{strategy,marketing-plan,execution,zhuge}` · `api/{goals,initiatives}` | `goals` `initiatives` `marketing_plans` `execution_items` |
| **飞轮数据闭环** (P12) | ✅ 上线 | `lib/flywheel` · `api/flywheel` | `flywheel_actions` `flywheel_metrics` `flywheel_outcomes` |
| **诊断 / 数据回流** | ✅ 上线 | `lib/{diagnostic,scoring,ga4,gbp,places,competitors,monthly-report,reports}` | `diagnostic_{runs,findings,narratives}` `ga4_traffic_snapshots` `anomaly_signals` |
| **Agent 层** | ✅ 上线 | `lib/{huatuo,zhuge,zhangqian,luban,agent-tools,memory}` | `client_{learned_preferences,proven_patterns,failed_experiments,decision_history}` |
| **MTC 计费 / Portal** (P20) | ✅ 上线 | `lib/{mtc,billing}` · `api/{mtc,stripe}` · `app/portal` | `mtc_*` `client_portal_users` |
| **ME MCP Server** (P34) | ✅ 上线 | `lib/mcp` · `api/mcp` · `api/mcp-admin` | `admin_api_keys` `client_api_keys` `api_key_settings` |
| **Outbound Prospecting** (P35) | 🔄 建设中 | `lib/prospecting` · `api/admin/prospecting` · `api/prospect` | `outbound_prospects` `discovery_leads` |
| **Voice Agent** (P36) | 🔄 建设中 | `lib/voice` · `api/voice` · `scripts/voice/` | 见 `docs/voice-agent/` |
| **ME2 GEO 测量线**（WP02→WP04A） | ✅ **在生产，已真实跑过一次** | `lib/geo-measurement`（契约）· `lib/geo-measurement-store`（不可变存储）· `lib/geo-measurement-runtime`（执行 + 预算闸）· `lib/geo-baseline`（真 provider / parser / store 接线） | `geo_query_sets` `geo_queries` `geo_batches` `geo_observations` `geo_evidence` —— **2026-08-12 实查存在**，装着 3 批次 / 25 观测 / 12 证据（含 Roman Baseline v1，批次 `688bd8ae`） |
| **ME2 执行内核** | ⚠️ **代码在 main，生产未启用** | `lib/kernel`（授权 / 网关 / lineage）· `lib/action-bridge`（K-WP02 的 `MAPPING_TABLE`，**当前是空数组**） | `action_runs` `action_run_steps` `authorization_decisions` `client_automation_policies` —— **2026-08-12 实查：四张表与全部 `kernel_*` RPC 一个都不存在**（与 WP00 2026-08-10 preflight 结论一致）。启用前仍按对象存在性重查 |
| **ME2 共享 Page 能力**（WP06） | ⚠️ **代码在 main，零调用方** | `lib/page-optimization`（resolve / draft / diff / validate）· `lib/capabilities/page-optimization/snapshot.ts` | 无（WP06 冻结决定：不加表、不加 migration、不持久化）。⚠️ 交付的是被缩小的范围 —— 无成本闸门是照实施指令做的，详见 [ROADMAP](./ROADMAP.md) 的 WP06 条目 |
| **ME2 Growth 契约** | ⚠️ **代码在 main，无人调用** | `lib/growth`（纯类型 + 纯校验器） | 无 |

**六支柱诊断维度（不变）**：`seo` / `ai_visibility` / `ads` / `social` / `reputation` / `competitor`。
其中 `reputation` + `competitor` 只诊断、不接飞轮（FDE 外部完成）。

### 3.1 ME2 两块「在仓库里但没在跑」的东西（新窗口必读）

这两块跟表里其它模块**性质不同**：代码合进 `main` 了，但**都不在任何运行时路径上**。看到它们不要以为系统已经在用。

| | 执行内核 | Growth 契约 |
|---|---|---|
| 合入 | PR #863 | PR [#890](https://github.com/bigbigraydeng-maker/magic-engine/pull/890)（合并提交 `700f57e`） |
| 为什么不活动 | 生产 migration `20260808000003_me2_execution_kernel_v1.sql` **未 apply**，且**没有任何提交 / 执行调用方**（没有代码提交 `action_run`，也没有人跑它）。⚠️ **这是 2026-08-10 的快照，不是实时状态** —— 出处是 [WP00 §9.1](./specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md) 当天的对象存在性 preflight（四张表 + lineage 视图全不存在、`kernel_*` RPC 一个都没有）。**启用前必须重查，不许拿这一行当现况。**<br><br>🔴 **但它不是完全没接线** —— 有一条**只读**路径已经在生产跑：`pm-daily-todo` cron → `loadManualItems()` → `pushKernelItems()`（`lib/pm-todo/manual-items.ts`）→ `fetchKernelHandoffTodos()`（`lib/kernel/handoff.ts`）→ `listDeadLetterRuns()` → 查 `action_runs`。migration 未 apply 时这个查询会报错，被调用点的 `.catch` 收成一条警告，**不阻塞其它待办**。改内核之前先把这条路径算进去。 | 全仓**没有任何代码 import 它**（`grep -rn "lib/growth" src/ --exclude-dir=growth` 零结果）。无表、无 migration、无 provider 调用、无 cron、无 API、无 UI |
| 启用需要什么 | apply 是**单独授权的运维动作**，必须 PM 显式 `go`，**绝不夹带进任何 PR** | 等 **WP05（GEO Module v1，#879）** 来 import —— 它是**唯一明确的首个 Domain Module 消费方**。其余 WP 会不会 import 由各自设计时决定，此处不预设 |

🔴 **判定 migration 有没有 apply 只认对象存在性**，不认文件名或版本号 —— 仓库账本会在 apply 时重编号（实测：文件 `20260808000001_*` 在生产账本里记成 `20260809020105`）。

**权威文档**（动 ME2 之前先读）：[WP00 契约冻结](./specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md) · [GEO 测量契约](./specs/2026-08-10-me2-geo-measurement-contract-v1.0.md) · [页面能力契约](./specs/2026-08-10-me2-page-optimization-capability-v1.0.md) · [执行内核 v1](./specs/2026-08-08-me2-execution-kernel-v1.md)

## 4. 定时任务全表

### 4.1 Render Cron（**47 个**，全部 curl `https://app.magicengine.com.au/api/cron/*`，带 `CRON_SECRET` Bearer）

| Cron 名 | 调度 (UTC) | 端点 |
|---|---|---|
| vision-analyzer | `*/10 * * * *` | `/api/cron/vision-analyzer` |
| poll-visual-jobs | `*/10 * * * *` | `/api/cron/poll-visual-jobs` |
| viral-analyzer-worker | `*/10 * * * *` | `/api/cron/viral-analyzer-worker` |
| factory-publish-worker | `*/10 * * * *` | `/api/cron/factory-publish-worker` |
| zhangqian-sweeper | `*/15 * * * *` | `/api/cron/zhangqian-sweeper` |
| blog-stuck-generating-sweeper | `*/15 * * * *` | `/api/cron/blog-stuck-generating` |
| factory-publish-sweeper | `*/15 * * * *` | `/api/cron/factory-publish-sweeper` |
| prospecting-sweep | `*/30 * * * *` | `/api/cron/prospecting-sweep` |
| team-memory-sweeper | `*/30 * * * *` | `/api/cron/team-memory-sweeper` |
| social-comment-autoreply | `*/30 * * * *` | `/api/cron/social-comment-autoreply` |
| messenger-hourly | `10 * * * *` | `/api/cron/messenger-sync-hourly` |
| meta-leads-hourly | `25 * * * *` | `/api/cron/meta-leads-sync` |
| ~~mailbox-sync-hourly~~ | — | **已从 `render.yaml` 移除**，路由 `/api/cron/mailbox-sync` 保留只为手动触发（见 `render.yaml` 注释）。邮箱同步现在不自动跑 |
| viral-discovery-weekly | `0 0 * * *` | `/api/cron/viral-discovery-weekly` |
| site-audit-cron | `0 2 * * *` | `/api/cron/site-audit-jobs` |
| industry-ai-visibility-daily | `30 2 * * *` | `/api/cron/ai-visibility-weekly` |
| goal-current-value-refresh | `0 3 * * *` | `/api/cron/goal-current-value-refresh` |
| google-data-pullback-daily | `0 3 * * *` | `/api/cron/google-data-pullback-daily` |
| social-engagement-pullback | `0 4 * * *` | `/api/cron/social-engagement-pullback` |
| seo-patrol-daily | `0 4 * * *` | `/api/cron/seo-patrol-daily` |
| mailchimp-activity-daily | `40 4 * * *` | `/api/cron/mailchimp-activity-sync` |
| anomaly-detector-daily | `0 5 * * *` | `/api/cron/anomaly-detector` |
| daily-cron-digest | `0 6 * * *` | `/api/cron/daily-cron-digest` |
| winner-reel-sync-daily | `0 15 * * *` | `/api/cron/winner-reel-sync-daily` |
| proposal-view-digest | `0 19 * * *` | `/api/cron/proposal-view-digest` |
| factory-order-scheduler | `0 20 * * *` | `/api/cron/factory-order-scheduler` |
| content-factory-intake | `0 22 * * *` | `/api/cron/content-factory-intake` |
| attribution-cron | `0 */6 * * *` | `/api/cron/attribution` |
| pm-daily-todo | `0 19 * * 0-4` | `/api/cron/pm-daily-todo` |
| site-audit-weekly | `0 1 * * 0` | `/api/cron/site-audit-weekly` |
| weekly-seo-report | `30 18 * * 0` | `/api/cron/weekly-seo-report` |
| ai-tracker-weekly | `0 1 * * 1` | `/api/cron/ai-tracker-weekly` |
| job-boards-weekly | `0 2 * * 1` | `/api/cron/job-boards-weekly` |
| keyword-snapshots-weekly | `0 2 * * 1` | `/api/cron/keyword-snapshots-weekly` |
| zhuge-weekly-recalculate | `0 3 * * 1` | `/api/cron/zhuge-recalculate` |
| reputation-snapshots-weekly | `30 3 * * 1` | `/api/cron/reputation-snapshots-weekly` |
| oztop-seo-optimizer | `0 5 * * 1` | `/api/cron/oztop-seo-optimizer?max=8` |
| cts-seo-optimizer | `30 5 * * 1` | `/api/cron/cts-seo-optimizer` |
| agent-learning-rollup | `0 7 * * 1` | `/api/cron/agent-learning-rollup` |
| factory-stock-refill | `0 19 * * 1` | `/api/cron/factory-stock-refill` |
| blog-weekly | `0 3 * * 2` | `/api/cron/blog-weekly` |

**2026-08-12 补录 —— `render.yaml` 里有、本表此前漏了的 7 条**：

| Cron 名 | 调度 (UTC) | 端点 |
|---|---|---|
| cms-connection-retest | `10 6 * * *` | `/api/cron/cms-connection-retest` |
| kpi-backfill | `20 6 * * *` | `/api/cron/kpi-backfill` |
| execution-auto-run | `30 9 * * *` | `/api/cron/execution-auto-run?dry_run=1` ← **仍挂着空跑参数，只选不做** |
| ad-readback-sweep-daily | `40 20 * * *` | `/api/cron/ad-readback-sweep` |
| benchmark-accumulator | `40 7 * * 1` | `/api/cron/benchmark-accumulator` |
| diagnostic-weekly | `0 8 * * 1` | `/api/cron/diagnostic-weekly` |
| prescription-weekly | `0 8 * * 2` | `/api/cron/prescription-weekly` |

### 4.2 GitHub Actions（12 个 workflow，其中 5 个带 `schedule:`）

| Workflow | 调度 (UTC) | 端点 |
|---|---|---|
| `factory-sweepers.yml` | `*/5 * * * *` | `/api/cron/factory-worker-sweeper` |
| `goals-expiry-check.yml` | `30 3 * * *` | `/api/cron/goals-expiry-check` |
| `baseline-domains-monthly.yml` | `0 3 1 * *` | `/api/cron/baseline-domains-monthly` |
| `winner-reel-sync-daily.yml` | **仅 `workflow_dispatch`** | 定时已迁到 Render（见 DECISIONS 2026-07-12） |

### 4.3 🔴 有路由但没有任何调度器 —— 这些功能永远不会自动跑

2026-08-12 实读：`src/app/api/cron/` 共 **57 个**端点，被调度的有 **53 个**。剩下 **4 个**：

| 端点 | 判断 |
|---|---|
| `admin-key-expiry` | ❓ 需确认是有意停用还是漏配 |
| `flywheel-seo-weekly` | ❓ 同上（Phase 12.I 建的，ROADMAP 标已完成） |
| `memory-extractor` | ❓ 同上（Phase 23 Memory Layer）。⚠️ 注意：**它没被调度 ≠ 从没跑过** —— `client_learned_lessons` 里已有 21 行，是别的路径写进去的 |
| `factory-review-sweeper` | ✅ **有意退役** —— 审核已搬到 `/dashboard/factory`（PR #581），Airtable 停用后该端点必 500 |

> 旧版这里写「50 个端点 / 44 个被调度 / 6 个孤儿」，已过时：`benchmark-accumulator` 与 `kpi-backfill` **都已接上调度**（见 §4.1 补录），不再是孤儿。
> `poster-studio-daily` 亦已于 2026-08-01 前接上调度。
> `factory-worker-sweeper` 由 `factory-sweepers.yml` 通过 `for path in …` 循环调用 —— **按 URL 字面量 grep 会漏掉它，别误判成孤儿**。

> 新建 `/api/cron/*` 路由时，**同一个 PR 里就要加 `render.yaml` 条目**，否则就会多一个僵尸端点。
> `bash scripts/doctor.sh --cron` 会自动查这件事。

### 4.4 常驻 worker（不在 Render 上）

`scripts/factory-worker/worker.mjs` 跑在**本地一台 Mac** 上，认领 Factory 工单。
仓库里**没有 launchd / pm2 配置**，进程挂了没有任何告警 —— 工单会静默卡在 `queued`。见 [PITFALLS F4](./PITFALLS.md)。

## 5. 外部服务

| 服务 | 用途 | 对外封装名 |
|---|---|---|
| OpenAI GPT-4o-mini | 文案 / Vision / Realtime | **Content Engine** |
| Anthropic Claude Sonnet | Brief / 策略 / 诸葛亮 | **Strategy Engine** |
| Muapi (ModelsLab) | 图 / 视频（P21.J 后主用） | **Visual Studio / Video Studio** |
| Atlas Cloud (WaveSpeed / Seedance) | 图 / 视频 | 同上 |
| HeyGen | 数字人头像视频 | **Avatar Studio** |
| DataForSEO | 关键词 / SERP / 外链（**主数据源**） | **Keyword Intelligence** |
| SerpAPI | SERP / Google AI Overviews | — |
| Publer | 多平台排期发布 | **Publishing Hub** |
| Stripe | MTC 充值 | — |
| Resend | 全部事务邮件 | — |
| Cloudflare AI Gateway | OpenAI / Anthropic 代理 | — |
| Apify | scraper（Pinterest / IG / FB 等） | — |
| Unsplash | 免费商用图库 | — |
| Jina.ai Reader | 网页抓取 | **Site Analyzer** |
| Airtable | **正在退役** — 代码仅剩 3 处引用 | **Content Workspace** |
| SEMrush | **已被 DataForSEO 取代** — 代码 0 引用（`SEMRUSH_DB` 除外） | **Keyword Intelligence** |
| Zapier | **已完全移除** | — |

> **UI / 报告 / 客户交付物中禁止出现真实供应商名**，只用封装名。API 路由内部、错误日志、环境变量可用真名。

## 6. 环境变量

完整表见 [ENV.md](./ENV.md)。要点：

- 代码在用 **113** 个 · `.env.example` 59 个 · `render.yaml` 44 个
- **62 个在用变量此前无任何登记**（已在 `ENV.md` 中标 ❌），包括整套 Stripe、`UPLOAD_LINK_SECRET`、`FACTORY_WORKER_TOKEN`、`ADMIN_KEY_KILL_SWITCH`
- 🔴 **已知问题**：`render.yaml` 声明 `ATLAS_API_KEY`，代码读 `ATLAS_CLOUD_API_KEY`。已在 blueprint 补上正确名字，旧名暂留待确认后清理

## 7. 自检

```bash
bash scripts/doctor.sh          # 全查
bash scripts/doctor.sh --env    # 环境变量（掩码，不打印值）
bash scripts/doctor.sh --api    # 外部 API 连通性
bash scripts/doctor.sh --cron   # cron 调度覆盖 + cron_run_logs 最近执行
bash scripts/doctor.sh --md     # 输出 Markdown，可直接粘回本文件 §8
```

## 8. 最近一次 doctor 结果

> 跑于 **2026-07-25**，在**审计容器**里（该容器的网络策略禁止访问外网，
> 且没有任何生产凭证）。所以下面**只有 cron 调度那一段是真实结论**——
> 它不依赖网络或密钥，纯读仓库文件。
> **环境变量与外部 API 两段必须在能拿到 `.env.local` 的机器上重跑才有意义。**

### 环境变量

未采集 —— 审计容器无任何生产凭证，全部报 `未设置`，无参考价值。
请在本地 `.env.local` 就位后跑 `bash scripts/doctor.sh --env`。

### 外部 API 连通性

未采集 —— 容器代理对全部外部主机返回 `403 CONNECT`（policy denial），
`https://app.magicengine.com.au` 等均无法握手。**这是审计环境限制，不代表生产不可用。**

### Cron 调度覆盖 ✅ 真实结论

```
✅  cron 路由总数      50 个 (src/app/api/cron/)
✅  已被调度           44 个 (render.yaml + .github/workflows)
❌  admin-key-expiry           有路由但没有任何调度器 → 永远不会自动跑
❌  benchmark-accumulator      有路由但没有任何调度器 → 永远不会自动跑
❌  flywheel-seo-weekly        有路由但没有任何调度器 → 永远不会自动跑
❌  kpi-backfill               有路由但没有任何调度器 → 永远不会自动跑
❌  memory-extractor           有路由但没有任何调度器 → 永远不会自动跑
⚠️  factory-review-sweeper     无调度 — 已知有意退役（Airtable 停用）
✅  被调度但路由不存在的        无
```

> 数字为 2026-08-01 并入 main 后重跑的结果（原审计时是 38 路由 / 31 调度 / 7 孤儿）。
> `poster-studio-daily` 已在这期间接上调度，不再是孤儿。

### cron_run_logs 最近执行

未采集 —— 需 Supabase 凭证。本地重跑 `bash scripts/doctor.sh --cron` 即可看到每个 job 的最近一次执行时间与状态。

---

## 9. 已知待办（从本次自检直接产出）

| 优先级 | 事项 | 出处 |
|---|---|---|
| 🔴 高 | 确认 Render 面板里 `ATLAS_CLOUD_API_KEY` 是否已配 —— 没配则图片/视频生成在生产上是坏的 | [PITFALLS A1](./PITFALLS.md) |
| 🔴 高 | 6 个孤儿 cron 逐个定性：接调度 还是 标记停用 | §4.3 |
| 🟡 中 | 62 个未登记环境变量补进 `.env.example`（已补，需 review） | [ENV.md](./ENV.md) |
| 🟡 中 | `APIFY_API_KEY` / `APIFY_TOKEN` 双名统一 | [PITFALLS A3](./PITFALLS.md) |
| 🟡 中 | `SEMRUSH_API_KEY` 从 `render.yaml` 清理（注意 `SEMRUSH_DB` 要留） | [ENV.md §4](./ENV.md) |
| 🟡 中 | `src/` 有 22 个文件的注释指向已移走的 `docs/superpowers/specs/*` —— 现在是死路径，跟到底是空。9 份已在 `docs/specs/` 下同名存在，`2026-06-04-a21-stepc-design-v3.md` 本来就不存在（PR 之前就断）。本 PR 刻意没动 `src/`（保住「一行没改」的可复核性），需一个独立小 PR 批量改路径 | 本次并入 main 时发现 |
| 🟢 低 | 远程 `master` 分支及 24 个特性分支清理（须先 verify PR MERGED） | [PITFALLS C2](./PITFALLS.md) |
