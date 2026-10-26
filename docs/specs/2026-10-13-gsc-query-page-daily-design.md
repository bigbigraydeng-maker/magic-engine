# GSC「词 × 页」每日存档 · 设计稿 v2（风险级 A）

- 日期：2026-10-13 · 上游：73 号策略稿 §11 A4 / §12 第 5 件事（PR #2515）
- 定位：**L1 · 既有 SEO 支柱的测量基础设施（Measure 段）**，不新增支柱、不新增能力线。
- 一句话：给每个连了谷歌搜索后台的客户，每天存下「哪个词、落在哪一页、点了几次、看到几次、平均排第几」，补齐谷歌还留着的约 16 个月；再给一个只读函数把词分成品牌 / 歧义 / 非品牌 / 未归因。
- v2 = v1 + 子牙（架构）5 条必改 + 魏征（挑刺）6 条必改，逐条落实见 §11。

## 1. 为什么要做

`gsc_page_daily` 只知道「哪一页拿了多少」，不知道「哪个词是哪一页在排」；`gsc_performance_snapshots` 只存前 50 词；手动通道 `/api/internal/gsc-query-overlap` 只返回两页以上共享的词、28 天窗口。谷歌后台只留约 16 个月，不存就丢。没有历史，品牌/非品牌拆分、抢词体检、点击率低的原因分析都做不了。

## 2. §11 资源优先级三维打分

频率 **高**（每天落数据、每周 SEO 判断都用）/ IMPACT **中**（卡在 Measure，但现状是诚实地说没有，不是给错信号）/ 收入 **中**（间接）→ 高中中 → **P2**。本件由 PM 点名、73 号窗口依赖，按 PM 指令做，不靠打分抢资源。

## 3. 体量（诚实版）

CTS 28 天合并口径下不同「词×页」对共 4,289 个（现有只读通道实测，2026-10-13）。**注意：这是逐日行数的下限，不是估算**——逐日拉取时同一对会在多天各出现一行。所以真实逐日总量未知，只知道 ≥ 约 150 行/天。
处理：①设计不依赖小体量——保留翻页、超长键跳过、回补限速；②**合并后先用只读探针（§8）真拉 1 天、7 天，量出真实行数再 apply 迁移**。

## 4. 复用什么（Reuse First）

复用线上跑着的「页级每日存档」链（PR #2068）：Inngest 派单 → 每单一个客户一段日期 → 回执表防重复 → 失败自收口 → CRON_REGISTRY 健康检查。**把它参数化成「数据集」，缺省 = 现状**。

| 复用（不改行为） | 做成可选参数（缺省 = 页级现状） |
|---|---|
| `withGscAccess` / `querySearchAnalyticsRows`（`dimensions:['query','page']`）/ `fetchFinalizedDayRange` | `PullDeps.dataset?: PullDataset`：{维度、拉取作业名、回执表、写行函数}；缺省 = 页级 |
| 计划器 `planPageDailyPulls`（纯函数，回执是入参）、日期工具 | `maxBackfillSegments`（缺省 3；词×页 = 4）|
| 派单 / 拉取两个 Inngest 函数的结构、`cron_run_logs`、`run-logger` | 派单作业名 / 事件名 / 事件 id 前缀 |
| `connected-clients` 名单、`fetchAll`、`gscPageKey` | 回执函数末尾加可选 `table` 参数（缺省 = 页级回执表）|

新增（词×页专有）：两张表、写行函数、两个 Inngest 函数实例、品牌拆分只读函数、只读探针路由。
**页级链既有测试必须原样全绿；另加「黄金测试」**固定页级数据集的：表名、冲突键、列集、作业名、事件名、事件 id 字符串——任何一个被误改立刻红。

## 5. 数据表

`gsc_query_page_daily`：`client_id uuid FK clients ON DELETE CASCADE, day date, query text, page_url text, page_key text, clicks int, impressions int, position numeric`，主键 `(client_id, day, query, page_url)`；索引仅 `(client_id, page_key, day)`（`(client_id, day)` 是主键前缀，不另建）。
- 原样存谷歌返回的 query 与 page_url，**不在写入时规范化大小写**（避免键合并后覆盖丢点击）；规范化放读时。
- `day` = 谷歌日期（美国太平洋时区）。不存 `ctr`（读时 clicks/impressions；位置按曝光加权，不简单平均）。
- 谷歌隐私过滤的匿名词不在表里 → 词级点击合计 ≤ 页级合计，差额 = 「未归因」，输出里单独报。曝光合计同一页多条结果会重复计，不拿来对账。
- 键长：`utf8Bytes(query)+utf8Bytes(page_url)` 或 `page_key` 字节 > 2000 的行不写，只计数到回执（**沿用回执列名 `skipped_long_urls`，不改名**，语义写进表注释）。
- RLS：`ENABLE ROW LEVEL SECURITY` + `FOR ALL TO service_role USING (true) WITH CHECK (true)` + `REVOKE ALL FROM anon, authenticated` + `GRANT ... TO service_role`（同页级表迁移）。表注释写明：词与网址可能含个人信息，保留约 16 个月，暂无自动清理。
- 回执表 `gsc_query_page_fetch_receipts`：列结构与 `gsc_page_fetch_receipts` **完全一致**（含 `skipped_long_urls`），单独成表，不动在线旧表。
- 已知限制：表里无 `site_url`，客户换谷歌属性会混在一起（页级表同样）；登记为后续事项。

## 6. 定时与回补

- **用 Inngest，不新建 `/api/cron/*`，所以无 `render.yaml` 条目**：页级链当初的有意选择（Render 要人点 Apply，两次静默漏跑）。代价照写：部署后要在 Inngest 后台重新 Sync；CRON_REGISTRY 用回执表新鲜度（26h，沿用页级值）兜底「不 Sync = 静默不跑」。
- **新链全部标识与页级分开**（子牙必改 1）：事件 `gsc/query-page-daily.pull.due`；函数 id `…gsc-query-page-daily-fanout` / `…-pull`；作业名 `gsc-query-page-daily` / `gsc-query-page-daily-pull`；事件 id 前缀 `gsc-query-page-daily:`；cron `0 19 * * *`（UTC）常量独立，registry 测试照样对账。加测试：页级拉取函数不会因新事件触发。
- 派单：每客户 1 单「最近 5 天」。回补 **每次每客户 4 个月**（≈ 4 天补满 16 个月；一次派 16 个月在积压时会在次日重复派）。
- 失败、429、停派、onFailure：沿用页级链。首次派单每客户 5 单；授权失效的客户每天重复派 4 个回补月且不计失败（页级链同样行为，授权失败已由「谷歌数据回流」那条每日任务单独报警）。

## 7. 品牌 / 非品牌拆分（平台化关键）

- **判据不写进共享代码。** 配置在 `clients.seo_config`：`brand_terms: string[]`（确定品牌词）、可选 `brand_ambiguous_terms: string[]`（歧义词，单独成桶，不硬判）。CTS 的取值（`cts` / `boying` / `ctstours`；歧义 `china travel service`）是写到 CTS 配置的**数据**，不是代码。
- 共享匹配规则：NFKC + 去变音符 + 小写；撇号删除、其它标点转空格、折叠空格；纯拉丁配置词按**整词序列**匹配（`cts` 不命中 `facts`）；含非拉丁字符（中文）的配置词按子串匹配（已知会有误命中，输出带该说明）；**域名主体（如 `ctstours.co.nz` 的 `ctstours`，含 `sc-domain:` 写法）只在「以某个已配置品牌词开头」时才并入**（`ctstours` 以 `cts` 开头；`international` 里只是含 `nal`、不并入）——域名是通用词（如 `travel.example`）时不并入，否则所有含该词的查询会被误判成品牌；这种情况走 `suspect_missed_brand` 交人确认。品牌词优先于歧义词。
- **复用已有品牌别名（实施后魏征指出）**：库里已有 `clients.brand_aliases`（Settings 有输入面板，`strategy/auto-fetch.ts` 的 `isBrandQueryMatch` 在用）。`seo_config` 里**没有** `brand_terms` 数组时，回退用 `brand_aliases`，不让客户填两遍；`brand_terms` 存在则以它为准（即使为空也不回退，避免悄悄换口径）。
- **fail-closed**：配置缺失、非数组、规范化后为空/过短（<2 字符）的词一律丢弃；丢弃后无有效品牌词 → 返回 `brand_terms_not_configured`，不猜。读取端校验，不只靠写入口校验。
- 输出四个桶：`brand / ambiguous / non_brand / unattributed`（= 页级合计 − 词级合计，同窗口）。每桶 clicks / impressions / 不同词数 / 曝光加权平均排名。另给 `suspect_missed_brand`：某个**词以品牌词（拼接形式）开头**但没被整词命中的查询（Top N，如 `ctstour nz`；不再用「包含」匹配，否则 `products` / `contacts` 会淹没真漏判），供人抽查。另带 `coverage`（两张表各有几天数据）和 `warnings`（两表天数不一致、`unattributed` 为负时必报，回补期间缺的天会整段显示成 unattributed）。
- 只读、不写库；一次读整窗口，仅适合批处理，不放请求路径；`fetchAll` 显式传 hardCap、按主键排序保证翻页稳定。
- 写入口：`PATCH /api/clients/[id]/seo-config` 增加两个键（字符串数组，数量与单词长度有上限，归一化为空的词拒绝；「无已知键」判断同步更新）。**Settings 输入框本次不做**（CLAUDE.md §8 要求 UI 一起做，这里需要 PM 明示豁免——见 PR 正文，已作为待 PM 回答项）。该接口登录的是网页会话，CTS 取值的实际写入合并后由 PM 点头再做。

## 8. 只读探针与取数入口（魏征必改 3：真实试跑）

`GET /api/internal/gsc-query-page-probe`（非定时路由，同 gsc-query-overlap 放 `/api/internal/`）：Bearer CRON_SECRET；`client_id` 必填；`days`（1–7，默认 7，结束日 = 今天往前 5 天以避开未定稿日；工作流只传 client_id，所以默认就是 7 天）；**只读、不写库、不需要迁移**；用与写入完全相同的转行函数，报告：逐日行数、重复键数、超长键数、`query` 大小写重复数、品牌拆分（若已配置）。加进 `manual-cron-trial.yml` 白名单（A 级，写进 PR）。合并后先跑它，拿到真实体量，再 PM 点头 apply 迁移。探针**和第一次真读一样**：过期的谷歌授权会被刷新并写回（`withGscAccess` 的既有行为），除此之外不写任何业务表；每天最多翻 2 页（同真实拉取的 5 万行上限）；输出只有数字和桶合计，**不含搜索词原文**（会进 GitHub Actions 摘要，搜索词可能带个人信息）；超 90 秒不再开新的一天并标 `stopped_early`；`days` 越界直接 400。
另有 `GET /api/internal/gsc-brand-split`（只读自家表、不调谷歌；同样进白名单、只输出数字）：`getBrandSplit` 的第一个真实调用方，迁移 apply 后用它在线上验证拆分。

## 9. 换客户 / 换行业测试

换客户（CTS → Oztop → Roman）：共享代码无客户名/ID/品牌词；品牌词来自各自 `seo_config`，没配就明说「未配置」。换行业（旅游 → 物流 → 地产）：存的是谷歌原始词×页，拆分是「整词匹配配置词」，无行业判断。层级：L1 共享测量基础设施；品牌词清单 = L4 客户配置；不登记候选。

## 10. 风险、边界、合并后清单

风险级 **A**（新表迁移 + 新定时任务 + 参数化在线页级链 + 工作流白名单）。PR 保持草稿；实现 PR 用 `feat/` 分支（`claude/` 分支会被大改动闸门拦）；A 级合并在对话里问 PM。只读谷歌、只写自家新表；不碰客户网站；无付费接口；`no_publish: true`。迁移随 PR 提交、**不由 PR 应用**。
合并后：①跑探针量体量 ②PM 点头 apply 迁移 ③部署并在 Inngest 后台 Sync ④在 Inngest 后台手动 Invoke 一次派单，当天回读行数（验证当日，不等次日）⑤PM 点头后写 CTS `brand_terms` ⑥台账卡改 `done`。

## 11. 审查意见落实表

- 子牙：①事件/id/job/cron 全分开+测试 → §6 ✓ ②回执列名不改 → §5 ✓ ③dataset 是 deps 可选、写行函数用新的、键按 (query,page_url)、超长判 page_key → §4/§5 ✓ ④试跑理由改写、verify_by 改为合并后 → §8/§10 ✓ ⑤回补 4 个月/次 → §6 ✓；建议：去冗余索引 ✓、fetchAll hardCap ✓、NFKC/撇号/域名并入/未命中清单 ✓、PATCH 同步 ✓、表注释隐私 ✓。
- 魏征：①150 行/天是下限 → §3 + 探针 ✓ ②verify_how 放水 → 台账卡重写（下限校验、全部已连客户、页级链不降、品牌拆分被调用）✓ ③试跑 → §8 ✓ ④品牌漏洞（ctstours、读取端 fail-closed、suspect 清单）→ §7 ✓ ⑤配置写不进/UI → §7（PM 豁免待回）⑥默认=现状黄金测试、列名不改 → §4/§5 ✓；建议：unattributed 桶 ✓、原样存键 ✓、不用「错开并发」当理由 ✓（改为错开只为分散负载）。
