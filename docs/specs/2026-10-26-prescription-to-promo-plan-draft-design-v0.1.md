# 处方 → 推广计划草稿：广告 Agent 主导 设计稿 **v0.4**（文件名沿用 v0.1 以免引用失效）

- 作者：119 号窗口　日期：2026-10-26　功能风险级：**A**（碰计划/预算数字的写入口）；本 PR 只含设计稿（纯文档）。
- 状态：**设计稿 v0.4，待子牙+魏征再审，再给 PM 看方向，审过前不写代码。**
- 版本脉络：v0.1/v0.2「种子只能人工写」→ PM 2026-10-26「让 ME 的广告 Agent 做主导」→ v0.3「种子由 Agent 从系统事实产出」→ **v0.4 吸收魏征（8 必改 + 8 建议）与 74 的口径澄清**。
- **对“Agent 主导”要说实话（魏征判断，74 认同）**：数字的主导权真的交给系统了（`Suggestion` 逼每个数带出处，人从“填数字”退到“看一眼”）；**结构**（打哪几类、各占几成）的主导权由本稿的 **结构化 `intent` 字段**补上——由出处方的广告 Agent（含华佗入口的 LLM）直接输出，不由人在另一个输入框里重填。
- 不变的三条：只生成**草稿**；批准仍由 **PM 在计划页点**；**不自动建 Meta 对象**。新增第四条：**批准处方不写任何预算授权痕迹**（§8）。
- 平台层级（tier-gate Inline）：归位既有 L1「广告支柱 · IMPACT 的 Prescribe→Act 衔接」；取数构建器平台共享（无客户名/行业词），行业差异走广告剧本参数。

## 0. 先说结论
广告 Agent 出处方时产出结构化 `content.plan_seed`，由两部分合成：
1. **`intent`（结构，Agent/LLM 给）**：打哪几类打法（`PlayKey`）、各占几成预算。作为处方 schema 的一个字段，**经 zod 校验，形状不对 422 拒**。
2. **数字事实（系统取，确定性）**：账户、日预算、受众、素材、起止日全部由构建器 `buildPlanSeed` 从系统事实取，复用现成的 `draftAdsStep`/`Suggestion<T>`（值+依据 / 留空+原因）。
**两条禁令（74 明确）**：① 不从 `summary`/动作描述的**文字里解析**出 intent 或任何参数；② LLM **不得输出任何数字事实**（账户号、日预算、人数、花费、搜索量……一律走确定性取数）。

## 1. 现状事实（主干，已核；★ = 本版新增或更正）
1. 处方 `content` 没有每动作的账户/日预算/受众/素材/日期（CTS 89cb61eb：`budget_allocation` 为空，动作全是人工文字）。
2. ★ **`parseContent`（src/lib/diagnostic/manual-prescription.ts:191-213）是白名单**：没显式拷贝的键一律静默丢弃、返回 200。不改它，种子保存“成功”但没了，审阅页不报错。
3. ★ **promo_v1 `ads_campaign` 的 zod 不是 `.strict()`**（spec.ts:19-33），且 `creative_refs/placements/paused_ranges` 带 `.default([])`：构建器“不写”的可选字段，经 `parsePromoSpec` 后全变成 `[]`。
4. ★ `draft-ads.ts:78` 的 `budget_share_of_headroom` 是**单个标量**（来自 playbook `draftBudgetShareOfHeadroom`，promo-draft-facts.ts:478），没有 per-play 比例的位置。
5. ★ `draftAdsStep` 有**两个**扣减口：`committed_minor`（同账户）与 `committed_all_minor`（同阶段所有账户，客户总上限按它扣）（draft-ads.ts:62-65）。
6. ★ `f.daily === null`（近 30 天花费读不到）时只 push 一条 warning，预算仍 `ok:true`，“最近真实日花费贴近上限就砍半”整段跳过——**读数失败 → 不打折 → 数字反而更大**（draft-ads.ts:216-229）。
7. ★ 受众是三态：`audiences_complete` 区分“真没有 / 没读全”，`why_empty` 写「受众快照没读全，不能判断是真没有受众还是没读到」（draft-ads.ts:305-308）——资格读取要照抄这个做法。受众“在投仍挂着”在代码里只是排序权重（`last_used_on===null` 照样会被选中，:338-346）。
8. ★ `promoVerdict` 是**五态**（ok/undeclared/not_started/expired/expires_before_use_end，promo-window.ts:12）。`account_status !== 1`（欠款/停用）现在只给 warning 仍给预算（draft-ads.ts:407-409）。
9. ★ `loadAdsDraftFacts` 每次翻客户名下所有账户近 35 天快照（各最多 10 页）；其 `coverageProblem` 在 `owned_account_ids===undefined` 时**直接返回 null（=没问题）**（promo-draft-facts.ts:189-192）——那道闸可以被静默关掉。
10. 自动开方已停（全仓无调用方，只剩测试禁止引用）；处方写入口 = 人工路由 `/prescriptions/manual` 与华佗生成路由 `/prescription/generate`（LLM 产出正文）。批准处方 `landPrescription` 会写 initiatives、supersede 旧方案（prescription-landing.ts:170-234，副作用未逐行核）；3156 之后批准不再生成待办。
11. 保存计划 `PUT …/promo` 校验链：结构 → 目标属客户 → 账户归属 → `checkAdsBudget`（按阶段逐个算，over 拒；币种读不到 verdict='unknown' **放行**，budget-caps.ts:99）→ 草稿 + 乐观锁；批准 `…/approve` 另算指纹与 gate。
12. 空白草稿创建无按目标去重（3142）；`pickPlanForPrescription` 按“最新创建”选计划（测试锁行为）。
13. 验收样本：处方 89cb61eb、计划 7a8bee93 均已 approved。

## 2. 种子长什么样（`content.plan_seed`）
```
plan_seed: {
  produced_by: 'ads-agent',
  facts_as_of: ISO 时间,
  intent: {                              // ← 结构，由 Agent/LLM 输出，zod 校验，形状错 422
    steps: [{ step_key, play: PlayKey, budget_share: number /* 0–1，各步骤之和 ≤ 1 */ }]
  },
  currency: string | null,
  phases: [{ phase_key, name, start_date, end_date,        // 取自目标周期，不猜
    ad_steps: [{
      step_key, play,
      ad_account_id:      Field<string>,                   // Field<T> = Suggestion<T> + notes: string[]
      daily_budget_cents: Field<number>,
      audience_ref:       Field<string>,
      excluded_audience_refs?: Field<string[]>,
      creative_refs:      Field<string[]>,
      placements?, paused_ranges?
    }]
  }]
}
```
- ★ **warnings 按字段挂**（`Field.notes`），预算字段至少带自己的 notes；`Basis` 里**固定加一条**「真实日花费：读不到，这个数没经过核对」（当 `daily===null`）。不再把十几条提醒摊平挂在顶层。
- ★ **share 的唯一真源**：默认取 playbook 的 `draftBudgetShareOfHeadroom`（标量）。若 intent 给了 per-step `budget_share`，则**覆盖**默认值，且该字段 `Basis.source` 必须写「处方 intent（Agent 给）」——不得顶着“剧本参数”的出处（假出处会直撞「绿灯要带出处」）。intent 的 share 不得使各步骤之和 > 1，也不得使合计超过客户余量（超了由 `committed_*` 扣减自然压低或 `ok:false`）。
- 一个步骤只要任一必填字段（账户/日预算/受众）是 `ok:false`，**该步骤不生成**，原因进“未生成清单”（不猜、不用占位文字顶）。`creative_refs` 空是允许的（默认 []），但提示“素材池里没有可用的”。

## 3. 每个字段从哪取（逐条；★ = 吸收审查）
| 字段 | 取数来源与规则 | 取不到 |
|---|---|---|
| `ad_account_id` | `client_meta_ad_accounts`（该客户名下、未隐藏）。★ **资格三态，逐态写死**：(a) 资格**未知** → `ok:false`，**整个步骤丢掉**，不许“先选上账户再附一条未知 warning”；(b) **读成功且非空**→可投；**读成功且空**→「读到了，没有可用主页/表单权限」；**读失败或无权限**（HTTP 错、令牌缺 scope、字段缺失）→「**读不到**，核实不了」——三者 why_empty 文案必须不同。**权限不足常回 200+空数组**，所以区分“读成功且空”与“读失败”的依据要在动手前真调接口验证（见 §12）。★ 资格来源**不得用 `client_meta_ad_accounts` 上人填的标记**当作系统事实；若要用，必须标明“来源：人工标记 + 录入时间”，且不得替代系统读数。★ `account_status !== 1`（欠款/停用）并入资格：**不可投 → `ok:false`**（不再只给 warning 还照给预算） | 三态各自的 why_empty |
| `daily_budget_cents` | `draftAdsStep` 的日预算建议：上限 × share（见 §2）经 `computeLaunchHeadroom` 余量。★ **准确说法**：近 30 天真实日花费读得到才会“贴近上限则减半”；**读不到就不压**，并在该字段 notes + Basis 写明「没经过核对」。★ **两个扣减口都要累加**：`committed_minor`（同账户）+ `committed_all_minor`（同阶段所有账户，客户总上限按它扣），范围是**阶段内**（与 `checkAdsBudget` 的分组口径对齐）。单账户多步骤几何收敛安全；**跨账户多步骤**是唯一会超客户日上限的路径，且币种读不到时 `checkAdsBudget` 放行 → 超限草稿会被存下来——所以**币种读不到 → 本步骤 `ok:false`**，不依赖下游放行 | 现成 why_empty；币种读不到→why_empty |
| `audience_ref` | `draftAdsStep` 受众建议。★ 按代码如实写：“在投仍挂着”只是排序权重；构建器对重定向类打法再加**硬过滤**（子类型 + 人数门槛）；冷启动类走年龄地区兜底文字，并标“刀①前不能自动落结构化 targeting” | 三态 why_empty（真没有 / 没读全 / 无达标） |
| `excluded_audience_refs` | 受众池里**排除名单型**自定义受众；47 人名单本身的上传不在本功能（要 PM 授权） | 留空 + 原因 |
| `creative_refs` | `creative_pool` 里 `status=approved` 的素材，★ **`promoVerdict` 五态逐个给结论**：ok→可用；undeclared（最常见）→不可用并写「素材没声明推广期」；not_started/expired/expires_before_use_end→不可用并写各自原因 | `why_empty` 按五态汇总 |
| 起止日 | 目标周期 `goals.period_*` ∩ 今天之后 | 无周期→整个种子不产出 |
| 币种 | 账户币种 | `null` → 整个种子不产出 |
| ~~班次核对~~ | ★ **第一刀砍掉**（对第一刀验收零贡献），放后续 | — |
★ **事实读一次、复用**：构建器每次产出种子只调一次 `loadAdsDraftFacts`（不按“候选账户×步骤”重复读十几遍），且 **`owned_account_ids` 必传**；并把 `coverageProblem` 的 `undefined` 分支改为“按读不全处理”（否则覆盖闸被静默关掉）——这是本功能顺带要修的前置小改动。

## 4. 谁在什么时候产出种子（★ 回答“华佗入口产不产”）
- **两个处方写入口都产**：人工路由 `/prescriptions/manual` 与华佗 `/prescription/generate`。LLM 在处方 schema 里**直接输出 `plan_seed.intent`**（经 zod，形状错 422）；**数字一律由 `buildPlanSeed` 在服务端取数**，LLM 不得给。只在目标是广告类时产出。
- ★ **`parseContent` 必须显式保留 `plan_seed`**（白名单）；种子形状不对 → **422**，**不许静默降级成“这份处方没有种子”**。回归测试：**POST 带种子 → 读回断言种子非空**，不许只断言 200。
- 种子作为处方的一部分存下来（Agent 当时凭什么这么定的记录）；审阅页渲染（§9 要求）。
- **新鲜度**：种子带 `facts_as_of`；「按处方起草」写入计划时**重新取事实再校验**（账户归属、`checkAdsBudget`、素材推广期、账户状态），与种子不一致或种子超过 N 天（建议 3）→ 以重取为准并列出差异。

## 5. 触发、两档、指纹（★ 指纹是本版重点）
- 计划页（已打开的草稿计划）上「按处方起草」：先 **preview**（任意状态处方可读、纯计算、不写库）显示将生成/将更新/被人改过不覆盖/未生成及原因/警告；PM 点“写入”才 **write**（只认 approved）。
- write 与 `PUT /promo` **共用同一个校验函数**；单测：生成的草稿必须能被 PUT 原样接受。映射后整份 `PromoSpec` 先过 `parsePromoSpec` 才写。
- ★ **指纹一律算在 `parsePromoSpec` 返回的规范形上**，用现成的 `stableStringify`（content-hash.ts）。原因：zod 非 strict 且 `.default([])`，构建器“不写”的可选字段 parse 后全变 `[]`，若按原始对象算指纹、下次按库里读出来的算，两者对不上 → 判成“人改过”→ **永远不覆盖且无任何报错（表现是“点了没反应”）**。测试：**生成→保存→重读→重算，指纹必须相等**。
- 「人改完又改回去」：行为**故意**保持为“视为未改，可被覆盖”（指纹相等即未改），在页面说明里写明。
- 带状态过滤的新读取变体（只取 approved，提示有更高版本草稿）；`loadLatestGoalPrescription` 不变。

## 6. 幂等、改版、人改保留
1. `generation_meta.from_prescription = {prescription_id, goal_id, version, seed_hash, generated_step_ids[], generated_step_hashes{}, unmapped[], skipped_steps[{step_key, why_empty}], notes_by_field, generated_at}`，加类型；jsonb 合并只写这一个键 + `updated_at` 乐观锁；不入指纹。
2. 同版本再点：只覆盖“仍等于上次生成值（按 §5 规范形指纹）”的步骤；人改过保留并列出；首次遇同 id 手填步骤视为人改不覆盖；人删的不复活。
3. 改版识别用 (goal_id, version)；旧草稿仍是草稿→就地更新；已批准→新建草稿标「改版草稿」，**不改 plan-pick**，页面对“同目标 approved+草稿并存”显式提示。★ **并发验收**：乐观锁管的是计划，种子在处方侧；两份草稿并存时“按处方起草”写进哪份取决于创建时间——验收要真跑一次，看提示说不说得清。
4. Agent 不覆盖人：重新取事实后，与人手改过的数字不同 → 保留人改并报差异。

## 7. 与周边的边界（各一句）
3010 v0.7：写的是（将来 ads-only 指纹里的）广告字段，不写批准回执/`gate_snapshot`/`approved_at`，草稿≠花钱授权；2999：起草的余量来自 headroom，真闸在激活入口；2822：合并前 `audience_ref` 走文字；刀②（3190）：种子的 `audience_refs/excluded_audience_refs` 将来可喂 `AdDraft.audienceIds/excludedAudienceIds`，不依赖它先合；3143/3150/3156/3144：只读显示不变、批准处方无副作用、人工草稿处方 preview 可读 write 不读。

## 8. 不做
不自动批准计划；不自动建 Meta 对象；不碰钱（不改 `ad_strategy_configs`）；**不从 summary/动作文字解析任何参数**；**LLM 不输出数字事实**；不上传名单；本版只做 `ads_campaign`；不改 plan-pick；不建空白计划；★ **批准处方不写任何预算授权痕迹**（不写 `approval_receipt` 里的金额、不设预算授权字段）。

## 9. 处方审阅页（★ 防“数字被读成预算授权”）
审阅页渲染种子：账户名+币种+日预算+起止+每个字段的依据或留空原因。★ 种子区块**显式标注**：「**这些数字只是 Agent 的建议，批准这份处方不等于批准花这些钱**；花钱要在计划页批准计划、在审批页点开广告」。背景：本项目已有反向事故（10-19 PM 点了两个“我已核实”以为等于批准）。

## 10. 验收链（第一刀切薄）
**第一刀只做 `ad_account_id` + `daily_budget_cents` 两个字段**（PM 最关心、红线最密）；受众/素材/班次放第二刀；第一刀**不写任何计划步骤**。
1. 块 A+B 上线后，对 CTS 目标跑 **preview** 并保存带种子的处方：PM 打开审阅页，账户/日预算是 Agent 填好的，**每个字段带依据或留空原因**。
2. ★ **只读 SQL 对照**（截图只能证明页面渲染了数字，证明不了数字来自库里那一行）：打出 `ad_strategy_configs.daily_budget_cap_cents`、各账户在投合计、（第二刀起）`creative_pool` 里 approved 的 ref 列表，与页面数字逐项对齐，贴进 PR「当场试跑」。
3. 验收必测：**多账户多步骤**（含币种读不到的情形，应 `ok:false`）；`daily===null` 时预算字段带「没经过核对」；资格三态各一例；POST 带种子→读回非空；种子形状错→422；生成→保存→重读→指纹相等。
4. 第二刀起：与已批准计划 7a8bee93 逐步对照（同 id 步骤视为人改不覆盖，字段 diff 列表）；素材逐个**回查 Meta 侧还在不在**（★ 已知缺口：本地 approved+推广期不等于 Meta 里没被下架，会生成“ref 在、广告建不成”的步骤）。
5. write 档用单元/集成测试覆盖；**不对生产处方重新批准**。

## 11. 工作量与拆分（按块；第一刀切薄后重估）
| 刀 | 内容 | 估 |
|---|---|---|
| 前置小改 | `coverageProblem` 的 `undefined` 分支改“按读不全处理”+ 测试；`owned_account_ids` 必传的约束 | 0.5 天 |
| 第一刀 A1+B | `buildPlanSeed`（仅账户+日预算：资格三态、`account_status`、币种、share 真源与 intent 覆盖出处、两个扣减口、`daily===null` 标注）+ `plan_seed`/`intent` 类型与 zod + `parseContent` 保留 + 422 + 两个处方入口调用 + 审阅页渲染与“≠预算授权”标注 + 测试 | 3–4 天 |
| 第二刀 A2 | 受众（硬过滤+三态）/ 素材（五态）/ 排除名单；Meta 侧素材回查 | 2–3 天 |
| 第三刀 C+D | 映射纯函数 + 规范形指纹 + 幂等/人改/人删 + 共享校验函数 + 路由 preview/write + jsonb 合并 | 3–4 天 |
| 第四刀 E | 计划页按钮 + preview 展示 + 并存提示 + 验收 | 1–1.5 天 |
合计约 **9.5–13 天**（比 v0.3 的 7.5–10 天上调，原因：资格三态、两个扣减口、intent 校验、规范形指纹、审阅页标注）。每刀一个 A 级 PR。

## 12. 未核实 / 动手前必须先证实（不当作已核实）
- **Meta `promote_pages` / 表单列表在权限不足时的真实返回（空数组 vs 报错）**：魏征是从手册 §30 同类记录推的，没真调；资格三态依赖它，**写代码前先真打一次接口看**。
- `landPrescription` 的具体副作用没逐行核；`tour_catalog_departures` 的广告侧可读入口没查（第一刀已不用）；处方审阅页现在有没有能渲染种子的位置没查。
- `ads_campaign` zod 非 strict 已核实（§1.3）——“步骤备注”仍不加。

## 13. Reuse Statement
复用：`draftAdsStep`/`Suggestion<T>`/`loadAdsDraftFacts`（读一次）/`computeLaunchHeadroom`/`checkAdsBudget`、promo_v1 spec 与 `parsePromoSpec`、`stableStringify`、`loadOwnedAccounts`、`requirePlanApproverAccess`、PUT /promo 校验链（抽共享函数）、广告剧本参数、`promoVerdict`。新增（平台共享）：`plan_seed`/`intent` 协议、`buildPlanSeed` 编排、规范形指纹比对、映射纯函数。行业/客户特定：无（CTS 仅作验收样本）。无客户名进共享代码。

## 14. 审查意见对照（v0.4）
魏征必改 1→§1.2/§4（parseContent 白名单、422、读回断言）；2→§0/§4（intent 允许 LLM 结构化输出，禁解析文字与 LLM 数字，华佗入口产种子）；3→§2（share 唯一真源与 intent 覆盖的出处）；4→§3 预算（两个扣减口、阶段内、币种读不到 ok:false）；5→§1.6/§2/§3（daily===null 标注、warnings 按字段）；6→§3 账户（资格三态、未知丢步骤、人填标记不当事实）；7→§5（规范形指纹、非 strict 已核实）；8→§8/§9（不写预算授权痕迹、审阅页标注）。建议 S1→§3 末（读一次、owned_account_ids 必传、undefined 分支）；S2→§3 素材五态；S3→§3 账户 account_status；S4→§3 受众；S5→§10.4/§12；S6→§6.3；S7→§10.2；S8→§10/§11（第一刀只做账户+日预算）。
