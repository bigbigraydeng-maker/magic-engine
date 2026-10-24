# IMPACT 闭环复用差距（只读盘点 + 最小方案）

日期：2026-10-24  
风险：**C**（只加这一份说明，不改业务代码、不迁移、不部署）  
权威任务：本文件。完成标准：四个问题有证据；方案是 3–6 个互不重叠的小 PR，或明确写「保持现状」。  
不做：业务代码、实现 PR、合并、部署、生产读写、广告花费、改 #3078 / #3065 / #3066。

基线（2026-10-24 已 `git fetch origin main`）：仓库 `/workspace`，`main` = `origin/main` = `d81d3fcc5509b568a59841323194c4b5d3b10c11`，左右差距 `0 0`。未连任何一个生产库。

## Platform Tier Classification（Full）

**被判定对象**：把「需求 → 测量 → 处方 → 执行 → 检查 → 调整」收成任何客户都能走的同一套闭环契约；行业规则用配置接入；CTS 做第一个实例。

**建议层级**：L1 平台基础设施（已有的 IMPACT / Measurement / Verification 契约），不是新能力线。旅行社「定金 = 成交、座位 = 人数」是可选的 L2 解释器，默认关闭；CTS 的团期、人数、预算是 L4。

**归属**：平台基础设施（Measurement Contract / Growth Contract / Verification）。不新增支柱。

**换客户测试**：契约本身 ✓（CTS 换成 Oztop：仍是一条需求、一个指标、一条处方、一份回执）。若把「出发日一填就改计座位」写成共享默认 ✗（Oztop 没有出发日；填错 JSON 也会被改口径）。

**换行业测试**：契约本身 ✓（旅游换成地产：成交可以是签约，不是座位）。定金座位规则 ✗（地产、地板没有「已收定金座位」）。

**智能层 or 执行手**：智能层的经营契约。执行仍走现有 Kernel / Connector，不新造执行器。

**红线**：1 ✓ 不包装新支柱。2 注意：`me_sale_outcomes` 注释和报名取数已经把「定金 = 成交」写进共享路径，不能再扩散。3 ✓ 不直建新 L1。4–5 见上。6 不新开 L1，不另走五道门。7 ✓ L2 只放可选行业解释，不放 CTS 四个团期。

**PM 待拍板**：CTS 那条草稿目标要不要改成「进行中」（会开始写当前值，本方案不动库）。不登记 `platform-candidates`（没有新能力名）。

**结论**：原本容易做成「把 CTS 搬进平台库 impact 表」或「再造一套编排器」。判定是：**老路径当唯一生产闭环，平台库保持骨架，不搬家。**

按 §11：把闭环从老路径搬到平台库 —— 频率低 / IMPACT 低（搬家不让 CTS 多跑通一环）/ 收入低 → 两个以上低 → **P3，保持现状**。  
在老路径上补「销售目标不能用点击代替」—— 频率高 / IMPACT 高 / 收入高 → 零个低、三个高 → **P0（只出契约，不扩系统）**。

## 0. 结论

客户今天走的闭环在**老应用库**，不在平台库的 `impact` schema。两边是**并行**，不是替代，也没有正在进行的数据迁移。本仓库没有 `impact.*` 的迁移、接口或写入方。

最小做法：**不新建系统**。一份契约映射到已经在用的表；行业差异走现有的「按行业选剧本 / 适配器」；CTS 专属口径只挂在这一条目标的配置上。平台库的 `impact` 表留着，等 PM 另一次拍板才考虑搬家。

## 1. 核实过的事实（和没核实的）

| 说法 | 本窗口结论 | 证据 |
|---|---|---|
| 老库 `glbdnayojixmexgofbsd`（文档里的 CrazyContent）有 `public.goals`、`me_sale_outcomes`、CRM 表 | 代码和迁移在这个库的形状上。行数未查 | `docs/audits/2026-10-06-prod-ad-account-cap-column-and-values.md`；`supabase/migrations/20260619000003_phase31_strategy_layer_foundation.sql`；`20260905000002_conversion_writeback_v1.sql`；`20261012200000_crm_booking_tracker.sql` |
| 平台库 `magic-engine-platform-prod` / `thecxfwmqgmcopkiqrsm` 有 `impact` 下那些表和大约的行数 | **行数与「目标不在 impact.goals」未复验**（任务禁止连生产库）。项目 id 在本仓库检索不到。表名与 2026-10-12 账本里的 `app/impact`、`impact.outcomes` 同向 | 用户本次观察；`docs/roadmap/2026-10-12-platform-lead-s0-and-migration-ledger-v0.md` §3；`docs/audits/2026-10-06-prod-ad-account-cap-column-and-values.md` 只证明「另一个叫 platform-prod 的项目不是广告上限那张表的生产库」 |
| 新版代码仓 `magic-engine-dev/magic-engine-platform` | **本窗口读不到**（当前凭证 404）。10-12 那次读到的提交停在 2026-10-11，今天是否仍只有 ads/hello 接了六段，记**未知** | 同上账本 §3.1–3.2 |
| CTS 目标 `27fc80bd-b2d8-4cac-8ef4-9f6c574dd6ff` | 编号在老路径文档和未合并的 #3078 里，指向 `public.goals`。本仓库没有任何代码写 `impact.goals`。库里这一行此刻是否仍是草稿：**未知**（10-16 记录和 #3078 正文都写草稿；本窗口没查行） | `docs/clients/cts/2026-10-20-promo-plan-record-v2-payload.json`；`docs/clients/cts/2026-10-16-cts-march-ads-budget-record.md`；PR #3078 |
| 计划 `21971d80-be60-4f75-8d93-c2845d59b61b` | 文档里的推广计划，`plan_data.promo.goal_id` 指向上面那条目标。10-21 设计稿写「2026-10-20 20:23Z 库里读回 approved」。**今天是否仍是已批准：未知** | `docs/specs/2026-10-21-ads-spend-requires-approved-plan-gate-design-v0.1.md`；`docs/clients/cts/2026-10-17-promo-plan-21971d80-official-account-payload.md` |
| #3078 把定金座位接到 `src/lib/strategy/auto-fetch.ts` | **属实，未合并**。分支 `cursor/deposited-seat-goal-progress-e702`。主干上的报名数仍是「数 `me_sale_outcomes` 的 purchase 行」 | `gh pr view 3078`；主干 `src/lib/strategy/auto-fetch.ts` 的 `fetchBookings` |
| #3065 / #3066 | 都开着，别的窗口。本文件不改它们 | `feat/1986-company-confirmed-bookings`、`feat/1986-approved-creative-outcome-ranking` |
| GitHub Actions 10/18 起账单锁死 | #3078 的检查在数秒内失败；日志接口返回 `log not found`，**没有打开账单原文**。现象与「跑不起来」一致，原因沿用任务陈述，不另下结论 | PR #3078 `statusCheckRollup` |

NAL 暂停：企业层验证只准备用 CTS。下文不把 NAL 当实例。

## 2. 底座在哪，和老路径是什么关系

产品定义（最高优先级）把闭环写成 **Inspect → Measure → Prescribe → Act → Check → Tune**（`docs/strategy/ME_PRODUCT_DEFINITION.md` §4–§6、§13）。PM 这句话是同一条环，用词对应如下：

| PM | 产品定义 | 不是 |
|---|---|---|
| 需求 | Inspect 里的 Business Goal，且必须先落成一行 | 诊断散文、聊天记录 |
| 测量 | Measure | 广告点击本身 |
| 处方 | Prescribe | 多份互相抢预算的建议 |
| 执行 | Act | 合并代码、接口返回成功 |
| 检查 | Check | 把缺数写成 0 |
| 调整 | Tune | 只把结果存下来、下一次排序不变 |

**关系：并行，未迁移。**

- **生产闭环（客户真在用的）**：本仓库 + 老库 `public.*`。入口在 `docs/STATE.md` §2「共享执行与学习」：`src/lib/strategy/`、`marketing-plan/`、`execution/`、`kernel/`、`flywheel/`、`memory/`，加上各支柱自己的测量。STATE 写明：迁移文件数 ≠ 已应用到库；本窗口也没查运行日志，所以「今天定时任务是否成功」一律未知。
- **平台契约骨架**：另一个 Supabase 项目上的 `impact.*`，对应另一个 Python 仓库的 `app/impact`（10-12 账本）。10-12 已决定：老仓库**不要再造**一个通用编排器。这个决定继续有效。
- **不是替代**：CTS 的目标和计划编号只挂在老表。平台库那几行（用户看到 goals 约 2、loops 约 6、prescriptions 约 4、outcomes 约 2）是骨架量级，对不上老库的客户生产。
- **不是迁移中**：本仓库没有把 `public.goals` 同步到 `impact.goals` 的脚本。10-12 账本写明当时也没有搬数据脚本。

已有零件（老库），按产品定义 §5 的对象，不是新名字：

| 契约对象 | 老库落点 | 平台库同名表 |
|---|---|---|
| 需求 / Goal | `public.goals` | `impact.goals`（无本仓库写入方） |
| 增长状态 | 广告日行 `ads_growth_states`；不是全支柱一张表 | `impact.growth_states` |
| 机会 | 广告组合诊断的输出，写在 `ads_growth_states.payload` | `impact.opportunities` |
| 基线 | `goals.baseline_value`（人填）+ 各支柱快照 | `impact.baselines` |
| 指标 / 队列 | `src/types/strategy.ts` 的 `PRIMARY_METRIC_CATALOG`；飞轮 `flywheel_metrics` | `impact.metrics`、`impact.cohorts` |
| 验证定义 | 散落：飞轮 `window_days`、推广剧本里的成熟天数、GEO 那个 verification 指标 | `impact.verification_definitions` |
| 处方 | **三套并行**：`public.prescriptions`（诊断引擎）、`marketing_plans.plan_data`（推广计划）、`ads-strategy` 里的处方函数 | `impact.prescriptions` |
| 执行回执 | `execution_items`、`flywheel_actions`、Kernel `action_runs`（仅广告三条） | 用户清单里没有执行表；10-12 写的是内核 `action_runs`（今天未复读） |
| 结果 / 归因 | `flywheel_outcomes`、`me_sale_outcomes`、`crm_bookings` | `impact.outcomes`、`impact.attributions` |
| 行业剧本版本 | **代码文件**，不是表。见第 4 节 | `impact.playbook_versions`（本仓库无读写） |
| 调整 / 学习 | `src/lib/memory/`、`src/lib/flywheel/tune/`（后者不落库） | 10-12：`core.learnings` 只有模型 |

10-18 的最小骨架（`docs/specs/2026-10-18-me-closed-loop-skeleton-min-cost.md`）结论仍成立：**缺的是接线，不是新系统。** 那份文档引用的「内核只手动试跑过 2 次」来自当时的 STATE 表述。现行 `docs/STATE.md` 已改成生产未核验。代码上，Kernel 已接到广告三条动作（见下），有没有自动跑、跑过几次，本窗口记未知。

## 3. 六个环节

图例：**平台层** = 本仓库里可复用的表/接口（不是平台库）。**生产路径** = 老库上客户会走到的那条。平台库每一格的「是否在跑」都是未知。

### 3.1 需求

- **已有**：`public.goals`（`20260619000003`）。2026-06-20 的 `20260620000001_phase32_goal_subtypes_multi_active.sql` **删掉了「一个客户只能有一条进行中目标」**。所以一个客户多条需求，库已经允许。字段含意图、主指标、基线、目标、周期、预算、`fde_reasoning`。
- **写入方**：`src/lib/strategy/goals.ts` 和目标页。推广计划用 `promo.goal_id` 指向它（`src/lib/marketing-plan/promo/spec.ts`）。
- **生产路径**：老库 `goals`。CTS 三月目标是这条路径上的草稿记录（见第 1 节；活行状态未知）。
- **缺**：没有单独的「需求」表，也不该新建。缺的是闸：`fde_reasoning` 可空；草稿不会被每日刷新读到（`src/app/api/cron/goal-current-value-refresh/route.ts` 只查 `status = 'active'`）。AI 为什么立这条需求，没有强制的证据指针。
- **断在**：需求可以停在草稿，测量根本不开始。诊断引擎的 `prescriptions.intake` 是另一套入口，不等于 `goals` 这一行。

### 3.2 测量

- **已有**：`PRIMARY_METRIC_CATALOG`（`src/types/strategy.ts`）；`autoFetchMetricValue`（`src/lib/strategy/auto-fetch.ts`）；每日刷新挂在调度目录 `src/lib/cron/dispatch/catalog.ts`（`30 17 * * *`），不再是 `render.yaml` 里单独一条。广告日数据 `ad_daily_insights`、广告经营行 `ads_growth_states`。
- **生产路径**：老库。只刷新**进行中**的目标。报名数 `signups_count` 数的是 `me_sale_outcomes` 里 `outcome_kind = 'purchase'` 的**行数**（一笔一行）。没有 purchase 行时返回未知，不返回 0（`fetchBookings`）。历史教训写在同一函数注释里：曾经把报名接到广告留资上，已改回。
- **三层结果**：目录里线索（`leads_count` / `messaging_started` / `form_submissions`）和成交（`signups_count` 等）是不同的键。**没有「联系成功但还不合格」这一键。** `me_sale_outcomes.lead` 的建表注释把 lead 定义成「对话过或邮件过即合格」，联系成功和合格线索叠在一起。成交在这张表上是笔数，不是人数。
- **销售不能用点击代替**：目录没有把点击推荐给 `sales` 意图。广告日报挑目标时，只把 `leads_count` 和 `messaging_started` 当成广告能量化的指标；`signups_count` 被明确排除（`src/lib/ads-strategy/portfolio/goal-context.ts`）。若一个进行中的目标都不是这两键，日报会退回**最新一条**目标——可能是报名目标，但取数仍走 purchase，不会退回点击。点击键 `seo_gsc_clicks_28d` 推荐给的是 awareness/acquisition。
- **缺**：一条需求上没有强制的基线状态（数字或明确的未知）、对照 cohort、验证窗口。`goals.baseline_value` 是必填数字，填 0 和「还不知道」分不开。#3078 还写了：起点不是 0 时座位进度会一直不出数。
- **断在**：草稿目标不进每日刷新。座位进度不在主干上。平台库的 baselines/metrics/cohorts/verification_definitions 没有被这条生产路径读写。今日刷新是否成功：未知。

### 3.3 处方

- **已有三套，不要合成第四套**：
  1. 诊断处方 `public.prescriptions` → `execution_items`（`20260513000001_diagnostic_engine.sql`）。
  2. 推广计划 `marketing_plans`，批准守卫在 `src/lib/marketing-plan/plan-guard.ts`（未批准不能派活；已批准不能直接改内容）。
  3. 广告处方函数，结果进 `ads_growth_states`，不是 `prescriptions` 行。
- **生产路径**：CTS 三月方案挂在第 2 套，`goal_id` = `27fc80bd-…`。
- **缺**：没有「这一份处方只能执行一次」的跨套约束。没有「两份处方不能占同一段预算、不能把同一笔成交各计一次」的共享占用。Initiative 的 `budget_percent` 只在应用层加总（建表注释写明数据库不约束）。一个客户多条进行中目标 × 多份已批准计划，库允许。
- **断在**：诊断处方、推广计划和广告日处方互不知道对方。Kernel 不读 `prescriptions`。

### 3.4 执行

- **已有**：`execution_items`；推广计划派活（须已批准）；视频工厂发布；Kernel 只在广告这几处被创建：`src/app/api/clients/[id]/ad-health/stop-loss/route.ts`、`o1-scale`、`auto-pause` 决定、`meta-ads/execute`，以及 `src/lib/inngest/functions/ads-d3-auto-pause.ts`、`ads-o1-budget-scale.ts`、`ads-campaign-budget.ts`。
- **生产路径**：广告动作走 Kernel；社媒/出片/邮件/SEO 不走这一个执行契约。10-18 骨架把「谁批准、回执、核实」按业务线拆开，那些断点这次没有重查生产日志。
- **缺**：处方 id → 一次执行 → 一份外部回执，不是全支柱都有。批准计划 ≠ Kernel 授权 ≠ 广告账户里真的改了。
- **断在**：非广告动作可以在 Kernel 之外发生。平台库没有被这些路由写入。Kernel 自动跑了几次：未知。

### 3.5 检查

- **已有**：`flywheel_outcomes`（动作有没有带动指标）；`me_sale_outcomes`（purchase / balance / lead 分开建表，尾款注释写明不计入 Meta 成交）；`crm_bookings.party_size` 与付款节点（`20261012200000`，设计写明只记进度、不记金额）。销售进度页用适配器读出发日（`src/lib/crm/sales-progress/units.ts` 的 `SalesUnitSource`），**不回写目标当前值**。
- **生产路径**：目标当前值的成交 = purchase **笔数**。人数活在 CRM 预订里。两套事实没有合成一个检查记录。
- **CTS 口径（只能当这一户的配置，不能当全行业默认）**：手工「已收定金」= 成交、一单一笔、座位 = 人数、尾款另记、问 A 买 B 算 B、来源保留。前半已写进 `me_sale_outcomes` 的**共享注释**（purchase = 收到定金）和 CRM 阶段同步注释（`4-已订金`）。座位、问 A 买 B、来源未知仍不算进目标当前值，除非 #3078 合并。
- **缺**：检查结果没有强制分成执行 / 生效 / 营销产出 / 营销结果 / 生意结果（产品定义 §12）。同一笔成交可以被目标计数和飞轮归因各算一次——没有互斥。
- **断在**：报名目标的「当前值」还不是座位数。缺行是未知，这一点取数已经做到；别的指标是否仍会写出 0，本窗口没有逐个重跑。

### 3.6 调整

- **已有**：记忆服务 `src/lib/memory/`（10-18 核查：抽取在跑，但去重导致长期不新增；周汇总因类型错误写不进去）。`src/lib/flywheel/tune/` 按请求现算，**不落库、不改下一轮计划**（10-18 核查；本窗口只确认目录仍是纯函数文件，没有再查生产行）。
- **生产路径**：下一次处方不读上一轮 `flywheel_outcomes` 作为必填输入。
- **缺**：产品定义要求 Tune 改变下一次排序才算学习。这一环没有生产闭环。
- **断在**：这里。**保持现状，不在本方案里做学习系统、自动优化或新看板。**

## 4. 行业层 / 企业层现在放哪

| 层 | 现在 | 不在 |
|---|---|---|
| 平台 | 目标表、指标目录、取数开关、Kernel、飞轮表、`me_sale_outcomes` 的三种 `outcome_kind` | `impact.playbook_versions`（本仓库无读写） |
| 行业 | 广告剧本 `src/lib/ads-strategy/playbooks/`：`travel.ts` 只有三个名词（咨询 / 每个咨询 / 服务市场），**没有**定金和座位。`real-estate` / `ecommerce` / `logistics` / `default` 同样只是名词。推广剧本 `src/lib/marketing-plan/promo/playbooks.ts` **只有 default**，证据标记 `unvalidated_default`。销售进度的 `SalesUnitSource` 把「出发日」收成适配器，页壳不认识团。`src/lib/strategy/industry-mapping.ts` 把行业自由文本映射到 AI 可见度行业码 | 不是数据库版本表；支柱手册在仓库外的 Claude 记忆里，**本窗口没读到那些文件**，运行时代码也不读它们（10-18 核查 §4） |
| 企业 | 目标行上的基线、预算、周期、辅助指标；客户配置；团期目录里的行。四个出发日不应进共享代码 | 客户名不应进 `src/lib` 的判断 |

**#3078 要不要挪？** 计票规则应该挪到行业适配器，**四个日期留在这条目标上。**

- 不该留在共享默认里的：`src/lib/strategy/auto-fetch.ts` 只要看见辅助指标里的出发日，就把**任何客户**的报名数改成座位数（#3078 正文自己写了「任何目标只要写下出发日」）。这过不了换行业测试。
- 该去的地方：跟 `SalesUnitSource` 一样，旅行社解释器放 `src/lib/crm/sales-progress/`（或同级的 outcome profile），由**这一条目标的配置打开**，而不是 `clients.industry = travel` 就全行业生效。下一家旅行社不自动继承「手工已收定金 = 成交」。
- 不该搬去的：`27fc80bd`、计划 `21971d80`、四个月期、预算。那是 L4。
- **不要改 #3078 那个分支。** 等它合并后另开一个只做「谁可以调用这段计数」的 PR。合并前主干仍是按笔数。

`me_sale_outcomes` 建表注释里的「purchase = 收到定金」已经是 CTS 口径进了共享表。最小方案**不改这张表的含义**（改注释也容易让已有行变义）。新检查要写明：这列在 CTS 上按那户的配置解释；别的客户的 purchase 是什么，未知就标未知，不套用定金。

## 5. 最小方案（可复用，不过度开发）

保持不变的：

- 不在老库创建 `impact` schema，不把 CTS 行复制到平台库。
- 不新编排器、不新看板、不新渠道、不做自动调预算。
- 不把 Kernel 扩到社媒/SEO。
- 调整（Tune）继续断着，直到上面五环有同一条需求 id 串起来。先串起来再谈学习。
- #3065 / #3066 不动。

一条闭环在老库上的身份（不新建表）：

`goals.id`（需求）→ 指标键（测量）→ 一份 `marketing_plans.id` **或** 一份 `prescriptions.id`（处方，两套不要同时对同一目标生效）→ 已有回执（执行）→ 一个检查来源（笔数或座位，二选一）→ 调整先写「未知」。

CTS 第一个实例就是 `27fc80bd` + `21971d80`。跑通的定义：这条目标从草稿变成进行中之后，当前值来自**配置打开的**座位解释器，缺数是未知；这份计划的预算不被第二份已批准计划再占一次；点击和线索不能填进这个销售目标。激活目标、改起点、写四个出发日，都是生产写入，**不在下面任何一个 PR 里做**。

### 建议的 PR（按最先能跑通排序）

六个里后五个可以并行开分支：文件不重叠。第 4 个依赖 #3078 合并后才能改那一行调用，所以它的分支先只加新文件。

| # | 目标 | 改哪些文件 | 依赖 | 生产迁移 / PM |
|---|---|---|---|---|
| 0（本 PR） | 把契约和断点写死，防止再造一套 | 只此文件 | 无 | 否。C 级文档 |
| 1 | **结果三层**。纯函数：联系成功、合格线索、成交互斥；`sales` 意图拒绝点击和线索键；`signups_count` 标明「笔数，不是座位，不是线索」 | 新文件 `src/lib/strategy/outcome-levels.ts` + 其测试。不改 `auto-fetch.ts`、不改 `types/strategy.ts` | 无。目录仍是现有键，函数只读目录 | 否。不用 PM 拍技术。要 PM 的只有：CTS 目标以后以成交（座位或笔数）验收，不以点击验收——这是已定原则，PR 里复述即可 |
| 2 | **需求不入库就不能变成进行中**。缺主指标、周期、基线或显式「基线未知」、一句人能看懂的理由，拒绝从草稿改成进行中。不新建表 | `src/lib/strategy/goals.ts` 与现有 goals 测试（若没有就加 `src/lib/strategy/__tests__/goal-activation.test.ts`） | 不依赖 1 的文件。理由字段用现成 `fde_reasoning` | 否。**要 PM 拍板的是以后何时把 `27fc80bd` 改成进行中**（那一次会写当前值）。本 PR 不改那一行 |
| 3 | **一份目标同时只允许一套处方占用预算**。纯函数：同一 `goal_id`、日期重叠的第二份已批准推广计划不能再占预算；诊断处方和推广计划不能对同一目标各执行一遍。先不改路由，只加判断和测试 | 新文件 `src/lib/marketing-plan/promo/exclusive-claim.ts` + 测试 | 无。接到保存/批准路由是**下一张**、且会碰到 `plan-guard.ts`，不与本张并行 | 否。若要拦已经批准的第二份计划，那是行为变化，合并前用一句话告诉 PM「以后同一目标不能有两份重叠的已批准计划」 |
| 4 | **行业解释器，默认关闭**。旅行社座位计数留在 CRM 适配器；只有目标配置写了「用已收定金座位」才调用。`industry=travel` 不自动打开。四个日期仍只出现在目标配置 | 新文件 `src/lib/strategy/outcome-profiles/travel-deposited-seats.ts`（包装，不复制 #3078 的规则正文）。**调用点**在 #3078 合并后改 `auto-fetch.ts` 一行，单独跟进，不进 #3078 | 包装文件可先写；接线等 #3078 合并。不改 #3078 分支上的文件 | 否。不要在这个 PR 里写生产目标的辅助指标。**PM 另决**：何时把四个出发日写进那条目标（#3078 已列过，仍未做） |
| 5 | **检查来源说明，只读**。给定目标，返回「将读哪张表、数的是笔数还是座位、缺了哪项就是未知」。不写当前值 | 新文件 `src/lib/strategy/check-source.ts` + 测试 | 读 1 的层级名可以等 1 合并；为了并行，本文件自带三个常量字符串，合并时再改一次 import（若冲突，以本文件让路） | 否 |

明确不做的第 6 张：**调整 / 学习 / 平台库搬家 / 新看板**。保持现状。

§11 只排这两件容易抢资源的事：第 1 张（口径）频率高 / IMPACT 高 / 收入高 → **P0**；平台库搬家频率低 / IMPACT 低 / 收入低 → **P3**。第 2–5 张都是把已有行说清楚，频率高、IMPACT 高、收入中（不直接扣广告费）→ 零个低、两个高 → **P0 里的契约，仍禁止扩范围**。它们并行是因为文件不重叠，不是因为要同时做大。

CTS 实例「跑通」还差的生产动作（都不是这些 PR）：确认起点是不是 0（未知）；把出发日写进该目标；把目标从草稿改成进行中；确认计划 `21971d80` 今天是否仍批准。四件都要 PM 点头，且会写老库。

## 6. Reuse Statement

- 复用：`goals`、指标目录、`auto-fetch`、推广计划批准守卫、广告剧本文件、`SalesUnitSource`、Kernel 的广告三条、`me_sale_outcomes` 与 `crm_bookings`。平台库 `impact.*` 只作为对照，不接。
- 平台共用：六段契约和「未知不是 0、三层结果分开、一份处方不重复计效果」。
- 行业：可选的旅行社座位解释器。广告剧本继续只放名词。
- 客户：CTS 目标 id、计划 id、团期、预算、定金口径的开关。
- 共享运行时里已有的客户/行业痕迹：`me_sale_outcomes` 注释和 `fetchBookings` 注释把定金写成了 purchase 的含义。本方案不把更多 CTS 规则写进去；已写进去的不在这次改（避免改义）。
- 学习：没有把 CTS 数字升到行业或全局记忆。
- 与层级门一致：落点是已有 L1 契约 + L2 可选解释器 + L4 配置，不是新 L1。

## 7. 验证

未运行应用测试、类型检查、构建：纯文档。未连生产库，未触发定时任务，未产生花费。

当场试跑：不适用。本文件不增加定时任务、工作流或对外动作。
