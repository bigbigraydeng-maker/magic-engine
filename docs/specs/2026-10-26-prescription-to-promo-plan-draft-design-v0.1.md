# 处方 → 推广计划草稿 自动生成 设计稿 **v0.2**（文件名沿用 v0.1 以免台账引用失效）

- 作者：119 号窗口　日期：2026-10-26　功能风险级：**A**；本 PR 只含设计稿（纯文档）。
- 状态：**P3 待认领，PM 2026-10-26 决定暂停（"停"）；未批准，不得据此写代码。** 以下 v0.2 是暂停前的最后版本，两位审查员的意见已吸收在 §11，将来接手从这里续。
- v0.2 相对 v0.1 的改动：吸收魏征 6 必改 + 5 建议、子牙 4 必改 + 8 建议（见 §11 对照）。主要变化：周更来源删除（以代码核清）；种子按阶段给起止并整份过 `parsePromoSpec`；生成器分 preview / write 两档；复用 PUT /promo 同一套校验链；改版/幂等/人改保留规则补全；§7 验收链重写；工作量上调。
- 平台层级（tier-gate Inline）：归位既有 L1「广告支柱 · IMPACT 的 Prescribe→Act 衔接」，不新增能力线；种子协议与映射不含客户名/行业词。

## 0. 先说结论
**现在的处方里没有结构化的账户/日预算/受众，所以不能“读处方生成步骤”——必须先让处方带结构化种子 `plan_seed`，生成器只读种子，不解析摘要文字。** 种子**只有一个写入口：人工处方路由**（`/prescriptions/manual`）。触发用计划页（已打开的草稿计划上）一个显式按钮「按处方起草」；只生成草稿，批准仍由 PM 在计划页点。生成器分两档：**preview**（任意状态的处方都能读、纯计算、不写库）和 **write**（只认 approved，写进草稿计划）。

## 1. 现状事实（主干，已核）
1. 处方 `prescriptions.content` 没有每动作的账户/日预算/受众/素材/日期（src/types/diagnostic.ts:438）；数字只在 `summary` 文字、KPI 文字和 `intake`。`goal-prescription.ts` 读的 `content.spend/rules/review_anchor` 是读侧容错，无 schema。
2. promo_v1（spec.ts）：阶段有起止；**阶段不得重叠**（`crossFieldIssues`，spec.ts:~244）；`ads_campaign` 步骤只有 `ad_account_id / daily_budget_cents(>0) / audience_ref / creative_refs / placements / paused_ranges{from,to}`，无备注/KPI/日期字段。`promoContentHash` 覆盖几乎全部字段（除 checks、gate_snapshot、seats 三项）；可选字段必须“不写”而不是写 undefined。
3. 计划↔处方无外键：计划靠 `plan_data.promo.goal_id` 或 `generation_meta.blank_draft.goal_id` 挂目标；处方也挂目标。`loadLatestGoalPrescription`（goal-prescription.ts:249-268）按 version 取最新、**不滤状态**。
4. **自动开方已停**：`auto-prescribe.ts` 头注释（2026-10-25 起周二不再生成/批准）；全仓**没有任何调用方**（grep `runAutoPrescribe` 只剩一条测试断言“周更文件里不许出现它”，prescription-weekly-check.test.ts:138）；周更任务只读已批准方案写复查（prescription-weekly-check.ts:343-352）。→ **魏征 M2 的“周二顶掉”风险现在不存在，只在“将来有人把自动开方接回去”时才成立**，见 §5.4。
5. 批准处方：`landPrescription` 会往 initiatives 插阶段并 supersede 旧方案（prescription-landing.ts:170-234）；人工路由没有“approved 副本”入口；人工路由写 `supersedes_id=null`（manual/route.ts:76）。3156 之后批准不再生成待办；3144 人工草稿不被周更覆盖；`parseContent`（manual-prescription.ts:209-213）会丢未知键。
6. 保存计划 `PUT …/promo`（route.ts:76-111）校验链：结构 → 目标属于客户 → 账户归属 → `checkAdsBudget` over 拒（unknown 放行）→ 草稿 + `expected_updated_at` 乐观锁。批准 `…/approve` 另算指纹、gate、写回执。
7. 空白草稿创建无按目标去重（blank-draft-create.ts:14-31，3142 引入）；`pickPlanForPrescription` 选“最新创建”的计划（plan-pick.ts:26-43），测试锁着现行为（plan-pick.test.ts:50-62）。

## 2. 种子 `content.plan_seed` 与映射
### 2.1 种子（可选，zod 校验；缺一项必填 → 种子整体无效 → **写入时 422**，不静默丢）
```
plan_seed: {
  currency: 'NZD',
  phases: [{                              // 顺序时间窗，彼此不得重叠（和 promo_v1 同规则）
    phase_key: 'p1',                      // → 阶段 id
    name: '留资表单 · 2027 中国团',
    start_date, end_date: 'YYYY-MM-DD',
    ad_steps: [{                          // 同一阶段内“同期并投”= 多个步骤
      step_key: 'ads-lead-a',             // → 步骤 id（幂等锚）
      ad_account_id, daily_budget_cents,  // 账户必须属于该客户（写种子时就核）
      audience_ref,                       // 2822 合并后可改给 targeting（二选一）
      creative_refs?, placements?,
      paused_ranges?: [{ from, to }]      // 与 promo_v1 一致：from/to
    }]
  }]
}
```
“某步骤晚几天才开始”用 `paused_ranges` 表示（例：11/02 起投 = 暂停 10/26–11/01），不用另开阶段。
### 2.2 谁写、怎么校验
- **唯一写入口 = 人工处方路由**。华佗生成路由（`/prescription/generate`）**不写种子**（明说）；自动开方已停（§1.4），不写。
- 写入时同一个纯函数 `validatePlanSeed(seed, ownedAccounts)`：结构、日期合法且阶段不重叠、币种与账户币种一致、账户属于客户（`loadOwnedAccounts`）。失败 → 422 + 人话。
- 审阅页（prescription/new/page.tsx:933/:1004 一带）必须**渲染种子**：账户名 + 币种 + 日预算 + 起止（不是裸 id）。批准接口放行付费客户账号（manual/route.ts:109）→ 渲染是批准前能看见这些数字的唯一方式，属块 0。
- `parseContent` 改为保留 `plan_seed`；种子无效 → 422，不吞。
### 2.3 映射表
| 处方里的东西 | 落到计划 | 说明 |
|---|---|---|
| `goal_id` | `promo.goal_id` | 已有 |
| `seed.phases[].start/end/name/phase_key` | 阶段 `start_date/end_date/name/id` | |
| `ad_steps[].*` | 步骤 `settings` 同名字段 + `id=step_key` | 可选字段缺省时**不写** |
| `kpi_targets[]` | `generation_meta.from_prescription.kpis`（展示），不进 promo | promo_v1 无 KPI 字段 |
| `summary` 里的规则（学习期 72h、继续/暂停线、加钱条件、两组人群…） | `from_prescription.unmapped[]` 原文列出 | 不解析、不丢；规则的家是广告 Agent 配置（A 级，不在本功能写） |
| `external_manual` 动作 | `unmapped[]` 的“人工动作”栏 | 非广告步骤 |
| `intake.monthly_budget_aud` / 空的 `budget_allocation` | 不用 | 币种口径冲突 |
**映射后整份 `PromoSpec` 先过 `parsePromoSpec`（含阶段不重叠、id 唯一、paused_ranges 合法）再写；过不了 → 不写、返回具体原因。**

## 3. 边界（各一句）
- **3010 v0.7**：生成器写的都是（将来 ads-only 指纹里的）广告字段；不写批准回执/`gate_snapshot`/`approved_at`；`generation_meta` **不入指纹**（补）。草稿≠花钱授权。
- **2999**：起草时调 `computeLaunchHeadroom` 只出提示（warnings），真闸在激活入口。
- **2822**：合并前种子只写 `audience_ref`；合并后可写 `targeting`。
- **3143/3150**：复用“目标上最新处方”读取思路，但 write 档用**带状态过滤的新变体**（只取 approved，并提示“有更高版本的草稿/未批准版本”）；`loadLatestGoalPrescription` 保持不变（它给显示用）。
- **3142**：空白计划创建无去重，所以按钮**只在已打开的草稿计划上起草**，不负责建计划。
- **3156 / 3144**：批准处方无副作用；人工草稿处方在 preview 档可读、write 档不读。

## 4. 触发与两档
- 按钮「按处方起草」在计划页已打开的草稿计划上（`requirePlanApproverAccess`）。点后先 **preview**：显示“将生成/将更新/被人改过不覆盖/未映射/提示”，PM 点“写入”才 **write**。
- **preview**：任意状态处方可读（含 draft）、纯计算、不写库；这是验收档。**write**：只认 approved；新路由 `POST …/promo/from-prescription`（mode=preview|write）。
- write 与 `PUT /promo` **共用同一个校验函数**（从 route.ts:76-111 抽出）：结构 → 目标属客户 → 账户归属 → `checkAdsBudget`（over 拒；unknown 放行并写 warnings）→ 草稿 + 乐观锁。**单测：生成的草稿必须能被 PUT 原样接受。**

## 5. 幂等、改版、人改保留
1. 记录：`generation_meta.from_prescription = { prescription_id, goal_id, version, seed_hash, generated_step_ids[], generated_step_hashes{}, unmapped[], kpis, warnings, generated_at }`，**加类型**（types.ts:264-285）；写入是 **jsonb 合并只写这一个键 + `updated_at` 乐观锁**（同 approve/route.ts:132、promo/route.ts:84/:125），不整列覆盖——已有的 `blank_draft.goal_id / promo_checks / approval_receipt` 不许抹。
2. 同处方版本再点：只更新同一份草稿。**只覆盖“仍等于上次生成值”的步骤**；人改过的保留并列出。
3. **首次生成遇到同 id 步骤（如 7a8bee93 手填的 `ads-lead-a`）一律视为人改：不覆盖、报出。** **人删掉的步骤不复活**（`generated_step_ids` 记过的、现在没有的 → 视为人删）。旧草稿被删/归档后改版不复活。
4. 处方改版识别用 **(goal_id, version)**，不依赖 `supersedes_id`（人工路由永远 null）。若旧版本生成的计划还是草稿 → 就地更新并记 `previous_prescription_id`；若已批准 → 不动，**新建一份草稿**，标题加「改版草稿」。
5. 读到“最新 approved”若**没有种子 / 缺 step_key**：不删不改，只报警（“最新批准的处方没有种子”）。若将来有人恢复自动开方并批准无种子的新版本 → 同样只报警；**写明：现在无此路径（§1.4），属“将来恢复时”的风险，恢复时须另开刀让自动开方不替代已批准的人工处方（A 级）。**
6. **改版草稿会被 `pickPlanForPrescription` 顶掉已批准那份**（“最新创建优先”）：本功能**不改 plan-pick**（测试锁行为），而是页面对“同目标 approved + 草稿并存”**显式提示**；plan-pick 改“approved 优先”另开一刀。

## 6. 不做
不自动批准计划；不自动建 Meta 对象；不碰钱（不改 `ad_strategy_configs`）；不解析 `summary`；不从 AUD/空 `budget_allocation` 推预算；本版只做 `ads_campaign`；不改 plan-pick；不让华佗生成路由写种子；不建空白计划。

## 7. 验收链（重写）
**不靠批准处方**（批准会往 initiatives 插阶段并 supersede 旧方案，且无 approved 副本入口）。
1. 块 0 单独 PR 上线后能验的只有：人工路由写入带种子的处方 ok、非法种子 422、审阅页显示种子（账户名/币种/日预算）。
2. 在 CTS 目标下由 PM/广告 Agent 写入一份**带种子的新人工草稿处方**（种子内容 = 7a8bee93 现状：单阶段 `phase-1` 2026-10-26→11-30；`ads-lead-a`：act_2775766642787274、5000 分、creative_refs 空；`ads-sh-thruplay`：act_2202695063810470、3000 分、creative_refs ['1136316685721299']、paused_ranges [{from 2026-10-26, to 2026-11-01}]）。
3. 对该草稿处方跑 **preview**，与现有草稿计划 7a8bee93（已由 74 修成合法）逐步对照：预期两个同 id 步骤均“已存在、视为人改、不覆盖”，字段逐项 diff 全部相等或列出差异。这就是验收，**不触发批准、不写库**。
4. write 档用单元/集成测试覆盖（假 approved 行）；真批准处方（带 Initiatives/supersede 副作用）是 PM 的业务决定，不属验收。

## 8. 工作量（按块；已吸收两位审查）
魏征估 6–8 天、子牙估 3–4 天（扣周更后）。我的估计 **5–7 天**，差在块 0 碰 `PrescriptionContent` 类型会牵动华佗生成/落地/审阅页三处。
| 块 | 内容 | 估 |
|---|---|---|
| 0 | `plan_seed` 类型 + `validatePlanSeed` + 人工路由写入/422 + `parseContent` 保留 + 审阅页渲染 + 导入页提示（A 级，单独 PR） | 2–2.5 天 |
| 1 | 映射纯函数 + 整份 `parsePromoSpec` + 幂等哈希/人改/人删判定 + 单测 | 1–1.5 天 |
| 2 | 共享校验函数抽出（含 PUT 回归）+ 路由 preview/write + jsonb 合并 + approved 过滤读取 | 1.5–2 天 |
| 3 | 计划页按钮 + preview 结果/未映射/并存提示 | 0.5–1 天 |
| 4 | 验收（§7）+ 台账 | 0.5 天 |

## 9. 风险与待核
- 【待核】`ads_campaign` zod 是否 `.strict()`（决定能不能加步骤备注；本稿默认不加）。
- 种子里写账户号 = 把账户事实放进处方：校验在写种子时（账户属客户）与生成时各做一次；3 个账户选错（本客户内）挡不住 → preview 显示账户名+币种+当日已花；文字受众标“刀①不可用”；`creative_refs` 起草时只读核对。
- 3066/2822 改 `promo/draft` 附近：本功能用新路由、不碰这些文件。

## 10. Reuse Statement
复用：promo_v1 spec/`parsePromoSpec`、`loadOwnedAccounts`、`checkAdsBudget`/`computeLaunchHeadroom`、`requirePlanApproverAccess`、PUT /promo 的校验链（抽成共享函数）。新增（平台共享）：`plan_seed` 协议、`validatePlanSeed`、映射纯函数、带状态过滤的 approved 处方读取。行业/客户特定：无（CTS 仅作验收样本）。

## 11. 对照：审查意见 → 本稿处理
魏征 M1→§2.1/§2.3（每阶段起止、整份 parsePromoSpec）；M2→§1.4/§5.5（以代码核清：自动开方无调用方，风险降为“将来恢复时”，并写“无种子只报警”）；M3→§2.2（审阅页渲染、写种子时核账户）；M4→§5.6（不改 plan-pick，页面提示并存）；M5→§5.1（jsonb 合并+乐观锁）；M6→§7；B1→§3；B2→§5.3；B3→§9；B4→§5.3；B5→§8。
子牙 M1→§2.2/§1.4（删周更来源）；M2→§2.1；M3→§4/§7（preview/write 两档）；M4→§4（共享校验函数+PUT 原样接受测试）；S1→§3；S2→§5.4；S3→§2.2；S4→§3（3142、按钮只在已打开草稿）；S5→§5.3；S6→§5.1；S7→§5.4/§5.6（标「改版草稿」）；S8→§8。
