# 定时任务数据「有没有人读」审计（2026-10-07）

> 只读审计：没有改任何任务、没有触发任何接口。运行记录取自 `cron_run_logs` 近 14 天（2026-09-22～10-06）；读取方来自代码 grep + 生产库 SELECT。
> 分身逐任务证据（文件:行号）在同目录 [`2026-10-07-cron-readers/`](./2026-10-07-cron-readers/) 的 7 份明细里，本页是汇总。
> 判定规则（PM 2026-10-07 原话转述）：证明有人读且读取方自己在跑 → 保留；查完仍证明不了 → 归「没人读」。「代码里 grep 到引用」不算有人读；读取方是已停用的本机定时任务不算有人读。

## 一、粗数

范围：Render 57 个 + GitHub 工作流 + Inngest 定时函数，去掉重复登记后共 **78 个**。

| 结论 | 条数 | 含义 |
|---|---|---|
| A 有人读且有用 | 24 | 读取方真在跑，且有改变决定/展示的证据 |
| B 有人读但没改变任何决定 | 30 | 有读取方，但无证据说明它影响过任何决定（含「才刚上线还没满周期」的几条） |
| C 没人读 | 12 | 全仓找不到真实读取方，或只有无法证明有人看的页面 |
| D 读取方已坏或没启用 | 12 | 读取方存在但开关没开 / 上游已死 / 自己在失败 |

「没人读 + 读了没用 + 读取方已坏」合计 54 条里，**绝大多数单价接近 0**（Render 算力按秒、空跑一次 1～3 秒）。能点出具体美元的只有下面几条，所以**关任务能省的钱很有限，更大的钱和风险在「修」而不是「关」**（见第三节）。

## 二、第一批可关闭清单（证据最扎实，且不碰例外类别）

例外一律保留：客户外发（邮件/发帖/广告）、安全闸与熔断依赖、给台账/待办/回执写数据、PM 明令保留的。

| # | 任务 | 写什么 | 读取方查证 | 判没人读的理由 | 每天省 |
|---|---|---|---|---|---|
| 1 | `industry-ai-visibility-daily` | 每天 234 行行业 AI 可见度快照（15802 行） | 唯一接线是「AI 可见度分」目标，生产库这类目标只有 2 条，一条过期一条归档；管理页有一个标签页读它，无访问记录 | 没有任何在用目标在读，flywheel/华佗/诸葛亮目录 grep 0 命中 | 约 US$0.21（库内成本记录）+ Render 10～20 分钟 |
| 2 | `team-memory-sweeper` | 补提炼 team 教训（每 30 分钟） | 上游 `work_sessions` 最新一行 8-22；本机钩子没装；读取方只有一个看板页，无访问记录 | 705 次运行全是 0 干活 | 约 240 次数据库请求 + 2.3 秒 |
| 3 | `execution-auto-run` | 只写运行记录（挂着 dry_run=1，空跑两个月） | 全仓除注册表和 STATE.md 外无引用；今日待办是自己重新算，不读它的结果 | 无读取方 | ≈0 |
| 4 | `job-boards-weekly` | 招聘站点抓取 | 8 次运行全是「开关没开」；下游 Google Places 账单也没开 | 读取方没启用 | ≈0 |
| 5 | GitHub `baseline-domains-monthly.yml` | 重复触发同一接口 | Render 手工 cron 已经每天敲，接口有 7 天节流；GitHub 每月一次只跑 7～9 秒 | 重复调度（Render 那条保留） | ≈0（去噪） |

说明：第 1 条需要 PM 确认「管理页的 AI 可见度标签页你有没有在看」。若在看，降为每周跑一次而不是关。

**不进第一批、但待 PM 决定的**（理由：或属例外类别，或需先查账单/页面是否有人看）：
`product-map-sync-daily`（读取方是 PM 页面 `/dashboard/me2/product-map`，无访问日志）· `content-factory-intake`（9-28 起每次抓 0 条、错误被吞，Apify 账单没查到）· `viral-analyzer-worker`（实质已坏，建议停+修，但 Gemini 钥匙和队列堵塞需 PM 先决定开付费档）· `prospecting-sweep`（属外联邮件链路，归例外；Google 账单没开，需 PM 决定开账单还是明说不做）。

## 三、比「关任务」更值得先处理的发现（都不是关任务能解决的）

1. **私信写卡每小时重写同一批对话（真 bug）**：`src/lib/messenger/brief-cycle.ts:147` 按数组取已有的卡，而库返回的是对象，永远判成「没写过」。一天约 1200 次 gpt-4o-mini 调用，真正需要约 70 次；`conversation_briefs` 723 行 `regen_count` 全是 1（证实）。粗估每天 US$0.5～1.5，是本次审计里最大的一笔可省钱。**要修代码，不是关任务**（`messenger-brief-hourly` 属客户私信链路，归例外）。
2. **5 个客户的私信拉不到**（East、Magic Lab Class、NAL、NZCPE、Roman，Meta 权限错 190，9-25 21:10 起）；`meta-leads-sync` 168 次全失败（3/7 客户线索进不了 CRM，CTS 和 Roman 是通的）；NAL 的成交回传因此一直是 0。
3. **评论自动回复 8-20 起没有一次成功**，还有 3 条要人看的评论（含 1 条投诉）没人处理；**每日跟进汇总信开关没开**，12 天 0 封，积压 95→132 条。
4. **`proposal-view-digest` 4 次有访客的日子邮件全没送出**：发信人写死 Resend 沙盒地址，对非账号主人会 403。方案 `carrington_estate` 两周被打开 5 次，没人收到通知。（代码证据，未在 Resend 后台核实。）
5. **`lead-sheet-sync` 疑似每小时往 CTS 留资总表重复写同样 5 条线索**（回执同一个 lead id 在 297 次运行里出现 267 次，但 CRM 读到的表格行数一天只涨约 10 行，两边对不上）。需要有人打开表格核对，我们读不了客户表格。
6. **`seo-patrol-daily` 可能出了问题**：9-30～10-03 没有运行记录，10-06 那次一直停在 running，单次 298～373 秒贴着 300 秒上限；累计 297 张 `seo.*` 卡没有一张被完成过。
7. **SEO 标题自动循环的验收没有结论**：在 CTS 官网改的 15 条标题里 8 条已被回退，T+14 点击率检查和 T+18 排名采样至今没产出过一条结论。
8. **`flywheel-seo-weekly` 写的 CTS「估算流量」是 29，同期 Google 搜索数据点击是 1042**，错数还在页面上展示；来源标签写 semrush，实际是 DataForSEO。
9. **爆款分析 `viral-analyzer-worker`** 14 天跑 8064 次只成功 11 条：Gemini 走免费档每天 20 次，队列头被永久失败的链接堵死。同一把钥匙疑似拖垮 AI 可见度的 Google 探针（494 条失败 491 条，强怀疑未单独证实）。
10. **`prospecting-sweep` 4 周无产出无人处理**（Google 账单没开，9-8 最后一次成功），库里 1452 封待审外联草稿无人处理、已发 129 封、回复 0。
11. **「体检→处方→记忆」自动链实际只服务 CTS**：其他客户目标到期无人续；`agent-learning-rollup` 11 周没写成过一行（去重键不是合法 UUID）；`benchmark-accumulator` 失败是迁移 10 周没人 apply；`web-intelligence-due` 自 9-29 被一条 reconciliation 状态卡死，竞品抓取停摆 8 天且不在健康检查里。
12. **`google-data-pullback-daily` 14 次「失败」是误判**（没投广告的客户 meta empty_data），主力客户数据是新的；该任务评为 A，建议只改失败判定。
13. 另有**一处凭据回显（违反本次只读授权的条件）**，见下面「五之二」。

## 四、全量汇总表（78 条）

结论列：A/B/C/D。「花费」均为分身估算或库内成本记录，「没法估」表示缺账单/用量数据。建议只是建议，**一条都没执行**。

### 广告 / 线索 / 私信 / 邮件（G1，19 条）
| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| ad-entity-snapshot | A | Render 约 86 秒 | 保留 |
| ad-readback-sweep | A | Render 约 9 秒 | 保留 |
| google-data-pullback-daily | A（红灯误报） | 约 106 秒 + 邮件 3 封 | 保留，改失败判定 |
| meta-leads-sync | A（3/7 客户取不到） | 约 3.4 分钟 | 保留，开卡修页面授权 |
| messenger-sync-hourly | A（5/7 客户取不到） | 约 36 分钟 | 保留，开卡修令牌 |
| messenger-brief-hourly | A（94% 调用浪费） | $0.5–1.5 粗估 | 保留，修 brief-cycle.ts:147 |
| lead-sheet-sync | A（疑重复写） | 约 4.5 分钟 | 保留，先核对表格 |
| crm-lead-followup-digest | D | 约 160 秒 | PM 决定开不开 |
| conversion-daily-pipeline | A | 约 416 秒 + AI 审核没法估 | 保留 |
| social-comment-autoreply | D | Graph 约 3500 次读 + 约 23 分钟 | 修权限 + 推待办；修好前降频 |
| social-engagement-pullback | B | 约 12 秒 | 保留 |
| attribution-cron | B | 约 37 分钟 | 保留，改只写变化 |
| mailchimp-activity-daily | A | 约 2 分钟 | 保留 |
| mailchimp-paid-tagging | A | 约 3 秒 | 保留 |
| mailchimp-suppression-sync | A | 约 24 秒 | 保留 |
| kpi-backfill | B（数据枯竭） | ≈0 | 停或降周 |
| goal-current-value-refresh | B | 约 2.4 秒 | 保留 |
| linkedin-progress-post-mon | B（10 条草稿 0 发布） | Claude 量小 | 停或让草稿能过过滤 |
| linkedin-progress-post-thu | B | 同上 | 同上 |

### SEO / AI 可见度 / 口碑 / 博客（G2，25 条，seo-meta 六步合并计一条）
| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| keyword-snapshots-weekly | A（SERP 采集 C） | 约 US$0.2 | 保留快照，收窄/停 SERP 采集 |
| seo-weekly-list | B（才跑 1 次） | ≈0 | 保留，10-12 复查 |
| seo-patrol-daily | B（疑卡死） | 没法估 | 保留并修 |
| weekly-seo-report | B | ≈0 | 保留，问 PM 读不读 |
| oztop-seo-optimizer | D | 0（Render 已暂停） | 停，删 render.yaml 与 registry 条目 |
| cts-seo-optimizer | D | 0 | 去 Render 后台删遗留服务 |
| site-audit-cron | A | ≈0 | 保留 |
| site-audit-weekly | A | ≈$0.01 | 保留 |
| industry-ai-visibility-daily | C | $0.21 | **第一批：停或降周** |
| ai-tracker-weekly | A | $1.23 | 保留（单次约 2.5 小时，需关注） |
| ai-visibility-tracker-weekly（Inngest） | C | ≈0 | 定开关计划，否则停 |
| competitor-watch-weekly（Inngest） | D | ≈0 | 给 CTS 开开关并接读取方，否则停 |
| baseline-domains-monthly | B | 约 $0.43/月 | 去掉 GitHub 重复调度 |
| blog-weekly | B（3.5 个月 0 篇上线） | $0.01–0.02 | 先定要不要发 |
| blog-stuck-generating-sweeper | C | 约 22 秒 | 并入每日任务 |
| cms-connection-retest | B | ≈0 | 改 |
| reputation-snapshots-weekly | B | ≈$0.003 | 保留 |
| simaqian-reputation-weekly（Inngest） | B | ≈$0.0003 | 保留，改一处误报 |
| job-boards-weekly | D | ≈0 | **第一批：停** |
| market-intel-daily | B（只发邮件） | $0.002–0.005 | 先问 PM 还看不看 |
| seo-meta-cycle（Inngest，step2/3/4/6） | A | <$0.01 | 保留；step5 仅复述，C，可并入 step4 |
| seo-meta-rank-sampler（Inngest） | B（暂，10-16 复查） | 现 $0 | 保留 |
| seo-post-publish-monitor | C | 0 | 不是定时任务，9-16 手动发的一批已做完 |
| flywheel-seo-weekly（Inngest） | B（数字错） | <$0.01 | 改（修估算流量） |
| gsc-page-daily + pull（Inngest） | A | $0 | 保留（目前只 CTS 有读取方） |

### 内容工厂 / 视频 / 外联（G3，16 条）
| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| vision-analyzer | B | ≈0（14 天 0 张图） | 改事件触发 |
| poll-visual-jobs | B | ≈0 | 停/改（近 80 天无人点生成） |
| viral-analyzer-worker | B（实质已坏） | $0；约 67 分钟 | 停+修 |
| viral-discovery-weekly | B | ≈0 | 停到分析修好 |
| content-factory-intake | C | 没法估 | 待查 Apify 账单后停 |
| factory-publish-worker | A | ≈0 | 保留（14 天真发 2 条草稿） |
| factory-order-scheduler | C | $0 | 停/降周（全客户自动下单开关都关） |
| factory-publish-sweeper | C | ≈0 | 并进 publish-worker |
| factory-worker-sweeper（GitHub） | A | ≈0 | 改（名义每 5 分钟，实际约 5 次/天） |
| factory-worker-alive | A | $0 | 保留，清已离线 worker 行 |
| winner-reel-sync-daily | B | ≈0 | 改（结果进待办/日报）；GitHub 同名仅手动 |
| tailor-made-jobs-sweeper | C | ≈0 | 降到每天 1 次 |
| libai-prompt-library-monthly | B | $0 | 保留 |
| zhangqian-sweeper | C | ≈0 | 降到每天 1 次 |
| prospecting-sweep | B（上游全失败） | $0；历史 AI 分析约 $218 | PM 决定开账单/停（外联链路，归例外） |
| demo-refresh-daily（GitHub） | B | ≈0 | 保留 |

### 大脑 / 诊断 / 汇报 / 记忆（G4，18 条独有）
| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| zhuge-weekly-recalculate | B | ≈$0.02 | 改（修中断后不收口） |
| diagnostic-weekly | B | 没法估 | 改（排除没目标/内部客户） |
| prescription-weekly | B | 约 1 次 Claude/周 | 保留（只服务 CTS） |
| benchmark-accumulator | D | ≈0 | PM 批准迁移或停 |
| execution-auto-run | C | ≈0 | **第一批：停** |
| anomaly-detector-daily | B | ≈$0.0014 | 保留并降噪 |
| daily-cron-digest | A | 1 封邮件 | 保留 |
| proposal-view-digest | D | ≈0 | 改（发信人 + 错误信息） |
| agent-learning-rollup | D | ≈0 | 改（去重键）或停 |
| memory-extractor | B | ≈0 | 保留，让自动链读它 |
| team-memory-sweeper | D | 约 240 次请求 | **第一批：停** |
| pm-daily-todo | A | 1 封邮件 | 保留（盯 81→98 反弹） |
| product-map-sync-daily | C | 约 40 秒 | 停或降周（先问 PM 页面看不看） |
| cron-run-logs-cleanup | A | 3 秒 | 保留 |
| goals-expiry-check | A | 约 10 秒 | 保留 |
| conversation-health-heartbeat（Inngest） | D（疑没跑，未核实） | 没法估 | 先去 Inngest 后台核实 |
| web-intelligence-due（Inngest） | D（卡 8 天） | 卡前约 NZ$0.05 | 改（reconciliation 当终态） |
| web-intelligence-traffic-due（Inngest） | C | 关则 0 | 核对环境变量，关着就停 |

## 五、没验证的部分（如实）
- 管理页/PM 页面（AI 可见度标签页、team-memory 看板、product-map）**有没有人在看**：没有页面访问日志，查不到；按规则归「证明不了」。
- Inngest 运行记录本机读不到，Inngest 类任务改用其写入表和 `cron_run_logs` 回执作证据；`conversation-health-heartbeat` 判 D 只是推断。
- Jina 是否配了付费 key、Apify/Render 实际账单、Resend 后台状态：库里查不到，相关花费标「没法估」。
- 全部花费是按代码注释单价或库内成本记录的估算，不是账单。

## 五之二、凭据回显事件（如实记录）
- **发生在哪一步**：分身（G2 的两个子审计、G3、G4 各有一个）开工时按指令 `source` 主目录的 `.env.local`；该文件第 78 行格式特殊，shell 报语法错，报错把这一行的内容原样打印进了分身自己的工具输出。被打印出来的是 **Oztop 网站插件的应用密码**（变量名 `OZTOP_WP_APP_PASSWORD`），**不是**数据库总钥匙。
- **范围**：只在本机几个分身的工具输出/会话记录里；**未写进任何文件、PR、台账、审计文档或聊天**，也没发往任何外部服务。本文档与 7 份明细已逐个检查，不含密码值。
- **为什么算违规**：PM 的一次性授权条件是「钥匙在一条命令里读进环境变量用完，绝不打印」。这次是 shell 报错把行打印出来，不是分身主动 echo，但结果等同打印。
- **以后怎么做**：读钥匙只用 `set -a; source <路径>; set +a` 并立刻在同一条命令里使用；**禁止** `cat` / `echo` / `printenv` / `grep` 任何钥匙行并打印；若 `source` 报错，只报「第几行语法错」，不复述该行内容，并改用只取所需变量名的方式（先确认变量名，不打印取值）。
- **要不要轮换那个密码**：由 PM 决定，本文档只写事实。

## 六、Reuse Statement
- 复用：`cron_run_logs`、`docs/STATE.md` §4 清单、既有只读查询方式；未新增代码、未新增表。
- 平台共享：审计方法（运行记录 + 读取方追踪 + 读取方在不在跑）可沉淀成 ME 里的体检任务，本次不做。
- 行业 / 客户特定：无写入共享 runtime；客户名只出现在证据里。
- 落点与 tier-gate 决策一致：纯文档，不新增能力。
