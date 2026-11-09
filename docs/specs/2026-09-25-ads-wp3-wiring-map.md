# 广告 WP3 闭环编排 · 接线点地图（2026-09-25，只读调查，origin/main = 99125fa4）

用途：把 [ads spec](2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md) §3 G6–G11 / §7 WP3 拆成可派给 DeepSeek 的小轮（每轮 ≤3 文件、每个符号带行号）。谁接手 WP3 都从这张图开始，不用再摸一遍。所有 `路径:行号` 用 `git grep -n` / `git show origin/main:` 核过。

## 0. 两条必须先修的实锤（A 级，WP3 第一轮）

1. **信封事实解析器没接进内核组装**：`src/lib/kernel/deps.ts:113-130 createKernelDeps` 不转发 `init.resolveEnvelopeFacts`；`src/lib/kernel/index.ts:18-33 createKernel` 从不调 `src/lib/capabilities/ads/envelope-facts.ts:116 createAdsEnvelopeFactsResolver({sb, capabilities, now?})`。全仓只有 `gateway.ts:901` / `authorize.ts:396` 在读它。**今天任何 bounded 广告 run 到授权必 deny `outside_autonomy_envelope`。** 测试全绕过 deps 直调 `preProviderEnvelopeBlockReason`（`pre-provider-envelope.test.ts:98-186`），所以全绿。`capabilities/ads/*` 零单测。
2. **旁路**：`src/app/api/clients/[id]/ad-health/stop-loss/route.ts:48-50,124` 直调 `setAdSetStatus/DailyBudget`，不经 Kernel。spec G11 要求所有触达 Kernel 的路径经 `ads/impact.cycle.due` 队列，无旁路。

台账卡：`docs/ledger/2026-09-25-ads-wp2-envelope-facts-not-wired.md`。

## 1. Kernel 提交入口

| 位置 | 符号 | 签名 / 内容 |
|---|---|---|
| `src/lib/kernel/runner.ts:41` | `SubmitActionInput` | `{clientId, actionKey, purpose, goalId?, executionItemId?, triggeredBy: 'signal'\|'schedule'\|'human'\|'agent'\|'run', triggeredByRef?, input, rationale?, evidence?, correlationId?}` |
| `runner.ts:64` | `submitActionRun(deps, input): Promise<{run, existing}>` | 幂等提交；`purpose='growth'` 无 goalId 抛 INVALID_INPUT（K5 已在） |
| `runner.ts:248` | `runAction(deps, input): Promise<ActionRunOutcome>` | 提交 + 授权 + 执行 |
| `runner.ts:714-729` | `RECOVERABLE_DENY_CODES` | 含 `outside_autonomy_envelope` |
| `runner.ts:750` | `recoverDeniedRun(deps, runId, recoveredByUser, reason)` | 只放白名单码 |
| `supabase/migrations/20260925000003_kernel_recovery_outside_autonomy_envelope.sql:48` | RPC 副本 | `architecture.test.ts:2016/2048` 钉两边一致 |

**缺**：按「客户 + deny_code + 晚于 config/goal 更新时间」列 denied run 的查询（`store.ts:858 listDeadLetterRuns` 只按 `needs_human`）；`deny_code` 在 `authorization_decisions` 不在 `action_runs`（`20260808000003:163`），恢复点要 join。

## 2. 广告 ActionKey 与执行器

`src/lib/kernel/registry-ads.ts`：六个 key 全 `approval:{mode:'bounded', envelope: ADS_ENVELOPE}`（`:17-24`：0.2 / true / 72 / true / true / true），`rollback:'provider_native'`。keyFields：pause `['cycle_date','adset_id']:79`；cut/scale `[+'after_cents']:129/179`；budget_move `['cycle_date','plan_hash']:228`；add_retargeting `['cycle_date','campaign_id','audience_id']:278`；swap `['cycle_date','ad_id','creative_ref']:328`。

`src/lib/capabilities/ads/`：`pause-unit.ts:74` / `cut-unit-budget.ts:72` / `scale-unit-budget.ts:72` 真实现；`deferred-to-human.ts:80/93/106` 三个 stub 抛 `CAPABILITY_NOT_IMPLEMENTED`（budget_move_plan / add_retargeting_adset / swap_creative）。`common.ts:43 makeSnapshotPreStep(sb)`、`:84 makeReadbackVerification`。`src/lib/kernel/autonomy-envelope.ts:97 isWithinEnvelope(request, facts, envelope): {within, reasons[]}`。

## 3. 卫青 / 巡察

`src/lib/ads-strategy/agents/patrol.ts:181 buildGrowthState(clientId, date, syncAccounts)`，`:220` upsert `ads_growth_states`（`onConflict:'client_id,date'`）；`:61 resolveCompleteness(...)`；`:196` partial 不出机会。`portfolio/run-daily.ts:22 runPortfolioDiagnostics(clientId, clientName, insightDate, recipients)`。
`src/app/api/cron/google-data-pullback-daily/route.ts`：`:440 evaluateClientAdHealth`、`:483 runPortfolioDiagnostics`、`:498 buildGrowthState`。**无 `inngest.send`**。render.yaml `:360` `0 17 * * *`。
**缺**：`ads/impact.cycle.due` 发送点；evaluate/diagnostics 未迁出 route（spec 要求收编不并行）；O4 只有类型（`diagnostics/types.ts:21`）无实现。

## 4. Inngest 基建

`src/lib/inngest/client.ts:41 inngest`、`:26 CLOUD_FN_PREFIX='cloud-'`；`functions/index.ts` `cloudFunctions[]`（30 个）；`/api/inngest/route.ts` serve。事件名惯例 `域/名词.动词`。模板：`seo-post-publish-monitor.ts:13-27`（fan-out + `concurrency:{limit:1,key:'event.data.client_id'}`）+ `:29-58`（`step.sleepUntil` + `onFailure` receipt）；工厂模式 `flywheel-seo-weekly.ts:74/157/211`。发送：`inngest.send({id,name,data})`（`web-intelligence/route.ts:42`）。
**缺**：任何 `ads/*` 事件、`cloud-ads-*` 函数——零。上线要手动 Sync（`STATE.md:174`，PITFALLS F10）。

## 5. Check / Tune 与记忆

`flywheel/attribution/job.ts:326 upsertOutcome(row)`（私有，`onConflict='action_id,metric_key,window_days'`），`evaluator_key` 取 `OUTCOME_EVALUATOR`（`outcome-identity.ts:37`，只有 `flywheel_metrics`/`gsc_snapshots`）。`flywheel_actions.action_run_id` 已有（`20260808000003:1542`）；广告写 `flywheel_actions` 范式 `draft-and-gate.ts:67-84`。
`src/lib/memory/service.ts`：`:28 loadMemoryForClient`、`:340 saveProvenPattern`、`:368 saveFailedExperiment`、`:435 saveDecisionHistory`、`:462 updateDecisionOutcome`。
**缺（要 migration）**：`flywheel_outcomes_evaluator_key_check`（`20260808000001:176`）不接受 `'ads.goal_pace'`；`PatternType`（`memory/types.ts:74`）无广告动作类型；无 ads 专用 outcome 写手。

## 6. Jev

`src/lib/jev/client.ts:61 callJev(state, questions:{[k]:{type:'noul', instructions}})`，缺 `TYPESAFE_API_KEY` 直接 throw，调用方 fail-closed（范式 `factory/content-quality-guard.ts:155-180`）。
**缺**：`prescription_rejected_by_jev`、`envelope_preflight_mismatch`、处方一致性问句、「连续 5 条低分回 observe」。

## 7. 日报与待办

`portfolio/internal-digest.ts:159 buildInternalDigest(opts 含 goal?)`（`:143` 已有目标进度行）、`:221 persistAndSendInternalDigest`；`goal-pace.ts:148 computeGoalPace`；`portfolio/goal-context.ts:87 buildDigestGoalContext`。pm-todo：`manual-items.ts:205 pushKernelItems` 把 `listDeadLetterRuns` 转成 `kernel_needs_human`（现成的 Kernel→待办桥）。
**缺**：`pushAdsAutonomyItems`、`escalate_to_pm` kind、五段日报、`ads_growth_states` 进邮件。

## 8. 开关与策略表

`ad_strategy_configs.autonomy_mode` 运行期**无人读**。`client_automation_policies`：无写入辅助函数（唯一读者 `knowledge/entitlement.ts:85`）；`mode IN ('auto_approve','require_approval','deny')`、`updated_by NOT NULL`、活动行唯一索引 `(client_id, action_key) WHERE effective_to IS NULL`、改 mode 自动 `policy_version+1`（`20260808000003:32-125`）。`authorize.ts:354` 缺行 → `no_policy` deny。`store.ts:86 getActivePolicy`。
**缺**：同步器（`bounded_auto` ↔ 六个 ads key 的 `auto_approve` 行，`updated_by` 服务端派生；狄仁杰审）。

## 9. 熔断（G11）

`circuit|熔断|breaker|spend_spike` 在 ads-strategy / kernel / capabilities **零命中**。第 5 条（数据不全当日不动）已由 `patrol.ts:196` 实现；第 1（花费×3）、2（累计变动>上限）、3（回滚失败只落 dead_letter，`gateway.ts:1285-1330`，不冻结客户）、4（Jev 连低）全缺。

## 10. 架构测试红线（`src/lib/kernel/__tests__/architecture.test.ts`）

`:249` `PROVIDER_WRITE_MODULES`（`boundaries.ts:25-36`）**不含 `@/lib/meta/adsets`**，拦不住 ads-strategy 直写；`:322` kernel/ 与 capabilities/ 禁 import `supabaseAdmin`（韩信放 capabilities 必须注入 sb）；`:2016-2051` 可恢复码 SQL/TS 一致（`deny-recovery.test.ts:244` 六码列表同改）；`:2229` `createCapabilities` 键集 == `ACTION_KEYS`。**缺**：「ads-strategy/capabilities 之外禁 import submitActionRun/recoverDeniedRun」断言。

## 11. 拆轮建议

**先做（A 级）**：① `deps.ts:113` 转发 `resolveEnvelopeFacts` + `kernel/index.ts:22` 装 `createAdsEnvelopeFactsResolver` + 一条走真 deps 的集成测试；② `autonomy_mode`→policy 同步器与 PATCH 路由同轮（狄仁杰审）；③ 收编 stop-loss 旁路 + 架构断言。
**纯函数可单独成轮（B 级）**：熔断判据 `circuit-breaker.ts`；孔明处方排序 + memory 过滤 + `isWithinEnvelope` 预检；五段日报渲染；Jev 一致性问句 + 阈值；Check 纯比较。
**接线必须一起改**：`ads-events.ts` 常量 + `functions/ads-impact-cycle.ts` + `index.ts` 登记 + route.ts `:498` 后 `inngest.send`（一轮）；迁 `:440/:483` 入函数（下一轮，禁双跑）。
**要 migration**：`flywheel_outcomes` evaluator CHECK 扩 `ads.goal_pace`；`PatternType` 扩广告类型。
