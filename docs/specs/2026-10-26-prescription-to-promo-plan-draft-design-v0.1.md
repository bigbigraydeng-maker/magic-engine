# 处方 → 推广计划草稿：广告 Agent 主导 设计稿 **v0.5**（文件名沿用 v0.1 以免引用失效）

- 作者：119 号窗口　日期：2026-10-26　功能风险级：**A**（碰计划/预算数字的写入口）；本 PR 只含设计稿（纯文档）。
- 状态：**设计稿 v0.5，待子牙+魏征再审，再给 PM 看方向，审过前不写代码。**
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
2. `parseContent`（manual-prescription.ts:191-213）是**白名单**，没显式拷贝的键静默丢弃、返回 200。
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
    step_key, play: PlayKey,                           // ← intent 的落点（见下）
    ad_account_id:      { value,basis[],notes[] } | { why_empty, notes[] },
    daily_budget_cents: 同上,
    audience:  {kind:'saved', ref, ...} | {kind:'targeting', countries[], age_min?, age_max?} | {why_empty},   // ★ 对齐 2822
    excluded_audience_refs?: [...] ,                   // → settings.targeting.excluded_audience_refs
    creative_refs, placements?, paused_ranges?
  }]
}
```
- ★ **存储契约**：种子只存**快照**，读回必须过 zod；形状不符按“未知”处理；以后改 `Basis` 字段不影响旧种子含义（种子里存的是自己的版本化形状）。
- ★ **intent 落点（M6，铁律 0 Reuse Gate）**：**先尝试扩展 `PhaseInitiativeSeed`**，加可选 `ad_plays?: {step_key, play}[]`（加性字段，派生 initiatives 的逻辑忽略它）。若评审认为承载不了，逐条理由：`initiative_seed` 是**按阶段**的、`budget_percent` 语义是 Goal 总预算百分比；而 plays 是**按广告步骤**的、日预算来自“上限×余量”——**同一份处方里会出现两套钱的口径**，本版**只在审阅页并排标注，不做口径对账**（§9、§11 风险）。
- 入口分开写：**华佗 `/prescription/generate`：`ad_plays` 由 LLM 输出（zod，形状错 422）= 真 Agent 主导**；**人工 `/prescriptions/manual`：`ad_plays` 是人填的，如实标“人工填写”**。
- ★ **warnings 按字段挂**（`notes[]`），`daily===null` 时预算字段固定带 Basis「真实日花费：读不到，这个数没经过核对」。
- 一个步骤只要**账户/日预算/受众/素材**任一 `ok:false` 就**不生成**，原因进“未生成清单”（★ 素材为空是硬红，不是“允许留空”）。

## 3. 每个字段从哪取
| 字段 | 取数与规则 | 取不到 |
|---|---|---|
| `ad_account_id` | ★ **候选 = `loadOwnedAccounts`（客户名下）**；**不得用 `hidden_from_ad_health` 筛**（展示开关≠投放开关，“状态字段当授权”老坑）。★ **资格判据 = 系统读得到的三样**：该主页有可用 token（`getStoredPageToken`）+ 必需权限（`leads_retrieval`、`pages_manage_ads`，以 meta-oauth/client.ts 的 scope 清单为真相源）+ 至少一个 **ACTIVE** 表单（`fetchPageLeadForms`）。“账户↔可投主页”再加 `promote_pages`（**待建只读适配器**）。★ **三态**：读成功且非空 / 读成功且空 / **读失败或无权限（HTTP 错、令牌缺 scope、字段缺失）**——三者 why_empty 文案不同，第三态写“读不到”。★ 资格**未知 → `ok:false` 整个步骤丢掉**，不许先选账户再附 warning。★ `account_status!==1` → `ok:false`。多个都合格 → 取余量最大者并在 Basis 列出候选与各自余量 | 三态各自 why_empty |
| `daily_budget_cents` | ★ **多步骤拆分公式写死（M7）**：总额 = 余量 × 剧本标量 share；**按步骤数等分**，**事先一次算好**，不靠调用顺序（顺序扣减会得到 0.5/0.25 只用掉 0.75 余量）；`Basis.source` 写「剧本参数 ÷ 步骤数」。★ 近 30 天真实日花费读得到才会“贴近上限则减半”，**读不到就不压**并标“没经过核对”。★ 两个扣减口都累加（同账户 + 同阶段所有账户），范围=阶段内。★ **币种读不到 → 该步骤 `ok:false`**（不依赖 `checkAdsBudget` 对 unknown 的放行） | 现成 why_empty |
| `audience` | ★ **受众池读取注意（2026-10-26 实测，已写入 Meta 广告手册 §30 第 7 条）**：账户的受众列表边（`customaudiences`，含 `fetchCustomAudiences`）**会漏掉部分相似受众**——CTS 旧账户列表边只返回 8 条，而广告 MCP 读到 12 条，缺的 4 条都是「类似受众 (NZ, 1%)」，按 id 直读均 200 且 `account_id` 就是本账户。所以**“不在列表里 ≠ 不属于该账户”**；受众归属/可选性判断，列表里没有的要按 id 直读核 `account_id`（刀② 已实现 `fetchCustomAudienceById`）。官方账户列表边也只返回 8 条而 MCP 读到 11 条，缺的 3 条**同类原因、未穷尽，未逐条核实**。`approximate_count_lower_bound` 会返回 **-1/0 表示“不报”**，≤0 一律当读不到、不当“人太少”。★ 按 2822 形状：有合格已保存受众 → `audience_ref=<编号>`；没有 → **不得把中文散文塞进 `audience_ref`**，改用 `targeting={countries:['NZ'], age_min, age_max}`（`audience_ref=''`），`countries` 与 `city_keys` 不同时给。重定向类打法构建器再加**硬过滤**（子类型 + 人数 ≥ `D4_AUDIENCE_FLOOR`）；“在投仍挂着”只是排序权重，按代码写 | 三态 why_empty |
| `excluded_audience_refs` | 受众池里排除名单型自定义受众 → 写入 `settings.targeting.excluded_audience_refs`。★ **有意“仅为携带排除名单而创建 `targeting` 对象”**（targeting 是 optional，注释禁 default，所以只在有排除名单时才创建，不能给每个步骤都塞空对象）。47 人名单本身的上传不在本功能（要 PM 授权） | 留空+原因 |
| `creative_refs` | `creative_pool` approved；`promoVerdict` 五态逐个：ok→可用；**undeclared（最常见）**→不可用并写「素材没声明推广期」；not_started/expired/expires_before_use_end→各自原因。★ 结果为空 → 整步骤进“未生成清单”（素材空是硬红，PM 批不了） | 五态汇总 |
| 起止日 | 目标周期 ∩ 今天之后；**单阶段** | 无周期→整个种子不产出 |
| ~~班次核对~~ | ★ **移出主干**：旅游语义，将来走行业 Playbook 可选钩子，经 `loadPublishedProducts(db, clientId, today)`（catch `PublishedUnreadableError` → “未知”） | — |
★ **事实读一次、复用（M10）**：构建器每次只调一次 `loadAdsDraftFacts`，facts 按账户缓存、`committed` 在内存递减；**`owned_account_ids` 必传**，并把 `coverageProblem` 的 `undefined` 分支改为“按读不全处理”（前置小改）。★ **失败隔离**：种子构建**任何一环失败只落 why_empty，绝不让处方保存失败**；给整体耗时上限（建议 8 秒，超时→未完成的步骤 why_empty「取数超时」）；不在处方保存请求里做 Meta 实时读取以外的重活（资格探测并发+超时）。

## 4. 谁在什么时候产出种子
- 两个处方写入口都产（华佗 LLM intent / 人工人填 intent），**加上 refine 路由必须保留已有种子**（refine 整份重写 content）。只在目标是广告类时产出。
- `parseContent` 显式保留 `plan_seed` 与 `initiative_seed.ad_plays`；形状不对 **422**，不静默降级；回归测试：POST 带种子 → **读回断言种子非空**。
- ★ **种子只在写处方时产出，已批准的 89cb61eb 没有种子**。第一刀验收（M9）选**前者**：新增**只读的「按目标现算一次种子」接口**（纯计算不写库，性质同现有 `POST …/promo/draft`，按 CLAUDE.md §3 例外不需要 Inngest）——PM 打开审阅页/计划页即可看到按当前事实现算的种子；写入处方时同一函数再存一份快照。

## 5. 触发、两档、指纹
- 计划页「按处方起草」：先 **preview**（任意状态处方可读、纯计算），PM 点“写入”才 **write**（只认 approved）；write 与 `PUT /promo` 共用同一个校验函数；单测“生成的草稿必须能被 PUT 原样接受”；映射后整份 `PromoSpec` 先过 `parsePromoSpec` 才写。
- ★ **指纹一律算在 `parsePromoSpec` 返回的规范形上**，用 `stableStringify`（构建器“不写”的可选字段 parse 后变 `[]`，按原始对象算会永远对不上、判成“人改过”、永不覆盖且无报错）。测试：生成→保存→重读→重算，指纹相等。“人改完又改回去”= 视为未改（故意，页面说明里写明）。
- 带状态过滤的新读取变体（只取 approved，提示有更高版本草稿）。

## 6. 幂等、改版、人改保留
1. `generation_meta.from_prescription` 存 `marketing_plans.generation_meta`（jsonb 合并只写这一个键 + `updated_at` 乐观锁，不入指纹，S1）。
2. 同版本再点：只覆盖“仍等于上次生成值（规范形指纹）”的步骤；人改的保留并列出；首次遇同 id 手填步骤视为人改；人删的不复活。
3. ★ **改版草稿会顶掉已批准计划（`pickPlanForPrescription`）**：仅“页面提示并存”不够。**需要决定这个顺序变化是不是想要的**——建议在第三刀之前先做一个小刀“plan-pick 改 approved 优先”（更新被测试锁住的行为），否则不发布“改版草稿”功能。**待 74/PM 拍板。**
4. Agent 不覆盖人；并发验收：两份草稿并存时“按处方起草”写哪份取决于创建时间——验收真跑一次看提示说不说得清。

## 7. 与周边的边界
3010 v0.7：写的是（将来 ads-only 指纹里的）广告字段，不写回执/`gate_snapshot`，草稿≠授权；2999：（OPEN 设计稿）起草余量来自 headroom，真闸在激活入口；★ **2822（已合并）**：本稿形状已按合并后重写；刀②（3190，OPEN Draft）：种子的 `excluded_audience_refs` 将来可喂 `AdDraft.excludedAudienceIds`；3143/3150/3156/3144：只读显示不变、批准处方无副作用。

## 8. 不做
不自动批准计划；不自动建 Meta 对象；不碰钱（不改 `ad_strategy_configs`）；不解析 summary；LLM 不输出数字事实；不上传名单；本版只做 `ads_campaign` 且**单阶段**；不用 `hidden_from_ad_health`/人填资格列当投放判据；不加迁移；★ **批准处方不写任何预算授权痕迹**；不改 content-hash.ts。

## 9. 处方审阅页（两个面）
★ **两个面**：(a) `prescription/new/page.tsx`（**1882 行，已超 800 行上限，新渲染必须另开组件文件**，不往里加）；(b) promo-plan 页的处方卡（走 `toGoalPrescriptionView` + `prescription-copy.ts`，`GoalPrescriptionView` 要扩字段）——块 B 两个都算。渲染：账户名+币种+日预算+起止+每字段依据或留空原因；并排标注两套钱口径（`budget_percent` = Goal 总预算百分比 vs 日预算 = 上限×余量，不对账）；显式标注「**这些数字只是 Agent 的建议，批准这份处方不等于批准花这些钱**」（10-19 反向事故）。

## 10. 验收链（第一刀切薄）
**第零刀（只读探针，已做，§12）**→ **第一刀只做 `ad_account_id` + `daily_budget_cents` 两个字段**，不写计划步骤。
1. 第一刀上线后，**只读接口**对 CTS 目标现算种子，PM 在页面看到：账户/日预算由 Agent 填好、每字段带依据或留空原因。
2. ★ **只读 SQL 对照**：打出 `ad_strategy_configs.daily_budget_cap_cents`、各账户在投合计，与页面数字逐项对齐，贴进 PR「当场试跑」。
3. 必测：多账户多步骤（含币种读不到→`ok:false`）；`daily===null`→“没经过核对”；资格三态各一例；POST 带种子→读回非空；种子形状错→422；refine 后种子仍在；生成→保存→重读→指纹相等；种子构建失败时处方保存仍成功。
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

## 12. 第零刀结果（只读探针，2026-10-26，CTS，已真打 Graph；未写任何东西）
| 探针 | 原始结果（摘录，无令牌） | 结论 |
|---|---|---|
| `act_<旧账户>/promote_pages` | 200，列出 `CTS Tours(1616575215312482)`、`Oztop…` | 旧账户可投 CTS 主页 |
| `act_<官方账户>/promote_pages` | **200，同样列出 `CTS Tours(1616575215312482)`**、`Roman Hu Real Estate` | ⚠️ **与“官方账户缺主页权限不能投表单”的运营说法不一致**：该边**读不出这个缺口** |
| 客户令牌 `me/permissions` | 200，含 `leads_retrieval`、`pages_manage_ads`、`ads_management`、`pages_show_list`… 均 granted | 权限三样齐全 |
| 页令牌 `me/permissions` | 400「Tried accessing nonexisting field (permissions)」 | 该边对页令牌不可用（要用客户令牌读） |
| `fetchPageLeadForms(CTS 主页)` | 11 个表单；v6.1 `1419397053495913` ACTIVE；v6 `861321827044055` ACTIVE… | 表单可读且有在用表单 |
| 两个账户 `customaudiences?limit=200` | 各 8 条，**`paging.next` 不存在**（只有 `cursors`）——**仅是 8 条样本上的结论，不是通则（待复核）** | 本次样本读全；“有无下一页”可用 `data.length<limit` 判断，但列表边本身会漏项（见下两行） |
**由此得出的设计结论**：`promote_pages` 是“必要条件”，**不能单独证明“能建表单广告”**；官方账户那条缺口**系统读不出来**，不得写死“官方账户不能投”——构建器按读数判为“可投”，**preview 里标注“资格为读数判断，未实际建过”**，真建时 Meta 报错会如实回流。运营说法与读数不一致这件事需要 74/PM 知道（可能是该账户另一层权限/业务验证，不在这些边上）。
| 旧账户 `customaudiences?limit=200` vs 广告 MCP | 列表边 8 条 vs MCP 12 条；缺的 4 条（相似受众 NZ 1%）按 id 直读 200 且 `account_id` 正确；某相似受众 `approximate_count_lower_bound=-1` | ⚠️ 列表边会漏项；“不在列表=不属于本账户”是错判据；count≤0=不报 |
| 官方账户 `customaudiences?limit=200` vs MCP | 列表边 8 条 vs MCP 11 条；缺的 3 条同类原因**未穷尽、未逐条核实** | 同上 |
**仍未核实**：`landPrescription` 副作用未逐行核；权限不足时 `promote_pages` 是返回空数组还是报错**没有对照样本**（本次读到的都是成功且非空，三态里“读成功且空/读失败”两态尚无真实样本，需在权限不足的账户上补一次）。

## 13. Reuse Statement
复用：`draftAdsStep`（只覆盖日预算/受众/素材三字段）/`Suggestion<T>`/`loadAdsDraftFacts`（读一次）/`computeLaunchHeadroom`/`checkAdsBudget`、promo_v1 spec（含 2822 的 `targeting`）与 `parsePromoSpec`、`stableStringify`、`loadOwnedAccounts`、`fetchPageLeadForms`、`getStoredPageToken`、meta-oauth scope 清单、`PhaseInitiativeSeed`（扩展）、`loadPublishedProducts`（行业钩子，将来）。新增（平台共享）：`plan_seed`/`ad_plays` 协议、`buildPlanSeed` 编排与新逻辑（账户资格三态、`promote_pages` 适配器、预算拆分公式、排除受众落点）、规范形指纹比对、只读现算接口。行业/客户特定：无（CTS 仅作验收样本）；班次核对移入行业 Playbook 钩子。无客户名进共享代码。

## 14. 审查意见对照（v0.5 子牙；v0.4 魏征见上一版）
M1→§1.1/§3 排除受众落 `targeting.excluded_audience_refs`；M2→§3 audience（targeting 形状，禁散文）；M3→§2/§8 单阶段；M4+待核③→§3 账户/§1.8-9/§12（三样可读事实 + 探针）；M5→§3/§8 不用 `hidden_from_ad_health`；M6→§2（扩展 `PhaseInitiativeSeed`，入口分开写）；M7→§0/§3 预算（删各占几成、等分公式、basis 署名）；M8+待核②→§1.7/§3（移出主干、`loadPublishedProducts`）；M9→§4/§10（只读现算接口）；M10→§3 末（失败隔离、读一次、超时）。S1→§1.11/§6；S2→§5；S3→§2/§3 素材；S4→§3 素材五态；S5→§1.3；S6→§1.6/§4；S7→§9。待核①→§1.1（zod 默认 strip）。口径①→§2（独立版本化 zod）；口径②→§0；口径③→§2/§11（两套钱口径）；口径④→§6.3（plan-pick）。

## 15. 后续刀前置（第一刀审查后追加，2026-10-26）

- **第二刀开工前必须先定：处方审阅页的面板显示哪一份种子**——页面现算的，还是处方里存档的 `content.plan_seed`。第一刀是有意让面板读现算（只读展示），第二刀起受众/素材会进种子，两份可能不一致，必须先选定一份并写进本节。
- **第三刀开工前必须先收敛两套「日预算」计算**：计划页的预算建议与本设计的 `splitBudget` 各算一套，口径不同；写入计划前只能留一个。
- **在投合计的实时读取**（第一刀之后单独一轮）：现在读的是最近一次抓取，抓取之后新开的广告不在内；改成对被选中的账户实时读，8 秒内读不回来就回落快照并在依据里明写，6.5 小时过期闸保留。见台账卡 2026-10-26-ads-facts-live-delivering-budget。
- 两条 Meta 只读通道的合并，见台账卡 2026-10-26-meta-readonly-two-channels。
