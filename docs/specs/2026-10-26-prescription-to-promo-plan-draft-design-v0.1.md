# 处方 → 推广计划草稿 自动生成 设计稿 v0.1

- 作者：119 号窗口　日期：2026-10-26　功能风险级：**A**（碰计划/预算数字的写入口）；本 PR 只含设计稿（纯文档）。
- 状态：**设计稿，待子牙+魏征审，审过前不写代码。** 子项标【待核】的是我还没在代码里证实的假设。
- 来源：74 号转述 PM「把没有的继续开发」；事实依据是对主干代码的只读调查 + CTS 生产数据的只读对照（见 §8）。
- 平台层级（tier-gate Inline）：归位既有 L1「广告支柱 · IMPACT 的 Prescribe→Act 衔接」，不新增能力线；映射表只读「处方里的结构化种子」，不含客户名/行业词；换成地产或其它行业客户，这段共享代码不用改。无需登记候选。

## 0. 先说结论（一句话）
**现在的处方里没有结构化的账户/日预算/受众字段，所以不能"读处方生成步骤"——必须先让处方带一个结构化种子（`plan_seed`），生成器只读种子，不解析摘要文字。** 触发用计划页上一个显式按钮「按处方起草」；只生成草稿，批准仍由 PM 在计划页点。

## 1. 现状事实（主干，已读代码）
1. 处方 `prescriptions.content`：`summary`(文字) / `phases[].actions[]` / `kpi_targets[]` / `budget_allocation[]`（src/types/diagnostic.ts:438）。**没有**每个动作的广告账户、日预算、受众、素材、日期字段。日预算、总预算、起止日只存在于 `summary` 文字、KPI 的 `metric` 文字和 `intake`。`goal-prescription.ts` 读的 `content.spend / rules / review_anchor` 是读侧的宽松容错、没有 schema。
2. 推广计划 `marketing_plans.plan_data.promo`（promo_v1，spec.ts）：阶段(phase)有起止日期；`ads_campaign` 步骤只有 `ad_account_id / daily_budget_cents(>0) / audience_ref / creative_refs / placements / paused_ranges`，**没有步骤备注、没有 KPI 字段、没有日期**。指纹 `promoContentHash` 覆盖几乎全部字段（除 checks、gate_snapshot 与 seats 三项）；可选字段必须「不写」而不是写 undefined，否则指纹会漂移。
3. 计划与处方没有直接外键：计划靠 `plan_data.promo.goal_id`（或 `generation_meta.blank_draft.goal_id`）挂到目标，处方也挂到目标；谁是「这个目标的最新处方」由 `goal-prescription.ts`（按 version desc）决定；`pickPlanForPrescription` 决定打开哪份计划。
4. 批准处方只改状态并落成 Initiatives，**不再生成待办**（3156）；人工处方只存草稿、周更不覆盖（3144）；计划页只读显示目标上最新处方（3143/3150）。
5. 保存计划走 `PUT …/promo`（`parsePromoSpec` 失败即拒、账户必须属于该客户、预算超限直接 400）；批准走 `…/approve`（算指纹、过 gate、写回执）。

## 2. 字段映射表（处方 → 计划步骤）
设计原则：**只映射结构化种子；映射不了的不丢、不硬塞，落到「未映射清单」并在计划页显示。**

### 2.1 新增：处方里的结构化种子 `content.plan_seed`（可选，zod 校验）
```
plan_seed: {
  currency: 'NZD',                       // 币种；与账户币种不符 → 整条拒绝
  start_date, end_date: 'YYYY-MM-DD',    // 广告投放的起止（=计划阶段日期）
  ad_steps: [{
    step_key: 'ads-lead-a',              // 稳定键 → 成为步骤 id（幂等的锚）
    phase_label: '留资表单 · 2027 中国团',  // → 阶段名
    ad_account_id: 'act_…',              // 必须属于该客户（生成时校验，不是 UI 填的）
    daily_budget_cents: 5000,
    audience_ref | targeting,            // 二选一：文字受众 / 2822 的结构化定向（2822 合并前只写 audience_ref）
    creative_refs?: string[],
    placements?: string[],
    paused_ranges?: {from,to}[]
  }]
}
```
谁写：人工处方路由（`/prescriptions/manual`，3144 那条）与周更自动处方，写入时**同一个校验函数**；缺任一必填项 → 种子整体无效，不进步骤（不猜）。

### 2.2 映射表
| 处方里的东西 | 落到计划的哪里 | 说明 |
|---|---|---|
| `goal_id` | `promo.goal_id` | 已有（3150 的挂目标逻辑复用） |
| `plan_seed.start_date/end_date` | 阶段 `start_date/end_date` | 必须 YYYY-MM-DD；阶段不得重叠（spec 已有规则） |
| `ad_steps[].phase_label` | 阶段 `name` | 同 label 的步骤归同一阶段 |
| `ad_steps[].step_key` | 步骤 `id` | 幂等锚；同键更新、不新增 |
| `ad_account_id / daily_budget_cents / audience_ref(或 targeting) / creative_refs / placements / paused_ranges` | 步骤 `settings` 同名字段 | 一一对应；可选字段缺省时**不写**（防指纹漂移） |
| `kpi_targets[]`（留资 300、线索成本 $12/$16、日上限 $150、总预算 $3,700…） | **不进 `plan_data.promo`**；进 `generation_meta.from_prescription.kpis`（展示）；日上限类对照 `ad_strategy_configs`（只读核对，不写） | promo_v1 没有 KPI 字段；硬塞会改指纹 |
| `summary` 里的规则（学习期 72h、继续线/暂停线、加钱条件、两组人群、$12 继续线…） | `generation_meta.from_prescription.unmapped[]`，原文按条列出 + 「这是广告 Agent 的运行规则，计划不承载」 | 不丢、不解析；这些规则的家是广告 Agent 配置（`ad_strategy_configs`，A 级，不在本功能里写） |
| `phases[].actions[]` 里 `external_manual`（建好暂停、送审、换配乐、上传排除名单、开投、回线索、复盘、补素材） | 不生成步骤；列入 `unmapped[]` 的「人工动作」栏 | 全是人做的事，不是广告步骤；`补素材` 阶段没有广告步骤 |
| `intake.monthly_budget_aud` / `budget_allocation[]` | 不用（空数组或口径不同） | 币种是 AUD 字段，与种子币种冲突风险；不作为日预算来源 |

### 2.3 三个例子（CTS 现有处方里的难点怎么落）
- 「两组人群（组 A 新客、组 B 老客户）」→ 种子里写成两个 `ad_steps`（`ads-lead-a`、`ads-lead-b`）；B 组需要挂名单（刀②未做）→ B 的 `audience_ref` 写文字，并在 `unmapped[]` 标「需挂名单后才可建」。
- 「$12 继续线、$16 暂停线」→ 不进步骤；进 `kpis` 展示 + `unmapped[]`；真正执行的地方是广告 Agent 的阈值，不由计划承载。
- 「学习期 72 小时保护」→ `unmapped[]`；落点是广告 Agent 的动作冷却，不在计划。

## 3. 与周边的边界（各一句）
- **3010 v0.7 指纹**：生成器写的是步骤里的广告相关字段，这些字段本来就在（将来的）ads-only 指纹里；生成器**不写**批准回执、不写 `gate_snapshot`、不设 `approved_at`；草稿计划不是花钱授权。
- **2999 日预算闸**：起草时调用 `computeLaunchHeadroom`，只产出**提示**（写入 `warnings`，不拦），真正的闸仍在激活/批准入口。
- **2822 结构化定向**：未合并前种子只写 `audience_ref`；合并后种子可写 `targeting` 且二选一规则沿用 2822。
- **3143/3150 只读显示**：复用同一个「目标上最新处方」读取函数；**只认 status=approved**（3143 的显示可以含草稿，生成器不行）。
- **3156**：批准处方不再有副作用；本功能是显式的另一步，不挂在批准上。
- **3144**：人工草稿处方不会被生成器读取；周更自动处方（`prescription-weekly（自动落地）`，status=approved）可以是来源。

## 4. 触发方式：计划页「按处方起草」按钮（不做批准即起草）
理由：①显式、可重复，与 3156「批准不生成东西」口径一致；②批准处方的人和起草计划的人不一定是同一个动作，自动起草会在 PM 没打算建计划时多出一份草稿；③出错可重试，不影响处方状态；④按钮可展示「将生成什么 / 哪些没映射」的预览再确认。路由：`POST …/marketing-plan/[planId]/promo/from-prescription`（或没有计划时先走 3150 的空白计划创建再填）。授权同 `requirePlanApproverAccess`。

## 5. 幂等与改版
- 记录：`generation_meta.from_prescription = { prescription_id, version, seed_hash, generated_step_hashes{step_id: hash}, unmapped[], kpis, warnings, generated_at }`。
- 同一处方版本再点：只更新同一份草稿计划。**只覆盖「仍等于上次生成值」的步骤**（用 `generated_step_hashes` 判断）；PM 手改过的步骤保留，并在结果里列「这些步骤被人改过，没覆盖」。
- 处方改版（新版本 `supersedes_id` 指向旧版本）：若旧版本生成的计划还是草稿 → 就地更新并记 `previous_prescription_id`；若那份计划已批准 → **不动它**，新建一份草稿计划（并行存在，由 PM 决定哪份作数）。旧草稿里的人工改动按上条规则保留。
- 阶段/步骤 id 取 `step_key`，不用随机 id。

## 6. 不做（明确）
不自动批准计划；不自动建任何 Meta 对象；不碰钱（不改 `ad_strategy_configs`、不改预算上限）；不解析 `summary` 文字；不从处方的 `budget_allocation`/AUD 字段推日预算；不生成社媒/博客/邮件步骤（本版只做 `ads_campaign`）。

## 7. 当场验收（dry-run 对照，已人工做了一遍预演）
对象：CTS 处方 `89cb61eb`（status=draft，人工，agent=广告 Agent）对 74 手填的计划草稿 `7a8bee93`。**注意：该处方现在是 draft，生成器按设计不会读它（只认 approved）——正式验收前需先让 PM 批准处方，或用同一份内容的 approved 副本做试验。**
| 项 | 处方 89cb61eb | 手填草稿 7a8bee93 | 生成器预期 |
|---|---|---|---|
| 结构化种子 | **无** | — | 生成 0 个步骤，只出 `unmapped` + 提示「处方没有 plan_seed」 |
| 阶段 | 3 个（开投前/投放中/补素材，按活动分，周数 1/5/2） | 2 个（按投放步骤分：留资 10/26–11/30；Shanghai 11/2–11/30） | 取决于种子；活动阶段不直接变成计划阶段 |
| 起止日 | 摘要文字「2026-10-25 到 11-30」 | 10/26 起 | 以种子为准；两者差 1 天 → 提示 |
| 日预算 | 文字「每天 $100（含 A/B 两组）」，上限 $150 | 组 A $50（B 暂缓）+ Shanghai $30 | 以种子为准；若种子日预算合计 > 客户总闸 → 起草警告 |
| 账户 | 无 | 留资 → 7274；Shanghai → 0470 | 以种子为准，不属于客户 → 拒 |
| 受众/素材/版位 | 无（只有文字描述） | 文字受众 + 版位；Shanghai 带 1 个素材 id | 以种子为准 |
| Shanghai 阶段 | **处方里没有** | 有（手加） | 不会生成；`unmapped` 里不出现（处方没提） |
| 规则类内容（学习期 72h、$12/$16 线、两组人群…） | 在摘要里 | 不在计划里 | 全部进 `unmapped[]` |
结论：**当前处方内容不足以产出任何广告步骤**；验收要先补种子（人工处方路由与周更都要写 `plan_seed`），这是本功能的前置块 0。

## 8. 工作量估计（按块，含测试）
| 块 | 内容 | 估 |
|---|---|---|
| 0 | `plan_seed` 类型 + zod 校验 + 人工处方路由/周更写入（A 级，碰处方写入） | 0.5–1 天 |
| 1 | 映射纯函数（种子→PromoSpec 片段 + unmapped + warnings + 币种/账户校验）+ 单测（含幂等哈希、可选字段不写、指纹稳定） | 0.5–1 天 |
| 2 | 路由（读 approved 处方、建/更新草稿、幂等、人改保留、`computeLaunchHeadroom` 提示）+ 测试 | 1 天 |
| 3 | 计划页按钮 + 预览/未映射清单展示 | 0.5 天 |
| 4 | 当场验收（approved 副本对照 7a8bee93）+ 台账 | 0.5 天 |
合计约 3–4 天；块 0 是前置，建议第一个 PR 单独走。

## 9. 风险与待审问题
- 【待核】`ads_campaign` 的 zod 是否 `.strict()`（决定「步骤备注」能否放进步骤；本稿默认不放）。
- 【待核】blank-draft-create 之后再 PUT promo 的并发写（`expected_updated_at` 乐观锁够不够）。
- 【待核】周更自动处方（prescription-weekly）写 `plan_seed` 的口径：它没有账户/受众信息，**只能由人工处方写种子**；周更对已有种子的处方保持不动。
- 处方里写账户号 = 把账户事实放进「处方」这类文字产物；校验在生成时做（账户必须属于客户），失败即拒。
- 与 74 同日开发的 3066（CRM 结果上下文）与 2822 改 `promo/draft` 附近文件：本功能用新路由，不碰这些文件。

## 10. Reuse Statement
复用：promo_v1 spec/`parsePromoSpec`、`goal-prescription.ts` 最新处方读取、`pickPlanForPrescription`/`planLinkedGoalId`、3150 的空白计划创建、`checkAdsBudget`/`computeLaunchHeadroom`、`requirePlanApproverAccess`。新增（平台共享）：`plan_seed` 种子协议与映射纯函数。行业特定：无。客户特定：无（CTS 只用于验收对照）。无客户名/行业判断进共享代码。学习：无写入。
