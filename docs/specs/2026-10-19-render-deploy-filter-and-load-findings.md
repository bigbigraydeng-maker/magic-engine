# 部署过滤 + 后台卡顿定位（只读调查，未改任何东西）

日期 2026-10-19 · 118 号 · 依据：Render API 只读（服务设置 + 近 400 次部署）、本地 git、Supabase 边缘日志只读聚合（10-17 08:00Z ~ 10-18 13:30Z）。

## 给 PM 的结论
1. **“每次部署后新实例启动就把数据库打爆”这个说法，数据不支持。** 10-18 07:00–12:00Z 之间有 12 次部署，只有一次（11:55Z）附近出现请求洪峰，而那一次碰巧撞上了**每 6 小时一次的定时任务**（飞轮归因，00:00/06:00/12:00/18:00 UTC）。
2. **真正的大洪峰是这个 6 小时一次的定时任务**：每次约 1,400–3,700 次数据库请求（逐行 `DELETE flywheel_outcomes` 500–930 次 + 读 `gsc_performance_snapshots` 800 次），与部署无关（10-17 的 12:00/18:00、10-18 的 00:00/06:00/12:00 五次全部出现）。它跑的那 10–20 分钟，别的页面都会变慢。
3. **另一个慢点是“自动任务健康”检查**：`checkCronHealth` 对约 54 个定时任务**逐个**查一次 `cron_run_logs`（均 2.5 秒/次），被**今日待办**和 `/api/workflows-health` 调用；10-18 11:50–12:10Z 共约 410 次 ≈ 7–8 次页面加载的量。页面一打开就串着发几十次慢查询，是 15–20 秒卡顿的候选原因（与洪峰叠加时更慢）。
4. **“只改文档不触发部署”：render.yaml 做不到，且激进版会让线上读到旧台账。** 见下。

## ① 部署过滤
- 事实：Render 上的 Web 服务 `crazycontent` **不归任何 Blueprint 管**（API 返回 blueprintId=null，没有 buildFilter，自动部署=每次提交）。`render.yaml` 里本来就不定义它，所以改 render.yaml 对它**无效**。要加过滤只能改 Render 上的服务设置（面板 Build & Deploy → Build Filters，或 API `PATCH /services/{id}` 的 `buildFilter`）——**这是改生产设置，不是仓库 PR，需 PM 点头**。
- Render 规则（官方文档）：提交里只要有任何一个文件“不在忽略列表”就会部署；忽略优先于包含；`**` 可匹配多层目录，`*` 不跨 `/`。混合提交（文档+代码）照常部署，安全。
- 近 400 次部署（10-07~10-18，≈33 次/天）逐个用 git 判：
  - 激进版（忽略 `docs/**`、`.claude/**`、所有 `*.md`）会跳过 **62%**；
  - **但线上程序运行时会读这些文档**：`docs/ledger`（今日待办/台账）、`docs/history/CHANGELOG.md`、`docs/skill-cards` 与 `docs/sops/…ads-agent-playbook…`（广告规则）、`docs/agents/prompt-library`。全部是从部署包里的文件读的。台账卡占了这些“纯文档提交”里的绝大多数（415 次文件改动）。激进版会让线上台账/规则停在上一次代码部署的版本。
  - 保守版（只忽略不被线上读取的目录：specs/audits/dispatch/clients/strategy/roadmap/codex-prompts/handoffs/plans/research/tasks/bugs/archive/mockups/screenshots/recruiting/marketing/content/magic-insight、`.claude/`、根目录与 docs 顶层的 `*.md`）只跳过 **14%**（54/400）。
- 建议：**先别为它动生产设置。** 保守版收益只有 14%，而卡顿的主因不是部署次数（见上）。若 PM 仍要，用保守版，改法=在 Render 面板或 API 设置 ignoredPaths；回滚=清空该列表。激进版要先把“线上读台账”改成不依赖部署包（另案）。

## ② 数据库洪峰（只读定位，不改）
| 来源 | 证据 | 请求量 | 与部署关系 |
|---|---|---|---|
| 飞轮归因定时任务（每 6 小时） | `src/lib/flywheel/attribution/job.ts` 逐行 DELETE/POST/PATCH `flywheel_outcomes`；`gsc-bridge.ts` 读 `gsc_performance_snapshots` | 每次 1,400–3,700 | 无关；10-18 12:00 撞上 11:55 部署 |
| `checkCronHealth` 逐任务查询 | `cron_run_logs?select=started_at&job_name=eq.X&order=started_at.desc&limit=1`，被今日待办与 `/api/workflows-health` 调用 | 每次页面加载约 54，实测均 2.5 秒/次 | 无关；是页面加载触发 |
- 建议的改法（都需另案审，**本次未做**）：①归因任务把逐行 DELETE/POST/PATCH 改成批量（按客户一次删、一次 upsert）——飞轮代码，B/A 级看是否碰删除语义；②`checkCronHealth` 改成一次查询取全部任务最近一次（数据库函数 `DISTINCT ON`，新迁移=A 级）或加 30–60 秒缓存；③ 162 行一直 running 的僵尸行：清理是**写生产库**，只出方案——先导出备份（`select * from cron_run_logs where status='running' and finished_at is null`），再由 PM 点头后一条 UPDATE 补终态；本次未碰。
- 没验证的：PM 感到的 15–20 秒具体是哪个页面（若是今日待办，则对应第 3 点；若在每 6 小时整点前后，则对应第 2 点）；Supabase 日志只能回看 24 小时，别的天的洪峰没法复核；僵尸行是否真被 PR 1927 的启动补终态逻辑处理（本仓库未找到启动时执行的代码，`src/instrumentation.ts` 不存在）。
