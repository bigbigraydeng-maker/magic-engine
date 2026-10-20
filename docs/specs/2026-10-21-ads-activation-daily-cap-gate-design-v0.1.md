# 「开投/启用」那一步的日预算上限检查 · 设计 v0.1 · 只设计，未写代码 · 119 号 · 2026-10-21

> 来源：74 号认领的 A 级台账卡 `2026-10-21-ads-launch-step-has-no-daily-cap-check`（122 查出）：ME 内「开投/启用」那一步只有 PM 身份 + 授权回执，没有日预算上限检查。要求评估「把启用纳入内核动作 + 信封日上限检查」，并在手建广告登记入口（PR 2990）加「登记时读 Meta 现在投合计、超上限出待办」。
> 风险级：**A**（碰钱：启用 = 开始花钱；改内核 / 改开投路径）。设计阶段需子牙+魏征复审；排在 PR-2.0 之后；**本稿不改代码**。

## 0. 先说结论

1. **不建议新增内核动作 + 新信封。** 检查「在投合计 + 新开 ≤ 客户日上限」所需的**纯函数早就写好了**：`src/lib/ads-strategy/launch-budget-headroom.ts` 的 `computeLaunchHeadroom`——它文件头写的就是这个缺口：「建系列/激活这一步不经过 Kernel（接口直建、PM 说开后才激活），没有任何代码在替执行方算加了这个新系列后合计会不会超客户总上限」。它**现在只被推广计划草稿那一步用**（`marketing-plan/promo/draft-ads.ts`），**启用那一步没调**。缺口不是缺能力，是缺接线。
2. **推荐做法（最小）**：在三个「会让花费变多」的入口各调一次这个现成函数，**读不全 / 超上限一律拒绝（fail closed）**：①`approveDraft`（`draft-and-gate.ts`）②`meta-ads/execute` 的 `ads.reactivate_campaign` ③手建广告的登记入口（PR 2990，超了**不阻断、出待办**，因为广告已经存在）。再加一个每日只读审计兜底「绕过 ME 手建」的情形。
3. **为什么不进内核（说清取舍）**：内核的 AI 信封（学习期排除、72 小时冷却、变动幅度 20% 等）是为「AI 反复折腾」设计的，拿它拦**PM 本人启用**会像 10-06 那次「人工止损 100% 拧不动」一样误伤（`autonomy-envelope.ts` 注释里有生产数据）；而启用本来就有**只有 PM 本人**的身份闸和 `ads.spend_activation_receipt.v1` 回执（`ads/spend-activation.ts`）。新增内核动作还得新增第三类信封，是这几天我们刚决定要瘦身的那种「再加一层」。用现成纯函数 + 现成 PM 授权，**效果等价、改动小得多**。若以后启用路径变多（自治启用），再重评内核化。

## 1. 现状（读代码核实）

| 入口 | 谁能操作 | 现在检查什么 | 缺什么 |
|---|---|---|---|
| `approveDraft`（草稿「批准」→ 激活三层） | PM（`requireSpendActivationAuthority`，ADMIN_EMAILS 精确名单） | 草案状态、种类白名单、占位幂等、授权回执 | **没有日上限检查** |
| `meta-ads/execute` · `ads.reactivate_campaign` | PM（同上） | 归属校验、信使草稿拦截、授权回执 | **没有日上限检查** |
| Meta 后台 / Meta MCP 手建 | 任何有权限的人 | ME 看不到，建完才被快照读到 | 完全不经 ME |
| 内核 `ads.*`（加预算/新开再营销组） | AI/PM | `isWithinEnvelope` 含客户日上限硬拦（`clientAfter > clientCap` → 拒） | 只覆盖内核动作，不含上面三条 |
- 另有熔断判据 #2（`detectClientSpendOverCap`）按**实际花费**事后判超上限，是滞后的；本稿补的是按**设定预算**事前判的（领先的）。

## 2. 设计

### 2.1 一个共用函数 `assertLaunchFitsDailyCap`（放 `src/lib/ads-strategy/`，平台通用，客户无关）
```
assertLaunchFitsDailyCap({ clientId, committed: CommittedIncrease[], mode: 'block' | 'warn' })
  → { ok: true, headroom } | { ok: false, code: 'cap_unreadable' | 'cap_exceeded' | 'data_stale', reason, headroom? }
```
内部步骤：
1. **取数要新鲜**：启用是低频、花钱的动作，可以多花几秒——先对该客户已登记账户做一次**同步快照抓取**（复用 `portfolio/snapshot-sync.ts` 的 `captureClientSnapshots`，`capture_reason` 取现有的 `kernel_pre` 同类），再读这一轮的行；`ad_snapshot_captures.complete=false`、`skipped_shared=true` 的层级、或抓取失败 → `cap_unreadable`（拒绝，不用旧快照凑数）。
2. 读客户日上限：`ad_strategy_configs.daily_budget_cap_cents`（用 `loadAdStrategyConfigWithSource`，`source==='fallback'` → `cap_unreadable`）。
3. 调 `computeLaunchHeadroom({ rows, capMinor, committed })`（现成纯函数：CBO/ABO 口径、`DELIVERING_STATUSES`、币种混杂拒绝、在投单位读不到预算拒绝、`disappeared` 不计）。`ok:false` → `cap_unreadable`；`fits:false` → `cap_exceeded`。
4. `committed` = 这次要打开的东西的设定日预算：`approveDraft` 取草案的 `dailyBudget`（元→最小货币单位，注意 `Math.round(x*100)`，与 `ad-publisher` 一致）；`reactivate` 取该系列（或其下广告组）的当前设定日预算（读 Meta 实时值）。**被打开的这条在快照里是「暂停/潜在」，不要重复计入**（函数已把潜在预算单独返回，只把 `committed` 加到在投合计上）。
5. **上限口径**：用**客户总上限的硬值，不套内核信封的 20% 缓冲**（`autonomy-envelope.ts` 对客户跨账户合计同样是硬拦、不留缓冲）。PM 若要缓冲，是 PM 的决定，不是这里默认放宽。

### 2.2 三处接线
- **`approveDraft`**：在「占位（claim）」**之前**调用 `assertLaunchFitsDailyCap(mode:'block')`；失败返回 `{ ok:false, error: <中文原因> }`，**不占位、不调 Meta**。回执里记 `headroom` 结果（在投合计/新开/上限/余量）。
- **`meta-ads/execute` · reactivate**：在 `requireSpendActivationAuthority` 通过之后、调 Meta 之前，同样 `block`；HTTP 422（`cap_exceeded`）或 503（`cap_unreadable`），响应带中文说明与余量数字。
- **手建广告登记入口（PR 2990 的 `register`）**：登记完成后调一次 `mode:'warn'`（`committed=[]`，因为广告已在投，计入在投合计）；超上限或读不全 → **不阻断登记**，出一条今日待办（what：现在在投设定日预算合计 X，超过客户日上限 Y；how：去 Meta 暂停某些广告组或调低；href：广告健康页）。登记入口不是闸，只是补一次检查。
- 超上限但已在投的情形，**减少花费的动作永远放行**（暂停/降预算不经过这个函数）。

### 2.3 兜底：每日只读审计（覆盖「绕过 ME 手建」）
- 放在现有「巡检」一侧（每日诊断），用同一个纯函数对**最新完整快照**算 `committed=[]` 的在投合计；`> 上限` → 红待办；读不全 → 黄待办（不是绿）。**只读，不动广告。** 与熔断 #2 的区别：熔断看昨天实际花了多少，这条看今天设定的预算合计。
- 为什么需要：74 号自己守着「在投合计 ≤ 150」是人工纪律，不是机制；这条审计让纪律有机器兜底，也能发现别人在 Meta 后台手建/手调。

## 3. 边界与风险

- **快照新鲜度**是这个设计最容易出错的点：用旧快照算合计，刚手建的广告读不到 → 余量被高估 → 误放行。所以 2.1 第 1 步要求同步抓取并核 `complete`，抓不到就拒绝。这会让启用多花几秒、且依赖 Meta 读取可用；读取故障时启用被拦——方向安全，但要在响应里说清楚「读不到，不是超了」。
- **共用账户**：`skipped_shared` 的账户不写广告层快照，预算合计读不到 → 按 `cap_unreadable` 拒绝（符合现有「读不全一律拒绝」）。若某客户确有共用账户，需要另议（不在本稿）。
- **币种**：`computeLaunchHeadroom` 已拒绝币种混杂；客户上限的币种以账户币种为准（`daily-cap` 入口已有币种一致检查）。
- **CBO 与 ABO 混用**：沿用函数的口径；**口径一致性风险**：函数文件头明确说它与 `envelope-facts.ts`、`diagnostics/context.ts` 三处口径「没有自动对账」，改任一处要同步另两处——本设计不动口径，只增加调用点，并要求新增一条测试，对同一组夹具三处结果一致。
- **不含**：不新增内核动作与信封；不改自治加预算（已有硬拦）；不碰 `daily-cap` 入口；不处理「Meta 自己的账户总限额」。
- **待 PM 决定（不替定）**：超上限时是否允许 PM 本人「明知超限仍启用」（带原因的覆盖）。默认**不允许**（硬拦）；允许覆盖会新增一个需要审计的口子，建议先不做。

## 4. 验证计划
- 单测：对 `assertLaunchFitsDailyCap` 的每种拒绝（读不全/快照不完整/配置回落/币种混杂/超上限）各一个应拒用例，变异（去掉某条拒绝，对应用例必须变红）；「被打开的这条不重复计入」用例；CBO/ABO 夹具；`block` 与 `warn` 两种模式。
- 接线测试：`approveDraft` 超上限时不占位、不调 Meta；`reactivate` 超上限返回 422 且不调 Meta；登记入口超上限只出待办、仍写关联行。
- 当场试跑（只读）：对 CTS 现状跑一次 `warn` 模式，应得到「在投合计约 134（≤150），余量 16」这类结果（以实时读为准），并核对与 74 号手算的一致。
- 审计待办：造一个超上限夹具，每日审计必须出红待办。
- 审：子牙+魏征设计审、实施后再审；碰钱加狄仁杰攻击验证（绕过 PM 身份、读不全时放行、双重计入）。A 级 PR 草稿，PM 回「合 N」才合。

## 5. 与现有计划的关系
- 不新增表、不新增合同、不新增内核动作。接线点：`draft-and-gate.ts`、`meta-ads/execute/route.ts`、PR 2990 的登记入口、每日审计。
- 排期：**PR-2.0（补链）之后**；与推广期扫描（PR-2）互不依赖，可并行。

## 6. 未核实
- `approveDraft` 与 `reactivate` 里「被打开的那一条」的设定日预算在代码里怎么取（草案字段 vs Meta 读回）。
- `captureClientSnapshots` 同步调用的耗时与失败形态（它目前由 cron 调用，没在请求路径里用过）。
- `reactivate` 的对象是系列还是广告组（`execute` 的参数是 `campaign_id`，CBO/ABO 下「被打开」的预算要按层级取）。
