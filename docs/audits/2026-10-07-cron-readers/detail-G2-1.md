# 定时任务审计 G2 part1（SEO 类 6 个）

审计时间：2026-10-07。只读，没改仓库，没触发任何接口。数据来源：logs14.json（窗口 2026-09-22 ~ 10-06）+ 只读生产库查询（cron_run_logs / keyword_snapshots / serp_ai_overview_snapshots / seo_patrol_findings / execution_items / seo_meta_log）。
路径前缀：`src/` = `src/`。

---

### keyword-snapshots-weekly （每周一 02:00 UTC）
- 写入：`keyword_snapshots`（DataForSEO ranked keywords，每客户最多 200 词，`src/lib/seo-intelligence/keyword-snapshots.ts:106` upsert）；`serp_ai_overview_snapshots`（每个词再调一次 SERP，`src/lib/seo-intelligence/serp-capture.ts:231`）；并回写 `keyword_snapshots.local_pack_rank`（serp-capture.ts:248）。外部副作用：花 DataForSEO 钱（Labs 每客户 1 次 + SERP 每词 1 次，serp.ts:15 注释单价约 US$0.005/次）。覆盖 active 且有域名的客户（route.ts:55-59），实际有数据的 6 家。
- a) 最近运行：logs14 里 2 条。09-28 completed（processed 10 / failed 0，耗时 489 秒）；**10-05 02:01 状态一直是 `running`，没有结束时间**（进程中途死了，没写收尾）。验证：10-05 当天 keyword_snapshots 写了 269 行（正常），但 serp_ai_overview_snapshots 只有 85 行，缺 oztop 的 184 个词的 SERP（09-28 是 270/270）。所以 10-05 这次是半截：排名快照齐，SERP 采集没跑完。
- b) 读取方：
  - keyword_snapshots：SEO 巡逻 `src/lib/seo-patrol/job.ts:187,200,257`；SEO 每周清单 `src/lib/seo-weekly-list/run.ts:334,348`（"第19名、月搜3600"这类清单卡的数字来源）；每周周报 `src/lib/weekly-report/build.ts:121,131,196`；标题周循环的闸门 `src/lib/seo-meta/cycle/gate.ts:256`（取搜索量/难度，14 天内的快照省掉一次实时查询）；月报 `src/lib/reports/monthly-aggregator.ts:521,538`；排名变化页/SEO Agent `src/lib/seo-intelligence/position-changes.ts:112,130`（被 `src/app/api/clients/[id]/seo-intelligence/position-changes/route.ts:4` 和 `src/lib/seo-agent/assembler.ts:10` 调用）；执行看板 SEO 列 `src/app/api/clients/[id]/seo-intelligence/page-1-count/route.ts:43,62`（被 `SeoColumnSnapshot.tsx:46` 调用）；策略生成 `src/lib/strategy/analyzer.ts:136,152`；手动内部接口 `src/app/api/internal/keyword-opportunity/route.ts:63,79`。
  - **serp_ai_overview_snapshots：全仓 src/scripts 里只有写入方（serp-capture.ts:231）和测试，没有任何读取方。** 纯写不读。
  - local_pack_rank：只有月报 `monthly-aggregator.ts:459-549` 读；10-05 全库 269 行里只有 4 行有值。
- c) 读取方在跑吗：patrol 日跑（10-05 completed）；weekly-list 10-05 跑过；weekly-seo-report 每周日跑（10-04 completed）；seo-meta-cycle 步骤 1-6 在 10-05 05:31-05:33 全部 completed（logs14）。页面类读取方（执行看板 SEO 列、排名变化页）有没有人打开：无证据（库里没有页面访问记录）。
- d) 改变过决定吗：有例子。10-05 weekly-list 给 CTS 开的 5 张卡直接引用快照数字（"china beijing 第19名 月搜3600""zhangjiajie 第4名 月搜1600"，见 cron_run_logs seo-weekly-list summary.preview）；标题周循环闸门用它判断关键词值不值得改标题（gate.ts:256-272，快照超 14 天才退回实时付费查询）。SERP 那一半：无证据。
- 结论：**A**（排名快照这一半，多条下游真依赖）；SERP 采集这一半是 **C**（写了没人读）。每天花费：粗估约 US$0.2/天（SERP 约 270 次/周 × US$0.005 ≈ US$1.35/周，加 Labs ~10 次/周；单价取自 serp.ts:15 代码注释，没查到 DataForSEO 实际账单，库里也没有这个任务的逐次成本记录，所以是估算）。其中约 71% 的 SERP 次数（191/270）花在 oztop 上，而 oztop 的自动改标题已被暂停。
- 建议：保留排名快照；**SERP 采集（serp-capture）建议停或只留 local_pack 需要的客户**（没人读，还占大头花费）；另外查 10-05 为什么半路死掉、`running` 卡死没收尾（超时 900 秒或进程重启，没法从日志判断）。

---

### seo-weekly-list （每周一 04:30 UTC）
- 写入：`execution_items`（经 `zhuge/action-persister.ts:477-660` 的 SEO 清单卡，steps_json.loop = `seo_goal_v1`）；cron_run_logs 回执。无外部副作用、无付费（读 GSC 免费，最多每客户 3 次页面查询 `run.ts:56`）。仅处理有 ACTIVE `seo_gsc_clicks_28d` 目标的客户（run.ts:131）。
- a) 最近运行：只有 1 次，2026-10-05 04:31 completed（processed 1 / failed 0，8.6 秒）。summary：inserted 5、expired 0、verified_pass 0，客户只有 CTS。（该任务 10-04 才上线，registry.ts:253 addedAt 2026-10-04。）14 天成败：1 成 0 败。
- b) 读取方：库里 5 张 pending 的 `seo.plan.strengthen_page` 卡（10-05 创建，已核）→ 今日待办卡片计数 `src/lib/pm-todo/daily-todo.ts:~215`（FOCUS 客户 pending 卡）；周报 SEO 清单段 `src/lib/weekly-report/build.ts:23`（gatherSeoListWeekly，`src/lib/seo-weekly-list/report.ts:60,73`）；执行看板 SEO 列（页面）。
- c) 读取方在跑吗：pm-daily-todo 在跑（logs14：10-01/10-04/10-05 都 completed）；weekly-seo-report 在跑，但 10-04 那封是 10-05 首跑**之前**发的，所以周报里的 SEO 清单段还没真展示过，下一封 10-11 18:30 UTC。页面类：无证据。
- d) 改变过决定吗：无证据（才跑 1 次，5 张卡还是 pending，0 张被处理）。
- 结论：**B（暂定）**。每天花费：约 0（无付费接口，只有数据库读写和少量 GSC 免费读）。
- 建议：保留，10-12 看周报是否真出现 SEO 清单段、5 张卡有没有被人点；两周后若仍 0 处理再评估。

---

### seo-patrol-daily （每天 04:00 UTC）
- 写入：`seo_patrol_findings`（每次先删后插，job.ts:488-522）；`execution_items`（前 3 条发现转看板卡，source=zhuge，job.ts:580）；`client_site_pages.index_verdict / first_not_indexed_at`（每客户每天用 Google URL Inspection 查最多 20 页，index-check.ts:25,116-135）；顺手做“待办卫生”（过期草稿/旧卡标 superseded、PR 状态同步，route.ts:113-124）。无付费接口（Google 检查额度免费）。
- a) 最近运行：窗口内 10 条。9 条 completed（09-23~09-29、10-04、10-05；processed 9~10 / failed 0；耗时 298-373 秒，**贴着 maxDuration 300 和 render.yaml 的 `curl --max-time 300`**）。**缺 4 天：09-30、10-01、10-02、10-03 完全没有日志行**（同期其他每日任务都有）；**10-06 04:01 状态 `running` 无结束时间**（卡死）。14 天 processed 合计非 0（每次 9-10 个客户、138-151 条发现）。没行的原因没法判定（可能没跑，也可能记录没写进去），需要 Render 后台运行历史。
- b) 读取方：
  - seo_patrol_findings（164 行：oztop not_indexed 129、各客户 stale_content 等）：周报 `src/lib/weekly-report/build.ts:216,312,443`（只显示“巡逻员本周抓到 N 个新发现”，而因为每天先删后插，这个数≈当前存量，是个虚数）；今日待办 `src/lib/pm-todo/daily-todo.ts:213`——**`findingsByClient` 只被算出来（daily-todo.ts:271），全仓没有任何地方使用它，是接了没用**（grep `findingsByClient` 只有定义和赋值 2 行）。
  - 看板卡（execution_items）：执行看板 SEO 列；今日待办 pending 卡计数。
  - index_verdict / first_not_indexed_at：站点审计页面 `src/app/dashboard/clients/[id]/site-audit/pages/page.tsx:25-140` 和接口 `src/app/api/clients/[id]/site-audit/pages/route.ts:19`。
- c) 读取方在跑吗：weekly-seo-report、pm-daily-todo 在跑（见上）；页面类无证据。
- d) 改变过决定吗：**弱，几乎无证据**。生产库 `action_type like 'seo.%'` 的卡累计 297 张：superseded 279（refresh_blog 259 + publish_blog 20）、pending 18，**completed = 0**。即巡逻卡从没被人做完过一张；被 14 天过期机制自动清掉的占大头（10-05 一次清 20 张）。唯一正面例子：09-27 首跑给 CTS 开出 1 张 Christchurch 页的卡（evidence/2026-09-26-seo-patrol-card-dedupe-first-run--2026-09-28.md），卡出来了，但没有做完记录。
- 结论：**B**（有读，但读的是计数/看板卡，没改变任何已验证的决定）。每天花费：外部接口 0（Google 检查额度免费，每天 40 页）；Render 每天占用约 5 分钟请求时长 + 大量数据库读；没法估金额，缺 Render 实例用量和 Supabase 请求量（docs/audits/supabase-request-audit.md 只在第 309 行提到这个任务名的一条查询计划，没有该任务的用量数）。
- 建议：保留但要修——①查 09-30~10-03 为什么 4 天没记录、10-06 为什么卡 running（运行时长贴着 300 秒上限）；②daily-todo 里没人用的 findings 查询可删；③卡从未被完成过，是否要继续每天开新卡由 PM 决定。

---

### weekly-seo-report （每周日 18:30 UTC）
- 写入：外部副作用 = 通过邮件服务给 hello@magicengine.cloud 发 1 封周报（route.ts:68-73）；cron_run_logs 回执。只读各表（keyword_snapshots / gsc_performance_snapshots / seo_patrol_findings / seo_meta_log / blog_posts / flywheel_metrics 等，`src/lib/weekly-report/build.ts`）。覆盖 2 个重点客户（CTS、oztop）。
- a) 最近运行：窗口内 2 条（09-27、10-04 18:31），都 completed、sent=true、processed 2、completed_count 1（代码把 completed 写死为 1，route.ts:78，不是失败）。14 天 0 败。回执显示 oztop 的 social/ads 两段连续两周都是“断流”（stale_sections），周报如实说出来了。
- b) 读取方：收件人是 PM 邮箱。没有任何程序读这封邮件或这条回执（cron_run_logs 只有健康检查泛读）。
- c) 读取方在跑吗：邮件已发出（sent=true，邮件服务无报错）；PM 有没有打开读：无证据（我没有读 PM 邮箱，没有打开记录）。
- d) 改变过决定吗：无直接证据。台账 `docs/ledger/2026-10-04-seo-weekly-list-s2.md` 把“10-12 周报出现 SEO …”写进验证步骤，说明它被当作验收渠道，但没有“某周因为周报改了某个决定”的例子。
- 结论：**B**。每天花费：≈0（每周 1 封邮件 + 约 2 客户的几十次数据库读；不调大模型，route 和 build.ts 里没有 Anthropic 调用，虽然 render.yaml:~850 给它挂了 ANTHROPIC_API_KEY 的注释，属于遗留）。
- 建议：保留；问 PM 一句“周一早上周报你读不读”，不读就并入今日待办。

---

### oztop-seo-optimizer （每周一 05:00 UTC，已被手动暂停）
- 写入：`seo_meta_log`（把 AI 生成的标题/描述排队，wp_updated=false，route.ts:187-200）；`fde_work_logs`（route.ts:209）；调 Claude Haiku（每页约 200 token，route.ts:62）。真正改官网的是 Oztop 站点上的 WP 插件每小时拉这张表去改（route.ts:11-14）。
- a) 最近运行：**最后一次 2026-09-21 05:01**（processed 17 / queued 4）。窗口内（09-22 以后）0 行：09-28、10-05 都没跑，因为 09-27 PM 回“停”后 Render 服务被手动暂停（`docs/ledger/2026-09-27-oztop-auto-title-damage.md`；10-05 浏览器亲眼核实“手动暂停”，见 `docs/ledger/2026-09-29-cts-retired-seo-optimizer-ran-again.md`）。7-31 起累计每周排 3~8 条。
- b) 读取方：Oztop 站点上的 WP 插件（拉 seo_meta_log，不分客户）；周报 `build.ts:226,234`（按 client_id 过滤读）；`src/app/api/clients/[id]/seo-meta-log/route.ts:33`；今日待办 `src/lib/pm-todo/manual-items.ts:447`。
- c) 读取方在跑吗：插件在跑（历史行里 wp_updated=true 的有一批），但 oztop 最新 40 行中至少 18 行 wp_updated=false 从没被应用（排队了没落地）。
- d) 改变过决定吗：**改变过，且是坏的**：生成器从 7 月起把 23 条“关键词原样 + 空描述”推上官网，18 页线上仍是坏标题（Issue 2145；台账 2026-09-27-oztop-auto-title-damage）。
- 结论：**D**（已停，且产出有害）。每天花费：现在 0（已暂停）；停之前约几美分/周（Haiku 约 17 次/周）。
- 建议：停（已停）。**render.yaml 里这一条还在（约 782-799 行）、`src/lib/cron/registry.ts:241` 仍登记为应每周跑且 logsRuns:true**——重新同步部署可能恢复、健康检查可能每周报“没跑”（这点我没验证），应走 A 级改动删掉；删前保持暂停。

---

### cts-seo-optimizer （已退役，Render 上一个手动暂停的遗留服务）
- 写入：现在什么都不写，只写一条失败的 cron_run_logs（route.ts:36-37）并返回 410。退役前写 GitHub 上 CTS 官网的 PR 并自动合并。
- a) 最近运行：**09-28 05:31 completed**（processed 3，completed_count 0）——这是退役后 8 天“死而复生”的那次，自动合并 chinatravel#213，改错 3 个标题（Forbidden City 跑题等，`docs/ledger/2026-09-29-cts-retired-seo-optimizer-ran-again.md`）。原因：render.yaml 删了条目但 Render 上的服务还在，带着一次性日程“30 5 28 9 *”。09-29 起（PR #2200）路由只返回 410。窗口内 1 条。
- b) 读取方：无。路由不写业务表；唯一副作用是失败记录，被 daily-cron-digest 邮件收（台账说失败记录不进健康检查，只出现在每日摘要邮件）。取代它的是 Inngest 周循环 `cloud-seo-meta-cycle-fanout`（registry.ts:424-428），10-05 05:31-05:33 步骤 1-6 全部 completed。
- c) 读取方在跑吗：Render 服务 10-05 核实为“手动暂停”，不会再触发。
- d) 改变过决定吗：改变过，坏的（9-28 三个错标题已让它失效、官网撤回待合）。
- 结论：**D**（退役）。每天花费：0。
- 建议：停（已停）；在 Render 后台删除这个遗留服务（台账标为可选清理）；删前保持暂停，避免再被同步复活。

---

## 汇总

| 任务 | 结论 | 每天花费 | 建议 |
|---|---|---|---|
| keyword-snapshots-weekly | A（排名快照）/ C（SERP 采集写了没人读） | 约 US$0.2（估算，无实际账单） | 保留快照；停或收窄 SERP 采集；查 10-05 半路卡死 |
| seo-weekly-list | B（暂定，才跑 1 次） | ≈0 | 保留，10-12 复查周报与 5 张卡 |
| seo-patrol-daily | B | 外部 0；Render/库读没法估 | 保留并修：9-30~10-03 缺 4 天、10-06 卡 running；297 张卡 0 张被做完 |
| weekly-seo-report | B | ≈0 | 保留，问 PM 是否在读 |
| oztop-seo-optimizer | D | 0（已暂停） | 停；A 级改动删 render.yaml 与 registry 条目 |
| cts-seo-optimizer | D | 0 | 停；Render 后台删遗留服务 |

A:0 完整 + 1 半（keyword-snapshots）/ B:3 / C:0（SERP 子功能 1）/ D:2
