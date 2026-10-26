# 处方 → 推广计划草稿：广告 Agent 主导 设计稿 **v0.6**（文件名沿用 v0.1 以免引用失效）

- 作者：119 号窗口　日期：2026-10-26　功能风险级：**A**（碰计划/预算数字的写入口）；本 PR 只含设计稿（纯文档）。
- 状态：**设计稿 v0.6 = 定稿（吸收魏征、子牙第二轮全部意见；审查两轮已用完，不再开第三轮）。第一刀开写前还卡三件事实，见 §11.1。**
- **v0.6 变化一句话**：第二轮审查（魏征 N-0…N-H + 子牙 N1–N6）全部落地；**§12 的 promote_pages 结论被令牌身份实测推翻并重写**（系统身份与客户令牌看到的世界不一样）；预算等分公式与 Basis 署名定死；指纹加版本号；`play` 只留一个真相源；`page_id` 进种子。
- 版本脉络：v0.1/v0.2「种子只能人工写」→ PM 2026-10-26「让 ME 的广告 Agent 做主导」→ v0.3「种子由 Agent 从系统事实产出」→ v0.4 吸收魏征 8 必改 → **v0.5 吸收子牙 10 必改 + 7 建议（其中 4 条是“稿子依赖的取数源主干里不存在/已被规则禁止”）**，并把“资格判定”拎成**第零刀只读探针**，已真打一次（§12，原始输出已摘录）。
- **先 fetch 最新 main 再改的原因**：PR 2822 已合进主干（`cf1ba619`，改的正是 `spec.ts`），受众/排除受众形状必须按合并后重写（见 §1.1、§3）。
- 对“Agent 主导”说实话：**数字**的主导权交给系统（`Suggestion` 逼每个数带出处，人从“填数字”退到“看一眼”）；**结构**（打哪几类打法）靠处方里的结构化 `intent`（§2）——**华佗生成入口的 intent 由 LLM 给（真 Agent 主导）；人工入口的 intent 是人填的（如实写，不叫 Agent 主导）**。
- 不变的四条：只生成**草稿**；批准仍由 **PM 在计划页点**；**不自动建 Meta 对象**；**批准处方不写任何预算授权痕迹**。

## 0. 先说结论
广告 Agent 出处方时产出结构化 `content.plan_seed`，由两部分合成：
1. **`intent`（结构）**：只说“打哪几类打法（`PlayKey`）”。**不再包含各占几成**（M7：剧本里只有一个全局标量，覆盖它会让 `Basis` 对 PM 说谎）；预算拆分由确定性公式给（§3 预算）。
2. **数字事实（系统取）**：账户、日预算、受众、素材、起止日由构建器 `buildPlanSeed` 取，复用 `draftAdsStep`/`Suggestion<T>` 做它**覆盖的三个字段**（日预算/受众/素材），其余（账户资格、排除受众、投放位置、起止日）是**新逻辑**。
两条禁令：① 不从 `summary`/动作文字里**解析**参数；② LLM 不输出任何**数字事实**（账户号、日预算、人数、花费……）。

## 1. 现状事实（主干，已核；★ = v0.5 新增/更正）
1. ★ **2822 已合并**：`ads_campaign.settings` 新增 `targeting`（`.optional()`，**注释明令不许 default**，否则旧计划指纹变）；`audience_ref: z.string()` **去掉了 `.min(1)`**，空串合法但必须填 `targeting`（二选一，在 `crossFieldIssues` 查，spec.ts ~L278-287）；`targeting = {countries[], city_keys[], age_min?, age_max?, excluded_audience_refs[]}`，**`excluded_audience_refs` 只存在于 `settings.targeting` 里，step 层没有**；`countries` 与 `city_keys` 不许同时给（Meta 按并集，08-04 事故，~L288-295）；`audience_ref` 有四处下游当“受审编号”读（overview.ts / schedule.ts / AdsDraftPanel.tsx / draft-ads.ts）。`ads_campaign` zod **非 strict（默认 strip）**，且 `creative_refs/placements/paused_ranges` 带 `.default([])`。
2. `parseContent`（manual-prescription.ts:191-213）是**白名单**，没显式拷贝的键静默丢弃、返回 200——这一支管顶层 `plan_seed`。★ **但 `initiative_seed` 那一支方向相反（魏征 N-0 / 子牙 N3，两人都查到）**：`parseSeed`（manual-prescription.ts:112-128）结尾是 `raw as unknown as PhaseInitiativeSeed`，**整体 cast**、不是白名单——`ad_plays` 今天不加任何代码就能存进去，而且**零校验**。风险不是“静默丢”，是**“静默收下脏数据”**。所以 `ad_plays` 必须在 `parseSeed` 里**显式校验**（`step_key` 非空字符串且不重复、`play` 属于 `PlayKey` 封闭集合、数组长度上限），**形状错 422**；回归测试：POST 带**非法** `ad_plays` → 422，带合法 → 读回等于入参。否则“形状不对 422”是句空话。
3. `draft-ads.ts`：`budget_share_of_headroom` 是单个标量（playbook `draftBudgetShareOfHeadroom`=0.5，`evidence:'unvalidated_default'`），basis 署名「剧本参数」；有两个扣减口 `committed_minor`/`committed_all_minor`；`f.daily===null` 时只 push warning、预算仍 `ok:true` 且**不打折**；受众是三态；`last_used_on===null` 只是排序权重；`promoVerdict` 五态；`account_status!==1` 只给 warning 仍给预算。剧本里只有 `draftBudgetShareOfHeadroom` 与 `draftMaxCreatives` 两个参数；**`min_audience_size` 是全局常量 `D4_AUDIENCE_FLOOR=1000`（thresholds.ts:42），不是剧本参数**。
4. `loadAdsDraftFacts` 每次翻客户名下所有账户近 35 天快照（各≤10 页）+ 近 30 天逐日 + 受众抓取；其 `coverageProblem` 在 `owned_account_ids===undefined` 时返回 null（=没问题）。
5. 处方正文**已有**结构化容器 `PhaseInitiativeSeed`（diagnostic.ts:396-416）：`initiative_type`（6 类封闭）、`posture`、`budget_percent`（**占 Goal 总预算百分比**，manual-prescription.ts:185-189 校验合计≤100，批准时写进 initiatives）、`hypothesis`。人工路由的 `agent_name='广告 Agent'` 只是标签常量，正文是人填表单。
6. ★ **plan_seed 进 content 要改三处写入点**：`parseContent` 白名单；`prescription/generate/route.ts:430,459`；`prescription/[pId]/refine/route.ts:204,216`（**refine 整份重写 content，会把种子冲掉**）。
7. ★ **`tour_catalog_*` 被边界测试明令禁止**：`src/lib/tour-catalog/__tests__/boundary.test.ts` 是 allow-list，catalog 四个目录之外任何 src/scripts 文件出现 `tour_catalog_*` 子串即失败；唯一合法入口 `loadPublishedProducts(db, clientId, today)`（store-publish.ts:153-167），已按 today 过滤，没发布过返回 `{published:false}`，会抛 `PublishedUnreadableError`（要 catch 成“未知”不是“没有”）。班次核对是**旅游行业语义**，不进主干构建器，走行业 Playbook 的可选钩子。
8. ★ **`client_meta_ad_accounts` 没有资格列**（列只有 id/client_id/ad_account_id/label/is_primary/created_at/updated_at + daily_budget_cap_cents + hidden_from_ad_health）；加列=迁移=留给 PM 亲手合。`hidden_from_ad_health` 的列注释原话「只管展示，不改变投放/预算/内核对该账户的任何处理」，`loadOwnedAccounts` 也不读它。
9. ★ `promote_pages` **全仓零命中**（待建 Graph 适配器）。`src/lib/meta/lead-forms.ts`（按 pageId 列 `leadgen_forms`，返回 `{rows,error}`）、`src/lib/meta-oauth/client.ts`（scope 真相源）、`getStoredPageToken` 都现成可读。
10. 保存计划 `PUT …/promo` 校验链：结构 → 目标属客户 → 账户归属 → `checkAdsBudget`（按阶段逐个算；币种读不到 verdict='unknown' **放行**）→ 草稿+乐观锁。素材为空是**硬红**（gates.ts:179-180）。
11. `generation_meta` 在 `marketing_plans.generation_meta`（已有 `promo_checks` 同款），放那里“不入指纹”自动成立、**不需要**改 content-hash.ts。
12. `pickPlanForPrescription`（plan-pick.ts:26-43）优先级“挂同目标的最新创建 → approved → draft”，测试锁行为：**新建的改版草稿若挂同一目标，会立刻顶掉已批准那份成为页面认的计划**。
13. 自动开方已停（全仓无调用方）；2999 仍是 OPEN 的设计稿（不是在飞实现）；3066、3190 是 OPEN Draft，避让成立。验收样本：处方 89cb61eb、计划 7a8bee93 均已 approved。

## 2. 种子与存储契约
```
plan_seed: {                     // 带版本号的独立 zod；与内存类型 Suggestion/Basis 解耦（★）
  schema_version: 1,
  produced_by: 'ads-agent',
  facts_as_of: ISO,
  currency: string | null,
  period: { start_date, end_date },                    // ★ 本版只出**单阶段**（M3）
  ad_steps: [{
    step_key, play: PlayKey,                           // ← 由 ad_plays 派生的快照（见下，非独立真相）
    page_id: Field<string>,                            // ★ 判资格用的那个主页编号，必须落进种子+Basis（10-09 硬规矩：多客户主页的账户里一律显式指定，禁依赖默认值/清单第一个）
    ad_account_id:      { value,basis[],notes[] } | { why_empty, notes[] },
    daily_budget_cents: 同上,
    audience:  {kind:'saved', ref, ...} | {kind:'targeting', countries[], age_min?, age_max?} | {why_empty},   // ★ 对齐 2822
    excluded_audience_refs?: [...] ,                   // → settings.targeting.excluded_audience_refs
    creative_refs, placements?, paused_ranges?
  }]
}
```
- ★ **存储契约**：种子只存**快照**，读回必须过 zod；形状不符按“未知”处理；以后改 `Basis` 字段不影响旧种子含义（种子里存的是自己的版本化形状）。
- ★ **`play` 的唯一真相源（子牙 N3）**：**只有 `initiative_seed.ad_plays[].{step_key, play}` 是存下来的真相**（LLM 或人填，经 `parseSeed` 校验）；`plan_seed.ad_steps[].play` 是构建器按它**派生出来的快照**，只用于审计展示。**refine 路由整份重写 content 时，不“保留旧 plan_seed”，而是用新的 `ad_plays` 重新跑构建器重建 `plan_seed`**（数字重新取事实）；若 refine 的输出没有 `ad_plays` → 保留旧 `ad_plays` 并提示。两边永远不会分叉。
- ★ **intent 落点（M6，铁律 0 Reuse Gate）**：**先尝试扩展 `PhaseInitiativeSeed`**，加可选 `ad_plays?: {step_key, play}[]`（加性字段，派生 initiatives 的逻辑忽略它）。若评审认为承载不了，逐条理由：`initiative_seed` 是**按阶段**的、`budget_percent` 语义是 Goal 总预算百分比；而 plays 是**按广告步骤**的、日预算来自“上限×余量”——**同一份处方里会出现两套钱的口径**，本版**只在审阅页并排标注，不做口径对账**（§9、§11 风险）。
- 入口分开写：**华佗 `/prescription/generate`：`ad_plays` 由 LLM 输出（zod，形状错 422）= 真 Agent 主导**；**人工 `/prescriptions/manual`：`ad_plays` 是人填的，如实标“人工填写”**。
- ★ **warnings 按字段挂**（`notes[]`），`daily===null` 时预算字段固定带 Basis「真实日花费：读不到，这个数没经过核对」。
- 一个步骤只要**账户/日预算/受众/素材**任一 `ok:false` 就**不生成**，原因进“未生成清单”（★ 素材为空是硬红，不是“允许留空”）。

## 3. 每个字段从哪取
| 字段 | 取数与规则 | 取不到 |
|---|---|---|
| `ad_account_id` | ★ **候选 = `loadOwnedAccounts`（客户名下）**；**不得用 `hidden_from_ad_health` 筛**（展示开关≠投放开关，“状态字段当授权”老坑）。★ **（子牙 N2，已被令牌实测证实，见 §12）`promote_pages` 的读数是“令牌身份”的函数**：系统身份长期钥匙看到官方账户只有 Roman、看不到 CTS Tours；构建器运行时那把客户令牌（`source=client_domain`）两个账户都列出 CTS Tours。**所以第一刀把 `promote_pages` 降成“Basis 展示 + warning，不参与 `ok:false`”**，样本齐了再升；Basis 里**必须写明用的是哪把令牌身份**。★ **资格判据 = 系统读得到的三样**（用构建器运行时实际会拿到的那把令牌）：该主页有可用 token（`getStoredPageToken`）+ 必需权限（`leads_retrieval`、`pages_manage_ads`，以 meta-oauth/client.ts 的 scope 清单为真相源）+ 至少一个 **ACTIVE** 表单（`fetchPageLeadForms`）。“账户↔可投主页”再加 `promote_pages`（**待建只读适配器**）。★ **三态**：读成功且非空 / 读成功且空 / **读失败或无权限**。★ **（魏征 N-F）两态行为相同（都 → `ok:false` 丢步骤，fail-closed）**，但真实返回下第二态与第三态分不开（令牌看不到某条边时 Meta 常见是 **200+空数组**而不是报错）。所以**文案不能说“这个主页没有在用的表单”**，要说「**读到 0 个——也可能是这个令牌看不到**」；样本缺口不挡第一刀，只挡这两句文案定稿（台账卡跟踪）。★ 资格**未知 → `ok:false` 整个步骤丢掉**，不许先选账户再附 warning。★ `account_status!==1` → `ok:false`。多个都合格 → **preview 把所有合格候选及各自余量都摆出来**；默认取余量最大者，并在 notes 写明“该账户是否有 ME 成功建过广告的记录（有读数时）”，因为“取余量最大”会系统性地选中**从没经 ME 成功建过**的官方账户而不是已真建过的旧账户——账户选择在 preview 里要让 PM 看得见、能改 | 三态各自 why_empty |
| `daily_budget_cents` | ★ **等分公式（v0.6 定死）**：<br>**先算资格再算钱，只切一次（魏征 N-C）**：N = 通过**非预算闸**（账户资格 / 账户状态 / 受众 / 素材 / 起止日 / 币种可读）的步骤数；因预算 `ok:false` 被丢的**不重新切**（避免“丢一个→N 变小→别的变大→刚丢的又够了”的循环）。`n_a` = 落在账户 a 上的步骤数。每步：`budget = floor( share × min( 客户余量 / N , 账户 a 余量 / n_a ) )`（`share` = 剧本标量 `draftBudgetShareOfHeadroom`）。性质：Σ ≤ share × 客户余量，每个账户 Σ ≤ share × 该账户余量——**不会超上限，只会偏小**。<br>★ **写法选择（子牙 N4a）：构建器不复用 `draftBudget` 的预算计算与它写死的「剧本参数」Basis，用纯函数 `splitBudget(facts, plan)` 自己算、自己写 Basis**（共享的 `draft-ads.ts` 不改，现有 `promo/draft` 与 AdsDraftPanel 行为不变）；复用的是**取事实**（`loadAdsDraftFacts` 读一次）和受众/素材建议。Basis 打出实际除数与余量：「客户余量 15000 ÷ N=2；账户 a 余量 10000 ÷ n_a=1；取小者×剧本比例 0.5」。**绝对不许**用“改小传进去的 `headroom_minor`/`budget_share_of_headroom`”来实现等分（Basis 会对 PM 打出假的余量/假的出处）。<br>★ **扣减口（子牙 N4b）**：本次生成的这批步骤**一律不走 `committed_*` 顺序扣减**（它靠调用顺序，会得到 0.5/0.25）；`committed_minor`/`committed_all_minor` **只装计划里“人工已有的步骤”**（先从余量里扣掉，再按上式等分），且范围=同阶段、与 `checkAdsBudget` 分组口径对齐。<br>★ **示例（CTS 当下真实读数，§12.1）**：客户上限 15000，账户 7274 上限 10000、0470 上限 3000，两账户在投合计读数均为 0（⚠️ 快照陈旧，见 §12.1），share=0.5。N=2（各 1 步）→ 7274：floor(0.5×min(7500,10000))=3750；0470：floor(0.5×min(7500,3000))=1500；合计 5250 ≤ 0.5×15000。N=1 只落 7274 → floor(0.5×min(15000,10000))=5000。<br>★ **快照过期 = 闸，不是标签（74 拍板）**：`loadAdsDraftFacts` 的“在投合计”来自实体快照；**构建器自己读每个账户最近一次成功抓取时间**（`ad_snapshot_captures` 最新一行，**不用实体行的 `captured_at`**——后者只在设置变化时+每日一行才写，会显得比真实抓取老得多，今天实测 as_of 显示 10-25 12:31Z，而抓取表最新一轮是 10-26 06:31Z）。抓取节奏：`ad-entity-snapshot` **每 6 小时一次（`30 */6 * * *`，Render cron）**，所以**阈值 = 12 小时（两轮没跑成才算过期）**，不是照抄 24 小时；快照老于 12 小时 → 日预算**按保守口径减半**（与 `daily===null` 同一套，且两者叠加时只减半一次），Basis 打出抓取时间与“这个数没算进该时间之后新开的广告”。**测试断言数字本身（新鲜/过期两例）**。**已知缺口（如实写）**：这道闸只能抓“抓取轮次没跑成”，**抓不到“上一轮抓取之后才新开的广告”**——今天 7274 的 $50/天是 10-26 07:34Z 开的，最新抓取在 06:31Z，下一轮 12:31Z，之间的在投预算读数就是 0。真正的修法是取数层改成**实时读在投预算**（心跳读取层 `readHeartbeatAccount` 已能读 ACTIVE 广告组日预算，≤4 次 Graph 调用/账户），**本版不改，已开台账卡**。
★ **读不到近 30 天真实日花费（`daily===null`）→ 同样保守减半**（与币种读不到/资格未知同一套 fail-closed 口径；读不到时的建议值恒 ≥ 读得到且贴近上限时的值，方向往大偏）；Basis 写「真实日花费读不到，按保守口径减半」。★ 币种读不到 → 该步骤 `ok:false`。★ **preview 固定写一行**：「本阶段 N 步通过资格，日预算按 N 等分（各账户按落在该账户的步骤数再等分）」；某步因预算被丢时明说“该步骤被丢，其余步骤预算未重新分配”。 | 现成 why_empty；币种读不到→why_empty |
| `audience` | ★ **受众池读取注意（2026-10-26 实测，已写入 Meta 广告手册 §30 第 7 条）**：账户的受众列表边（`customaudiences`，含 `fetchCustomAudiences`）**会漏掉部分相似受众**——CTS 旧账户列表边只返回 8 条，而广告 MCP 读到 12 条，缺的 4 条都是「类似受众 (NZ, 1%)」，按 id 直读均 200 且 `account_id` 就是本账户。所以**“不在列表里 ≠ 不属于该账户”**；受众归属/可选性判断，列表里没有的要按 id 直读核 `account_id`（`fetchCustomAudienceById` **只存在于 PR 3190（OPEN Draft）里，主干零命中**——本功能依赖 3190 合并；3190 不落地时本功能自建同等读取器）。官方账户列表边也只返回 8 条而 MCP 读到 11 条，缺的 3 条**同类原因、未穷尽，未逐条核实**。`approximate_count_lower_bound` 会返回 **-1/0 表示“不报”**，≤0 一律当读不到、不当“人太少”。★ 按 2822 形状（空 `audience_ref=''` + `targeting` 会成为构建器的**常规产物**，所以下游要跟上：`schedule.ts:148` 无条件打印 `受众引用 ${…}`，空串会渲染成「受众引用 」；`AdsDraftPanel.tsx:15/118` 的 `onAdopt` patch 形状里没有 `targeting`——这两处在第二/第三刀一并补，子牙 N6）：有合格已保存受众 → `audience_ref=<编号>`；没有 → **不得把中文散文塞进 `audience_ref`**，改用 `targeting={countries:['NZ'], age_min, age_max}`（`audience_ref=''`），`countries` 与 `city_keys` 不同时给。重定向类打法构建器按子类型过滤；★ **人数处理（子牙）**：`D4_AUDIENCE_FLOOR=1000` 的原语义是「**≤ 它说明 Meta 显示下限、人数判不了**」（thresholds.ts:40-42），**不是“不合格”**——所以**不做“人数 ≥ 1000”的硬过滤**；人数 `null` 或 ≤ 该下限 → 记“人数判不了”并仍可入选（例：CTS「Leadform submitted 90d」显示 1000 = 下限，是合法暖名单）；人数按大小只作排序权重。★ **`approximate_count_lower_bound` 的 -1/0（Meta“不报”）在构建器入口归一成 `null`（facts 预处理，不碰共享 `draft-ads.ts`）**，否则 -1 会静默掉进“不达门槛”被剔除、连“人数未知”那条 Basis 都不出现。★ **被跳过的候选必须在 Basis 里列出（几个、各自原因）**，不许静默剔除；“在投仍挂着”只是排序权重，按代码写 | 三态 why_empty |
| `excluded_audience_refs` | 受众池里排除名单型自定义受众 → 写入 `settings.targeting.excluded_audience_refs`。★ **有意“仅为携带排除名单而创建 `targeting` 对象”**（targeting 是 optional，注释禁 default，所以只在有排除名单时才创建，不能给每个步骤都塞空对象）。47 人名单本身的上传不在本功能（要 PM 授权） | 留空+原因 |
| `creative_refs` | `creative_pool` approved；`promoVerdict` 五态逐个：ok→可用；**undeclared（最常见）**→不可用并写「素材没声明推广期」；not_started/expired/expires_before_use_end→各自原因。★ 结果为空 → 整步骤进“未生成清单”（素材空是硬红，PM 批不了） | 五态汇总 |
| 起止日 | 目标周期 ∩ 今天之后；**单阶段**。★ **映射规则（子牙 N1，第三刀 write 用）**：`ads_campaign` 步骤自己没有起止日（只有 `paused_ranges`），`schedule.ts:142` 拿 `phase.start_date` 当开投日，所以 period 只能落在**阶段**上；而阶段不许重叠。规则：目标计划**还没有任何阶段** → 新建这一个阶段；**已有阶段** → **只在其中恰好一个阶段的日期区间完整覆盖 period 时，复用该阶段**（把步骤加进去）；否则**不写，preview 明说“与现有阶段冲突，需人手处理”**，绝不新建会重叠的阶段。幂等粒度：阶段按 `phase_key`、步骤按 `step_key`。 | 无周期→整个种子不产出；冲突→不写 |
| ~~班次核对~~ | ★ **移出主干**：旅游语义，将来走行业 Playbook 可选钩子，经 `loadPublishedProducts(db, clientId, today)`（catch `PublishedUnreadableError` → “未知”） | — |
★ **事实读一次、复用（M10）**：构建器每次只调一次 `loadAdsDraftFacts`，facts 按账户缓存（只读一次）；预算按上面的等分公式**一次算出**，不靠调用顺序；**`owned_account_ids` 必传**，并把 `coverageProblem` 的 `undefined` 分支改为“按读不全处理”（前置小改）。★ **失败隔离**：种子构建**任何一环失败只落 why_empty，绝不让处方保存失败**；给整体耗时上限（建议 8 秒，超时→未完成的步骤 why_empty「取数超时」）；不在处方保存请求里做 Meta 实时读取以外的重活（资格探测并发+超时）。

## 4. 谁在什么时候产出种子
- 两个处方写入口都产（华佗 LLM intent / 人工人填 intent），**加上 refine 路由必须保留已有种子**（refine 整份重写 content）。只在目标是广告类时产出。
- `parseContent` 显式保留 `plan_seed` 与 `initiative_seed.ad_plays`；形状不对 **422**，不静默降级；回归测试：POST 带种子 → **读回断言种子非空**。
- ★ **种子只在写处方时产出，已批准的 89cb61eb 没有种子**。第一刀验收（M9）选**前者**：新增**只读的「按目标现算一次种子」接口**（纯计算不写库，性质同现有 `POST …/promo/draft`，按 CLAUDE.md §3 例外不需要 Inngest）——PM 打开审阅页/计划页即可看到按当前事实现算的种子；写入处方时同一函数再存一份快照。

## 5. 触发、两档、指纹
- 计划页「按处方起草」：先 **preview**（任意状态处方可读、纯计算），PM 点“写入”才 **write**（只认 approved）；write 与 `PUT /promo` 共用同一个校验函数；单测“生成的草稿必须能被 PUT 原样接受”；映射后整份 `PromoSpec` 先过 `parsePromoSpec` 才写。
- ★ **指纹一律算在 `parsePromoSpec` 返回的规范形上，并且指纹输入先过一次 JSON 往返（`JSON.parse(JSON.stringify(spec))`）**，再喂 `stableStringify`（魏征 N-A）。原因：① 构建器“不写”的可选字段 parse 后变 `[]`，按原始对象算会永远对不上；② **zod 对 `.optional()` 会保留“键在、值 undefined”的键**（本机实跑：`parse({audience_ref:'x', targeting: undefined})` 得 `{…,"targeting":null}`，而省掉键则没有；`stableStringify` 用 `Object.keys`、不跳 undefined）。实现者最自然的写法 `targeting: hasExcluded ? {…} : undefined` 正好落进这个形：生成时指纹含 `"targeting":null` → 存 jsonb 时 undefined 被丢 → 重读重算不同 → 该步骤**永久判成“人改过”、永不覆盖、不报错**。**测试：生成→保存→重读→重算，指纹必须相等；夹具必须包含“可选字段键在、值 undefined”这一例**。历史数据（§12.1 实测）：33 份计划 / 5 个广告步骤，没有任何一个带 `targeting` 键，不需要兼容旧数据。
- ★ **指纹连 spec zod 版本号一起存（子牙 N5）**：规范形本身是 zod 版本的函数——2822 刚往 `adsTargeting` 加了 `excluded_audience_refs: .default([])`，下次谁再加一个带 `.default()` 的字段，所有已存步骤的指纹一起变。所以 `generated_step_hashes` 旁存 `spec_schema_version`；**版本不一致 → 按“未知”处理：不覆盖 + 页面明说“规范形已升级，这些步骤无法判断是否被人改过”，不静默跳过**。步骤粒度的新指纹放在新模块（`promo/step-fingerprint.ts`），与既有 `promoContentHash`（整份推广结构是否被改动的尺）**并存、互不替代**，剔除规则在模块注释里写明与它的差异；`content-hash.ts` 不改。“人改完又改回去”= 视为未改（故意，页面说明里写明）。
- 带状态过滤的新读取变体（只取 approved，提示有更高版本草稿）。

## 6. 幂等、改版、人改保留
1. `generation_meta.from_prescription` 存 `marketing_plans.generation_meta`（jsonb 合并只写这一个键 + `updated_at` 乐观锁，不入指纹，S1）。
2. 同版本再点：只覆盖“仍等于上次生成值（规范形指纹）”的步骤；人改的保留并列出；首次遇同 id 手填步骤视为人改；人删的不复活。
3. ★ **改版草稿会顶掉已批准计划（`pickPlanForPrescription`）**：仅“页面提示并存”不够。**74 已拍板：同意，单独一小刀，放在第三刀前**，别混进这条链：它改的是“页面认哪份计划”（用户看得见的行为，`plan-pick.test.ts` 正锁着现行为，**不能当纯重构混进去**），动之前要确认 3143/3150/3156 刚合的只读显示（都走这条挑选逻辑）没有反向依赖。第一刀/第二刀期间触发不了（这两刀都不建 `marketing_plans` 行）。
4. Agent 不覆盖人；并发验收：两份草稿并存时“按处方起草”写哪份取决于创建时间——验收真跑一次看提示说不说得清。

## 7. 与周边的边界
3010 v0.7：写的是（将来 ads-only 指纹里的）广告字段，不写回执/`gate_snapshot`，草稿≠授权；2999：（OPEN 设计稿）起草余量来自 headroom，真闸在激活入口；★ **2822（已合并）**：本稿形状已按合并后重写；刀②（3190，OPEN Draft）：种子的 `excluded_audience_refs` 将来可喂 `AdDraft.excludedAudienceIds`；3143/3150/3156/3144：只读显示不变、批准处方无副作用。

## 8. 不做
不自动批准计划；不自动建 Meta 对象；不碰钱（不改 `ad_strategy_configs`）；不解析 summary；LLM 不输出数字事实；不上传名单；本版只做 `ads_campaign` 且**单阶段**；不用 `hidden_from_ad_health`/人填资格列当投放判据；不加迁移；★ **批准处方不写任何预算授权痕迹**；不改 content-hash.ts。

## 9. 处方审阅页（两个面）
★ **两个面**：(a) `prescription/new/page.tsx`（**1882 行，已超 800 行上限，新渲染必须另开组件文件**，不往里加）；(b) promo-plan 页的处方卡（走 `toGoalPrescriptionView` + `prescription-copy.ts`，`GoalPrescriptionView` 要扩字段）——块 B 两个都算。渲染：账户名+币种+日预算+起止+每字段依据或留空原因；★ **并明写这句（魏征 N-H）**：「**百分比（`budget_percent`）只是记在 Initiative 上的分配说明，不会花钱；日预算才是以后真能花出去的数；本版两者不互相校验。**」（代码追踪：`budget_percent` 经 `parseSeed` → `phaseBudgetPercentSum`（≤100）→ initiative-derive.ts:243-252 → `createInitiative`，之后只被 polish-hypothesis 回显和 UI 求和消费（InitiativeList.tsx:87,179、prescription/new/page.tsx:982），从不进 `checkAdsBudget`、不进 `ad_strategy_configs`、不碰任何 Meta 对象。）；显式标注「**这些数字只是 Agent 的建议，批准这份处方不等于批准花这些钱**」（10-19 反向事故）。

## 10. 验收链（第一刀切薄）
**第零刀（只读探针，已做，§12）**→ **第一刀只做 `ad_account_id` + `daily_budget_cents` 两个字段**，不写计划步骤。
1. 第一刀上线后，**只读接口**对 CTS 目标现算种子，PM 在页面看到：账户/日预算由 Agent 填好、每字段带依据或留空原因。
2. ★ **只读 SQL 对照**：打出 `ad_strategy_configs.daily_budget_cap_cents`、各账户在投合计，与页面数字逐项对齐，贴进 PR「当场试跑」。
3. 必测：多账户多步骤（含币种读不到→`ok:false`）；`daily===null`→**断言数字本身：满额 vs 保守减半两例**（不能只断言 warning 在——否则把减半分支整段删掉测试照样全绿，同 10-26“假时钟藏住预算逻辑”一类）；等分公式 N=1/N=2/N=4、单账户/跨账户、某步因预算被丢不重新切；**只读现算接口真的一行库都不写：验收里数一次 `marketing_plans` 行数前后不变**；资格三态各一例；POST 带种子→读回非空；种子形状错→422；refine 后种子仍在；生成→保存→重读→指纹相等；种子构建失败时处方保存仍成功。
4. 第二刀起：与已批准计划 7a8bee93 对照；素材逐个**回查 Meta 侧还在不在**（已知缺口：本地 approved+推广期≠Meta 没下架）。

## 11. 工作量（子牙估 10–13 天；本稿采纳）
| 刀 | 内容 | 估 |
|---|---|---|
| 第零刀 | 只读探针（已做，结果见 §12） | 0.5 天（完成） |
| 前置小改 | `coverageProblem` undefined 分支；`owned_account_ids` 必传 | 0.5 天 |
| 第一刀 | `buildPlanSeed`（账户资格三态含 `promote_pages` 适配器 + 日预算）+ `plan_seed` 独立 zod + `ad_plays` + 三处写入点（含 refine）+ 422 + 只读现算接口 + 审阅页两个面（新组件文件） + 失败隔离/超时 | 4–5 天 |
| 第二刀 | 受众（2822 形状、硬过滤、三态）/ 素材（五态）/ 排除名单 / Meta 侧素材回查 | 2.5–3.5 天 |
| 第三刀 | 映射 + 规范形指纹 + 幂等/人改/人删 + 共享校验函数 + preview/write + jsonb 合并；（先决：plan-pick 小刀） | 3–4 天 |
| 第四刀 | 计划页按钮 + preview 展示 + 并存提示 + 验收 | 1–1.5 天 |
**风险**：两套钱口径并存（`budget_percent` vs 日预算）本版不对账；`ad_plays` 若被评审否决需另开字段；资格是“读数判断（必要条件）”，**真能不能建只有建了才知道**（见 §12 的发现）。

## 11.1 第一刀开写前卡的三件事实（子牙）+ 必须一起落的两件
1. **`promote_pages` 用哪把令牌读、读出来什么** → ✅ 已做（§12：令牌身份实测，三把令牌并列）。结论：第一刀 `promote_pages` 只做 Basis + warning。
2. **“未知→丢步骤”会不会在第一刀直接产出零条** → 第一刀的资格判据不再依赖 `promote_pages`，只依赖（运行时令牌 + 必需 scope + ≥1 个 ACTIVE 表单 + 账户状态 + 币种），§12 读数下这些都满足（11 个表单、v6.1 ACTIVE、scope 齐全），所以不会因判据本身产出零条；“读成功且空 / 读失败”两态样本仍缺（台账卡跟踪，不挡第一刀）。
3. **预算两处互相抵消先各选一条写法** → ✅ 已定（§3 预算：构建器自写 `splitBudget` 与 Basis；生成批次不走 `committed_*`，它只装人工已有步骤）。
**第一刀 PR 必须一起落**：① 种子里的 `page_id`（+Basis）；② `parseSeed` 对 `ad_plays` 的校验（422）。
**范围外但要开卡**：`snapshot.ts:273` 是 `approximate_count_lower_bound ?? null`，-1 原样入库；而 `d4-unharvested-audience.ts:76` 的 isSmall 用 `<= D4_AUDIENCE_FLOOR`、`d11-audience-pool-starved.ts:46` 用 `<= floor` 跳过——**现有 D4/D11 诊断可能对“Meta 不报人数”的受众误报**（台账卡已开）。

## 12.1 开工前只读读数（2026-10-26，CTS，只读；未写任何东西）
1. **会生成几步、落哪几个账户**：取决于 `ad_plays`。处方 89cb61eb 是“一个系列、两组人群（A 新客 + B 老客户）”→ 两类打法；资格读数下两个账户都“可投”，N 可能是 1 或 2——**公式按 N 参数化，不在纸上定 N**（§3 示例给了 N=1/N=2）。
2. **预算读数**：客户日上限 **15000 分（$150）**；账户 7274 上限 **10000**、0470 上限 **3000**；剧本 `draftBudgetShareOfHeadroom=0.5`、`draftMaxCreatives=3`；近 30 天逐日都读到（7274 15 天、0470 6 天），账户状态 1。现有 `draftAdsStep` 单步建议：7274 → **5000**、0470 → **750**（贴近上限被减半）。⚠️ **事实层陈旧**：两个账户“在投合计”读数都是 **0**，快照 as_of 是 **2026-10-25 12:31Z**，而 7274 上 10-26 晚已有一条 $50/天的广告在投——`loadAdsDraftFacts` 吃最多 2 天前的快照，**会把余量高估**；构建器必须在 Basis 里打出快照 as_of，快照老于 24 小时时给 notes（本版不改取数层）。
3. **历史计划里 `targeting` 的存法**：33 份计划、5 个广告步骤，**0 个带 `targeting` 键**（无 null/undefined/对象）→ 指纹修法不需要兼容旧数据。**查询口径（将来有人加了 targeting，这个结论即作废）**：只读扫 `marketing_plans` 全表（无过滤，33 行）的 `plan_data`；对每一份取 `plan_data.promo.phases[].steps[]` 里 `kind==='ads_campaign'` 的步骤，用 `Object.prototype.hasOwnProperty.call(step.settings,'targeting')` 判“带 `targeting` 键”，再区分值是 `null/undefined` 还是对象。日期 2026-10-26，本机一次性只读脚本，没有落库。
4. **权限不足账户上 `promote_pages`/`leadgen_forms` 的真实返回形状**：仍无样本（不挡第一刀；已开台账卡，等真撞上再补）。

## 12.2 第零刀结果（只读探针，2026-10-26，CTS，已真打 Graph；未写任何东西）
> ★★ **以下 v0.5 的结论被令牌身份实测推翻（子牙 N2），以本节“令牌身份对照”为准。**
| 探针 | 原始结果（摘录，无令牌） | 结论 |
|---|---|---|
| `act_<旧账户>/promote_pages` | 200，列出 `CTS Tours(1616575215312482)`、`Oztop…` | 旧账户可投 CTS 主页 |
| `act_<官方账户>/promote_pages` | **200，同样列出 `CTS Tours(1616575215312482)`**、`Roman Hu Real Estate` | ⚠️ **与“官方账户缺主页权限不能投表单”的运营说法不一致**：该边**读不出这个缺口** |
| 客户令牌 `me/permissions` | 200，含 `leads_retrieval`、`pages_manage_ads`、`ads_management`、`pages_show_list`… 均 granted | 权限三样齐全 |
| 页令牌 `me/permissions` | 400「Tried accessing nonexisting field (permissions)」 | 该边对页令牌不可用（要用客户令牌读） |
| `fetchPageLeadForms(CTS 主页)` | 11 个表单；v6.1 `1419397053495913` ACTIVE；v6 `861321827044055` ACTIVE… | 表单可读且有在用表单 |
| 两个账户 `customaudiences?limit=200` | 各 8 条，**`paging.next` 不存在**（只有 `cursors`）——**仅是 8 条样本上的结论，不是通则（待复核）** | 本次样本读全；“有无下一页”可用 `data.length<limit` 判断，但列表边本身会漏项（见下两行） |
### ★ 令牌身份对照（2026-10-26 只读，三把令牌各读一遍；不打印令牌值）
| 令牌 | 官方账户 `promote_pages` | 旧账户 `promote_pages` | `/me/accounts` |
|---|---|---|---|
| ① 系统身份长期钥匙（`META_SYSTEM_USER_TOKEN`） | **只有 Roman Hu Real Estate**，CTS Tours 不在 | **403**「Ad account owner has NOT grant ads_management or ads_read permission」 | 6 个主页（East Inter / NM Medspa / NewAsian Logistics / NZ China Products Expo / Oztop / Roman），**无 CTS Tours** |
| ② 客户令牌 = ③ **构建器运行时实际拿到的**（`resolveMetaTokenForClient`，`source=client_domain`；两者字符串与 ① 不同） | **CTS Tours + Roman** | **CTS Tours + Oztop** | 7 个主页，**含 CTS Tours** |
**如何解释 2026-10-09 那条相反记录**（docs/clients/cts/2026-10-09-shanghai-ads-paused-build.md §5：用“公司长期钥匙”读官方账户只返回 Roman、CTS 不在）：**它和今天的读数一致**——那条用的就是 ①；今天 ② 的读数是另一把令牌看到的世界。所以这不是“运营说法与读数不一致”，而是**两把钥匙看到的世界不一样**，PM 的说法（官方账户缺主页权限）对**系统身份视角**成立；而 ME 实际建广告走的是 ②/③（`meta-ads/draft` 用 `getMetaTokenForClient`），它在**旧账户**已被真建广告证明可用，在**官方账户**还没真建过。该文档同时点名 `leadgen_tos_accepted=false` 是“令牌身份视角问题，已踩过三次”——**不要用这个字段做资格判据**。
**这条结论的设计后果**：`promote_pages` 本身就是令牌身份的函数，**不能把它当硬必要条件**（与受众“列表边会漏项、不能用‘不在列表里’当否定判据”是同一类推理）——第一刀降成 Basis 展示 + warning（§3）。

**（v0.5 原结论，已被上面推翻，留作对照）**`promote_pages` 是“必要条件”，**不能单独证明“能建表单广告”**；官方账户那条缺口**系统读不出来**，不得写死“官方账户不能投”——构建器按读数判为“可投”，**preview 里标注“资格为读数判断，未实际建过”**，真建时 Meta 报错会如实回流。运营说法与读数不一致这件事需要 74/PM 知道（可能是该账户另一层权限/业务验证，不在这些边上）。
| 旧账户 `customaudiences?limit=200` vs 广告 MCP | 列表边 8 条 vs MCP 12 条；缺的 4 条（相似受众 NZ 1%）按 id 直读 200 且 `account_id` 正确；某相似受众 `approximate_count_lower_bound=-1` | ⚠️ 列表边会漏项；“不在列表=不属于本账户”是错判据；count≤0=不报 |
| 官方账户 `customaudiences?limit=200` vs MCP | 列表边 8 条 vs MCP 11 条；缺的 3 条同类原因**未穷尽、未逐条核实** | 同上 |
**仍未核实**：`landPrescription` 副作用未逐行核；权限不足时 `promote_pages` 是返回空数组还是报错**没有对照样本**（本次读到的都是成功且非空，三态里“读成功且空/读失败”两态尚无真实样本，需在权限不足的账户上补一次）。

## 13. Reuse Statement
复用：`draftAdsStep`（只覆盖日预算/受众/素材三字段）/`Suggestion<T>`/`loadAdsDraftFacts`（读一次）/`computeLaunchHeadroom`/`checkAdsBudget`、promo_v1 spec（含 2822 的 `targeting`）与 `parsePromoSpec`、`stableStringify`、`loadOwnedAccounts`、`fetchPageLeadForms`、`getStoredPageToken`、meta-oauth scope 清单、`PhaseInitiativeSeed`（扩展）、`loadPublishedProducts`（行业钩子，将来）。新增（平台共享）：`plan_seed`/`ad_plays` 协议、`buildPlanSeed` 编排与新逻辑（账户资格三态、`promote_pages` 适配器、预算拆分公式、排除受众落点）、规范形指纹比对、只读现算接口。行业/客户特定：无（CTS 仅作验收样本）；班次核对移入行业 Playbook 钩子。无客户名进共享代码。

## 14. 审查意见对照（v0.5 子牙；v0.4 魏征见上一版）
M1→§1.1/§3 排除受众落 `targeting.excluded_audience_refs`；M2→§3 audience（targeting 形状，禁散文）；M3→§2/§8 单阶段；M4+待核③→§3 账户/§1.8-9/§12（三样可读事实 + 探针）；M5→§3/§8 不用 `hidden_from_ad_health`；M6→§2（扩展 `PhaseInitiativeSeed`，入口分开写）；M7→§0/§3 预算（删各占几成、等分公式、basis 署名）；M8+待核②→§1.7/§3（移出主干、`loadPublishedProducts`）；M9→§4/§10（只读现算接口）；M10→§3 末（失败隔离、读一次、超时）。S1→§1.11/§6；S2→§5；S3→§2/§3 素材；S4→§3 素材五态；S5→§1.3；S6→§1.6/§4；S7→§9。待核①→§1.1（zod 默认 strip）。口径①→§2（独立版本化 zod）；口径②→§0；口径③→§2/§11（两套钱口径）；口径④→§6.3（plan-pick）。

## 15. 后续刀（总控 Raybot 2026-10-26 补充，对照 #3195 / main 7f0fd588）
> 来源：总控对 #3195 的只读梳理，转述入稿；**#3195 的具体行为本分支未重新核对**（本分支基于 0ee8abd，落后该提交），开工前每条先对当前 main 复核。本节**不改动 §0–§14 的定稿结论**，只规定“第一刀之后”怎么拆。边界不变：不开投、不花钱、不改 Meta、不改生产数据。

### 15.1 现状缺口（总控报告）与处置
1. **#3195 的 plan-seed 只算出主页、广告账户、日预算 3 项**；受众、素材、写入计划、页面入口都没做 → 分别对应本稿第二～第四刀（§11），不新增并行路线。
2. **处方没填 `ad_plays` 时 seed 什么都算不出来**（禁止从摘要文字抠数字，§0 禁令①不变）。**定：两条都要，但真相源只有一个**——
   - 新处方由华佗入口（LLM）/ 人工入口写入 `initiative_seed.ad_plays`，仍是**唯一存下来的真相**（§2）；
   - 只读现算接口**可选**接受一份 `ad_plays` 试算参数，**必须过与 `parseSeed` 同一个校验函数**（形状错 422）；响应与页面固定标「试算，未存入处方」，**不落库、不替代处方里的 `ad_plays`**。这样已批准的老处方（如 89cb61eb）也能看到现算结果，又不会长出第二个真相。
3. **现有计划结构装不下多受众**：受众是一段文字，每个广告步骤只放一个受众 id，多受众的组整组丢失；表单 id 混在文字里 → 见 15.2「受众」「落地」两行。**与 §3/§8 的关系**：第二刀仍是“一步一受众、单阶段”，多受众是**第二刀之后**的扩展，不挤进第二刀。

### 15.2 要补的字段（全部可选 JSON，放 `plan_data.promo` / `generation_meta`；不加迁移、不设默认值）
“不设默认值”的原因同 2822 注释：给可选字段加 `.default()`，已批准计划的规范形和指纹会一起变（§5 `spec_schema_version`）。**每个新字段上线时都按 §5 的“键在、值 undefined”夹具测一遍指纹往返。**

| 类 | 字段 | 备注 / 与既有设计的关系 |
|---|---|---|
| 受众 | 组名、每步打法、多个包含受众、Advantage+ 开关、相似扩展开关 | 相似扩展/Advantage+ **会改变触达范围和花费**，默认一律“关/未设”，写入须带出处；与 3190（OPEN Draft）Codex P1 的扩量开关复核对齐，**3190 未定稿前不定字段名**。`excluded_audience_refs` 仍走 §3 现有落点 |
| 预算 | CBO 还是组预算、系列日预算、每组最低/最高、计划上限、加预算规则 | **第一刀的 `splitBudget` 只覆盖“组预算、无 CBO”**；CBO/每组上下限是新口径，进来时 `splitBudget` 要扩展并重写 Basis。上限和节奏**实时读**（`goal-pace.ts`），不存快照值 |
| 素材 | 文案出处、`music_id`、CTA、首评文字、URL tags | **素材必须在素材池里**（沿用 §3 五态判定）；文案出处走客户数据红线（官网可溯 / brief 可溯 / 未证实） |
| 落地 | 即时表单 id 与版本 | `AdDraft.leadFormId` 已有；从受众字段文字里拆出来独立存 |
| 排期里程碑 | 素材就绪 → 建好暂停 → 送审 → 开投 → 24/48 小时检查 → 第 7/14 天复盘 | **凡是花钱、发布、改 Meta 的步骤都标「需 Ray 授权」**；里程碑只是计划数据，不触发任何动作（§8 不变）；属跨步骤异步接力，实现时按 CLAUDE.md §3 接 Inngest（事件名业务可读 + receipt） |
| 规则倍数 | 进平台打法库（Playbook），标「未验证默认值」 | 与 `draftBudgetShareOfHeadroom` 同类（`evidence:'unvalidated_default'`），不写进 shared runtime 常量 |
| 负责人 | `sales_handover`、`contacts.assigned_to` | 只读引用；缺失 → 进“未生成清单”并下发人工任务（what / how / href 三件套），不静默留空 |

### 15.3 目前只能在对话框做、需要后台入口的（按刀拆分）
| 刀 | 内容 | 风险级 / 合并 |
|---|---|---|
| 第五刀 | **第 7/14 天复盘面板**（只读，读 `ad_entity_snapshots` 与既有 outcome）；**配乐签字记在视频工单上**（视频仍只走工厂 `src/lib/factory/`，不绕开） | B；检查全绿自动合 |
| 第六刀 | **每 2 小时只记录快照**（复用 `ad_entity_snapshots`，只写快照、不改 Meta）。⚠️ 现状 `ad-entity-snapshot` 每 6 小时（§3），改 2 小时＝改 `render.yaml` 调度；它**同时是 §3「快照过期闸」12 小时阈值的依据**——节奏变了，阈值要在同一个 PR 里重算。**当场试跑**必做：手动触发一轮，贴抓取行数与 `ad_snapshot_captures` 最新时间 | B（只写快照）；PR 写明调度变更 |
| 第七刀 | **排除名单上传按钮（只有 Ray 能按）**：写 Meta 受众＝外部副作用，须 Ray 授权事件 + provider receipt，fail-closed。§8 里“不上传名单”到此刀才解除 | **A；碰 Meta → 留给 Ray 亲手合** |
| 第八刀 | **AdDraft 支持 CBO / 多组 / 多受众 / 排除**（去掉单组限制，建完进现有广告审批页）；**建草稿时自动保存 readback** | **A / P0；碰 `ad-publisher`、创建 Meta 广告系列 → 留给 Ray 亲手合，agent 不得 `--admin`**。建出来仍是暂停草稿，不开投 |
| — | 多受众进计划结构（15.1-3） | 先改 `PromoSpec`（可选字段、不设默认值、指纹往返测试），在第二刀之后、第八刀之前 |

**排序**：先 15.1-2（试算接口收 `ad_plays`，是第一刀的顺手延伸，不碰 Meta）→ 第五刀 → 第六刀 → 多受众结构 → 第七/八刀。第七、八刀依赖 3190 与“多受众结构”，放最后。

### 15.4 审查与合并（对总控原话的订正）
总控写“碰 ad-publisher 的刀算 A 级 / P0，**由 Codex 审**、Ray 亲手合”。**现行规则（CLAUDE.md §2/§4，Ray 2026-10-26）已去掉 Codex 那一签**：A 级只认 **Claude Code 对当前这次提交**的签字，且碰 Meta 广告系列/预算/出价/凭证的 PR 一律留给 Ray 亲手合。第七、八刀按现行规则走；若 Ray 仍要 Codex 复核，需他明确点名，不按旧口径默认等待。

### 15.5 Reuse Statement（本节）
复用：`ad_plays`/`plan_seed` 协议、`parseSeed` 校验、`splitBudget`、`AdDraft`（含 `leadFormId`）、`ad_entity_snapshots`、`goal-pace.ts`、素材池五态、Playbook 机制。新增（平台共享）：试算参数、多受众/CBO 可选字段、里程碑结构、复盘面板。行业/客户特定：无；规则倍数进 Playbook 并标未验证；负责人只读引用。无客户名进共享代码。
## 16. 后续刀前置（第一刀审查后追加，2026-10-26；119 号窗口）

- **第二刀开工前必须先定：处方审阅页的面板显示哪一份种子**——页面现算的，还是处方里存档的 `content.plan_seed`。第一刀是有意让面板读现算（只读展示），第二刀起受众/素材会进种子，两份可能不一致，必须先选定一份并写进本节。
- **第三刀开工前必须先收敛两套「日预算」计算**：计划页的预算建议与本设计的 `splitBudget` 各算一套，口径不同；写入计划前只能留一个。
- **在投合计的实时读取**（第一刀之后单独一轮）：现在读的是最近一次抓取，抓取之后新开的广告不在内；改成对被选中的账户实时读，3 秒封顶、读不回来就回落快照并在依据里明写，6.5 小时过期闸保留（PR 3196，台账卡 2026-10-26-plan-seed-live-delivering；本节上一条 ads-facts-live-delivering-budget 卡的「第一刀不改」口径已被取代）。
- 两条 Meta 只读通道的合并，见台账卡 2026-10-26-meta-readonly-two-channels。
