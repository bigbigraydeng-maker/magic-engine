# Supabase 请求量与数据库错误专项审计

- **审计日期**：2026-08-03
- **项目**：`glbdnayojixmexgofbsd`（CrazyContent — ME 唯一权威库，见 [[reference-render-two-services-crazycontent-vs-magic-engine]]）
- **Postgres**：17.6.1.104 · 区域 ap-southeast-2 · `max_connections = 60`
- **本轮性质**：诊断为主。**不改 schema、不动 RLS、不建索引、不删数据。**
- **审计人**：子牙（Claude Code）

> **执行进度**（本文件随修复推进更新）
>
> | 项 | 状态 | 出处 |
> |---|---|---|
> | P1-1 拓客巡逻慢查询（占全库 DB 时间 24.6%） | ✅ **已上线** 728.8ms → 5.8ms | PR [#784](https://github.com/bigbigraydeng-maker/magic-engine/pull/784) · §6.1 |
> | P0-1 空跑 cron 降频 | ✅ **已上线** 808 → 616 次运行/天。**估算由 7–11% 下修至 2.3–3.1%**，复盘见 §8 | 本 PR · §8 |
> | 🔴 RLS 策略对匿名访客敞开（118 条） | ✅ **已上线** 客户联系资料 / API key 表此前可被任何人读写。**初稿曾误判为「不是漏洞」** | PR [#789](https://github.com/bigbigraydeng-maker/magic-engine/pull/789) · §7.1 |
> | 其余 P0 / P1 / P2 | 📋 待 PM 逐条拍板 | §8 |

---

## 0. 数据来源与可信度声明（先说清楚哪些是实测、哪些是推算）

| 数据源 | 覆盖窗口 | 用途 | 可信度 |
|---|---|---|---|
| `pg_stat_statements` | **98 天 17 小时**（自 2026-04-25 21:08 UTC 未重置） | endpoint 排名、耗时归因 | ⭐⭐⭐ 全量，无采样 |
| `pg_stat_user_tables` / `pg_stat_user_indexes` | 全生命周期累计 | 表大小、索引命中、seq scan | ⭐⭐⭐ 全量 |
| `cron_run_logs` 表 | 真实 24h | cron 实际运行次数与产出 | ⭐⭐⭐ 全量 |
| `EXPLAIN (ANALYZE, BUFFERS)` | 实时 | 慢查询根因 | ⭐⭐⭐ 实测执行计划 |
| Performance / Security Advisor | 实时 | 索引与 RLS 体检 | ⭐⭐⭐ |
| Postgres 日志（MCP `get_logs`） | **只返回最近约 100 条 = 约 3.7 小时** | Postgres 错误明细 | ⭐⭐ **不完整，见 §3 说明** |
| Auth 日志（MCP `get_logs`） | 最近约 100 条 = 约 1 分钟 | 调用来源识别 | ⭐⭐ 采样 |

### ⚠️ 三条必须先讲的限制

1. **17 个 Postgres 错误我只直接看到了 4 个。**
   Supabase MCP 的 `get_logs` 每次只返回最近约 100 条日志，而 Postgres 日志被 checkpoint 行淹没（每 5 分钟 2 行 = 576 行/天），100 条只覆盖约 3.7 小时。我在这个窗口内抓到 4 条 ERROR 并完成了归类，**剩余 13 条无法通过当前工具枚举**。§3 给出可直接在 Supabase Log Explorer 跑的 SQL，能一次拉全 17 条。

2. **我没有采样原始 Kong / Edge 访问日志，这是刻意的。**
   同样受 100 条上限限制，在 23,588 请求/天的量级下只覆盖约 1 分钟，**无法支撑 24 小时的 endpoint 排名**——拿它当排名依据会误导。我改用 `pg_stat_statements` 做 endpoint 归因（覆盖 100% 的 PostgREST 流量，98 天全量）。§4 给出 Log Explorer 查询让你自行核对 4xx/5xx。
   关于"是否有 Bot / 异常请求"：你提供的面板数据本身已经是 24h 全窗口权威答案——**API Gateway 0 errors / 15 warnings，成功率 99.8%**。Bot 扫描或重试风暴必然表现为大量 4xx/404，这里没有。

3. **`pg_stat_statements` 是 98.7 天累计，不是 24h 快照。**
   全部 PostgREST 调用 735,686 次 ÷ 98.7 天 = **平均 7,454 次/天**，而当前观测是约 22,790 次/天（23,588 减去 Auth 716 + Storage 82）。
   **也就是说当前流量约为 98 天均值的 3 倍。**这有两种可能：(a) 近期新增 cron 与页面导致真实增长（最可能）；(b) 部分 Gateway 请求不产生可追踪 SQL（OPTIONS 预检、Realtime、Studio/MCP 访问）。
   因此下文 §4 的排名**以"占 PostgREST 调用的百分比"表述**，这个比例是稳健的；绝对"次/天"只作参考，已标注。

---

## 1. Executive Summary

> ### 🔴 初稿此处写「没有安全事故」—— 这句话是错的（2026-08-03 修正）
>
> 初稿基于「17 个错误无害 + 118 条 RLS 告警符合架构」下了这个结论。**后者是误判**：那 118 条策略实际对匿名访客敞开读写，`outbound_prospects` 2,678 行、`conversation_messages` 2,135 行、`contacts` 557 行、`client_api_keys` 7 行等均可被任何持有公开 anon key 的人读取。已修复，完整复盘见 **§7.1**。
>
> 保留原文不删，是因为「怎么错的」比「结论」更值得留档。

**修正后的结论：请求量与数据库性能是健康的 —— 没有 bug、没有故障、17 个 Postgres 错误确系手写 SQL 所致、用户零影响。但存在一处真实的对外数据泄露（RLS 授权对象写错），已于同日修复。** 24,968 次请求里绝大部分是真实工作，其中约 1/3 花在"给自己记账"和"空转巡逻"上。

### 四个关键判断（性能维度；安全维度见 §7.1）

1. **17 个 Postgres 错误不是应用错误，是人（我）在 MCP 里手写 SQL 写错的语法错误。**
   实测到的 4 条全部是 `42703 / 42601 / 42883 / 42804` 这类"列不存在 / 语法错 / 类型不匹配"，时间戳与当天 MCP `execute_sql` 建表、探索的时间完全重合。
   **没有一条 `42501`（RLS/权限）、`23505`（唯一约束）、`23503`（外键）、timeout 或连接池耗尽。**
   佐证：全库 `xact_rollback` 累计 5,368 次 vs `xact_commit` 6,474,244 次 = **回滚率 0.08%**。这不是一个在报错的数据库。
   → **用户零影响。**

2. **请求量第一大户是 `cron_run_logs` 自己 —— 占 PostgREST 调用的 31.6%。**
   每次 cron 运行写两次：开始时 `INSERT status='running'`，结束时 `UPDATE`。24h 内 808 次 cron 运行 = 1,616 次纯记账写入。
   而 `INSERT` 单次耗时 **7.46ms**（一次简单插入不该这么慢）——因为这张表 24MB 里有 **14MB 是索引**，每插一行要维护 3 个索引。

3. **过去 24 小时有 480 次 cron 运行（占全部运行的 59%）产出为零 —— 一件事都没干。**

   | 任务 | 频率 | 24h 运行 | 处理条数 | 空跑率 |
   |---|---|---|---|---|
   | `poll-visual-jobs` | 每 10 分钟 | 144 | **0** | **100%** |
   | `vision-analyzer` | 每 10 分钟 | 144 | **0** | **100%** |
   | `blog-stuck-generating-sweeper` | 每 15 分钟 | 96 | **0** | **100%** |
   | `zhangqian-sweeper` | 每 15 分钟 | 96 | **0** | **100%** |

   这 480 次空跑各自还要：2 次记账写 + 至少 1 次"有活吗"探询查询。`visual_assets` 的两个 partial 索引各被扫了 39,526 次，是全库第三大读来源（10.9%）——**扫出来全是空的**。

4. **两条查询吃掉了全部数据库执行时间的 38%，而它们都不是"缺索引"，索引都在正常命中。**
   - `lastDiscoverAttemptByCombo`（[src/lib/prospecting/pipeline.ts:71](../../src/lib/prospecting/pipeline.ts#L71)）：平均 **302.8ms**，累计 **898 秒 = 24.6%**
   - `ai_visibility_runs` 列表查询：平均 **221–303ms**，累计 **500 秒 = 13.7%**

   根因是**取了不需要的宽字段**（`summary` jsonb / `raw_response` 长文本，逐行 detoast），以及**索引列与过滤列错位**。见 §6，两条都有 `EXPLAIN ANALYZE` 实证。

### 一句话给 PM

> 系统没坏。17 个"数据库错误"是我自己在后台手敲 SQL 敲错的，客户和功能完全没受影响。真正值得动的是：**有 4 个巡逻任务每 10~15 分钟跑一次，连续 24 小时一件活都没找到，纯烧请求量**。关掉或改成"有活才跑"，请求量能降两成左右。

---

## 2. 当前流量构成

### 2.1 面板数字拆解（24h）

| 服务 | 请求数 | 占比 | warnings | errors | 判读 |
|---|---:|---:|---:|---:|---|
| API Gateway (PostgREST) | 23,588 | 94.5% | 15 | 0 | 主体，全部服务端调用 |
| Auth | 716 | 2.9% | 6 | 0 | `getUser()` 校验 |
| Postgres（直连） | 582 | 2.3% | — | **17** | MCP/Studio 手工 SQL |
| Storage | 82 | 0.3% | 0 | 0 | 素材读写，量极小 |
| **合计** | **24,968** | 100% | 21 | 17 | 成功率 99.8% |

### 2.2 流量来源归因

| 来源 | 估算占比 | 依据 |
|---|---:|---|
| **Cron / 后台任务** | **~60–70%** | 24h 内 808 次 cron 运行；`cron_run_logs` 记账占 PostgREST 调用 31.6%，`visual_assets`/`viral_reference_library`/`content_factory_render_jobs` 等纯 worker 表再占约 20% |
| **正常用户操作**（FDE / PM 打开后台页面） | ~15–25% | Auth 仅 716 次/天，说明真人会话很少；每次页面加载会串起十几个 API 路由 |
| **AI 任务状态轮询**（前端 setInterval） | ~5–10% | 33 处 `setInterval`，绝大多数带停止条件（见 §5） |
| **Realtime 连接** | **0** | 全仓 `grep '\.channel('` / `'\.subscribe('` → **零命中**，项目完全没用 Realtime |
| **React 组件重复调用 / 无限重试** | **~0** | 无 React Query，无 `refetchInterval`；未发现无限重试（见 §5） |
| **第三方 webhook** | 极小 | 未进入前 30 |
| **健康检查** | 极小 | — |
| **Bot / 异常请求** | **~0** | API Gateway 0 errors，Auth 日志采样中 100% 来自 Render 出口 IP `74.220.48.172` + referer `app.magicengine.com.au` |

**核心判断：这是一个「机器为主、人为辅」的流量结构。** 优化的杠杆几乎全在 cron 侧，不在前端。

### 2.3 Auth 侧一个值得注意的现象（非故障）

Auth 日志采样显示：**同一秒内出现 25+ 次 `GET /user`**（2026-08-02 14:05:53），全部 200，全部来自 Render 服务端。

原因：[src/middleware.ts:17](../../src/middleware.ts#L17) 每个 `/dashboard/*` 请求调一次 `supabase.auth.getUser()`，而 [src/lib/auth/require-session.ts:23](../../src/lib/auth/require-session.ts#L23) 等 API 路由各自再调一次。一次页面加载并发打十几个 API → 十几次 `/user`。

每次 `/user` 在 Postgres 侧展开为 5 次查询（`sessions` / `mfa_amr_claims` / `identities` / `mfa_factors` / `users`）。

**但这不是问题**：Auth 全天只有 716 次请求（2.9%），说明真人会话总量很小。**列在这里是为了让你知道，如果将来客户数上去了、真人会话变多，这里会以约 5 倍放大。** 现在不用动。

---

## 3. Postgres 错误明细

### 3.1 已直接观测到的 4 条（约 3.7 小时窗口内的全部 ERROR）

| # | 时间 (UTC) | SQLSTATE | 错误信息 | 涉及对象 | 来源 | 触发条件 | 用户影响 | 修复方式 |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-08-02 10:47:34 | `42804` | `COALESCE types text and jsonb cannot be matched` | 临时探索查询 | MCP `execute_sql`（`POST /mcp`, `bigbigraydeng@gmail.com`） | 手写 SQL 把 text 和 jsonb 放进同一个 `COALESCE` | **无** | 无需修（一次性手写错误） |
| 2 | 2026-08-02 11:50:40 | `42883` | `function max(jsonb) does not exist` | 临时探索查询 | 同上 | 对 jsonb 列用 `max()` | **无** | 同上 |
| 3 | 2026-08-02 11:51:31 | `42601` | `syntax error at or near ":="` | 临时探索查询 | 同上 | 在纯 SQL 里写了 PL/pgSQL 赋值语法 | **无** | 同上 |
| 4 | 2026-08-02 12:10:53 | `42703` | `column "website" does not exist` | 未知表（推测 `clients`） | 同上 | 引用了不存在的列名 | **无** | 同上 |

**共同特征（这是本节最重要的结论）**：

- 全部由 `POST /mcp` 发起，用户 `oauth:e1389fcc-5010-47ef-a27f-3aaf7a7a198a` / `bigbigraydeng@gmail.com` —— 即**我在会话中手写 SQL**，不是应用代码。
- 同一日志窗口内可见大量 MCP migration 语句（`client_projects` 建表、`client_assets` 加 source/ownership 列、`platform_oauth_connections` 加 `microsoft_mail`），**错误与这些探索动作时间完全重合**。
- 全部是**编译期错误**（语法/类型/对象不存在），语句在执行前就被拒绝，**没有任何一条改动过数据**。
- **出现次数**：各 1 次，不重复、无模式、非周期性。

### 3.2 你特别点名的错误码——逐条核对结果

| 错误码 | 含义 | 本次是否发现 | 依据 |
|---|---|---|---|
| `42501` | RLS / 权限错误 | ❌ **未发现** | 应用层全部走 `supabaseAdmin`（service_role），**结构上不可能触发 RLS 拒绝**；Security Advisor 也无相关告警 |
| `23505` | 唯一约束重复写入 | ❌ 未发现 | 采样窗口内 0 条 |
| `23503` | 外键错误 | ❌ 未发现 | 采样窗口内 0 条 |
| `42P01` | 表不存在 | ❌ 未发现 | — |
| `42703` | 字段不存在 | ✅ **1 条**（#4） | 手写 SQL，非应用 |
| timeout | 语句超时 | ❌ 未发现 | 应用侧统一 `SET LOCAL statement_timeout TO '30000ms'`（9,257 次），无超时命中 |
| connection pool exhaustion | 连接池耗尽 | ❌ **未发现** | 实测 `pg_stat_activity` 总连接 **15 / 60**，active **1**，`idle in transaction` **0**。余量充足 |
| trigger / function 错误 | — | ❌ 未发现 | — |

### 3.3 剩余 13 条怎么拿全（给你的工具）

Supabase Dashboard → **Logs → Log Explorer**，粘贴执行（时间范围选 Last 24 hours）：

```sql
select
  cast(t.timestamp as datetime) as ts,
  p.error_severity,
  p.sql_state_code,
  p.query,
  p.detail,
  p.hint,
  p.application_name,
  p.user_name,
  p.database_name,
  event_message
from postgres_logs as t
cross join unnest(t.metadata) as m
cross join unnest(m.parsed) as p
where p.error_severity in ('ERROR','FATAL','PANIC')
order by t.timestamp desc
limit 200
```

看三个字段就能定性：
- `application_name` = `PostgREST` → **真的是应用错误，需要修**
- `application_name` 含 `Supabase Studio` / 为空 + `user_name` = `postgres` → **手工 SQL，不用修**
- `sql_state_code` 是否出现 `42501 / 23505 / 23503` → 出现才需要进入修复阶段

**我的预判：13 条会和已观测的 4 条同源**，理由是全库回滚率仅 0.08%，且应用侧 PostgREST 走 service_role + 参数化查询，产生这类编译期错误的概率极低。**但这是预判不是事实，请以上面查询结果为准。**

### 3.4 一条非 ERROR 但值得记一笔

```
LOG: could not receive data from client: Connection reset by peer
```
出现 1 次（2026-08-02 13:50:36）。这是客户端（Render 实例或 MCP 会话）断开时的正常噪声，`error_severity = LOG` 不是 ERROR，**不计入 17 个错误，无需处理**。

---

## 4. 请求量最高的 20 个 endpoint

### 4.1 说明

- 数据源：`pg_stat_statements`，识别 PostgREST 的 `pgrst_source` CTE 并反解出 REST 语义（表 + 方法）。
- **总量基数**：735,686 次 PostgREST 调用 / 98.7 天 / 1,544 条不同语句 / 累计执行 3,656 秒。
- `占比` 列是稳健指标；`≈次/天` 是 98.7 天均值，**当前实际约为其 3 倍**（见 §0 限制 3），已在列名标注。
- **`4xx / 5xx / response size` 无法从 `pg_stat_statements` 获得**（它只记录 SQL 层）。面板 24h 全窗口数据为 **0 errors / 15 warnings**；逐 endpoint 的 4xx 拆分需用 §4.3 的 Log Explorer 查询。
- `p95 latency` 同样不可得（`pg_stat_statements` 只有 mean/min/max/stddev）；下表给 **mean**，并另附 §6 的实测执行计划。

### 4.2 Top 20

| # | 方法 | 路径（表） | 调用数 | 占比 | ≈次/天(98d均值) | mean ms | 累计秒 | 主要调用来源 | 轮询? | 代码位置 |
|---:|---|---|---:|---:|---:|---:|---:|---|:--:|---|
| 1 | POST | `/rest/v1/cron_run_logs` | 116,484 | **15.8%** | 1,180 | 7.46 | 869 | `startCronRun()` | ✅ | [src/lib/cron/run-logger.ts:17](../../src/lib/cron/run-logger.ts#L17) |
| 2 | PATCH | `/rest/v1/cron_run_logs` | 116,471 | **15.8%** | 1,180 | 0.58 | 67 | `CronRunHandle.finish()` | ✅ | [src/lib/cron/run-logger.ts:29](../../src/lib/cron/run-logger.ts#L29) |
| 3 | GET | `/rest/v1/visual_assets` | 80,303 | **10.9%** | 814 | 0.11 | 9 | `poll-visual-jobs` cron + 视觉页轮询 | ✅ | `src/app/api/cron/poll-visual-jobs/route.ts` · [visuals/page.tsx:1066](../../src/app/dashboard/visuals/page.tsx#L1066) |
| 4 | GET | `/rest/v1/reels_drafts` | 39,917 | 5.4% | 404 | 0.59 | 24 | ReelsStudio 30s 轮询 + PM 待办 | ✅ | [ReelsStudio.tsx:197](../../src/app/dashboard/clients/[id]/_components/ReelsStudio.tsx#L197) |
| 5 | GET | `/rest/v1/client_assets` | 39,604 | 5.4% | 401 | 0.21 | 8 | 素材库 / 工厂装配 | ❌ | `src/lib/team-memory`, 工厂管道 |
| 6 | PATCH | `/rest/v1/viral_reference_library` | 37,129 | 5.0% | 376 | 0.89 | 33 | `viral-analyzer-worker`（每 10 分钟） | ✅ | `src/app/api/cron/viral-analyzer-worker/route.ts` |
| 7 | GET | `/rest/v1/flywheel_metrics` | 33,681 | 4.6% | 341 | 0.20 | 7 | Goal 主指标 / 看板 | ❌ | `src/lib/strategy/*` |
| 8 | GET | `/rest/v1/gsc_performance_snapshots` | 27,204 | 3.7% | 276 | 0.21 | 6 | brand_search_volume 解析 | ❌ | `src/lib/connectors/gsc` |
| 9 | GET | `/rest/v1/client_discovery_jobs` | 19,551 | 2.7% | 198 | 0.33 | 6 | `zhangqian-sweeper`（每 15 分钟） | ✅ | `src/app/api/cron/zhangqian-sweeper/route.ts` |
| 10 | GET | `/rest/v1/blog_posts` | 17,942 | 2.4% | 182 | 0.64 | 12 | `blog-stuck-generating-sweeper` + blog 页 5s 轮询 | ✅ | [blog/page.tsx:131](../../src/app/dashboard/clients/[id]/blog/page.tsx#L131) |
| 11 | GET | `/rest/v1/outbound_prospects` | 14,382 | 2.0% | 146 | 13.86 | 199 | `prospecting-sweep`（每 30 分钟） | ✅ | `src/lib/prospecting/pipeline.ts` |
| 12 | GET | `/rest/v1/clients` | 12,954 | 1.8% | 131 | 0.40 | 5 | 几乎所有路由 | ❌ | 全仓 |
| 13 | GET | `/rest/v1/viral_reference_library` | 11,016 | 1.5% | 112 | 2.86 | 32 | 爆款库页 5s 轮询 + worker | ✅ | [viral-references/page.tsx:428](../../src/app/dashboard/admin/viral-references/page.tsx#L428) |
| 14 | GET | `/rest/v1/content_factory_render_jobs` | 10,087 | 1.4% | 102 | 0.09 | 1 | 工厂 worker sweeper | ✅ | `src/app/api/cron/factory-worker-sweeper` |
| 15 | PATCH | `/rest/v1/content_factory_render_jobs` | 9,669 | 1.3% | 98 | 0.24 | 2 | 同上 | ✅ | 同上 |
| 16 | PATCH | `/rest/v1/outbound_prospects` | 8,672 | 1.2% | 88 | 5.79 | 50 | `prospecting-sweep` | ✅ | `src/lib/prospecting/pipeline.ts` |
| 17 | GET | `/rest/v1/ai_visibility_runs` | 7,542 | 1.0% | 76 | **149.65** | **1,129** | AI 可见度页 / 周报 | ❌ | `src/lib/ai-visibility/*` |
| 18 | GET | `/rest/v1/conversation_messages` | 6,898 | 0.9% | 70 | 0.90 | 6 | Messenger 同步 | ✅ | `src/app/api/cron/messenger-sync-hourly` |
| 19 | GET | `/rest/v1/client_portal_users` | 6,892 | 0.9% | 70 | 0.10 | 1 | middleware 鉴权 | ❌ | [src/middleware.ts:104](../../src/middleware.ts#L104) |
| 20 | GET | `/rest/v1/ai_visibility_queries` | 6,059 | 0.8% | 61 | 1.52 | 9 | AI 可见度 | ❌ | `src/lib/ai-visibility/*` |
| — | GET | `/rest/v1/cron_run_logs`（读） | 4,545 | 0.6% | 46 | **200.06** | **909** | 见 §6.1，最慢查询 | ❌ | [pipeline.ts:71](../../src/lib/prospecting/pipeline.ts#L71) |

**Top 20 合计 ≈ 84% 的 PostgREST 调用。**

### 4.3 逐 endpoint 4xx/5xx / 响应大小怎么拿（Log Explorer）

```sql
select
  r.method,
  r.path,
  count(*) as requests,
  countif(cast(resp.status_code as int64) < 400) as success,
  countif(cast(resp.status_code as int64) between 400 and 499) as c4xx,
  countif(cast(resp.status_code as int64) >= 500) as c5xx,
  round(avg(cast(resp.origin_time as int64)), 1) as avg_ms,
  approx_quantiles(cast(resp.origin_time as int64), 100)[offset(95)] as p95_ms
from edge_logs as t
cross join unnest(t.metadata) as m
cross join unnest(m.request) as r
cross join unnest(m.response) as resp
group by r.method, r.path
order by requests desc
limit 20
```

---

## 5. 重复调用与轮询问题（代码审计）

### 5.1 你列的 15 项逐条核对

| # | 检查项 | 结论 | 证据 |
|---:|---|---|---|
| 1 | React StrictMode 导致开发环境重复调用 | ⚪ **不影响生产** | StrictMode 双调用只在 dev 生效，生产构建无此行为 |
| 2 | `useEffect` 依赖造成循环执行 | 🟡 **1 处结构脆弱** | [viral-references/page.tsx:425](../../src/app/dashboard/admin/viral-references/page.tsx#L425)：effect 依赖 `refs`，而 effect 内的轮询会更新 `refs` → 每次响应都销毁并重建定时器。不是死循环（有 5s 间隔兜底），但计时器不断重置，行为不可预测 |
| 3 | 同页面多组件重复读同一数据 | 🟡 存在但轻微 | `clients` 表被读 131 次/天，多路由各自读；量小，暂不值得改 |
| 4 | `onAuthStateChange` 重复注册未 unsubscribe | ✅ **无问题** | 全仓仅 1 处（[ResetPasswordForm.tsx:22](../../src/app/portal/reset-password/_components/ResetPasswordForm.tsx#L22)），且正确解构了 `subscription` 做清理 |
| 5 | 搜索框缺 debounce | ⚪ 未发现搜索型高频请求进入 Top 20 | — |
| 6 | 页面失焦后继续轮询 | 🟡 **33 个 `setInterval` 中只有 3 处做了可见性守卫** | 有守卫：[use-diagnostic-status.ts:100](../../src/app/dashboard/clients/[id]/diagnostic/_hooks/use-diagnostic-status.ts#L100)、[ReelsStudio.tsx:200](../../src/app/dashboard/clients/[id]/_components/ReelsStudio.tsx#L200)、[useWorkbenchSuggestionEvents.ts:150](../../src/components/workbench/useWorkbenchSuggestionEvents.ts#L150)。其余 30 处后台标签页照跑 |
| 7 | 任务完成/失败后轮询是否停止 | ✅ **绝大多数正确** | blog 页 `if (!hasGenerating) return`、viral 页 `if (!hasAnalyzing) return`、ReelsStudio `if (status !== 'video_generating') return`。**没有发现"永不停止"的轮询** |
| 8 | 请求失败无限重试 | ✅ **未发现无限重试** | ReelsStudio catch 块注释 "keep polling" 但外层有状态停止条件；无指数退避但也无重试风暴 |
| 9 | 频繁调用 `getSession`/`getUser` | 🟡 **结构性放大 5 倍**（见 §2.3） | middleware + 每个 API 路由各调一次；当前总量小（716/天），**暂不影响** |
| 10 | N+1 逐条查询 | 🟡 疑似 1 处 | [viral-references/page.tsx:602](../../src/app/dashboard/admin/viral-references/page.tsx#L602) 并发发 5 个 `pageSize=1` 请求只为拿 5 个计数 —— 应合并为 1 个聚合接口 |
| 11 | 大量 `select('*')` | 🟡 **186 处** | 需逐个评估，其中 `ai_visibility_runs` 的宽字段拉取已被证实是 Top2 耗时源（§6.2） |
| 12 | 列表缺 pagination / limit | 🟡 至少 1 处 | [pipeline.ts:71](../../src/lib/prospecting/pipeline.ts#L71) 无 `.limit()`，拉 7 天全部 `summary` |
| 13 | 重复获取 profile / permissions / settings | 🟡 同 #9 | `client_portal_users` 70 次/天，middleware 每请求一次 |
| 14 | Server / Client Component 重复读同一数据 | ⚪ 未发现显著案例 | — |
| 15 | 每次 render 重建 Supabase client | ✅ **无问题** | [src/lib/supabase.ts:18](../../src/lib/supabase.ts#L18) / `:26` 为模块级单例；6 处 `createClient()` 全在模块顶层或类字段，非 render 内 |

### 5.2 Realtime

**全仓零使用。** `grep '\.channel('` 与 `'\.subscribe('` 在 `src/` 下 **0 命中**。Realtime 不是流量来源，也不需要排查。

### 5.3 真正的重复调用大头不在前端，在 cron

前端轮询做得比预期好（有停止条件、有清理）。**真正的浪费是 §1-3 那 480 次零产出的 cron 空跑**，以及每次 cron 都要写两遍的记账。

---

## 6. 数据库性能问题

### 6.1 最慢查询 #1：`lastDiscoverAttemptByCombo` —— 占全库执行时间 24.6%

- **位置**：[src/lib/prospecting/pipeline.ts:71](../../src/lib/prospecting/pipeline.ts#L71)
- **调用**：2,967 次 · 平均 **302.8ms** · 累计 **898.5 秒**
- **SQL 语义**：`select summary, finished_at from cron_run_logs where job_name='prospecting-sweep' and finished_at >= <7天前>`（**无 `.limit()`**）

实测执行计划（换成命中行数少的 job 以避免影响生产）：

```
Limit (actual time=2.523..4.387 rows=1)
  -> Index Scan using cron_run_logs_job_name_idx on cron_run_logs
       Index Cond: (job_name = 'seo-patrol-daily')
       Filter: (finished_at >= now() - '24:00:00')
       Rows Removed by Filter: 5
```

**根因两条（都不是"缺索引"）**：

1. 现有索引是 `(job_name, started_at DESC)`，但代码过滤的是 **`finished_at`** → 计划里 `finished_at` 只能当 **Filter**，不能当 **Index Cond**。对 `prospecting-sweep` 这种 48 次/天 × 保留 30 天 ≈ 1,440 行的 job，**每次调用都要把这个 job 的全部历史行读出来再过滤**。
2. 每读一行都要 detoast `summary` jsonb（平均 158 字节，但逐行 TOAST 访问开销大）。

**✅ 已修复并上线** — PR [#784](https://github.com/bigbigraydeng-maker/magic-engine/pull/784)，2026-08-02 合并进 main。

采用方案（零 schema 变更、未建任何索引）：过滤条件由 `finished_at` 改为 `started_at`，使其进入 **Index Cond**；并补 `.order('started_at', desc)` + `.limit(500)` 作上限。

改后实测（真实生产数据，**两种写法返回完全相同的 328 行**）：

```
Limit (actual time=0.048..5.751 rows=328)
  Buffers: shared hit=346
  -> Index Scan using cron_run_logs_job_name_idx on cron_run_logs
       Index Cond: ((job_name = 'prospecting-sweep') AND (started_at >= now() - '7 days'))
Execution Time: 5.839 ms
```

对比改前同一条件下的真实计划：

```
Bitmap Heap Scan (actual time=299.177..728.617 rows=328)
  Filter: (finished_at >= now() - '7 days')
  Rows Removed by Filter: 2639          ← 读 2977 行，丢掉 2639 行
  Buffers: shared hit=963
Execution Time: 728.812 ms
```

**728.8ms → 5.8ms（125×），buffers 963 → 346。**

被否决的备选：新建 `(job_name, finished_at DESC)` 索引。理由——现有索引改一个过滤字段即可命中，新建索引会给这张写入最频繁的表再加一份写放大（该表已是 24MB 中 14MB 为索引，见 §6.3）。

### 6.2 最慢查询 #2：`ai_visibility_runs` 列表 —— 占全库执行时间 13.7%

- **调用**：2,241 + 2,239 + 1,093 次 · 平均 **221 / 221 / 95 ms** · 累计约 **1,103 秒**

实测执行计划：

```
Limit (actual time=3.773..53.568 rows=100)
  Buffers: shared hit=104
  -> Index Scan using idx_ai_runs_client_ran_at on ai_visibility_runs
       Index Cond: (client_id = 'c0000000-...')
       Filter: (error_message IS NULL)
Execution Time: 54.444 ms
```

**索引 `idx_ai_runs_client_ran_at (client_id, ran_at DESC)` 正常命中，`shared hit=104` 全内存命中，不缺索引。**

**根因**：`raw_response`（AI 原始回复全文）被 SELECT 出来。取首行只要 3.8ms，取满 100 行要 53.5ms —— 时间全花在逐行 detoast 长文本上。表 13MB 里绝大部分是这一列。

**修复方向（本轮不执行）**：列表视图去掉 `raw_response`，只在详情页按 id 单独取。**预计砍掉这条查询 90% 的耗时，且零 schema 变更、零索引。**

### 6.3 `cron_run_logs` INSERT 慢（7.46ms）

24MB 表里 **14MB 是索引**：

| 索引 | 大小 | 使用次数 | 定义 |
|---|---:|---:|---|
| `cron_run_logs_job_name_idx` | 7,696 kB | 4,272 | `(job_name, started_at DESC)` |
| `cron_run_logs_started_at_idx` | 3,656 kB | 191,894 | `(started_at DESC)` |
| `cron_run_logs_pkey` | 3,216 kB | 116,431 | `(id)` |

每插一行维护 3 个 B-tree。`cron_run_logs_job_name_idx` 使用率最低（4,272 次）但体积最大（7.7MB）——**它就是 §6.1 那条慢查询在用的索引**，不能删，但可以换成能真正命中的定义。

**保留策略是健康的**：60,008 行中只有 4 行超过 30 天，最早 2026-07-03 → 已有 30 天清理机制在跑。**不需要加清理任务。**

### 6.4 数据库资源现状（全部健康）

| 指标 | 实测 | 判定 |
|---|---|---|
| 连接数 | 15 / 60（active 1，idle in transaction 0） | ✅ 余量充足 |
| 回滚率 | 5,368 / 6,474,244 = 0.08% | ✅ 极低 |
| 语句超时 | 统一 30s，无命中 | ✅ |
| 最大表 | `cron_run_logs` 24MB | ✅ 库很小 |
| autovacuum | 大表近期均有执行 | ✅ |
| 死元组 | `cron_run_logs` 11,397（19%） | 🟡 可接受，autovacuum 会追上 |

### 6.5 Performance Advisor（175 条）

| 类型 | 数量 | 级别 | 判定 |
|---|---:|---|---|
| `unused_index` | **95** | INFO | 🟡 **值得清理**。95 个从未被使用的索引持续拖慢所有写入。已确认实例：`idx_visual_assets_queued_at`、`reels_drafts_storyboard_idx` 等 `idx_scan = 0` |
| `unindexed_foreign_keys` | **59** | INFO | ⚪ **本轮不动**。当前无外键相关慢查询，盲目补索引会加重写放大。**符合你"未经 EXPLAIN 不批量建索引"的要求** |
| `auth_rls_initplan` | 13 | WARN | ⚪ 不适用。ME 不走 end-user RLS |
| `multiple_permissive_policies` | 5 | WARN | ⚪ 同上 |
| `no_primary_key` | 2 | INFO | ⚪ 均为归档表（`_archived_keywords_2026_05_30`） |
| `auth_db_connections_absolute` | 1 | INFO | 🟡 Auth 固定 10 连接，建议改百分比策略（升配才生效） |

**你要求检查的字段索引覆盖情况**：
`user_id` / `organisation_id` / `tenant_id` —— **ME 库不存在这些列**（无多租户模型，见 CLAUDE.md 强约束）。实际热点字段是 `client_id` / `status` / `created_at` / `started_at`，**已确认核心表均有覆盖索引且正常命中**（`idx_ai_runs_client_ran_at`、`outbound_prospects_status_score`、`idx_visual_assets_pending`、`cron_run_logs_started_at_idx`）。

---

## 7. 安全问题（Security Advisor，163 条）

| 类型 | 数量 | 级别 | 判定 |
|---|---:|---|---|
| `rls_policy_always_true` | **118** | WARN | 🔴🔴 **初稿判定为「符合架构、不是漏洞、不要改」—— 这个判断是错的，已于 2026-08-03 修正并修复。见下方 §7.1** |
| `function_search_path_mutable` | **28** | WARN | 🟡 **真问题，但优先级低**。`search_path` 可变的函数理论上可被 search_path 注入。示例：`public.handle_updated_at`。修复=加 `SET search_path = public, pg_temp`，无行为变化 |
| `anon_security_definer_function_executable` | **4** | WARN | 🔴 **需要确认**。`anon` 角色可通过 `/rest/v1/rpc/*` 调用 SECURITY DEFINER 函数，例：`public.activate_geo_directive(p_client_id uuid, p_directive_id uuid)`。**匿名用户传任意 client_id 就能激活别的客户的 GEO 指令 —— 这是跨客户越权的形状**。需先确认是否有真实调用方，再决定 `REVOKE EXECUTE FROM anon` |
| `authenticated_security_definer_function_executable` | 4 | WARN | 🟡 同上，风险低一档（需已登录） |
| `rls_enabled_no_policy` | 7 | INFO | 🟡 含 `client_portal_users`（开了 RLS 但无策略 = 对 anon/authenticated 完全拒绝）。**service_role 不受影响，功能正常**，属于"配置不完整但结果安全" |
| `auth_otp_long_expiry` | 1 | WARN | 🟡 邮件 OTP 有效期 > 1 小时，建议收到 1 小时内 |
| `auth_leaked_password_protection` | 1 | WARN | 🟡 未启用 HaveIBeenPwned 泄露密码检查，Dashboard 一键开启 |

### 7.1 🔴 初稿误判修正：118 条 RLS 里有 118 条是真漏洞（2026-08-03）

> **初稿写的是「符合 ME 架构，不是漏洞，不要因为这 118 条告警去改 RLS」。这句话是错的，而且是本次审计最严重的一处失误。**
>
> **错在哪**：我只看了告警的**类型名**（`rls_policy_always_true`），认定它对应 CLAUDE.md 那条「service-role 模板」强约束，就判成设计使然。**没有去查这些策略实际授权给了哪些角色。**

#### 真相

`CREATE POLICY ... FOR ALL USING (true)` **不写 `TO` 子句 = `TO PUBLIC` = 对所有角色生效**，包含 `anon`。而 Supabase 默认已给 `anon` / `authenticated` GRANT 了 public schema 下所有表的增删改查 —— 平时全靠 RLS 兜底，这个模板等于把兜底拆了。

**策略的名字叫 `service_role_full`，实际谁都能用。名字骗了所有人两个月。**

`clients` / `master_briefs` 等早期表写法是对的（`{service_role}`），所以对照测试能挡住 —— 这也是初稿没被戳穿的原因。

#### 实测（生产环境公开 anon key，随浏览器 bundle 公开分发）

| 表 | 匿名可读 |
|---|---:|
| `outbound_prospects` | 2,678 行 |
| `conversation_messages` | 2,135 行 |
| `contact_identities` | 1,260 行 |
| `contacts` | 557 行 |
| `client_connectors` | 12 行 |
| `client_api_keys` | **7 行** |
| `cms_connections` | **3 行** |
| `admin_api_keys` | **1 行** |

写入同样开放：修复后同一请求返回 `42501 new row violates row-level security policy`，修复前无此拒绝。

**未波及**：`platform_oauth_connections`（第三方令牌）、`mtc_purchases` / `mtc_ledger`（充值消费）、`client_portal_users`、`clients`、`master_briefs`、`client_assets`、`voice_*`。

#### 修复

已于 2026-08-03 上线：118 条策略 `ALTER POLICY ... TO service_role`（只改角色不动条件，无「表裸奔」窗口）。保留 `local_cities_read_all` 公开只读（城市名参考数据）。

复测结果：上表全部归零；`local_cities` 仍可读（证明 key 有效、非整体封禁）。

根因已修：`docs/DECISIONS.md` 模板补 `TO service_role` + 事故记录 + 自查 SQL；`CLAUDE.md` 对应条目标红。

#### 两条教训

1. **告警的「类型」不等于「结论」。** 判定一条安全告警是否可忽略，必须查它的**实际生效对象**，不能靠类型名 + 架构假设推断。这次差一点让一个真实的对外数据泄露被一句「符合架构，不要改」封存。
2. **探针要能分辨两种结果。** 初次写权限测试用 `PATCH ?id=eq.<不存在的id>`，前后都返回 204 —— 因为「被拒绝」和「允许但匹配 0 行」返回值相同，**这个探针根本测不出东西**，却被当成了「可写」的证据。有效探针是 `INSERT {}`：`42501` = 被 RLS 拒绝，`23502` = 放行了只是字段不合法。

---

**其余安全项**：`anon_security_definer_function_executable` 的 4 个函数（`activate_geo_directive` / `mtc_deduct_atomic` / `sync_execution_item_on_post_published` / `zhangqian_rate_limit_consume`）—— 调用方全部使用 `supabaseAdmin`，收权不影响功能；`mtc_deduct_atomic` 已有 `p_mtc_amount <= 0` 校验，无法靠负数充值。**尚未处理，见 §8 P0-3。**

---

## 8. 修复优先级

### P0 — 立即修（本周内，收益最大、风险最低）

| ID | 问题 | 动作 | 代码文件 | 预计减少请求 | 风险 |
|---|---|---|---|---:|---|
| ~~**P0-1**~~ ✅ **已上线（估算已下修，见下方复盘）** | 4 个 cron 24h 内 480 次运行 **零产出** | 只降 3 个：`vision-analyzer` `*/10`→`*/30`、`zhangqian-sweeper` `*/15`→`*/30`、`blog-stuck-generating-sweeper` `*/15`→`*/30`。**`poll-visual-jobs` 刻意保持 `*/10`** | `render.yaml` | **~580–770 次/天（2.3–3.1%）** | 低。用户无感 |
| **P0-2** | 每次 cron 写 2 次记账（占 PostgREST 31.6%） | 合并为 1 次：结束时一次性 INSERT 完整行（`startCronRun` 只在内存记 `startedAt`）。代价：任务崩溃时不留"running"记录 —— 可用 Render 自身的 job 状态兜底 | [src/lib/cron/run-logger.ts](../../src/lib/cron/run-logger.ts) | **~800–1,200 次/天（3–5%）** | 中。需确认 `cron-health` 页与 `daily-cron-digest` 不依赖 `status='running'` 中间态 |
| **P0-3** | `anon` 可执行 4 个 SECURITY DEFINER 函数 | **先查是否有真实调用方**，无则 `REVOKE EXECUTE ... FROM anon` | 待定位 migration | 0 | 低（但需先确认，见 §11） |

#### 📉 P0-1 估算下修复盘（初稿 7–11% → 实际 2.3–3.1%）

初稿把 4 个空跑任务一视同仁，假设都能降到每小时。**动手前的核查推翻了这个假设**，记录如下，避免以后再用"空跑率"单一指标拍降频决策：

| 任务 | 初稿计划 | 实际执行 | 为什么改 |
|---|---|---|---|
| `poll-visual-jobs` | `0 * * * *` | **保持 `*/10`** | **不是兜底扫描，是用户在等的完成检查。** ReelsStudio 的「生成视频」按钮写 `reels_drafts.status='video_generating'`，另有 3 个接口写 `visual_assets.generation_status='generating'`，上游全部活跃。降频 = 让人干等 |
| `zhangqian-sweeper` | `0 * * * *` | `*/30` | 确是纯兜底（只把超时任务标 failed，从不干活），但**超时阈值仅 6 分钟**。每小时跑会让真卡住的任务在界面上「运行中」挂最多 66 分钟 |
| `blog-stuck-generating-sweeper` | `0 * * * *` | `*/30` | 同上，**超时阈值 10 分钟**，每小时跑最坏挂 70 分钟 |
| `vision-analyzer` | `0 * * * *` | `*/30` | 非交互式批处理，可放心降；但保守取 30 分钟档与其余对齐 |

**队列是"真空"还是"管道断了"——已用 SQL 证实是前者。** 四个任务要找的状态在表里一条都不存在：`reels_drafts` 无 `video_generating`、`visual_assets` 无 `generating`/`queued_for_retry`、`client_assets` 无 `pending`（最新素材停在 2026-06-10）、`blog_posts` 无 `generating`、`client_discovery_jobs` 无 `pending`/`running`（最新任务 2026-07-17）。**上游没断，只是这些功能当下闲置。**

**教训**：空跑率 100% 只说明"当下没活"，**不说明"可以慢"**。降频前必须再问一句——**有人在等它吗？** 等的人存在，空跑就不是浪费，是待命。

**净效果**：808 → 616 次运行/天（cron 运行总量 −24%）。

### P1 — 本周修（性能收益大，请求数不变）

| ID | 问题 | 动作 | 代码文件 | 预计收益 | 风险 |
|---|---|---|---|---|---|
| ~~**P1-1**~~ ✅ **已上线** | 最慢查询占全库执行时间 24.6% | 过滤条件 `finished_at` → `started_at`（命中现有索引）+ 加 `.limit(500)` | [src/lib/prospecting/pipeline.ts:71](../../src/lib/prospecting/pipeline.ts#L71) | **实测 728.8ms → 5.8ms** | 已合并 PR #784 |
| **P1-2** | `ai_visibility_runs` 列表拉 `raw_response` | 列表查询移除 `raw_response`，详情页按 id 单取 | `src/lib/ai-visibility/*` | **DB 执行时间 −12%** | 低。需检查调用方是否真的用到该字段 |
| **P1-3** | 爆款库页轮询 effect 依赖 `refs`，定时器反复重建 | 依赖数组改为 `[hasAnalyzing, page]`，用 ref 持有 fetch | [viral-references/page.tsx:425](../../src/app/dashboard/admin/viral-references/page.tsx#L425) | 页面打开时 ~720 次/小时 → 稳定 720 | 低 |
| **P1-4** | 同页 5 个 `pageSize=1` 请求只为拿计数 | 合并为一个聚合接口 | [viral-references/page.tsx:602](../../src/app/dashboard/admin/viral-references/page.tsx#L602) | −4 次/加载 | 低 |

### P2 — 后续优化（不急，但要记账）

| ID | 问题 | 动作 | 预计收益 |
|---|---|---|---|
| **P2-1** | 95 个从未使用的索引拖慢所有写入 | 逐个核对后分批 DROP（**必须先确认不是新建功能的预留索引**） | 写入变快，存储下降 |
| **P2-2** | 30 处 `setInterval` 无页面可见性守卫 | 抽公共 `useVisiblePolling` hook，复用 [use-diagnostic-status.ts](../../src/app/dashboard/clients/[id]/diagnostic/_hooks/use-diagnostic-status.ts) 的成熟实现 | 后台标签页归零 |
| **P2-3** | 28 个函数 `search_path` 可变 | 统一加 `SET search_path = public, pg_temp` | 安全加固 |
| **P2-4** | middleware + 每路由重复 `getUser()`（5 倍放大） | 中间件解析一次，经 header 下传 | 当前收益小，**客户数上去后收益大** |
| **P2-5** | 186 处 `select('*')` | 按 §6.2 方法逐个评估宽字段 | 逐步降低 DB 时间 |
| **P2-6** | Auth OTP 有效期 / 泄露密码检查 | Dashboard 开关 | 安全加固 |

---

## 9. 预计可减少的请求比例

| 阶段 | 减少的请求 | 占 24,968 的比例 | 依据 |
|---|---:|---:|---|
| ~~P0-1（4 个空跑 cron 降频）~~ **已上线** | ~~1,700–2,600~~ → **580–770/天** | ~~7–11%~~ → **2.3–3.1%** | **初稿高估。** 只降 3 个（192 次运行/天），`poll-visual-jobs` 因有用户等待而保留。复盘见 §8 |
| P0-2（记账合并为 1 次） | ~600–900/天 | **2.5–3.6%** | 616 次运行 × 1 次（P0-1 生效后基数已从 808 降到 616） |
| P1-3 + P1-4（前端轮询修正） | ~100–500/天 | **0.5–2%** | 取决于管理页打开时长 |
| **合计** | **~1,300–2,200/天** | **约 5–9%** | |

**同时，数据库执行时间预计下降约 35–40%**（P1-1 的 24.6% + P1-2 的 13.7%，二者互不重叠）。

> ⚠️ **诚实标注**：以上是基于 `pg_stat_statements` 98.7 天均值与 24h `cron_run_logs` 实测的推算。因为存在 §0 限制 3 的 3 倍差（当前流量高于历史均值），实际比例可能在 ±5 个百分点内浮动。**建议按 §10 的方法在改动前后各测一次，用实测差值取代这里的估算。**

---

## 10. 验证方案

### 10.1 改动前建立基线（改任何东西之前先跑）

```sql
-- 基线快照：跑一次，把结果存下来
select now() as snapshot_at,
       sum(calls) as pgrst_calls,
       round(sum(total_exec_time)::numeric/1000,1) as pgrst_total_sec
from pg_stat_statements where query like '%pgrst_source%';

select job_name, count(*) runs,
       sum(coalesce(processed,0)) processed,
       count(*) filter (where coalesce(processed,0)=0 and coalesce(completed_count,0)=0) empty_runs
from cron_run_logs where started_at > now() - interval '24 hours'
group by job_name order by runs desc;
```

### 10.2 逐项验证

| 修复项 | 验证方法 | 通过标准 |
|---|---|---|
| P0-1 | 部署后 24h 跑 §10.1 第二段 | 4 个任务的 `runs` 分别降到 24 / 24 / 48 / 48；**`processed` 总和不得减少**（说明没漏活） |
| P0-2 | `select count(*) from cron_run_logs where started_at > now() - interval '24 hours'` | 行数 ≈ cron 运行次数（1 行/次，不是 1 行/次但写 2 遍） |
| P0-2 副作用 | 打开 `/dashboard/admin/cron-health`；检查 `daily-cron-digest` 次日邮件 | 页面正常显示各 job 最近 5 次；digest 仍能识别失败 |
| P1-1 | `EXPLAIN (ANALYZE, BUFFERS)` 改后的查询 | 计划中 `started_at` 出现在 **Index Cond** 而非 Filter；mean 从 302ms 降到 < 20ms |
| P1-2 | 同上，对 `ai_visibility_runs` 列表查询 | Execution Time 从 ~54ms(100行) 降到 < 10ms |
| P1-3 | 浏览器 DevTools Network，打开爆款库页 5 分钟 | `/api/admin/viral-references` 请求数 = 60±2（严格 5s 一次） |
| 全局 | 部署后 48h 看 Supabase 面板 Total Requests | 日请求数下降 11–17%；**成功率仍 ≥ 99.8%** |

### 10.3 回归底线（任何一条被破坏就回滚）

1. `cron_run_logs` 24h 内 `status='failed'` 数量 **保持为 0**
2. 各 cron 的 `processed` 总和 **不低于**改动前
3. `/dashboard/admin/cron-health` 正常渲染
4. Supabase 成功率 **≥ 99.8%**
5. `pg_stat_activity` 连接数 **< 30 / 60**

---

## 11. 回滚方案

| 修复项 | 回滚方式 | 耗时 | 数据风险 |
|---|---|---|---|
| P0-1 cron 降频 | `render.yaml` 改回原 `schedule`，重新部署 | ~5 分钟 | **零**。纯调度参数 |
| P0-2 记账合并 | `git revert` [run-logger.ts](../../src/lib/cron/run-logger.ts) 的 commit | ~5 分钟 | **零**。只影响日志写入方式，不影响任务本身 |
| P0-3 REVOKE EXECUTE | `GRANT EXECUTE ON FUNCTION ... TO anon` | 立即 | **零**。纯权限 |
| P1-1 查询条件调整 | `git revert` | ~5 分钟 | **零**。只读查询 |
| P1-2 移除 `raw_response` | `git revert` | ~5 分钟 | **零**。只读查询 |
| P1-3 / P1-4 前端 | `git revert` | ~5 分钟 | **零** |
| P2-1 DROP 未使用索引 | `CREATE INDEX CONCURRENTLY` 重建（DDL 需 PM `go apply`） | 每个 ~1 分钟 | **零数据风险**，但重建期间写入略慢 |

**全局回滚**：所有 P0/P1 均为纯代码/配置变更，**不涉及任何 schema 变更、不删任何数据**，`git revert` + 重新部署即可完全恢复。P2-1 是唯一涉及 DDL 的项，按 CLAUDE.md 强约束**必须 PM 显式 `go apply`**。

---

## 12. 本轮明确没有做的事（按你的红线）

- ❌ 没有关闭任何 RLS
- ❌ 没有在前端暴露 service_role key（现状也没有：`src/lib/supabase.ts` 的 admin client 只在服务端使用）
- ❌ 没有删除任何数据
- ❌ 没有大规模重构（唯一落地的代码改动是 P1-1，单文件 9 行，见 §6.1）
- ❌ 没有修改生产数据库 schema（本轮所有 SQL 均为只读查询 + `EXPLAIN`）
- ❌ 没有升级 Supabase 套餐
- ❌ 没有用无限重试掩盖错误
- ❌ 没有未经 `EXPLAIN ANALYZE` 就建索引（**两条慢查询都做了 EXPLAIN，结论都是"不需要建索引"**）
- ❌ 没有盲目添加 `SECURITY DEFINER`（相反，发现了 4 个应该收权的）

---

## 附录 A：`pg_stat_statements` 重置说明

当前统计窗口为 98 天 17 小时。若希望后续按天精确对比，可在**改动前**执行一次重置：

```sql
select pg_stat_statements_reset();
```

⚠️ 这会清空全部历史统计（不影响任何业务数据），重置后需等待 24 小时才有可比数据。**建议在 P0 修复部署前一刻执行**，这样"改动后 24h"的数字就是干净的。
