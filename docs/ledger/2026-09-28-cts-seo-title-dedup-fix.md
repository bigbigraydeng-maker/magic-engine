---
id: 2026-09-28-cts-seo-title-dedup-fix
title: CTS 网站6个页面标题改动+2组"两页打一件事"去重，等网站改动真正合并上线后再走14天自动回看
status: decided
owner: agent
decided_on: 2026-09-28
source: session:065e0f34
verify_how: 六个前置条件缺一个都还是"决定了没做"，不能提前当成done：①改标题的那条PR在chinatravel仓库（不是本仓库，本仓库自己同号的PR是另一件早已合并的事，不能拿来对号），要等它真正合并且网站上线（记这天为L）后，才能按②③做完整套重置，只改一半都不算做完；②确认L当天，四件事一起做，不能只做一件：(a)把seo_meta_log这6行的`optimised_at`重置成`L`当天（不能沿用写卡当天2026-09-28这个占位日期），(b)把`checked_at`、`outcome`、`observed_ctr`、`observed_impressions`这4个字段一并清回NULL——`runStep1CheckDue`（src/lib/seo-meta/cycle/runner.ts）只选`checked_at`为NULL的行，只改`optimised_at`不清这4个字段，这6行会永久被排除在下一次回看之外，(c)从同一个GSC来源重新查一次这6个页面在`L`当天（或`L`之前最后一次未受标题改动影响的干净数据点）的真实CTR/排名/曝光，把`baseline_ctr`/`baseline_position`/`baseline_impressions`这3个字段也一并重写——现在这3个字段存的是写卡当天(2026-09-28)插进去的占位值，chinatravel那条PR拖得越久，等待期间发生的自然排名/流量波动就越会被`processCheckDueRow`当成"标题改动前的基线"，14天后算出的improved/regressed会把这段自然波动错记成标题改动的功劳或黑锅，(d)把`verify_by`写成`L`+28天（不是`L`+14天，原因见③），`done_on`写`L`当天；③`readPageMetrics`（src/lib/seo/post-publish-monitor-store.ts）读的不是"只含上线后数据"的干净样本，而是`gsc_performance_snapshots`里最近一条按`fetchGscSnapshot(...,28)`滚动28天生成的`top_pages`快照——`runStep1CheckDue`按`optimised_at`超14天选中这6行时（也就是`L`+14天那天），这个28天窗口有大约一半仍是标题改之前的数据，会把improved/regressed判稀甚至判反；所以`L`+14天那天cron第一次自动写下的`checked_at`/`outcome`必须当成不可信的假结果丢弃——把这4个字段（`checked_at`、`outcome`、`observed_ctr`、`observed_impressions`）再清回一次NULL，让它下个周一重新被选中，如此反复，直到某次`checked_at`落在`L`+28天或之后（这时候滚动28天快照窗口才完整落在`L`之后，不含上线前数据），才把那次的`outcome`当真——每一次丢弃都要在这张卡的`check_note`里记一句"L+14天自动判定被丢弃，快照仍含上线前数据"这样的话，不能悄悄清空、不留痕迹；④到了确认可信的那次回看，看`outcome`字段，不是"不为空即算验过"：只有`improved`才转`verified`；`regressed`要转`failed`并另外判断是否要把这6个标题改回去；`insufficient_data`既不算验过也不算失败，必须人工把这一行的`checked_at`清回NULL才能让它在下一个周一被`runStep1CheckDue`重新选中再判一次——不清`checked_at`就没有"下一轮"，不能只把card状态写`done`当作已经安排了重试；`flat`（CTR变动在±1个百分点噪声带内，见`classifyMetaChangeOutcome`的`FLAT_BAND`）转card状态`verified`（不是`done`——`done`在`src/lib/ledger/walk.ts`的状态机里不是终态，到期没转`verified`/`failed`会被`classifyDone`判成`done_unverified`反复追问），`verified_ref`指向能查到这次判定的证据，`check_note`写"flat：改动安全无回归但无显著提升，不需要revert，也不需要再排查"；⑤①②发现"已被提前扫描"（chinatravel那条PR拖过2026-10-12才合并，这6行先被用占位`optimised_at`扫描过一次）时，需要另外确认没有已经因为这次提前判定而误触发`regressed`的人工待办（`buildManualAction`会把`regressed`直接下发成执行看板任务），如果已经下发，要在待办里注明"该判定基于占位日期、待重新回看"，不能放着不管；⑥如果chinatravel那条PR被关闭且确认不再合并（不是拖延，是放弃），必须直接从`seo_meta_log`删除这6行占位记录——它们从没对应过真实生效的改动，留着的话2026-10-12（写这张卡当天+14天）之后就会被`cloud-seo-meta-cycle-fanout`当成到期行去判一个基于占位`optimised_at`的假`outcome`，还会通过`optimised_at`把这6个页面锁进`runStep2CandidatesReady`的冷却期、挡住它们被重新选中；删完之后把这张卡的`status`改成`failed`，`verified_ref`里说明"chinatravel侧PR已关闭，本次改动未上线"，不能让它继续挂着`decided`。
---
诊断+方案见本会话记录（孔子/SEO agent，PM 2026-09-28 当场"做"授权）。改标题+去重内链的代码改动
是 chinatravel 仓库（github.com/bigbigraydeng-maker/chinatravel）里的一条 PR，当场核实时那条 PR
还没合并、待人工代码复审——所以这张卡先记成"决定了"，等它真正合并上线，再由处理合并的人把状态
翻成 `done` 并补 `done_on` / `done_ref`（`done_ref` 只能写本仓库能查到的指针，chinatravel 那条
PR 号请写进 `done_ref` 指向的证据文档里，不要直接写 `pr:<号>`——本仓库工具只按 `GITHUB_REPOSITORY`
解析 PR 号，会跟本仓库自己同号的 PR 撞车判重）。如果 chinatravel 那条 PR 最终被关闭、确认不再合并，
不走"翻成 done"这条路，走下面"关闭路径"那段。

seo_meta_log 里已经插入的 6 条基线行的 `optimised_at`、`baseline_ctr`、`baseline_position`、
`baseline_impressions` 目前记的都是 2026-09-28（写这张卡当天）的占位值，不是网站真正改动上线那天
（记为 L）的真实状态。chinatravel 那条 PR 合并上线后，必须由处理合并的人把这 6 行一次性做完四件事：
①`optimised_at` 改成 `L` 当天；②`checked_at`/`outcome`/`observed_ctr`/`observed_impressions` 这
4 个字段清回 NULL；③从同一个 GSC 来源重新查一次这 6 个页面在 `L` 当天（或 `L` 之前最后一次未受标题
改动影响的干净数据点）的真实 CTR/排名/曝光，把 `baseline_ctr`/`baseline_position`/
`baseline_impressions` 这 3 个字段也重写成这次查到的真实值——只改 `optimised_at` 不重写这 3 个基线
字段，等待期间的自然排名/流量波动会被记成标题改动的基线，14 天后的效果判断会把这段自然波动错算成
标题改动本身的功劳或黑锅；④把这张卡的 `verify_by` 写成 `L`+28 天（不是 `L`+14 天，理由见下一段），
`done_on` 写 `L` 当天。四件事任何一件漏了都不算做完这一步。

不用新建 Inngest：ME 已有 `cloud-seo-meta-cycle-fanout`（每周一自动跑，读 `seo_meta_log` 里
`optimised_at` 超14天且 `checked_at` 为空的行，自动对比 GSC 真实数据、写回 `outcome`），前提是该
客户 `seo_config.meta_cycle_enabled=true`；[docs/ledger/2026-09-26-cts-title-cycle-stays-on.md](./2026-09-26-cts-title-cycle-stays-on.md)
已确认 CTS 这个开关现在是 true，也就是说这条 cron 本来就会照常每周一扫描这 6 行，不是"开关没开就不
会有事"——合并上线拖得越久，这 6 行被占位 `optimised_at` 提前扫描、写死 `checked_at` 和一个基于假
日期算出来的 `outcome` 的风险越真实。

即使按上面从 `L` 当天正确重置了 `optimised_at`，`runStep1CheckDue`（src/lib/seo-meta/cycle/runner.ts）
在 `L`+14 天那天选中这 6 行时，`readPageMetrics`（src/lib/seo/post-publish-monitor-store.ts）读到的
也不是"只含上线后数据"的干净样本——它读的是 `gsc_performance_snapshots` 里最近一条按
`fetchGscSnapshot(...,28)` 滚动 28 天生成的 `top_pages` 快照，`L`+14 天这天的 28 天窗口还有大约一半
落在 `L` 之前，会把 `improved`/`regressed` 判稀甚至判反。所以 `L`+14 天那天 cron 第一次自动写下的
`checked_at`/`outcome`/`observed_ctr`/`observed_impressions` 必须当假结果丢弃：清回 NULL，让它下个
周一重新被选中，如此往复，直到某次 `checked_at` 落在 `L`+28 天或之后——这时候滚动 28 天窗口才完整
落在 `L` 之后——才把那次的 `outcome` 当真采信。这也是为什么这张卡的 `verify_by` 要设成 `L`+28 天而
不是常规的 `L`+14 天。

`src/lib/seo-meta/cycle/runner.ts` 的 `runStep1CheckDue` 只选 `checked_at IS NULL` 的行去判
（见该函数的查询条件），`processCheckDueRow` 则对每一行判完都无条件写 `checked_at`——不管判出来
的是 `improved`/`flat`/`insufficient_data`/`regressed` 哪一种，也不管这次判断是不是上面说的、被
污染快照算出来的假结果。这意味着：①如果这 6 行在真正上线前就已经被扫描过一次，合并上线时只改
`optimised_at` 而不清 `checked_at`/`outcome`/`observed_ctr`/`observed_impressions` 这 4 个字段，
它们会永远不再被选中，真实上线后的效果就再也回看不到；②`insufficient_data` 不会自动进入"下一
轮"——同样是因为 `checked_at` 已经写死，必须人工把它清回 NULL 才能让下一个周一重新选中它；
③`flat`（CTR 变动落在 `classifyMetaChangeOutcome` 的 ±1 个百分点噪声带内）收敛为 card 状态
`verified`（不是 `done`——`done` 在 `src/lib/ledger/walk.ts` 的状态机里不是终态，到期没转
`verified`/`failed` 会被 `classifyDone` 判成 `done_unverified` 反复追问今日待办要求处理），
`verified_ref` 指向这次判定的证据，`check_note` 写"flat：改动安全无回归但无显著提升，不需要
revert，也不需要再排查"，不允许悬挂等结果。详细动作清单见上面 frontmatter 的 `verify_how`。

关闭路径：如果 chinatravel 那条 PR 被关闭且确认不再合并（是放弃，不是暂时拖延），必须直接从
`seo_meta_log` 删除这 6 行占位记录——它们从没对应过真实生效的改动。留着不删的话，2026-10-12
（写这张卡当天+14天）之后 `cloud-seo-meta-cycle-fanout` 会把它们当成到期行，用占位 `optimised_at`
判出一个假 `outcome`，还可能触发一条基于假数据的 `regressed` 人工待办；同时这 6 个 slug 也会因为
`optimised_at` 落在 `runStep2CandidatesReady`（同文件）的冷却窗口内而被挡住重新选中，直到占位
日期过期为止。删完这 6 行之后，把这张卡的 `status` 改成 `failed`，`verified_ref` 里说明
"chinatravel 侧 PR 已关闭，本次改动未上线"，不能让它继续挂着 `decided` 等一个不会再来的合并。
