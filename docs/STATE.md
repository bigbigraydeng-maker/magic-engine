# Magic Engine — 系统状态与证据快照

> **仓库审计**：2026-10-24 03:06 UTC，从远端 `main` 读取，精确提交 `847b8c4c8699ac5aef19f3b6cc57b5a0a36330e3`。
>
> **范围**：核对 Git 树、`package.json`、`render.yaml` 和仓库内已有的带日期证据。此次没有查询生产 Render、Supabase、外部 API 或应用运行日志；下文不会把仓库配置当成当前生产状态。
>
> **产品定义权威来源**：[ME Product Definition v1.0](./strategy/ME_PRODUCT_DEFINITION.md)。本文件只记录实现与运行证据，不能改写产品定义。

## 1. 本次可核验的仓库快照

所有代码计数都来自上述精确提交的 Git Tree；调度配置计数来自该提交中的 `render.yaml` 和 `.github/workflows/`。

| 项 | 仓库事实 | 证据边界 |
|---|---:|---|
| API route handler 文件（`src/app/api/**/route.ts`） | 667 | 文件数；不表示端点健康或可用 |
| Cron API route handler 文件（`src/app/api/cron/**/route.ts`） | 69 | 文件数；不表示有调度器调用 |
| `src/lib/` 下 TS / TSX / JS / MJS 文件 | 3,030 | 文件数；不表示已接线或已投入生产 |
| Supabase migration SQL 文件 | 329 | 仓库文件数；不表示已 apply 到任何数据库 |
| GitHub Actions workflow 文件 | 23 | 仓库文件数；不表示最近成功运行 |
| `render.yaml` 中 `type: cron` 声明 | 51 | 仓库期望配置；不表示 Render 当前有 51 个服务 |

## 2. 产品域的代码入口

下表只说明上述 `main` 提交里有哪些代码目录，不是功能成熟度或生产运行证明。

| 产品支柱 | 代码入口 |
|---|---|
| SEO | `src/lib/seo/`、`seo-agent/`、`seo-intelligence/`、`keywords/`、`site-audit/`、`seo-meta/` |
| AI Visibility / GEO | `src/lib/ai-tracker/`、`geo/`、`geo-baseline/`、`geo-measurement*/`、`industry-ai-visibility/` |
| Social | `src/lib/social/`、`content/`、`campaign/`、`reels/`、`factory/`、`content-factory/` |
| Ads | `src/lib/ads/`、`ads-strategy/`、`meta/`、`google-ads/`、`tiktok-ads/` |
| Reputation | `src/lib/reputation/`、`local-reviews/`、`gbp/`、`review/` |
| Competitor Intelligence | `src/lib/competitors/`、`market-intel/`、`dataforseo/` |
| 共享执行与学习 | `src/lib/strategy/`、`marketing-plan/`、`execution/`、`kernel/`、`kernel-approval/`、`action-bridge/`、`flywheel/`、`memory/` |

## 3. 部署与调度：配置和生产分开记录

- 仓库内 `render.yaml` 的说明将生产 Web 服务记为 Render `crazycontent`，部署分支为 `main`；`render.yaml` 文件本身只定义 Cron 服务。本次没有读取 Render 服务详情，因此当前服务、域名绑定、暂停状态和部署 SHA 均为**未核验**。
- 当前 `render.yaml` 有 51 条 Cron 服务声明。2026-10-21 的[Render 对账台账](./ledger/2026-10-21-render-orphan-cron-services-9.md)记录当时 Render 有 85 个服务，且存在 9 个未登记的孤儿定时服务；台账要求 2026-10-28 复核。这是 10-21 的历史生产证据，不是 10-24 的在线状态。
- `src/lib/cron/registry.ts` 登记 Render、GitHub Actions、外部调度和 Inngest 等调度来源；仓库中声明了任务，不代表任务在生产中运行，也不代表没有仓库声明的任务正在运行。
- 本次没有读取 `cron_run_logs`。各任务最近一次运行时间、成功率、是否已停用和是否产生预期数据均为**未核验**。

## 4. 数据库与应用运行

- 仓库中有 329 个 migration SQL 文件；生产数据库已应用的 migration、当前 schema、行数和数据新鲜度本次均未读取。
- 本次没有访问生产环境变量、密钥、API 连通性、应用健康检查或用户流量。
- 仓库内较新的生产相关记录包括 [2026-10-18 闭环工作流核查](./specs/2026-10-18-me-closed-loop-skeleton-min-cost.md)、[2026-10-18 学习机制与广告工作流核查](./specs/2026-10-18-learning-mechanisms-and-ads-workflow-audit.md)和上面的 2026-10-21 Render 对账。每一项只代表其记录日期的证据，不能外推为当前状态。

## 5. 如何读取本文件

- **产品应当是什么**：看[冻结版产品定义](./strategy/ME_PRODUCT_DEFINITION.md)。
- **代码里有什么**：以本文件顶部记录的精确 `main` SHA 和仓库快照为准。
- **生产里正在发生什么**：只认带查询时间、对象 / 服务标识和结果的在线证据；没有新证据就标为未知，不沿用旧快照冒充当前。
- **未完成任务**：看[路线图](./ROADMAP.md)。
- **功能规格**：看[`docs/specs/`](./specs/)里的单项规格；完整索引当前尚未建立。