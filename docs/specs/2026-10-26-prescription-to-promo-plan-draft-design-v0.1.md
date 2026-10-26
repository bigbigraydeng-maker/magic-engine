# 处方 → 推广计划草稿：广告 Agent 主导 设计稿 **v0.3**（文件名沿用 v0.1 以免引用失效）

- 作者：119 号窗口　日期：2026-10-26　功能风险级：**A**（碰计划/预算数字的写入口）；本 PR 只含设计稿（纯文档）。
- 状态：**设计稿 v0.3，待子牙+魏征审，再给 PM 看方向，审过前不写代码。**
- 为什么有 v0.3：PM 2026-10-26 原话「继续修复 prescription 到广告计划的全链条！让 ME 的广告 Agent 做主导！」——优先级拔高（取代之前的“停/P3”）。v0.1/v0.2 假设“种子只能由人工处方写”，那样人还是要手填账户、日预算、受众、素材，只是换个地方填，与“Agent 主导”冲突。**v0.3 的核心改动：`plan_seed` 由广告 Agent 在出处方时自己产出，每个字段都从系统里已有的事实取，取不到就留空并写明原因（不猜、不兜底）。** 人退回「看一眼、改一改、批准」。
- 不变的三条：生成出来仍是**草稿**；批准仍由 **PM 在计划页点**；**不自动建 Meta 对象**。
- 平台层级（tier-gate Inline）：归位既有 L1「广告支柱 · IMPACT 的 Prescribe→Act 衔接」；Agent 产出种子的取数逻辑是平台共享（读客户名下账户/预算上限/素材池/受众池/目标周期，无客户名、无行业词）；行业差异走既有广告剧本参数（`budget_share_of_headroom / min_audience_size / max_creatives`）。

## 0. 先说结论
**广告 Agent 出处方时，由一个确定性的取数构建器 `buildPlanSeed` 产出结构化种子 `content.plan_seed`：Agent 决定“结构”（打哪几类打法、各占预算几成），系统事实决定“数字”（账户、日预算、素材、受众、起止日）。每个字段要么有值 + 依据（凭什么），要么留空 + 原因。** 之后计划页「按处方起草」只做搬运与校验，不再有人手填。

**关键复用（已核）：** 仓库里**已经有**这套“取事实→给建议→取不到写原因”的机器——`draftAdsStep`（src/lib/marketing-plan/promo/draft-ads.ts）：入参是 `AdsDraftFacts`（预算余量 `computeLaunchHeadroom`、近 30 天逐日花费、受众池、已批准素材），出参是 `Suggestion<T>` = `{ok:true,value,basis[]}` 或 `{ok:false,why_empty}`——类型层面就写不出“读不到被悄悄填成 0”。目前它只给「广告起草」按钮用（只读建议）。**种子构建器直接调用它，不另造一套。**

## 1. 现状事实（主干，已核）
1. 处方 `prescriptions.content` 没有每动作的账户/日预算/受众/素材/日期；数字只在 `summary`/KPI 文字（CTS 89cb61eb：`budget_allocation` 为空，动作全是人工文字）。
2. promo_v1（spec.ts）：阶段有起止、**阶段不得重叠**；`ads_campaign` 步骤只有 `ad_account_id / daily_budget_cents(>0) / audience_ref(min1) / creative_refs / placements / paused_ranges{from,to}`；指纹 `promoContentHash` 覆盖几乎全部字段，可选字段必须“不写”。
3. 自动开方已停：`auto-prescribe.ts` 头注释（2026-10-25 起）；全仓无调用方（只剩一条测试禁止周更文件引用它）。处方现在的写入口：人工路由 `/prescriptions/manual`（agent_name='广告 Agent'）与华佗生成路由 `/prescription/generate`。
4. `draftAdsStep`/`loadAdsDraftFacts`（src/lib/ads-strategy/promo-draft-facts.ts，482 行）/`computeLaunchHeadroom` 已存在，`POST …/promo/draft` 在用（纯只读）。
5. 批准处方 `landPrescription` 会写 initiatives、supersede 旧方案；3156 之后批准不再生成待办；3144 人工草稿不被覆盖。
6. 保存计划 `PUT …/promo` 的校验链：结构 → 目标属客户 → 账户归属 → `checkAdsBudget`（over 拒、unknown 放行）→ 草稿 + 乐观锁；批准走 `…/approve`（指纹、gate、回执）。
7. 空白草稿创建无按目标去重（blank-draft-create.ts，3142）；`pickPlanForPrescription` 按“最新创建”选计划（plan-pick.ts:26-43，测试锁行为）。
8. **验收样本现状**：处方 89cb61eb 已被 PM 批准（2026-10-26 07:25）；计划 7a8bee93 已批准（07:33）。可直接拿它们做对照，不需要“approved 副本”。

## 2. 种子长什么样（`content.plan_seed`）
```
plan_seed: {
  produced_by: 'ads-agent',              // 谁产出的
  facts_as_of: ISO 时间,                 // 取数时刻（过期要重取）
  currency: 'NZD' | null,
  phases: [{                             // 顺序时间窗，彼此不得重叠（同 promo_v1）
    phase_key, name,
    start_date, end_date,                // 取自目标周期（goal.period_*），不猜
    ad_steps: [{
      step_key,                          // → 步骤 id（幂等锚）
      play: PlayKey,                     // Agent 决定的打法：如 lead_form_harvest / warm_pool_retarget（play-vocabulary.ts）
      ad_account_id:   Field<string>,    // Field<T> = {ok:true,value,basis[]} | {ok:false,why_empty}
      daily_budget_cents: Field<number>,
      audience_ref:    Field<string>,    // 2822 合并后可换 targeting
      excluded_audience_refs?: Field<string[]>,
      creative_refs:   Field<string[]>,
      placements?:     Field<string[]>,
      paused_ranges?:  [{from,to}]
    }]
  }],
  warnings: string[]                     // 来自 draftAdsStep 的提醒 + 构建器自己的
}
```
`Field<T>` 就是 `Suggestion<T>`（复用类型）。**一个步骤只要有任一必填字段（账户/日预算/受众）是 `ok:false`，该步骤不生成计划步骤，整条原因进「未生成清单」**——不猜、不用占位文字顶。`creative_refs` 空是允许的（promo_v1 默认 []），但会提示“素材池里没有可用的”。

## 3. 每个字段从哪取（逐条，已核存在性；标【待核】的是动手前先证实）
| 字段 | 取数来源 | 取不到时 |
|---|---|---|
| `ad_account_id` | `client_meta_ad_accounts`（该客户名下、未隐藏）；再按“这个打法能不能在这个账户投”过滤：表单类要主页权限（CTS 官方账户 0470 因主页权限未回，**不能投表单广告**，这条写进构建器的账户资格判定；资格事实来源【待核】：`promote_pages` 读取或账户级资格标记） | `why_empty`：「这个客户名下没有能投表单广告的账户（0470 缺主页权限）」 |
| `daily_budget_cents` | `draftAdsStep` 的日预算建议：`ad_strategy_configs.daily_budget_cap_cents` × 剧本 `budget_share_of_headroom`，经 `computeLaunchHeadroom` 的余量、近 30 天真实日花费压低；**同一计划多个步骤用 `committed_minor` 逐个扣减** | 现成的 `why_empty`（余量读不全/已用完/太小…） |
| `audience_ref` | `draftAdsStep` 的受众建议（受众池：人数达门槛、在投广告组仍挂着）；重定向类打法过滤受众子类型（视频观看/互动/名单）；冷启动类走年龄地区兜底（`audience_ref` 写“新西兰 45–65 岁”这类文字，且标“刀①前不可自动落 targeting”） | 现成的 `why_empty`（读不到受众池 / 没读全 / 没有达标受众） |
| `excluded_audience_refs` | 受众池里的**排除名单型**自定义受众（CTS 0470 有一份）；**47 人名单本身的上传不在本功能，要 PM 本人授权** | 留空 + 「该账户没有排除名单」 |
| `creative_refs` | `creative_pool` 里 `status=approved` 且**推广期覆盖投放期**（`promoVerdict`）的素材 | `why_empty`：「素材池里没有可用的」 |
| 起止日 | 目标周期 `goals.period_start/period_end`（与投放期取交集，不早于今天） | 目标没有周期 → 整个种子不产出 |
| 推什么（班次） | `tour_catalog_departures` 里还在卖的班次，仅用于**核对素材**（素材讲的班次已售完 → 警告），不写进步骤（promo_v1 无此字段） | 读不到 → 警告“没法核对班次在售” |
| 币种 | 账户币种（`computeLaunchHeadroom` 已按币种）；多币种账户同计划 → `checkAdsBudget` 已有 unknown 规则 | `currency: null`，整种子不产出 |

## 4. 谁在什么时候产出种子
- **产出时机**：广告 Agent 写处方时（人工路由 `/prescriptions/manual` 与华佗生成路由两个入口都调用同一个 `buildPlanSeed(clientId, goalId, intent)`；**只在目标是广告类时**）。`intent` = Agent 的结构决定（打哪几类打法、各占预算几成），由处方作者（Agent）给；其余全部系统事实。
- **种子是处方的一部分**：作为 `content.plan_seed` 存下来——这是“Agent 当时凭什么这么定”的可审计记录；审阅页**渲染种子**（账户名+币种+日预算+起止，并列出每个 `why_empty`），PM 批准处方时看得见数字。
- **新鲜度**：种子带 `facts_as_of`；**「按处方起草」写入计划时重新取一遍事实再校验**（账户归属、`checkAdsBudget`、素材推广期），种子与重取结果不一致或种子超过 N 天（N 待定，建议 3）→ 以重取结果为准并列出差异。即：种子是 Agent 的决定记录，写入时的数字由当时事实核过。

## 5. 触发与两档（沿用 v0.2）
- 计划页（已打开的草稿计划）上「按处方起草」。先 **preview**（任意状态处方可读、纯计算、不写库）显示“将生成/将更新/被人改过不覆盖/未生成及原因/警告”，PM 点“写入”才 **write**（只认 approved 处方）。
- write 与 `PUT /promo` **共用同一个校验函数**（从 route.ts:76-111 抽出）；单测：生成的草稿必须能被 PUT 原样接受。映射后整份 `PromoSpec` 先过 `parsePromoSpec` 才写。
- 带状态过滤的新读取变体（只取 approved，并提示有更高版本草稿）；`loadLatestGoalPrescription` 不变。

## 6. 幂等、改版、人改保留（沿用 v0.2，补充 Agent 主导后的变化）
1. `generation_meta.from_prescription = {prescription_id, goal_id, version, seed_hash, generated_step_ids[], generated_step_hashes{}, unmapped[], skipped_steps[{step_key, why_empty}], warnings, generated_at}`，加类型；jsonb 合并只写这一个键 + `updated_at` 乐观锁；**不入指纹**。
2. 同处方版本再点：只覆盖“仍等于上次生成值”的步骤；人改过的保留并列出。首次遇同 id 手填步骤视为人改、不覆盖。人删的不复活。
3. 改版识别用 (goal_id, version)（人工路由 supersedes_id 恒为 null）；旧版本生成的计划仍是草稿 → 就地更新；已批准 → 新建草稿并标「改版草稿」，**不改 plan-pick**，页面对“同目标 approved + 草稿并存”显式提示。
4. **Agent 主导带来的新规则**：重新取事实后，Agent 产出的步骤数字与人手改过的数字不同 → 一律保留人改并报差异（Agent 不覆盖人）。

## 7. 与周边的边界
- 3010 v0.7：写的是（将来 ads-only 指纹里的）广告字段；不写批准回执/`gate_snapshot`/`approved_at`；草稿≠花钱授权。
- 2999：起草时 `computeLaunchHeadroom` 只出提示，真闸在激活入口（种子里的日预算本来就来自 headroom，所以天然在余量内；不替代激活闸）。
- 2822：合并前 `audience_ref` 走文字；合并后可写结构化 `targeting`（二选一）。
- 刀②（PR 3190，起草器挂受众/排除受众）：种子里的 `audience_refs / excluded_audience_refs` 将来可直接喂 `AdDraft.audienceIds/excludedAudienceIds`；本功能不依赖它先合。
- 3143/3150/3156/3144：只读显示不变；批准处方无副作用（本功能是显式另一步）；人工草稿处方在 preview 可读、write 不读。

## 8. 不做
不自动批准计划；不自动建 Meta 对象；不碰钱（不改 `ad_strategy_configs`）；不解析 `summary` 文字；不上传名单（47 人名单要 PM 授权）；本版只做 `ads_campaign`；不改 plan-pick；不建空白计划。

## 9. 验收链（89cb61eb 已 approved，可直接用）
1. 块 A（取数构建器）上线后，对 CTS 目标跑 **preview**，期望产出：账户=旧账户（0470 因主页权限被排除并写明原因）、日预算来自余量（与 PM 定的 $50/$100 对照，差异列出）、受众来自 7274 现有受众池（组 B 能选到“看过视频/互动”类）、素材=素材池里 approved 且推广期覆盖的（今天加的 1133861909177335）、起止=目标周期。
2. 与现有已批准计划 7a8bee93 逐步对照：同 id 步骤“视为人改、不覆盖”，字段逐项 diff 列表。
3. write 档用单元/集成测试覆盖（假 approved 行）；**不对生产处方重新批准**（批准有 initiatives/supersede 副作用，是 PM 的业务决定）。

## 10. 工作量（按块，重新估；Agent 主导后变大）
| 块 | 内容 | 估 |
|---|---|---|
| A | `buildPlanSeed`：账户资格判定 + 多步骤预算扣减 + 受众子类型过滤 + 素材推广期 + 班次核对 + 单测（复用 `draftAdsStep`/`loadAdsDraftFacts`，只做编排） | 2–3 天 |
| B | `plan_seed` 类型/zod + `content` 解析保留 + 两个处方入口调用构建器 + 审阅页渲染（账户名/币种/日预算/起止/why_empty）+ 导入页提示 | 2–2.5 天 |
| C | 映射纯函数 + 整份 `parsePromoSpec` + 幂等哈希/人改/人删判定 + 单测 | 1–1.5 天 |
| D | 共享校验函数抽出（含 PUT 回归）+ 路由 preview/write + jsonb 合并 + approved 读取变体 | 1.5–2 天 |
| E | 计划页按钮 + preview 展示（含未生成清单/并存提示）+ 验收与台账 | 1–1.5 天 |
合计约 **7.5–10 天**（v0.2 的 5–7 天不含 Agent 取数构建器与审阅页渲染）。建议拆 3 个 A 级 PR：A+B（种子产出与可见）→ C+D（写入）→ E（页面与验收）。

## 11. 风险与待核
- 【待核】账户资格事实（表单类广告“主页权限”）的程序化来源；【待核】`ads_campaign` zod 是否 `.strict()`；【待核】`tour_catalog_departures` 在广告侧的可读入口。
- Agent 的“结构决定（intent）”是否由 LLM 生成：本稿默认由处方作者（广告 Agent）在写处方时给出，构建器只做确定性取数；若要让 LLM 自动出 intent，是另一件事（单独设计，不在本稿）。
- 种子里写账户号 = 把账户事实放进处方：校验在产出时与写入时各做一次（账户属客户）。
- 与刀②/2822/3066 无文件冲突（新路由、新模块）。

## 12. Reuse Statement
复用：`draftAdsStep`/`Suggestion<T>`/`loadAdsDraftFacts`/`computeLaunchHeadroom`/`checkAdsBudget`、promo_v1 spec 与 `parsePromoSpec`、`loadOwnedAccounts`、`requirePlanApproverAccess`、PUT /promo 的校验链（抽成共享函数）、广告剧本参数。新增（平台共享）：`plan_seed` 协议、`buildPlanSeed` 编排、映射纯函数。行业/客户特定：无（CTS 仅作验收样本）。无客户名进共享代码。
