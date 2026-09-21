# CTS 项目经理 · 日/周/月检查手册

**Claude-side 验证版 · 2026-09-20 首版**

## 一句话

每天/每周/每月，有一个 agent 替 PM 把 CTS Tours NZ（`client_id c0000000-0000-0000-0000-000000000000`）这个客户的所有工作线过一遍：**任务是不是按时跑了、跑出来的东西是不是真的对、有没有等 PM 拍板的事**。这不是新建一个角色——它是 [诸葛亮](../agents/20-zhuge.md)（ME 业务大脑，统筹客户业绩增长）日常该做的事，这份文档把"该做的事"写成一张可核对的清单。

**这一版跑在哪**：三个已建好的 Claude 定时任务——`~/.claude/scheduled-tasks/cts-pm-daily/`、`cts-pm-weekly/`、`cts-pm-monthly/`（提示词见各自 `SKILL.md`）。它们开工时会先读本文档、以本文档的对应章节为准；本文档是权威版本，`SKILL.md` 里的清单只是没有本文档时的兜底。这是 Claude 侧的第一步验证，不是最终形态——见文末 Reuse Statement。

**为什么要有"验证真实产出"这一条，而且是整份文档的重点**：2026-09-20 当天，CTS SEO 自动改文案的流程（SEO Meta-Cycle W38 首跑）六步回执全部显示 `completed`，但实际改上线的两处文案都是错的——一页把另一页的关键词塞了进来、另一页把"免签、不用申请"改成了"申请步骤和时间"，事实说反了，已经通过 chinatravel 仓库 [#201](https://github.com/bigbigraydeng-maker/chinatravel/pull/201)/[#202](https://github.com/bigbigraydeng-maker/chinatravel/pull/202) 撤回。**回执全绿只证明流程走完了，不证明结果是对的。** 本手册每一段检查都要求至少抽查一条，去看"真实那个东西"本身，而不是看流程状态。详见会话记忆 `feedback-seo-optimize-only-with-complete-data`（不在本仓库内，是 Claude 会话记忆体系里的记录）与本文各节的具体例子。

---

## 0. 定位与边界

- **不是新角色**：这套检查是 [诸葛亮](../agents/20-zhuge.md) 统筹客户增长这个既有职责下的一段日常节奏（daily/weekly/monthly operating rhythm），不新建 persona。`docs/agents/` 里的子牙、达芬奇、魏征只是人设文档，没有代码实现，同样不要借用。
- **谁来跑**：目前是三个独立的 Claude 定时任务（见上），跑在本机主目录 `/Users/raydeng/Projects/magic-engine`（不开 worktree，因为只读查询 + 发卡片，不改代码）。
- **能做什么、不能做什么**：这套检查**只读 + 发现问题就发卡片**，不自己改代码、不自己跑数据库迁移。任何需要修的东西，走 `mcp__ccd_session__spawn_task` 发卡片，等 PM 点开才有新窗口去做——这条硬约束见会话记忆 `feedback-coordinator-window-no-code-use-spawn-task`，三个 `SKILL.md` 也各自重复了一遍。
- **跟 PM 说话的格式**：本仓 [`CLAUDE.md`](../../CLAUDE.md) 的硬规矩——一次一件事、先结论后原因（结论一行，原因≤2行）、零黑话、需要拍板的事给"回 `X` 就行"这种一句话回法。三段检查结束时最多汇总 3 件需要 PM 决定的事，其余能自动判断健康/不健康的，直接给结论，不上抛。
- **覆盖范围**：目前只做 CTS 一家客户。Oztop 等其他客户不在这一版范围内——不是不需要，是先在一个客户身上把"检查逻辑本身可信"这件事验证完，再谈铺开（PM 2026-09-19/20 对 SEO 自动化"先验证再重做"的同一条决策，见文末 Reuse Statement）。

---

## 1. 日检（daily）

对应任务：`~/.claude/scheduled-tasks/cts-pm-daily/`。目的：昨天该跑的东西是不是都跑了、跑出来的东西对不对、有没有今天就要 PM 拍板的事。

| # | 检查什么 | 数据从哪来 | 健康 | 需要注意 |
|---|---|---|---|---|
| 1 | **任务健康** | `cron_run_logs` 表最近 24 小时记录，按 CTS 相关任务过滤（广告日报、SEO、Messenger 同步、Meta 留资同步、内容工厂发布、GBP）。判定逻辑见 [`src/lib/cron/health.ts`](../../src/lib/cron/health.ts) 的 `checkCronHealth`，任务清单见 [`src/lib/cron/registry.ts`](../../src/lib/cron/registry.ts)（62 条），后台页面 [`/dashboard/admin/cron-health`](../../src/app/dashboard/admin/cron-health/page.tsx) | 该跑的都跑了、状态不是 `failed`、没有卡死（`running` 超 60 分钟） | 任何一条从没跑过 / 该跑没跑 / 最近一次失败 / 卡死超 1 小时，都是 P0 发现，不是可以跳过的小事 |
| 2 | **真实产出核验（重点，不可省略）** | 挑昨天 1-2 条"系统自动改了客户看得见的东西"的记录，去真实那个东西里核对，不是看日志 | 抽查的那条跟日志描述一致 | 见下方"怎么验"；如果昨天没有任何自动改动，写"昨天没有自动改动"并跳过，不用编造 |
| 3 | **广告日报有没有真的送达** | 用 `ListAgents` / `list_task_runs` 查名字类似"【每天】CTS 广告花费/留资日报"的会话，是不是在过去约 24 小时内跑过 | 跑过，且报告里的数字不是"查不到" | 没跑 = P0 发现。这个任务目前从 `/Users/raydeng/Projects/magic-engine/.claude/worktrees/nervous-aryabhata-3a910b/.env.local` 读取 `RENDER_API_KEY`——这个 worktree 目录随时可能被 Claude 的会话管理机制回收删除，见本文第 4 节"已知运维风险"。发现凭据路径失效，不要只报症状，发卡片要求换成稳定存放位置 |
| 4 | **跨窗口状态** | `ListAgents` | 没有 CTS 相关会话卡在 `busy` 超过 12 小时，也没有 `idle` 但手上挂着未合并、等拍板的 PR | 有 → 一行说清"卡在等什么" |
| 5 | **目标进度一句话** | `goals` 表，CTS 当前 active 目标的 `current_value` vs `target` | 有数据就给一句进度；没有 active 目标就静默跳过，不用提醒"没有目标"这种空话 | — |
| 6 | **纯播放广告有没有在偷偷烧钱进假用户（PITFALLS D9）** | 对当前每一个 `status=ACTIVE` 且 `optimization_goal` 是 `THRUPLAY`/`video_view` 这类纯播放目标的广告组，直接拉最近几天的 `insights`（`breakdowns=publisher_platform`），算 `audience_network` 花费占比 | `audience_network` 占比 <5%（正常波动）；如果广告组建的时候就手动设了 `targeting.publisher_platforms` 排除 `audience_network`，占比应该接近 0% | **占比 ≥20% = P0 发现，当天必须报**：这是 2026-09-16 就记录过的坑（钱流进 Audience Network"奖励视频"版位，用户是游戏里为换奖励被迫看完，不是真实感兴趣的人，完播率虚高但都是假信号）。2026-09-21 CTS 新建的圣诞团 ThruPlay 广告组就是因为建的时候没设这个排除，第二天实测 95%+ 花费又进了这个坑——**任何新建的纯播放广告组都要当天查一次这一项，不要等到有人主动问才查**。查的方法不是只看 `targeting.publisher_platforms` 这个设置本身（设了不代表真的挡住了，还没有拿真实花费验证过），必须拉真实 `insights` 数据核实 |
| 7 | **给 PM 的决策清单** | 汇总以上最多 3 条，每条一句话能回、给"回 `X` 就行" | — | — |

**"真实产出核验"具体怎么做（挑 1-2 个即可，不用每条都查）**：

- SEO 自动改了某页 meta 标题/摘要 → 直接 WebFetch/curl 客户官网那一页的真实 HTML，把标题、摘要跟 `seo_meta_log` 里记的改动逐字比对——**不是看这条记录的 `applied`/`completed` 状态**。这正是 2026-09-20 出事的那一步：六步回执全绿，没人去看真的改成了什么。
- Messenger/WhatsApp 昨天有 governed-reply 自动回复了客户私信 → 去 Meta 后台或 CRM 里查那条真实对话的回复内容，不是只看内部日志里"已回复"这个状态位。
- 广告日报本该发出——不只看 cron/任务状态是 `success`，要打开那次运行产出的报告文本，确认里面的花费、留资数字是具体数字而不是"查不到"占位语。

结尾格式：【CTS 日检 · <当天日期>】。一切正常、没有要拍板的事，就一句话说清楚，不用硬凑内容显得忙。

---

## 2. 周检（weekly）

对应任务：`~/.claude/scheduled-tasks/cts-pm-weekly/`。目的：上周交的活是不是真的做到了、这周先做哪个、周报这个自动化本身有没有断流、有什么风险要提前说。

| # | 检查什么 | 数据从哪来 | 健康 | 需要注意 |
|---|---|---|---|---|
| 1 | **验收上周交付** | `gh pr list --repo bigbigraydeng-maker/magic-engine --search "merged:>=<7天前>"`（过滤 CTS 相关标题/路径）+ 同样查 chinatravel 仓库（CTS 官网的落地仓库，这次事故的撤回 PR 就在那边） | 每条一句话：按时？一次过审还是被打回过？抽查后跟实际系统一致？ | 抽查环节不能省——这正是本文档反复强调的"验真实产出"，见下方例子 |
| 2 | **这周先做哪个** | 打开的 CTS 相关 issue / ROADMAP 条目，按 [`docs/ENGINEERING_QUALITY_GATES.md` §11](../ENGINEERING_QUALITY_GATES.md#11-资源优先级判断pm-2026-09-07-拍板) 三维打分（频率／IMPACT 闭环关键度／收入关联度） | 打分过程要摆出来（频率 X／IMPACT Y／收入 Z → P 几），不能只给结论 | — |
| 3 | **周报本身有没有断流** | `weekly-seo-report` cron 在 `cron_run_logs` 里的运行记录 + [`src/lib/weekly-report/build.ts`](../../src/lib/weekly-report/build.ts) 自带的新鲜度戳（一般数据超过 3 天、SEO 排名数据超过 8 天会标"⚠️ 数据断流"） | 有新鲜数据、没有断流标记 | 断流本身就是发现，直接引用周报自己标出来的那句话，不用重新推导 |
| 4 | **风险清单** | 结合前三项 + 日检累计的发现，判断下周大概率会出问题的点 | — | 每条一行 + 为什么 |
| 5 | **窗口清理** | `ListAgents` + PR 实际状态（只认已合并/已关闭的 PR 或验证过的真实结果，**会话自己写的 ✅ 或标题声称"完成"不算数**——这是 2026-09-20 当天的纠正） | 列出可以归档的会话，等 PM 确认，不擅自归档 | — |

**"验真实产出"具体怎么做（每周至少抽 1 条）**：

- 上周某条 PR 号称"修好了某个从没跑过的 cron"→ 去 `cron_run_logs` 或 [`/dashboard/admin/cron-health`](../../src/app/dashboard/admin/cron-health/page.tsx) 查它本周是不是真的开始有正常运行记录了，不是信 PR 描述自己写"已修复"。
- 周报里"系统本周自动改了 N 个页面标题"→ 抽一个页面，用 WebFetch/get_page_text 抓官网那一页现在的标题，跟 `seo_meta_log` 记的改动内容比对，确认真的改对了、改上线了。
- 上周有交付涉及客户对外内容（社媒/广告文案）→ 去对方平台（Meta 后台、官网）核对那条内容现在的真实样子，不是看内部草稿表状态是 `published`。

结尾格式：【CTS 周检 · <周起始日期>】，最多 3 条待拍板，给"回 `X` 就行"。没有要拍板的事，一句话说清楚。

---

## 3. 月检（monthly）

对应任务：`~/.claude/scheduled-tasks/cts-pm-monthly/`。目的：跟目标和钱对一遍账、每个自动化这个月是不是真的值得继续开着、有没有攒了一个月的收尾事项。

| # | 检查什么 | 数据从哪来 | 健康 | 需要注意 |
|---|---|---|---|---|
| 1 | **目标对账** | `goals` 表，CTS 本期 `baseline`/`current_value`/`target`（表结构见 [`supabase/migrations/20260619000003_phase31_strategy_layer_foundation.sql`](../../supabase/migrations/20260619000003_phase31_strategy_layer_foundation.sql)） | 一句话人话结论：超额完成 / 在轨 / 落后 | `current_value` 由 `goal-current-value-refresh`（每日 cron）刷新，要顺手确认这个 cron 本月一直有跑，不然这个数字本身就是旧的 |
| 2 | **花费对账** | 上月广告花费汇总（`ad_daily_insights` 或对应表）+ 按量计费的 API 成本（DataForSEO、AI 生成，参考仓库记忆里已登记的单价）；对照 `clients.seo_config` 或其他地方有没有写明的预算/目标 | 花费在预期范围内 | 没有任何地方写预算，这本身是个发现，不是可以假装没这回事 |
| 3 | **"这些自动化这个月还值不值"复盘（核心，这条不是走过场）** | 逐个检查 CTS 当前启用的自动化：`clients.seo_config` 里的开关、Inngest 里对 CTS 生效的函数、`render.yaml` 里跟 CTS 相关的 cron | 每一条都产出过至少一次**验证过是对的**真实结果，值这份成本/风险 | 开着但从没被人验证过真实产出的，或者整月都关着又没有重新打开的计划的，都要点名。这条的由来就是 2026-09-20 当天的教训——一整套 SEO 自动化上线当天就出事，事后复盘发现它对 CTS 这种低用量客户本身投入产出比就不划算（见文末 Reuse Statement 引用的记忆），"值不值"应该定期问，不该等出事才问 |
| 4 | **月报材料** | [`/api/reports/[clientId]/monthly`](../../src/app/api/reports/[clientId]/monthly/route.ts) 目前只能手动触发，没有排期自动生成 | 本月已经手动生成过一次 | 没生成过是发现，不代表要你现在去生成——按 CLAUDE.md 铁律 3，能自动化就该自动化，这也是一条可以发卡片的候选 |
| 5 | **收尾清理** | 跟周检第 5 条一样，但看的是"挂了一整月没有 PR 也没有下一步"的事项 | — | 列出来等 PM 确认，不擅自处理 |

结尾格式：【CTS 月检 · <月份>】，最多 3 条待拍板，给"回 `X` 就行"。

---

## 4. 已知运维风险

**CTS 广告日报任务（`~/.claude/scheduled-tasks/cts-daily-ads-report/`）目前从一个临时 worktree 目录读取凭据，这个目录随时可能被回收，这是需要修的问题，不是可以先放着的小事。**

具体位置：`SKILL.md` 第一步写死了路径 `/Users/raydeng/Projects/magic-engine/.claude/worktrees/nervous-aryabhata-3a910b/.env.local`，从里面取 `RENDER_API_KEY`，再用这个 key 去 Render 的环境变量接口取真正操作 Meta 广告用的令牌。`.claude/worktrees/` 下的目录是 Claude Code 会话按需创建、按需清理的临时工作区，不是稳定存储——那个 worktree 所属的会话一旦被清理或归档，这个路径就可能读不到文件，广告日报会在没有任何代码 bug 的情况下突然报"查不到"。

日检第 3 项已经把"这个任务今天有没有跑成"纳入日常检查，但**检查本身不能替代修复**：一旦发现失败，正确做法是发卡片（`mcp__ccd_session__spawn_task`）要求把凭据读取路径换成稳定位置（例如直接把 `RENDER_API_KEY` 或已经换算好的 Meta 令牌存进本仓某个不依赖具体 worktree 的配置位置，或改成每次都直接从 Render 后台按服务 ID 取，不经过任何本地文件中转），而不是每次日检发现失败就只记录一遍症状。

**广告投放位置自动巡检本该走的正式路径，至今没通电**：`docs/PITFALLS.md` D9 早就写明"以后应该给 `ad_entity_snapshots` 加一条'纯播放目标未排除 Audience Network'的规则检测"，配套的快照表 migration（`20260914000001_ad_entity_snapshots_and_video_metrics.sql`）和抓取代码（`src/lib/ads-strategy/portfolio/snapshot-sync.ts`）、每 3 小时跑一次的 cron（`ad-entity-snapshot`）**都已经写好、排期好了**，但表本身从写完那天起就卡在"需要 PM 明确批准才能 apply migration"这一步，一直没人跟进要这个批准——`ad-entity-snapshot` 这个 cron 三个礼拜以来每次第一句话都是"表不存在，跳过"，一次没真正运转过。日检第 6 项（上面新增的）是**不依赖这张表**的临时替代做法（直接拉真实 insights 现查，不是从快照表里读），先把最直接的伤口堵上；等 migration 真的被批准、`ad_entity_snapshots` 建起来之后，应该把这条检测规则迁回自动化的快照诊断里，日检第 6 项到时候可以退休。

---

## Reuse Statement

**复用了什么已有平台能力**：
- 任务健康判定全套逻辑——`src/lib/cron/health.ts` 的 `checkCronHealth` + `src/lib/cron/registry.ts` 的 62 条登记 + `/dashboard/admin/cron-health` 后台页
- 每日待办的口径和过滤方式——`src/lib/pm-todo/daily-todo.ts` / `manual-items.ts`（人工任务三件套：what/how/href；`FOCUS_CLIENT_IDS` 过滤思路）
- 周报的新鲜度戳逻辑和内容结构——`src/lib/weekly-report/build.ts`
- 既有的诊断→处方闭环——`diagnostic-weekly` → `prescription-weekly` → 自动落 `execution_items`
- `goals`/`initiatives` 表结构与 `goal-current-value-refresh`/`kpi-backfill` 两个 cron
- 月报的既有接口 `/api/reports/[clientId]/monthly`（虽然目前只能手动触发）
- 资源优先级三维打分规则——`docs/ENGINEERING_QUALITY_GATES.md` §11
- PM 沟通格式与"统筹窗口不写代码"的硬约束——本仓 `CLAUDE.md` 与会话记忆体系里已经拍板的规矩
- 诸葛亮既有职责边界——`docs/agents/20-zhuge.md`

**新增内容是什么**：只有这一份文档本身——把已经存在、但散落在三份 Claude 定时任务提示词里的检查清单，整理成本仓的权威 SOP，并且补全/修正了三份提示词里对代码事实的引用（比如把"周报断流"具体指向 `build.ts` 的两个新鲜度阈值，把"广告日报"的凭据风险从"提一句"变成"点名要修"）。三个 `~/.claude/scheduled-tasks/` 下的定时任务本身不属于这次改动范围（本次未修改任何调度任务，只是让它们的兜底逻辑指向本文档）。

**哪些是平台通用的，哪些是客户专属的**：目前**全部是客户专属**——三个定时任务和本文档都硬写死了 CTS 一家客户（`client_id c0000000-0000-0000-0000-000000000000`），检查逻辑虽然复用的都是平台层能力（cron 健康、周报、目标表），但"每天/每周/每月替这一个客户跑一遍"这件事本身还没有做成配置化的平台能力。`src/lib/pm-todo/daily-todo.ts:70-73` 的 `FOCUS_CLIENT_IDS` 硬编码（CTS + Oztop）也还没有解决，这份 SOP 不试图解决它。

**这一版明确是 Claude 侧的第一步验证**，不是最终形态——PM 2026-09-20 的决策是"先验证再重做"（同一天对 SEO 自动化的判断：先在低成本、可关闭的方式下确认这套检查真的有用，再决定要不要投入开发）。如果这套日/周/月检查跑几周后证明确实能提前发现问题、减少 PM 被动救火，下一阶段应该把稳定下来的部分（任务健康判定、"验真实产出"这条纪律、待拍板事项的收敛与下发）迁移进 Magic Engine 自己的后台（对应 Inngest 工作流或 cron 路由），不再依赖某台笔记本电脑开着 Claude Code；同时把硬编码的 CTS 单客户逻辑，往客户级配置的方向泛化，而不是给每个新客户复制一套定时任务。

**有没有把客户名、客户 ID 或客户私有事实写进共享 runtime**：没有，本次未改动任何 `src/` 下的代码；本文档本身是客户专属 SOP，放在 `docs/sops/` 是合适的位置，不冒充平台通用文档。

**学习沉淀在哪一层**：本次没有产出需要升级到 industry/global 记忆的新结论；"验真实产出优先于验流程状态"这条纪律已经作为会话记忆 `feedback-verify-final-artifact-not-pipeline-status` 记录下来，属于跨客户通用的操作纪律，本文档只是把它落到 CTS 这一个客户的具体检查动作上。
