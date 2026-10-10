# 广告支柱 · 目标驱动自治 IMPACT 闭环 v1

状态：设计稿（未写代码）· 待子牙 + 魏征 + 狄仁杰设计复审 · 风险 **A 级**（碰 Kernel 授权、真实花费、对外副作用）
Repository Fact Gate：`origin/main` = `5da5971a` · fetched 2026-09-24 02:10 NZST
Tier Classification：**既有广告 L1 的扩展 + Kernel / Memory / Verification 基础设施接入**，不新增支柱、不新增能力线，不进 platform-candidates
§11 资源优先级：频率 **高**（每天每客户都在花钱）/ IMPACT 闭环关键度 **高**（Prescribe→Act→Check→Tune 四段目前断头）/ 收入关联度 **高**（广告是 CTS/NAL 续费的直接依据）→ **P0**
前置设计：[`~/.claude/plans/ads-impact-loop-capability.md`](../../../../../.claude/plans/ads-impact-loop-capability.md)（2026-09-14，两轮复审收敛，§14 条款 K1–K14 / M1–M9 / C1–C9）。**本 spec 是它的 Phase 2–3 实施稿**，条款除 K2 外全部继承；K2 被 PM 2026-09-24 决策覆盖（见 §1）。

---

## 0. 一句话结论

**不建新引擎。** 把 `src/lib/ads-strategy/` 已经在跑的"每日体检 + D1–D9 诊断 + 止损 + 建广告闸门"补上四块缺口——目标契约、机会发现、Kernel 受限自治、Inngest 闭环编排——让它从"发现问题等人批"变成"冲着 PM 设的目标自己跑完 IMPACT，PM 每天看一次结果"。

---

## 1. PM 拍板与分工边界（2026-09-24）

PM 原话："不需要让我批准，我们最大权限的让 AI 去介入。但是以天为单位我们来看结果。我需要 AI 可以自己调优，借助 jev、inngest 等外部工具，结合企业自身知识库，严格遵守 IMPACT 理念，从发现问题到解决问题，不断的 loop 循环。"追加："我来设置目标，控制 daily 预算，素材。agent 需要根据我启动的这些指标，根据实际情况来向我请示是否要调整。要冲着目标完成去做！"

| PM 管 | AI 管 | AI 只在这种情况找 PM |
|---|---|---|
| **目标**（留资数 / 对话数 / 销售额 / 曝光 / 粉丝等，带期限） | 投放策略、预算在单位间怎么分、哪条加投哪条收缩、开/停广告组、换素材组合 | **按当前目标 + 预算上限 + 素材池，目标完不成**——请示"加预算到 X / 换素材 / 下调目标"三选一 |
| **日预算上限**（每客户每账户） | 在上限内自主调配 | 熔断触发（§6） |
| **素材池**（哪些片子/图可以投） | 只从池子里选，不造素材 | 素材池耗尽或全部疲劳 |

**被覆盖的旧条款**：9/14 设计 §14 K2「广告动作一律人审批，不论客户策略」→ 改为 **§5.3 受限自治信封（bounded autonomy envelope）**：信封内自动执行，信封外不执行、改为请示。9/22 的「D3-only 自动暂停」授权并入本条。

---

## 2. 复用清单（这些已经在，只调用不重写）

| 底座 | 路径 | 在闭环里的角色 |
|---|---|---|
| 目标表 `goals`（primary_metric_key / baseline / target / period / budget_amount） | `supabase/migrations/20260619000003_phase31_strategy_layer_foundation.sql` · `src/lib/strategy/goals.ts` · `/api/clients/[id]/goals` | **PM 的目标就写在这里**，一客户一 active goal；Kernel `purpose='growth'` 强制挂 goal_id（K5） |
| 指标目录 `PRIMARY_METRIC_CATALOG` + `autoFetchMetricValue` | `src/types/strategy.ts` · `src/lib/strategy/auto-fetch.ts` | 目标进度取数；**缺广告结果源（§3 G1）** |
| 每日数据脊柱 `ad_daily_insights` | `src/lib/ads-strategy/daily-insights.ts` | Measure 唯一数据源 |
| 设置快照 `ad_entity_snapshots` / `ad_snapshot_captures` | `portfolio/snapshot.ts` · `snapshot-sync.ts` | Check 的 before/after、72h 变动计数（K12） |
| 基线判定 `judgeCampaign` | `baseline.ts` | 疲劳传感器 |
| 诊断 D1/D3/D4/D5/D7/D8/D9 `runDiagnostics` | `portfolio/diagnostics/run.ts` | 问题传感器（纯函数，输出 `Diagnosis` 含 evidence/sample/not_comparable） |
| 漏斗角色 / 结果阶梯 / 客户结果口径 | `portfolio/roles.ts` · `outcome-ladder.ts` · `outcome-config.ts`（`ad_strategy_configs.primary_result / target_cost_per_primary`） | 目标 ↔ 广告结果对齐 |
| 处方模板 `prescribe` | `prescription.ts` | 三种标准处方保留为词表子集 |
| 止损 `executeStopLoss` | `stop-loss.ts` | `ads.pause` / 砍 20% 执行器 |
| 建广告闸门 `createDraftForApproval` / `approveDraft` | `draft-and-gate.ts` · `launch-readback.ts` · `meta-readback-adapter.ts` | 新广告组"建暂停→回读→激活"执行器 |
| 每日全账户回读扫描 | `readback-sweep.ts`（cron `ad-readback-sweep`） | 安全巡查，不动 |
| Meta 写入 | `meta/adsets.ts`（`setAdSetDailyBudget` / `setAdSetStatus`）· `meta/ad-publisher.ts` · `meta/guardrails.ts`（±20% band） | 唯一的对外写入面 |
| 行业剧本 | `playbooks/{travel,logistics,real-estate,ecommerce,default}.ts` | 结果名词 / 验证窗口 / 阈值，按 `clients.industry` 选 |
| Kernel | `src/lib/kernel/`（`submitActionRun` / `runAction` / `executeAuthorizedRun`；`client_automation_policies.mode`；`action_runs`） | 所有对外动作的授权 + 幂等 + 回执 + 撤回 |
| 记忆 | `src/lib/memory/service.ts`（`saveProvenPattern` / `saveFailedExperiment` / `saveDecisionHistory` / `updateDecisionOutcome`）· `write-lesson.ts` · `lesson-shareability.ts` · `learning-rollup.ts` | Tune 落点，客户层→行业层晋升 |
| 飞轮回执 | `flywheel_actions` / `flywheel_outcomes`（`evaluator_key`） | 分析投影（M1：以 `action_runs` 为准） |
| Jev | `src/lib/jev/client.ts`（`callJev(state, questions)`，noul 0–1，fail-closed） | §5.6 三处判断 |
| Inngest | `src/lib/inngest/client.ts`（`cloud-` 前缀、`WORKER_OWNED_EVENTS`）· `functions/index.ts` · 范式 `flywheel-seo-weekly.ts` · `daily-plan-post-measurement.ts`（`step.sleepUntil`） | 闭环编排 |
| 人工任务三件套 | `src/lib/pm-todo/manual-items.ts`（`ManualItem{what,how,href}` + `push*Items` 扩展点） | 请示 PM 的唯一通道 |
| 内部诊断日报 | `portfolio/internal-digest.ts` · `digest.ts` | 合并为 PM 日检报告（G10） |
| Haiku 叙述生成 | `src/lib/meta/ai/analysis.ts` 的 `callClaudeChat(MODEL_HAIKU)` 用法 | 只用来把结构化结论写成人话，不做判断 |

**明确不建**：新诊断引擎、新广告数据表、新回执表、新审批界面（Kernel `APPROVAL_SURFACE_BLOCKER` 保持不解决——本方案不需要审批界面）、任何 LLM 驱动的"你觉得该怎么办"决策。

**邻接系统（不撞车，不复用）**：`#1839 Meta Ads AI Connector`（`src/lib/meta/ai/`，客户自助只读分析、独立授权体系）——只读、面向自助客户；本方案面向 FDE 托管客户的写入闭环，共享 `meta_ads_read_grants` 不可写入 `client_meta_ad_accounts`，两边不交叉。

---

## 3. 缺口清单（只补这些）

### G1 目标契约（Growth Contract 落地）
- **不建新表**。PM 的目标 = `goals` 一行：`intent`（acquisition/sales/awareness）+ `primary_metric_key` + `target_value` + `period_start/end` + `budget_amount/currency`。
- `autoFetchMetricValue` 新增广告结果源：`leads_count` / `signups_count` / `messaging_started`（新 key，进 `PRIMARY_METRIC_CATALOG`）从 `ad_daily_insights` 按 `outcome-ladder.countOutcome` 取当期累计；归不上的按 M2 记 UNKNOWN，**不算 0**。
- `ad_strategy_configs` 加三列（一份 migration，随 PR 提交、PM go 才 apply）：
  - `daily_budget_cap_cents integer`（账户币种；NULL = 未设 → 自治模式一律 `observe`，M4 缺行即锁）
  - `autonomy_mode text CHECK IN ('observe','bounded_auto') DEFAULT 'observe'`
  - `creative_pool jsonb DEFAULT '[]'`：`[{kind:'meta_video'|'work_order', ref, approved_by, approved_at}]`；agent 只从这里选素材
- Settings UI：`/dashboard/clients/[id]/ads-health` 顶部加"目标 / 日预算上限 / 素材池"三块（铁律 8：不许让 PM 进 Supabase 直填）。
- **写入路径守卫（狄仁杰第一轮，四条实锤）**：三列的写入**只走现有** `/api/clients/[id]/ad-strategy-config` PATCH 的 `requirePaidClientAccess` + `guardGlobalAdmin` 双守卫（`route.ts:36-44`），不新开路由、不只挂 `requirePaidClientAccess`（它的 `ACCESS_TYPES_DASHBOARD` 含 `'fde'` 和 `'client'`，等于让客户/FDE 能改自治开关和预算上限，污染信封基准）。
- **素材池批准与提报分离**：`creative_pool[]` 条目带 `status:'candidate'|'approved'`；PATCH 只能写 `kind/ref/status='candidate'`；`approved_by/approved_at/status='approved'` **只能由** `POST /api/clients/[id]/ad-strategy-config/creative-pool/approve` 写入，`approved_by` **服务端从会话派生、拒绝任何客户端传入**（沿用 `src/lib/diagnostic/prescription-patch.ts` 2026-08-04 事故后的规则），且该路由挂 `guardGlobalAdmin`。agent 只读 `status='approved'` 的条目。

### G2 目标节奏（goal pace，纯函数）
`src/lib/ads-strategy/goal-pace.ts`：输入 goal + 当期累计 + 已过天数 → `{expectedToDate, actualToDate, gapPct, projectedEnd, verdict:'on_track'|'behind'|'unreachable_within_caps'}`。`unreachable_within_caps` 的判据：按过去 7 天中位数每结果成本 × 剩余日预算上限 × 剩余天数，仍到不了目标的 80%。这是**请示 PM 的唯一触发器**。

### G3 机会发现（卫青新增，纯函数，`portfolio/opportunities/`）
| 码 | 判据 | 输出处方候选 |
|---|---|---|
| O1 潜在爆款 | 单位 CTR 连续 3 天高于账户中位数 1.5× 且花费 < 账户日均 | `ads.scale_unit_budget`（+20%） |
| O2 漏斗缺位 | 有 awareness 花费 ≥ D4 阈值但无 retargeting 角色单位 | `ads.add_retargeting_adset` |
| O3 预算错配 | 同角色内高结果率单位预算占比低（复用 D5 检验方向反过来） | `ads.budget_move_plan` |
| O4 剧本缺口 | 行业剧本声明的打法（`play-vocabulary.ts`）在账户里缺席 | 只出建议，不出动作 |
每条同样带 evidence / sample / not_comparable，与 `Diagnosis` 同形。

### G4 处方词表（封闭，扩展 9/14 §4.2）
`ads.pause_unit` · `ads.cut_unit_budget`（现有止损）· `ads.scale_unit_budget`（新：+≤20%，日上限内）· `ads.budget_move_plan`（§4.3 一次性计划，总额不变）· `ads.add_retargeting_adset`（走 draft-and-gate）· `ads.swap_creative`（从素材池换，走 winner-sync 同路径）· `ads.escalate_to_pm`（不是动作，是三件套待办）。
**处方记录 = Kernel `action_runs` 一行**（`SubmitActionInput.rationale/evidence` 装"为什么"），不建 prescriptions 表。

### G5 Kernel 受限自治（A 级，核心改动）
- 注册 6 个 ActionKey（`types.ts` 封闭 union + `registry.ts` DEFINITIONS + `src/lib/capabilities/ads/*` 处理器，K7：执行器只放 capabilities）。
- `OutwardAuthorization` 从 `requiresHumanApproval: true` 字面量改为：
  ```ts
  authorization: { mode: 'human_only' } | { mode: 'bounded', envelope: AutonomyEnvelope }
  ```
  `AutonomyEnvelope = { maxBudgetDeltaRatio: 0.2; respectDailyCapCents: true; minHoursSinceLastChange: 72; excludeLearningPhase: true; excludeAdStudies: true; requiresRollbackHandler: true }`
- **Kernel 现有两道互相独立的"对外动作必须人审"闸，两道都要改、双保险保留**（子牙设计审 2026-09-24 指出，spec v1 初稿漏了第一道）：
  1. **结构闸** `outward-authorization.ts` `outwardBlockReason()`（`authorize.ts:330` 与 `gateway.ts:295` 各自独立调用，后者在任何 provider 副作用之前再跑一次）：现检查 `requiresHumanApproval !== true` 即拦。改为检查**声明本身是否完整合法**：`authorization.mode ∈ {human_only, bounded}`；`bounded` 时信封 6 项必须全部声明且值在允许域内（`maxBudgetDeltaRatio ∈ (0, 0.2]`、`minHoursSinceLastChange ≥ 72`、四个布尔项必须为 `true`），且 `rollback` 已声明、`reversible === true`、`providerIdempotency ≠ not_applicable`、capability 已注册撤回处理函数。缺任一项 → 与现在同样的"根本不做"语义（不是转审批）。这道闸只看**声明**，不看本次输入。
  2. **实例闸** `authorize.ts` ⑥b（policy 层）：`sideEffect==='outward' && policy.mode==='auto_approve'` → 若声明为 `bounded` 且 **本次 input 落在信封内**（每项在授权时用真实快照重算，K9）→ 放行；否则 **不是转 pending_approval，而是 deny（可恢复码 `outside_autonomy_envelope`）+ 生成 `ads.escalate_to_pm` 三件套**。审批界面因此不需要存在。
  3. **实例闸的兜底副本**：`gateway.ts` 在 `outwardBlockReason` 之后、provider 调用之前，用运行前快照（M1 `kernel_pre`）**再算一次输入是否在信封内**，不一致直接 `dead_letter` + 回滚不触发（还没动 provider）。这样"拆掉 authorize.ts 那一层，gateway 仍拦得住"对实例级检查同样成立——双保险从"两处都查声明"变成"两处查声明 + 两处查实例"，不是变单保险。
  4. 变异测试四条必红：删 gateway 的结构闸调用 / 删 gateway 的实例重算 / 把信封某项声明成 `false` / 把 `maxBudgetDeltaRatio` 声明成 0.5。
- **`outside_autonomy_envelope` 不许死锁（魏征第一轮，`runner.ts:291/714/744` 实锤）**：
  1. **正常流程根本不产生这条 deny**：孔明提交前先用同一个纯函数 `isWithinEnvelope(input, snapshot, config)` 预检；不在信封内 → **不提交 Kernel run**，直接出 `ads.escalate_to_pm` 三件套。Kernel 的实例闸只是纵深防御，命中即说明预检和授权用的快照/配置不一致，要记 `envelope_preflight_mismatch` 指标。
  2. 万一命中：`outside_autonomy_envelope` **加入** `RECOVERABLE_DENY_CODES`（`runner.ts:714`）**和** `kernel_claim_run_recovery` RPC 里那份必须一字不差的副本（新 migration，仿 `20260811040000_kernel_recovery_outward_requires_human_policy.sql`，架构测试 `architecture.test.ts:2011` 同步加断言）。
  3. **恢复调用点写死在一步**：下一轮 `ads/impact.cycle.due` 的孔明步骤开头，查该客户 `action_runs.status='denied' AND deny_code='outside_autonomy_envelope' AND (denied_at < ad_strategy_configs.updated_at OR denied_at < goals.updated_at)`（即 PM 改过上限**或**目标之后，任一更新都要重新考虑），命中的先 `recoverDeniedRun(runId, 'system:ads-strategist', reason)` 再决定是否重提；PM 保存 Settings 时不直接调 Kernel（保持"所有触达 Kernel 的路径都走每客户队列"，见 G11）。
  4. **幂等键含 `cycle_date`**：6 个广告 ActionKey 的 `idempotency.keyFields` 一律包含 `cycle_date` + 实体 id + 动作参数 hash，不同天的同内容处方不共用幂等键，昨天的 denied 不会被今天命中。
- 保留：K1 撤回处理函数必填、K3 延迟回读不自动恢复、K4 广告花费不进 Kernel 成本字段、K5 无 goal 拒绝、K6 学习受限只建议、K10/K11 改前值核对 + 回滚失败冻结客户、K13 禁回落共享令牌、K14 先对齐注册表与生产。

### G6 Inngest 闭环（业务可读事件，函数 id 一律 `cloud-ads-*`）
```
ads/impact.cycle.due        ← google-data-pullback-daily 拉完数据后 sendEvent（每客户一条，concurrency key = client_id）
ads/growth_state.built      ← 卫青：diagnoses + opportunities + goal pace → ads_growth_states 一行
ads/prescription.proposed   ← 孔明：处方候选 + memory 过滤 + Jev 一致性分 → submitActionRun
ads/action.executed         ← Kernel 回执（含 Meta receipt、改前/改后快照 id）
ads/action.readback_checked ← +10min / +60min 回读（K3，用 step.sleepUntil）
ads/verification.due        ← 按剧本窗口 sleepUntil（旅游 7d / 物流 14d）
ads/verification.completed  ← 韩信：before/after → flywheel_outcomes（evaluator_key='ads.goal_pace'）；窗口内有其他变动 → not_comparable
ads/memory.recorded         ← 孔明：saveProvenPattern / saveFailedExperiment / updateDecisionOutcome
ads/pm_digest.ready         ← G10 日检报告
```
**数据完整性：三段三种处理（子牙 + 魏征第一轮）**。现有 `route.ts` 里两道门槛是**故意不同的**：`:423` 的 `ad_daily.success` 只挡旧体检和日报；`:469` 的 D 系列诊断**刻意不设门槛**——授权断了拉不到数时，D7 的职责恰恰是报告这件事。迁入 `ads/growth_state.built` 后必须保留这个区分：
- **诊断（D1–D9）**：不设完整性门槛，照旧跑；数据坏了由 D7 报出来。
- **机会（O1–O4）+ 处方 + 动作**：`impact.cycle.due` 事件携带 **campaign / adset / ad 三级**同步函数各自的 `success/complete`（现有 `:403` 那个 if 只查了 campaign 级，不够）+ 当日 `ad_snapshot_captures` 完整性；任一不完整 → `ads_growth_states.data_completeness='partial'`，卫青仍写诊断但不出机会，**孔明本轮不提交任何 run**，日报写明"数据没拉全，今天不动"。
- **G11 熔断第 1/2 条（花费突增 / 账户超上限）是新逻辑，不是 D 系列，没有 D7 那种自报能力**：它**单独读**同一份完整性信号；`partial` 时花费异常判定结果为 `unknown`——既不触发熔断也不放行动作（本轮反正不提交），并在日报标"今日花费异常判定：数据不全，未判"。不做 low-confidence 继续算：API 不稳定和账户端出事常同源，缺分子会让"花费 > 中位数 × 3"反而更难触发。
- WP1 / WP3 验收项：完整性信号必须含 adset_level / ad_level，变异测试"只查 campaign 级"必红。

每步 `step.run` 内落 receipt（request id / client id / entity id / status / spend impact / authorization status / created_at）。**上线后必须手动 Sync `/api/inngest`**（PITFALLS F10）。现有 `google-data-pullback-daily` 内同步调用的 `evaluateClientAdHealth` + `runPortfolioDiagnostics` **迁入 `ads/growth_state.built` 这一步，旧路径收编不并行**（禁双跑）。

### G7 Check
扩展 `flywheel_outcomes` 写手：每条已执行动作在 `verification.due` 到期时，对比 `ad_daily_insights` 的作用范围（campaign/adset）before/after；`confidence` 按样本量；`verdict` 三态。K12：72h 内快照有非 ME 变动 → `not_comparable`，不写 memory。

### G8 Tune
- confirmed → `saveProvenPattern`（动作 × 角色 × 情境 → 结果）；reversed → `saveFailedExperiment`；inconclusive → 只 `updateDecisionOutcome`，不写经验。
- 下一轮 Prescribe 读 `loadMemoryForClient(flywheel:'ads')`：同类处方上次 reversed → 降 confidence 一档；两次 reversed → 该处方类型对该客户冻结 30 天。
- 晋升行业层：同行业 ≥2 客户同结论（红线 7）+ `checkShareable` 通过 + Jev 可泛化判断 ≥0.8 → `writeGlobalLesson(scope:'industry')`。v1 只写客户层，晋升在 WP4。

### G9 Jev（只用在记忆里已验证有效的三处）
1. 新广告上线前素材红线（竞品名/占位文字/口吻）——复用 `content-guard.ts` 已接的 Jev 检查。
2. 处方一致性："这条处方的理由是否被证据支持"（noul，掺 20% 构造反例作对照组，低于 0.5 不执行、记 `prescription_rejected_by_jev`）。
3. 经验可泛化判断（G8）。
**明确不用 Jev 判"该不该暂停/加减预算"**（`reference-jev-typesafe-evaluation` 已排除）。连续 5 条处方 Jev < 0.5 → 该客户 `autonomy_mode` 自动回 `observe` + 三件套。

### G10 PM 日检报告（合并两封邮件）
一封，五段，全部人话：
1. **目标进度**：`本月目标 200 留资，今天第 14 天，已到 87（预计 186，差 7%）`
2. **今天系统做了什么**：每条动作一行（做了什么 / 为什么 / 花费影响 / 撤回链接）
3. **上周动作效果**：到期验证的 before/after
4. **学到了什么**：新增 memory 条目
5. **需要你决定**：只放 `escalate_to_pm`（目标完不成三选一 / 熔断 / 素材池耗尽）
通道：内部 Resend 日报（现有）+ 今日待办卡片（`pushAdsAutonomyItems`）+ 看板页。客户版仍按 9/14 §6 C1–C9，本 spec 不动。

### G11 熔断（自动回 observe + 三件套，不等 PM）
- 客户当日花费 > 前 7 天中位数 × 3
- 单账户当日累计变动 > 日预算上限
- Kernel 回滚失败（K11）
- Jev 连续低分（G9）
- 快照采集 `ad_snapshot_captures` 或日数据同步当日不完整（看不见就不动）——**这一条是"当日冻结"不是"切回 observe"**：`data_completeness='partial'` 的日子不出动作，次日数据补全自动恢复，不需要 PM 点开关；前四条才切 `observe`。
- **串行化锁死（魏征补充）**：所有会触达 Kernel 授权的广告路径——每日循环、denied 恢复、WP4 多账户、任何未来的手动触发——**一律经由** `ads/impact.cycle.due` 这条 `concurrency: {limit:1, key:'event.data.client_id'}` 队列，没有旁路直接调 `submitActionRun`；同账户多单位的信封加总由此天然串行，gateway 第 3 道实例重算用的 `kernel_pre` 快照已含前一条 run 改后的预算。架构测试加断言：`src/lib/ads-strategy/**` 与 `src/lib/capabilities/ads/**` 之外禁止 import `submitActionRun` / `recoverDeniedRun`。

### G12 看板
`/dashboard/clients/[id]/ads-health` 改为经营看板：目标进度条 / 今日动作时间线 / 问题卡 + 机会卡 / 验证追踪 / 自治开关（observe ↔ bounded_auto）。数据全部来自 `ads_growth_states` + `action_runs` + `flywheel_outcomes`，不新建 API 之外的读路径。

**新表只有一张**：`ads_growth_states(client_id, date, payload jsonb, problems_count, opportunities_count, goal_pace jsonb, created_at)` PK `(client_id,date)`，RLS `FOR ALL TO service_role USING (true)`。

---

## 4. 三个 agent（确定性代码模块，不是聊天机器人）

| agent | 模块 | IMPACT 段 | 输入 | 输出 |
|---|---|---|---|---|
| **卫青**（巡察） | `src/lib/ads-strategy/agents/patrol.ts` | Inspect + Measure | `ad_daily_insights` · 快照 · `runDiagnostics` · `judgeCampaign` · O1–O4 · goal pace | `AdsGrowthState`（问题 / 机会 / 目标节奏 / 每 campaign 状态 / 人话 headline） |
| **孔明**（军师） | `agents/strategist.ts` | Prescribe + Tune | `AdsGrowthState` · `loadMemoryForClient` · 剧本 · 素材池 | 排序后的处方（每条：title / why / not_this_because / expected_impact / confidence / verification_definition）→ `submitActionRun`；Check 回来后写 memory |
| **韩信**（执行） | `agents/executor.ts` | Act + Check | Kernel 授权后的 run | 调 capabilities 处理器 → Meta → 回读 → `flywheel_actions` 投影；到期验证写 `flywheel_outcomes` |

命名说明：卫青已是广告支柱审查 agent，职责从"审"扩到"巡"；孔明 / 韩信为本闭环新起，不与 `docs/agents/` 现有角色冲突（诸葛亮是跨支柱处方总管，孔明只管广告支柱内的处方，对诸葛亮汇报）。

LLM 使用边界：**只有**把结构化结论翻译成 headline / why 的人话这一步用 `callClaudeChat(MODEL_HAIKU)`；判断、排序、阈值全是纯函数，可单测、可变异测试。

---

## 5. 一天的 IMPACT

```
17:00 UTC  google-data-pullback-daily 拉 Meta 日数据（现有）
           └─ sendEvent ads/impact.cycle.due × 每个 autonomy_mode≠null 的客户
           卫青  Inspect+Measure → ads_growth_states                         [I][M]
           孔明  Prescribe：候选 → memory 过滤 → Jev 一致性 → submitActionRun  [P]
           Kernel authorize：goal 在 / 策略 auto_approve / 信封内 → 放行
                              信封外 → deny(outside_autonomy_envelope) + escalate_to_pm
           韩信  Act：capabilities 处理器 → Meta → 改后快照 → action_runs 回执   [A]
+10m/+60m  韩信  readback_checked（被 Meta 延迟停投 → 只三件套，不自动重开 K3）
           日检报告 ads/pm_digest.ready → 邮件 + 今日待办 + 看板
T+7/14d    韩信  verification.completed → flywheel_outcomes                    [C]
           孔明  memory.recorded → 下一轮 Prescribe 读到                        [T]
```

---

## 6. 安全底线（写死在代码，不靠人）

1. 日预算上限：任何动作执行后账户当日预算总和 ≤ `daily_budget_cap_cents`（授权时按快照重算）
2. 只能暂停不能删除；不改落地页 URL；不改品牌素材；素材只从池子选
3. 单次预算变动 ≤20%（`guardrails.ts`）；同单位 72h 内只动一次（按快照真实变动计，K12）
4. Meta 实验（ad_studies）中的实体、学习期单位、共用账户：不出动作（M7 / K6 / M9）
5. 无 active goal → 不出动作，只巡察 + 三件套（K5）
6. 每个动作有 `action_runs` 回执 + 改前/改后快照 id + 撤回处理函数（K1 / M1）
7. 熔断五条（G11）任一触发 → `autonomy_mode='observe'` + 三件套；恢复需 PM 在看板点开关
8. 广告写入禁回落共享令牌（K13）；新执行器只在 `src/lib/capabilities/ads/`（K7）

---

## 7. 分阶段交付

| WP | 交付 | 风险级 | 复审 | 依赖 |
|---|---|---|---|---|
| **WP0 目标契约 + 日检报告** | G1 migration + Settings UI · G2 goal-pace · G10 合并日报（先只加"目标进度"段） | B | 子牙一次 | 无 |
| **WP1 卫青** | G3 机会发现 · `ads_growth_states` · G12 看板（只读版） · `evaluate`/`runPortfolioDiagnostics` 迁入 patrol | B | 子牙 + 板桥（PM 视角看板） | WP0 |
| **WP2 Kernel 受限自治** | G5 信封 + 6 ActionKey + `capabilities/ads/*` · G11 熔断 · K14 注册表对齐 | **A** | 子牙 + 魏征 + 狄仁杰（实施前后各一次）· 冻结 head 跑一次完整 mutation | WP0 |
| **WP3 闭环编排** | G6 Inngest 链 · 孔明 · 韩信 · G7 Check · G8 Tune（客户层）· G9 Jev · G10 完整五段 | **A** | 子牙 + 魏征 | WP1 + WP2 |
| **WP4 多客户** | CTS `bounded_auto` 首开；NAL / NM Medspa 默认 `observe` 跑 14 天对照后由 PM 开；G8 行业层晋升 | B | 子牙 | WP3 |

顺序不可换；WP2 与 WP1 可并行（不同目录）。WP0 是 PM 最快能感受到的一步（日报第一行变成"目标进度"）。

---

## 8. 五道 Build Gate

1. Repository Fact Gate：`origin/main 5da5971a` · 2026-09-24 02:10 NZST ✓
2. Domain Semantics Gate：shared runtime 无客户名/ID；结果口径来自 `ad_strategy_configs` + 剧本；目标数字来自 `goals` ✓
3. Product Gate：解决的是"IMPACT 后四段断头、PM 看不懂、审批成瓶颈"，不是把现有代码包一层 ✓
4. Architecture / Reuse Gate：见 §2；唯一新表一张；唯一 A 级架构改动是 Kernel 信封（§3 G5），理由：Kernel 现行"对外动作永远人审"是为 9/14 的授权边界写的，PM 9/24 改了边界，Kernel 必须表达新边界而不是被绕过 ✓
5. GO BUILD：待设计复审通过 + PM 回 `开工`

---

## 9. Reuse Statement

- 复用：§2 全表（数据脊柱、快照、D1–D9、基线、处方、止损、闸门、Meta 写入、剧本、Kernel、Memory、飞轮回执、Jev、Inngest、pm-todo、日报、goals）
- 新增 platform-shared：goal-pace、O1–O4、Kernel 受限自治信封、6 个广告 ActionKey + capabilities 处理器、Inngest 广告闭环链、`ads_growth_states`
- industry-specific：验证窗口天数、结果名词、O4 剧本缺口判据的打法清单——全部在 `playbooks/`
- client-specific：goal 数值、日预算上限、素材池、`autonomy_mode`、memory 条目——全部在 `goals` / `ad_strategy_configs` / `client_*` 记忆表
- shared runtime 里没有客户名/ID/行业判断
- 学习：v1 只写客户层；行业层晋升条件写在 G8，WP4 才开

**落点对账**（交付时必答）：本次实现落点与 tier-gate 决策一致——广告 L1 扩展，不新建能力线。

---

## 10. PM 待拍板（只列业务 / 钱）

1. CTS 首个目标的数字与期限（写进 `goals`）
2. CTS 两个账户各自的日预算上限
3. CTS 素材池初始清单（哪些片子可以投）
4. NAL / NM Medspa 何时从 `observe` 切 `bounded_auto`（默认：CTS 跑满 14 天无熔断后再谈）

---

## 11. 验证清单（证明"做对了"）

- WP0：goals 里写一条 CTS 目标 → 日报第一行出现真实进度数字，且归不上的结果显示"待确认"不是 0
- WP1：用 CTS 9/17–9/23 真实数据回放，O1 能抓出 Reborn 新素材（CTR 4.1%→ 应命中或明确 not_comparable）；D9 结果与 `d9-placement-leak.test.ts` 一致
- WP2：变异测试——删撤回处理函数 / 删信封重算 / 策略 auto 但 input 超 20% / 无 goal——四个变异全部让授权变红
- WP3：一条真实处方走完 proposed → executed → readback → verification → memory，`action_runs` / `flywheel_outcomes` / `client_proven_patterns` 各一行且 id 互相关联；Inngest 后台可见全链 receipt
- 熔断：人工把 `daily_budget_cap_cents` 调到低于当前预算 → 下一轮任何动作都被拒且三件套出现在今日待办
