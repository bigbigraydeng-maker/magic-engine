---
id: 2026-09-27-growth-states-missing-0925-root-cause
title: 广告巡察结论表 9/25 整天零行的根因：任务跑了，但写表那整段被前置闸门跳过、零告警
status: done
owner: agent
decided_on: 2026-09-27
source: doc:docs/ledger/2026-09-26-ads-d3-migration-applied-to-prod.md
done_on: 2026-09-27
done_ref: doc:docs/ledger/2026-09-27-growth-states-missing-0925-root-cause.md
verify_by: 2026-10-04
verify_how: 查最近 7 天 ads_growth_states 每天是不是都有 6 行（缺任一天 = 又出现同类静默，立刻交回 PM）。防复发（把 ads_growth_states 加进 cron registry 的 outputTables）尚未落地、单独开卡见 doc:docs/ledger/2026-09-27-ads-growth-states-outputtables-registry.md，本卡验的只是「这次根因是否复发」，不要把那张卡的完成状态并进本卡
---
统筹 2026-09-27 派查：`ads_growth_states`（广告每日巡察结论表，是广告刹车第 5 条判据「数据不全 → 当天冻结」的输入）2026-09-25 整天零行、六客户全缺，而 9/24、9/26 都正常。要判是①没触发 ②跑了报错 ③跑完写库失败。

## 定案：三种都不是，是第四种——任务跑了，但写表那整段被前置闸门跳过
- **不是①**：`cron_run_logs` 有 9/25 17:01:51 UTC 的运行记录。
- **不是②**：那次 status=failed，但失败原因是 3 个客户 `getAdAccountInsights returned null`（取数/令牌线），与本表无关。
- **不是③**：**写库代码压根没执行**，所以任何日志里都不会有「写 ads_growth_states 失败」。

**真因**：`google-data-pullback-daily/route.ts` 有一道闸 `if (snapshotsReady && adConfigSource !== 'fallback')`，块内依次是 D 码诊断 → 发内部日报 → `buildGrowthState`（写本表）。9/25 那天 `ad_strategy_configs` 缺 `autopilot_enabled` 字段（D3 代码先上线、migration 未 apply），六个客户 config 读取全部报错退化成 fallback → **整块跳过 → 三件事一起没了**（结论没写、诊断没跑、日报没发；9/25 三客户 `ad_health_narratives.email_status` 停在 pending 即此）。

**时间线印证**：2026-09-26 01:42 UTC 补上那两个字段后，9/26 17:01:12 那次运行恢复正常。实测行数：9/24 六行（17:01:21）→ **9/25 零行** → 9/26 六行（17:01:12）。

## 🔴 它为什么零告警地躺了一整天（本卡最该留的部分）
`cron/registry.ts` 里该 job 声明的产出表只有 `ad_daily_insights`、`ad_health_narratives`（各 26 小时），**`ads_growth_states` 没登记**；而 `cron/health.ts` 的「沉默死」检测**只查声明了 outputTables 的表，未声明 = 不查**。
9/25 于是出现双重巧合：**没登记的表零行 → 检测照不到；已登记的 `ad_health_narratives` 那天反而有行**（体检部分写在闸门之前）→ 新鲜度检查通过、显示健康。两边都不报。

**修法：一行配置** —— 把 `ads_growth_states`（freshnessHours: 26）加进该 job 的 `outputTables`。B 级、极小。卫青未擅自改，等统筹/PM 点头——**这条还没做**，单独开卡追踪：doc:docs/ledger/2026-09-27-ads-growth-states-outputtables-registry.md。

## 对熔断实现的提醒（已转统筹，含一处需要改口的结论）
第 5 条判据「数据不全 → 冻结」只处理**已经写出行**、`data_completeness='partial'` 的情况；`buildGrowthState` 只有跑到底并成功 upsert 才会写这个字段。9/25 这种「整段被前置闸门跳过、行压根没写」的场景，不落在这条判据的判定范围内——**没有行就没有 `partial` 值可读，既不是「判定为冻结」也不是「判定为放行」，是压根没有可供下游消费的判据或回执**。上一版把这次结果记成「正确 fail-closed」是错的：那句话默认了「零行」等价于「判定冻结」，但实际上下游（看板、日报、`ads-rule-finding-items.ts` 那类只读消费者）拿到的是「查不到今天这行」，跟「查到了、判定 partial」是两种不同状态，前者目前没有专门处理，读的人分不清是「今天没数据所以没判」还是「压根没跑」。**熔断要能区分「有输入但判定不冻结」「有输入且判定 partial」「压根没有输入行」三种，第三种目前无信号**，必须让消费方把「当日行不存在」单独当 fail-closed 处理，不能默认已经安全。

## 一个反复出现的模式（2026-09-26/27 两天内第三次）
「**一个前置闸门 return/skip 掉一整块副作用，且不留痕**」：
1. 本次：config 读失败 → 整块跳过（写表 + 诊断 + 日报三件事一起没）
2. D11 复审查出 8 处静默 `return null`（其中「改过池子收人规则就 7 天不判」会在最该盯供血效果的 7 天里致盲）
3. 巡察窗口自己开的「这类失败不能再静默」任务卡

**闸门本身都是对的（读不到配置就不该乱跑），错在跳过时不留一条「我因为 X 跳过了 Y」。** 建议把「闸门跳过副作用必须留痕（not_comparable / skipped 记录）」作为通用约定写进巡察与内核的实现规范，而不是一处一处补。

全程只读：未改代码、未改数据库、未动广告。
