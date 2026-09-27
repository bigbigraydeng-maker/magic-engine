---
id: 2026-09-28-cts-seo-title-dedup-fix
title: CTS 网站6个页面标题改动+2组"两页打一件事"去重，等网站改动真正合并上线后再走14天自动回看
status: decided
owner: agent
decided_on: 2026-09-28
source: session:065e0f34
verify_how: 四个前置条件缺一个都还是"决定了没做"，不能提前当成done：①改标题的那条PR在chinatravel仓库（不是本仓库，本仓库自己同号的PR是另一件早已合并的事，不能拿来对号），要等它真正合并且网站上线后，才把seo_meta_log这6行的`optimised_at`重置成合并上线当天，14天窗口从那天算，不能沿用这张卡写卡当天的日期，而且必须同时把`checked_at`、`outcome`、`observed_ctr`、`observed_impressions`这4个字段一并清回NULL——`runStep1CheckDue`（src/lib/seo-meta/cycle/runner.ts）只选`checked_at`为NULL的行，只改`optimised_at`不清这4个字段，这6行会永久被排除在下一次回看之外；②CTS的`seo_config.meta_cycle_enabled`已确认是true（见2026-09-26台账），也就是说`cloud-seo-meta-cycle-fanout`本来就会照常每周一扫描，不是"没开就不会误判"——如果chinatravel那条PR拖过2026-10-12（写卡当天起14天）才合并，这6行会先被扫描到、用占位`optimised_at`算出一个垃圾`outcome`并写死`checked_at`，合并上线时必须先确认有没有发生这种提前扫描，发生了同样要按①清空那4个字段，不能只改`optimised_at`；③到了回看时间点看`outcome`字段，不是"不为空即算验过"：只有`improved`才转`verified`；`regressed`要转`failed`并另外判断是否要把这6个标题改回去；`insufficient_data`既不算验过也不算失败，必须人工把这一行的`checked_at`清回NULL才能让它在下一个周一被`runStep1CheckDue`重新选中再判一次——不清`checked_at`就没有"下一轮"，不能只把card状态写`done`当作已经安排了重试；`flat`（CTR变动在±1个百分点噪声带内，见classifyMetaChangeOutcome的FLAT_BAND）收敛为card状态`done`，不转`verified`也不转`failed`，备注写"flat：改动安全无回归但无显著提升，不需要revert，也不需要再排查"，不能让`flat`卡一直悬挂等结果；④以上①②发现"已被提前扫描"时，需要另外确认没有已经因为这次提前判定而误触发`regressed`的人工待办（`buildManualAction`会把`regressed`直接下发成执行看板任务），如果已经下发，要在待办里注明"该判定基于占位日期、待重新回看"，不能放着不管。
---
诊断+方案见本会话记录（孔子/SEO agent，PM 2026-09-28 当场"做"授权）。改标题+去重内链的代码改动
是 chinatravel 仓库（github.com/bigbigraydeng-maker/chinatravel）里的一条 PR，当场核实时那条 PR
还没合并、待人工代码复审——所以这张卡先记成"决定了"，等它真正合并上线，再由处理合并的人把状态
翻成 `done` 并补 `done_on` / `done_ref`（`done_ref` 只能写本仓库能查到的指针，chinatravel 那条
PR 号请写进 `done_ref` 指向的证据文档里，不要直接写 `pr:<号>`——本仓库工具只按 `GITHUB_REPOSITORY`
解析 PR 号，会跟本仓库自己同号的 PR 撞车判重）。

seo_meta_log 里已经插入的 6 条基线行的 `optimised_at` 目前记的是 2026-09-28（写这张卡当天），这个
日期是占位的，不是网站真正改动上线的日期；chinatravel 那条 PR 合并上线后必须有人把这 6 行的
`optimised_at` 改成实际上线日，否则 14 天回看窗口会算错（提前判、或网站改动被关闭/未合并时被误判）。

不用新建 Inngest：ME 已有 `cloud-seo-meta-cycle-fanout`（每周一自动跑，读 `seo_meta_log` 里
`optimised_at` 超14天且 `checked_at` 为空的行，自动对比 GSC 真实数据、写回 `outcome`），前提是该
客户 `seo_config.meta_cycle_enabled=true`；[docs/ledger/2026-09-26-cts-title-cycle-stays-on.md](./2026-09-26-cts-title-cycle-stays-on.md)
已确认 CTS 这个开关现在是 true，也就是说这条 cron 本来就会照常每周一扫描这 6 行，不是"开关没开就不
会有事"——合并上线拖得越久，这 6 行被占位 `optimised_at` 提前扫描、写死 `checked_at` 和一个基于假
日期算出来的 `outcome` 的风险越真实。

`src/lib/seo-meta/cycle/runner.ts` 的 `runStep1CheckDue` 只选 `checked_at IS NULL` 的行去判
（见该函数的查询条件），`processCheckDueRow` 则对每一行判完都无条件写 `checked_at`——不管判出来
的是 `improved`/`flat`/`insufficient_data`/`regressed` 哪一种。这意味着：①如果这 6 行在真正上线
前就已经被扫描过一次，合并上线时只改 `optimised_at` 而不清 `checked_at`/`outcome`/`observed_ctr`/
`observed_impressions` 这 4 个字段，它们会永远不再被选中，真实上线后的效果就再也回看不到；
②`insufficient_data` 不会自动进入"下一轮"——同样是因为 `checked_at` 已经写死，必须人工把它清回
NULL 才能让下一个周一重新选中它；③`flat`（CTR 变动落在 `classifyMetaChangeOutcome` 的
±1 个百分点噪声带内）目前在这条判据体系里没有对应的 card 状态终点，明确收敛为：不转 `verified`
也不转 `failed`，就地记 `done` 并注明"flat：安全无回归但无显著提升，无需 revert，无需再排查"，
不允许悬挂等结果。详细动作清单见上面 frontmatter 的 `verify_how`。
