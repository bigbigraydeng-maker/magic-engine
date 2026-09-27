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
verify_how: 防复发已在本卡同一改动里落地（`src/lib/cron/registry.ts` 的 google-data-pullback-daily outputTables 已含 ads_growth_states，见 commit 938cd01），查它没被后续改动移除即可。再查最近 7 天 ads_growth_states 每天是不是都有 6 行（缺任一天 = 又出现同类静默，立刻交回 PM）
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

**修法：一行配置** —— 把 `ads_growth_states` 加进该 job 的 `outputTables`。机器按文件判 A 级（生产定时任务注册与调度），子牙 + 魏征 2026-09-27 审过。
**✅ 2026-09-27 已做**（统筹授权）：本卡同一个改动里已加上，并在 registry 里就地写了注释说明为什么补登记。以后这张表零行会被沉默死检测自己报出来。
**阈值同批从 26h 收到 24h**（Codex 复审 P1 提出、作者复核采纳）：整批没写时上一批的行到当天 19:00 检查只隔约 25.92h，够不到严格的 `> 26h`，24h 抓得到。
**但别把这当成「单日整批缺失已经盖住了」**（魏征 W131-1 纠正）：`pm-daily-todo` 是 `0 19 * * 0-4`，**UTC 周五、周六不发**，而 9/25 正是 UTC 周五 —— 周五缺一天、周六就补了新行，等周日 19:00 再查只隔约 2h，**阈值多少都零告警**。一周 2 天的整批缺失这条判据结构性看不见，得换判据（查最近 7 天逐日有没有行）。后续 P2 卡：[[2026-09-28-cron-freshness-misses-friday-saturday]]。
验证：`src/lib/cron` 全部测试跑过，**2 个失败经对比 origin/main 原版确认是既有基线红**（registry 与 render.yaml 调度对账、reel-batch-render 无人认领），我的改动只 +6 行、未引入新失败。

**顺手挖出的第三个监控问题（不在本次修复范围，建议独立修）**：那条基线红的详情显示 **8 个定时任务在 registry 里登记的调度时间跟 render.yaml 实际不一致**，普遍早 10–14 小时，疑似 NZ/UTC 时区混淆：
- `google-data-pullback-daily`：登记 `0 3 * * *` vs 实际 `0 17 * * *`（**就是广告巡察这个**）
- `ad-entity-snapshot`：登记 `30 */3` vs 实际 `30 */6`（**频率差一倍**）
- 另有 `ai-tracker-weekly`、`goal-current-value-refresh`、`industry-ai-visibility-daily` 等，共 8 个
**影响**：健康检测用 registry 的 schedule 判「该跑没跑」（overdue）。时间错 14 小时 → 这 8 个任务的逾期判定全部失准，可能误报逾期、也可能在真没跑时漏报。
（我自己今晚也差点因为算错这个 job 的运行时间误报「今早巡察没跑」——核了 render.yaml 才发现还没到点。人和机器踩的是同一个坑。）
另有一条同族基线红：`inngest/functions/reel-batch-render.ts` 设计上要定时跑，却不在任何名单里 = 没人监控它跑没跑。

## 对熔断实现的提醒（已转统筹，含一处需要改口的结论）
第 5 条判据「数据不全 → 冻结」只处理**已经写出行**、`data_completeness='partial'` 的情况；`buildGrowthState` 只有跑到底并成功 upsert 才会写这个字段。9/25 这种「整段被前置闸门跳过、行压根没写」的场景，不落在这条判据的判定范围内——**没有行就没有 `partial` 值可读，既不是「判定为冻结」也不是「判定为放行」，是压根没有可供下游消费的判据或回执**。上一版把这次结果记成「正确 fail-closed」是错的：那句话默认了「零行」等价于「判定冻结」，但实际上下游（看板、日报、`ads-rule-finding-items.ts` 那类只读消费者）拿到的是「查不到今天这行」，跟「查到了、判定 partial」是两种不同状态，前者目前没有专门处理，读的人分不清是「今天没数据所以没判」还是「压根没跑」。**熔断要能区分「有输入但判定不冻结」「有输入且判定 partial」「压根没有输入行」三种，第三种目前无信号**，必须让消费方把「当日行不存在」单独当 fail-closed 处理，不能默认已经安全。

## 一个反复出现的模式（2026-09-26/27 两天内第三次）
「**一个前置闸门 return/skip 掉一整块副作用，且不留痕**」：
1. 本次：config 读失败 → 整块跳过（写表 + 诊断 + 日报三件事一起没）
2. D11 复审查出 8 处静默 `return null`（其中「改过池子收人规则就 7 天不判」会在最该盯供血效果的 7 天里致盲）
3. 巡察窗口自己开的「这类失败不能再静默」任务卡

**闸门本身都是对的（读不到配置就不该乱跑），错在跳过时不留一条「我因为 X 跳过了 Y」。** 建议把「闸门跳过副作用必须留痕（not_comparable / skipped 记录）」作为通用约定写进巡察与内核的实现规范，而不是一处一处补。

全程只读：未改代码、未改数据库、未动广告。
