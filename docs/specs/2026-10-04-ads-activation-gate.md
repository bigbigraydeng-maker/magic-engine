# 设计稿 v3：开启私信广告的三道闸（第二步）

- 日期：2026-10-04 · 风险级别：**A**（花钱 / 对外发布 / 授权 / 动 Kernel）· 状态：**v3（四位审查员两轮意见已落实；第二轮结论均为「有条件通过」，所列必改全部写入本稿）**
- 前置：第一步 PR #2224（私信广告类型，只能建成暂停，旧的「开」按钮对它一律拒绝）。第二步在它之上。
- 分工：PM 2026-10-04 定——**写代码一律 DeepSeek**，Claude 管逻辑 / 指令 / 审查 / 项目管理。§12 是派工表。
- 层级门（Inline）：**L1 平台基础设施（Kernel / Governance）上的一个新动作 + 三道通用闸**，不新增支柱 / 能力线；走既有 Kernel / Inngest / flywheel_actions / ads_circuit_events；**不新增表、不写 migration**。客户差异（上限、红线）只经客户配置进入。
- **范围声明（魏征 1）**：三道闸**只对私信类型成立**。留资 / 养受众仍走旧的 `approveDraft`（客户付费成员可点，无开关、无预算检查），本步不迁移——这是已知的不对称，写进未解决项。

## 1. 做什么 / 不做什么

**做**：让私信广告在**授权人点头**后能被开启，开启前、中、后都有闸和回执：
1. **授权**：只有授权人能批；批准是不可改的 Kernel 授权记录，绑定「当时给授权人看的那版草案」**和 Meta 上当时的真实设置**；任何一边变了就作废。
2. **紧急开关**：一键停掉某客户的开启通道；状态读不到按「停」。
3. **每日总预算检查**：开启前实时算该客户所有广告账户当前在投的每日预算合计 + 这条，超上限就拒；上限缺失也拒。
4. **回执**：授权、执行、失败、授权过期各有机器可读回执；回执能回答「谁批的、哪一版、预算多少、何时开、何时停」。
5. **收口绕闸口子**：`boost-post` 退役；`ads.reactivate_campaign` 对 ME 私信草案系列加守卫；通用 `/draft` 的私信类型验素材批准 + 归属。

**不做**：回复率 / 值班（第 3 步）；A/B（第 4 步）；令牌 / OAuth（第 5 步）；留资 / 养受众开启流程；「未授权在投」定时对账、Meta 后台 / 官方连接器直接开启的拦截（见 §15 未解决）；不新增表；不开启任何真实广告；不合并。

## 2. 现状事实（探查所得，均有出处）

| 事实 | 出处 |
|---|---|
| 现在的「开」= `/api/ad-approval/[actionId]` → `approveDraft` → `activatePublished`，**绕开 Kernel**；鉴权 `requirePaidClientAccess`（客户付费成员也能点）| `ad-approval/[actionId]/route.ts`、`draft-and-gate.ts`、`ad-publisher.ts` |
| Kernel 已有人工授权链路：D3（human_only）、O1（`route → approveRun → inngest.send → 函数`）| `registry.ts:240-311`、`ads-o1-budget-scale.ts`、`o1-scale/[runId]/decision/route.ts` |
| `authorization_decisions` append-only、`decided_by='human'`；`approveRun` 校验 `expectedDecisionId`、重跑 preflight、`input_hash` 不得漂移 | `human-approval.ts:362-417` |
| 通用审批口 `/api/kernel/approvals/[runId]/decision` 只对**登记在 `DEDICATED_APPROVAL_ENTRIES` 的动作**拒签，其余动作客户付费成员可签；通用口只签不执行 | `kernel-approval/service.ts:170,633`、`dedicated-approval-entries.ts:36` |
| 没有「PM 本人」身份；`ADMIN_EMAILS` 精确 / `ADMIN_EMAIL_DOMAIN` 域名；无授权人环境变量 | `whitelist.ts:44-86`、`docs/ENV.md:136-146` |
| 策略行 `client_automation_policies`：human_only 新动作要有该客户的 `require_approval` 行；**行只在 `ADS_AUTONOMY_MODE_CHANGED` 事件触发同步时补**，不会给存量客户批量补新 key；没行 → `no_policy` 拒绝 | `ads-autonomy-sync.ts:187-199`、`authorize.ts:344-359` |
| 幂等键命中旧的 denied / failed / dead_letter run → 原样返回旧结果；重试需 `idempotencyNonce` | `runner.ts:150,287-330,57` |
| 熔断表 `ads_circuit_events`：`trip/release` 事件对、**按账户**、`seq` 稳定排序、`sticky` 只能人解；**release 的 `actor` 必须匹配 `human:email` —— 数据库 CHECK**；查询出错 fail-closed | migration `20260927000002`、`circuit-state.ts:81` |
| 熔断判断只在 bounded 信封路径被调；human_only 动作不会自动被罩住 | `envelope-facts.ts:358`、`authorize.ts:381` |
| 实时读预算零件：`fetchCampaignSettings / fetchAdsetSettings / fetchAccountSettings`（翻页，返回 `complete`，页数上限 25）| `entity-settings.ts:16,196-211` |
| `DELIVERING_STATUSES` **不含** `PENDING_REVIEW / PREAPPROVED`（审核中的广告组一通过就花钱，会漏算）| `diagnostics/context.ts:48` |
| `client-ad-accounts.getClientAdAccounts` 出错时静默退回主账户；`envelope-facts` 用的是严格读注册表 | `client-ad-accounts.ts`、`envelope-facts.ts:556-590` |
| 客户总上限 `ad_strategy_configs.daily_budget_cap_cents`（账户币种的分）、账户上限 `client_meta_ad_accounts.daily_budget_cap_cents`；**写口只要 `requireGlobalAdmin`（域名邮箱员工都行），无审计** | migrations `20260925000001`、`20260927000003`；`ad-strategy-config/route.ts`、`ad-accounts/.../daily-cap/route.ts` |
| `creative_pool`：`approved_by` 取会话、只全局管理员能写；**候选条目的 `ref` 可由 PUT 写成任意文本，批准只验 `ref` 在池里**；没有代码把 `ref` 当 Meta 视频号校验归属；也没有代码读它拦投放 | `creative-pool/approve/route.ts:58`、`ad-strategy-config/route.ts:117-121` |
| `flywheel_actions`：无唯一约束、无 status 列、可更新（`approveDraft` 自己就在更新 payload）、`FOR ALL` 仅 service_role；`meta-ads/actions` GET 把该客户 ads 行**连 payload 一起**返回给付费成员 | migration `20260517000001`、`actions` 路由 |
| `boost-post`：`requireDashboardClientAccess`（连 self_serve 都能进）、全局系统令牌、三层 ACTIVE；`meta/client.ts:57` 重新导出了它 | `boost-post/route.ts`、`meta/boost.ts:31` |
| `ads.reactivate_campaign`：付费成员经 `meta-ads/execute` 用系统令牌把系列设 ACTIVE（只开系列，广告组 / 广告仍暂停时不花钱）| `meta-ads/execute/route.ts:133-135` |
| **试跑实测（2026-10-04，官方连接器）**：创建后广告 `effective_status` 先是 `IN_PROCESS`，配置 `status` 才是 `PAUSED`；**创意里的视频号会被 Meta 换成新副本** | `docs/ledger/evidence/…--stage-a.md` |
| 架构测试：capability 才能 import `campaign-writes`；`action-submission/` 才能传 `triggeredBy:'human'` 且同文件调用鉴权函数；kernel / capabilities 不许 import `@/lib/supabase`；**任何文件同时含 `ads_circuit_events` + `.insert(` + 单词 `release`（代码里，注释除外）会被当成"解除写入者"** | `boundaries.ts`、`architecture.test.ts:2545,2592-2680,2687` |

## 3. 总体方案

```
[审批页] 打开卡片时：服务端实时回读 Meta，算「现在的指纹」，与建稿时存的指纹比；
         不一致 → 按钮禁用 + 说明哪一类变了(预算/定向/文案/视频…)，要求重新建稿；不重设基线
         一致 → 弹窗列出：文案 / 每日预算 / 实际剩余天数 / 上限·在投合计·本条 三个数
   │ 授权人点「批准开启」(带 expectedDraftHash)   POST /api/ad-approval/[actionId]/activate
   ▼
路由
  ①requireGlobalAdmin + isActivationApprover(email, 已验证)  ②读草案记录，校验 kind / 状态 / hash(含现场回读指纹)
  ③紧急开关：客户**当前全部**注册账户，任一账户存在未解的人工 trip → 423
  ④attempt = Kernel `action_runs` 里该草案(同 hash)已有的 run 数 + 1
  ⑤Kernel submit(human, nonce=String(attempt))；命中"已授权未派发"的 run 则直接到⑦
  ⑥approveRun(human, expectedDecisionId) → 重读 run：authorized 且 decided_by human
  ⑦草案状态条件更新 awaiting_approval|activation_pending → activation_pending（此后 rejectDraft 被拒）
  ⑧写「已授权」回执(按键去重)  ⑨inngest.send(ADS_DRAFT_ACTIVATION_APPROVED)
     send 失败 → 502，run 留在 authorized，草案 activation_pending；再点一次走⑤的重发分支
   ▼
Inngest 函数 ads-draft-activation（照 O1）
  开头：草案 activation_pending → activating（条件更新）；更新失败(已被拒绝等) → 停手，写 failed(draft_not_pending)，不开启
  → Kernel 执行 capability
  → 成功：写 executed 回执，草案 → active
  → 失败：写 failed 回执，草案 → awaiting_approval(可重试) 或 activation_failed(需人处理，如补暂停失败)
  → 授权过期：写 authorization_expired 回执，草案 → awaiting_approval
  → onFailure(重试耗尽、状态未知)：先查这个 run 是否已 succeeded / 已有 executed 回执 → 是则只补收尾回执 + 告警，不暂停；
                                  否则才补暂停(只动本 run 输入里的 id，且它仍是该草案最新的 run) + 写 failed(crash) + 下发人工任务
   ▼
capability ads.activate_paused_draft
  preflight(只读，全过才继续) → apply 前再查一次开关+熔断 → apply → readback → post-check(预算 + 指纹)
  任一步失败 → rollback = pausePublished
```

**为什么走 Kernel**：已有不可改的授权记录、防盲签、幂等、重试 / 死信、步骤记录、回滚钩子；自造一套是平行系统，且仍是 Kernel 旁路。（子牙 Q1：同意。）

**一次点击完成 submit + approve（Q8）**：D3 的 `approveAndExecuteAdsAutoPause` 是先例，但它不是私信这条链路，安全性单独论证：同一请求里自造的 `expectedDecisionId` 起不到防盲签作用，防盲签完全靠 `expectedDraftHash`——它由服务端**现场重算**，覆盖预算 / 天数 / 文案 / 地区 / ids / 上限快照，并且**要求现场回读的 Meta 指纹 = 建稿时存的指纹**；所以授权人批的是「此刻 Meta 上真实存在的那条广告」，不是账本里的一份描述。PR 里写明。

## 4. 新增 / 修改的文件与参数

### 4.1 Kernel 接线（A 级受保护路径）

| 文件 | 改动 |
|---|---|
| `src/lib/kernel/types.ts` | `ActionKey` 加 `'ads.activate_paused_draft'` |
| `src/lib/kernel/registry-ads.ts` | 新 `ActionDefinition`：`risk:'high'`、`sideEffect:'outward'`、`reversible:true`、`outwardAuthorization:{declaredIn:'docs/specs/2026-10-04-ads-activation-gate.md', approval:{mode:'human_only'}, rollback:'provider_native'}`、`idempotency:{keyFields:['draft_action_id','draft_hash'], scope:…}`、`providerIdempotency:'supported'`、`retryPolicy:{3, exponential, 1000}`、`verification:{method:'ads_readback_integrity'}`、**`requiredCapabilityTier:'admin'`**（狄 1：客户付费成员不得走这个动作）、`steps`（snapshot_pre / apply / readback，每步 `stepCeilingUsd` 有限）、`allowedPurposes:['maintenance']`（Q2：权宜，见 §13）|
| `src/lib/kernel/dedicated-approval-entries.ts` | **登记一行**：`actionKey:'ads.activate_paused_draft'`、`label:'私信广告开启待批准页'`、`path:(clientId)=>/dashboard/ad-approval`（守卫测试要求页面文件存在、专属待办从 `action_runs` 读）。**不登记 = 客户成员可在通用口给等待中的 run 签批准**（子牙 1 / 狄 1）|
| `src/lib/kernel/sync-policy.ts` | **不改**。新 key 被自动纳入同步：observe 客户得 `require_approval`（要的）；bounded_auto 客户得 `auto_approve` → 被 `authorize.ts:381` 拒 = 开启通道自然关闭（fail-closed，同 D3）。**更正（子牙 3）**：行**只在 `ADS_AUTONOMY_MODE_CHANGED` 事件时同步**，存量客户没有这个 key 的行 → `no_policy` 一律拒。上线前置步骤：**等一次每日 reconcile 补行（`notify.ts:63`）或手动调 `reconcileAutonomyMode`**，再查 `client_automation_policies` 确认有行（§11）。**不得用「切到 bounded_auto 再切回」**——中间会短暂给全部 `ads.*` 键写上 `auto_approve`（子牙）|

### 4.2 Capability `src/lib/capabilities/ads/activate-paused-draft/`（目录：`index.ts` 主体、`preflight.ts` 检查小函数、`deps.ts`）

工厂 `createActivatePausedDraftCapability(sb, deps)`；`deps` 注入 Meta 读写、时钟、熔断读取，便于测试。**不得 import `ads-strategy/config.ts`**（它顶层引 `supabaseAdmin`，子牙）。输入：`draft_action_id, draft_hash, ad_account_id, campaign_id, ad_set_id, ad_ids[], daily_budget_cents, currency, cap_cents_snapshot, meta_fingerprint`（`meta_fingerprint` = 建草案时回读的指纹，见 §5-3）。

**snapshot_pre（只读；任何读不到都按失败）**，顺序固定，拆成 ≤50 行的小函数：

| # | 检查 | 失败码 |
|---|---|---|
| 1 | **签批人核对**：读**本 run 当前指向的那条**授权记录（`ctx.decisionId`，`authorization_decisions.decided_by_user`，经 DI 的 `sb` 读，先例 `page-apply-optimization/index.ts:156`）；邮箱 trim + 小写后非空且 ∈ 授权人名单（过滤名单里的空项）。防「客户成员在 submit 与 approve 之间抢签」（狄 1 / H）。「邮箱已验证」只能在路由查 | `approver_mismatch` |
| 2 | 熔断 / 紧急开关：对客户**当前全部**注册账户（账户号归一化：去 `act_`、小写）逐个 `readCircuitState`，任一 `tripped` 或 `queryError` 即拒（§6）| `kill_switch_engaged` / `circuit_tripped` |
| 3 | 归属：对 campaign、adset、每条 ad `GET /{id}?fields=account_id,status`，`account_id` 去 `act_` 后 = `ad_account_id`，且该账户在客户**严格**读出的注册账户里 | `ownership_mismatch` |
| 4 | 三层配置状态都是 `PAUSED`（`ACTIVE / DELETED / ARCHIVED` 都拒）；**草案账本状态必须是 `activating`**（魏征 4）| `not_in_paused_state` / `draft_not_activating` |
| 4b | **兄弟对象**：列系列下**全部**广告组、广告组下**全部**广告，集合必须**恰好等于**输入的 `ad_set_id` / `ad_ids`（多一个配置为 ACTIVE 的对象，开系列时会一起投，狄 B）| `unexpected_siblings` |
| 5 | **Meta 侧指纹**：重新回读算指纹，必须 = 输入里的 `meta_fingerprint`（字段表见 §5-3）；同时**重跑** `checkLaunch` + `checkCreatedAsExpected`（Meta 异步补的相似人群 / 放宽等不进指纹，由这两道闸按策略判），有 blocker 即拒 | `meta_side_changed` / `readback_blocked` |
| 6 | 起止时间：`end_time` 必须在 `now + 24h` 之后；审批卡显示的是**实际剩余天数**（建稿几天后再批，剩余会短于"跑 N 天"）| `schedule_expired` |
| 7 | 买家可见文案按客户**当前**禁用词重扫；禁用词读不到 = 拒 | `brand_redline_hit` / `redlines_unavailable` |
| 8 | 每日总预算（§7），**预算用 Meta 实时的日预算，不是草案里的数** | `budget_cap_exceeded` / `budget_unavailable` |

**apply 之前**再查一次 #2（开关 / 熔断）和 #4（状态）——Inngest 排队、重试期间可能被人打开开关或改了草案（魏征 3）。

**apply**：自写"逐层改 + 逐层校验 `success`"，顺序 广告 → 广告组 → 系列（Q10：不改 `activatePublished`，旧 `approveDraft` 还在用）。**readback**：三层配置状态都 `ACTIVE`。**post-check**：开启后立刻 ①重算在投合计——此时合计**已含本条**，不得再加一次本条；读不到 / 读不全 → 补暂停；超上限 → 补暂停（TOCTOU，魏征 3 / 狄 3）；②重算指纹，≠ 存的 → 补暂停（狄 F）。

**rollback** = `pausePublished`（并发三层，已有）；全部成功 → `activation_failed_rolled_back`；有没停下的 → `activation_failed_rollback_incomplete`，回执列出 id，同时下发人工任务（§8）。**rollback handler** 必须存在（Kernel 要求）。注册进 `capabilities/index.ts`；键集合必须 = `ACTION_KEYS`。`ad-publisher` 不在 `PROVIDER_WRITE_MODULES`，可直接 import。

### 4.3 提交、授权人、路由

| 文件 | 内容 |
|---|---|
| `src/lib/action-submission/ads-activate-draft.ts` | `submitAdsActivateDraft`：`triggeredBy:'human'`，**同文件必须出现对 `requireGlobalAdmin(` 的真实调用**（`architecture.test.ts:2687`）；不 import capabilities / supabase；`idempotencyNonce = String(attempt)`（长度 1–128），**attempt 取 Kernel `action_runs` 里该草案同 hash 已有的 run 数 + 1**——不数回执：授权被拒（`no_policy` / 熔断 / 签批人）时函数根本没跑、没有失败回执，数回执会让幂等键永远命中旧的 denied run（魏征 / 子牙 / 卫青 / 狄 D）|
| `src/lib/ads-strategy/activation-approver.ts` | `isActivationApprover(email, emailConfirmed)`：读 `ADS_ACTIVATION_APPROVER_EMAILS`（逗号分隔，**过滤空项**，两边 trim + 小写后精确匹配）。**未配置 / 空串 / 过滤后为空 → 一律拒**（Q4）。要求会话邮箱已验证；邮箱为空串一律拒。上线前置：PM 配这个变量（§11、台账卡）|
| `src/lib/ads-strategy/draft-hash.ts` | `computeDraftHash(record)`：复用 `kernel/canonical-hash.ts` 的规范化；覆盖 `kind, creatives[全部文案/视频/封面/语言], geoCountries, geoCityKeys, age*, dailyBudget, durationDays, pageId, campaignId, adSetId, adIds, buyerWillSee, 上限快照` |
| `src/app/api/ad-approval/[actionId]/activate/route.ts` | §3 流程。错误码：401 / 403(非授权人) / 404 / 422(kind 非私信 / Kernel 拒绝，带码) / 409(状态不对 / hash 不符 / Meta 侧已变更) / 423(开关) / 502(事件没发出去)。操作者邮箱只取会话。错误信息**不含**令牌、Meta 原文 |
| `src/app/api/admin/ads/activation-kill/route.ts` | §6 |

### 4.4 Inngest

`ads-events.ts` 加 `ADS_DRAFT_ACTIVATION_APPROVED = 'ads.draft_activation.approved'`（payload `{client_id, action_run_id}`）；函数 `ads-draft-activation.ts`（照 O1 + `ads-campaign-budget.ts` 的 `onFailure`）；注册 `functions/index.ts`（`cloud-` 前缀）；上线后手动 Sync `/api/inngest`（台账卡）。**授权过期**：capability 以 `DECISION_EXPIRED` / run 回到 `pending_approval` 返回时，函数写 `authorization_expired` 回执并把草案退回 `awaiting_approval`，**不静默重试**（子牙探查隐患）。**草案被拒绝 / 状态不对**：函数开头条件更新失败 → 停手、写 `failed(draft_not_pending)`，不得继续开启，也不得写 executed。

### 4.5 第一步代码的补强（draft-and-gate.ts 等）

- 私信草案建好后，把**回读指纹** `metaFingerprint` 和**文案快照**写进 `DraftRecord`（读 `daily_budget / lifetime_budget / start_time / end_time` 需扩 `readback.ts` 的 `ADSET_FIELDS`）。
- 草案状态迁移改**条件更新**（`WHERE payload->>status = <期望旧状态>`），`rejectDraft` 只允许 `awaiting_approval`（狄 8 / 魏征 4：授权后到完成之前不可拒绝）。新增状态 `activation_pending`（路由设）/ `activating`（函数设）/ `activation_failed`（需人处理）；**审批页分组显式加上**，否则这三种卡片不可见。
- **卡死巡检**：`findStuckActivations`（状态为 `activation_pending` / `activating` 超过 30 分钟）接进既有每日待办生成器，下发人工任务（what/how/href，按 `(draft_id, code)` 去重，卡片恢复后自动关闭）——也补上"登记专属入口后 pending run 没有任何待办"的缺口（子牙 / 卫青 / 魏征）。
- `gateReadback`（现 53 行）先拆到 ≤50 行再加东西（R7pre）。
- `APPROVABLE_KINDS` **仍不含私信**；旧 `/api/ad-approval/[actionId]` 继续拒绝它。

### 4.6 审批页

私信卡片：把"暂不可开"换成 **「批准开启」**（仅授权人显示；其它人显示"需要授权人操作"）。**卡片打开时服务端现场回读 Meta，指纹与建稿时不一致 → 按钮禁用并说明变了哪一类，要求重新建稿；读不到 Meta → 同样禁用。**确认弹窗**原样列出**：买家会看到的文案、每日预算、投放天数、**上限 / 当前在投合计 / 本条** 三个数（狄 4）、"会产生真实私信对话"。另有"紧急停止开启（该客户）"按钮 + 当前状态；文案写清**它只挡新的开启、冻结该账户 ME 的自动动作，不会停已经在投的广告（要停在投的走现有暂停动作）**。

## 5. 授权细节

1. **授权人**：§4.3；**客户付费成员不能批**；tier `admin` + 登记专属入口 + 路由 / preflight 双重核对签批人。
2. **绑定草案**：`expectedDraftHash`（§4.3）；服务端重算，不符 409。
3. **绑定 Meta 现实（指纹）**：建稿时回读算 `meta_fingerprint` 存进草案记录；之后在**四个时点**重算并要求相等：审批卡打开时、点击时、preflight、apply 之后。**不重设基线、不降级**（不接受"只验视频存在且 ready"——那等于允许换成账户里任意视频，魏征 / 狄 E）。
   - **进指纹的字段（一旦变了就是实质改动）**：系列——目标、`spend_cap`、`bid_strategy`、CBO 日 / 总预算；广告组——日 / 总预算、`billing_event`、出价、优化目标、落点、起止时间、地区（国家 / 城市 key）、年龄、优势受众开关、**显式**受众 id、版位（`publisher_platforms` + `*_positions`）、`frequency`；创意——买家可见文案（正文 / 标题 / 描述 / 欢迎语 / 破冰问题）、视频号、缩略图、按钮类型与 `app_destination`、`degrees_of_freedom_spec`、`url_tags`、`tracking_specs`。
   - **不进指纹的**：Meta 异步补的 `expanded_implicit_custom_audiences`、`targeting_relaxation_types` 等——它们由 preflight #5 重跑 `checkLaunch` 按策略判（有 blocker 才拒），不让指纹因它们误报（魏征）。
   - 指纹分组计算（系列 / 广告组 / 每条广告 / 创意），不一致时能说清是**哪一组**变了，供审批页说明。
   - **风险（未验证）**：试跑发现创意里的视频号被 Meta 换成副本，但只见过一次、不知同步还是异步；若副本异步产生、晚于建稿时的回读，指纹会误报。处置：**宁可误报也不放行**——阶段 B 试跑实测；若抖动，另议"建稿后等 N 分钟再做基线回读"，不放宽比对。
4. **Kernel 防漂移**：`input_hash` 含全部 id + 指纹 + 上限快照。
5. **授权有效期**：`decision_ttl_seconds`；过期写 `authorization_expired`（§4.4）。
6. **一次性与重试**：授权用后即 consumed；同一草案同 attempt 重复点 → `idempotent_hit`；**任何结局**（被拒 / 失败 / 过期 / 被他人在通用口拒绝）之后 attempt+1（数 `action_runs`）才产生新 run。
7. **上限快照**：弹窗展示的上限写进输入与 hash；执行时用 `min(快照, 当前值)`；**当前值被清空 / 读不到 → 拒**，不静默取快照。上限写口加审计回执（谁、旧值、新值，§8）；"谁有权改上限"是 PM 决策，列未解决。

## 6. 紧急开关 = 熔断表的 sticky trip（子牙 4 / 魏征 7 / 狄 6）

- **存储**：`ads_circuit_events`，不用 `flywheel_actions`（无写入守卫、可改、无顺序号）。
- **停**：`POST /api/admin/ads/activation-kill`（`requireGlobalAdmin`，任何管理员可停）：读客户**全部**注册账户（**严格读，读失败整个请求失败**），**一次批量插入**每账户一行（原子，不会"界面显示已停、实际只停了一部分"，魏征）：`kind:'trip'`、`sticky:true`、`reason:'manual_emergency_stop: <原因>'`（原因必填）、`actor:'human:<会话邮箱>'`（**邮箱取不到直接拒，不许 `?? ''`**）、`ad_account_id` **归一化**（去 `act_`、小写）、`evidence:{source:'activation_kill', by, at}`。
- **读（狄 A）**：写、读两边的账户号都归一化；preflight / 路由对客户**当前全部**注册账户逐个读，**任一**账户有未解 trip 即停——所以停开关之后才新绑定的账户也被罩住（子牙）。`readCircuitState` 的 `tripped` 或 `queryError` 即停。
- **解（狄 G）**：只能走**现有** `admin/ads/circuit/release` 路由，且本步**修改它**：若被解除的 trip 的 `reason` 以 `manual_emergency_stop` 开头，**只有授权人**能解（其余 trip 的权限不变）；该路由 release 后果是"一次解除该账户全部未解 trip"，所以文案提示。需核对该路由是否要求填原因。
- **副作用（必须让 PM 知道）**：sticky trip 同时冻结该账户上 ME 的 bounded 自动动作（加 / 减预算、自动暂停等）——**开关打开期间 ME 不会自动止损**。这是"紧急"的代价；若 PM 不接受，备选是另做一个只罩开启通道的专用判断（本步不做）。审批页文案写明。
- **架构测试陷阱（按实际规则）**：`architecture.test.ts:2610-2616` 的判据是"代码里同时含 `ads_circuit_events` + `.insert(` + `release`"才算解除写入者；只有 `src/lib/` 下的文件是硬拒，路由文件是候选、还要过管理员检查。为稳妥，kill 路由文件的代码里仍避免出现该单词。
- 守卫测试：kill 之类类型**不得**进入 flywheel 的 action vocabulary 或被任何 adapter 接受（狄 6，防未登录伪造）。

## 7. 每日总预算检查

纯函数 `activation-budget.ts`：`checkActivationBudget(input) → {ok:true,…}|{ok:false, code, message}`；读数由 capability deps 提供（`entity-settings.ts` 实时读）。

- **上限**：`ad_strategy_configs.daily_budget_cap_cents`。缺失 / ≤0 → `budget_unavailable`（告诉人去哪填）。绑定 ≥2 个账户时还看账户上限：本账户有上限则"本账户合计 + 本条 ≤ 账户上限"；绑定 ≥2 个账户而本账户缺上限 → 拒（沿用 `envelope-facts.ts:556-590`）。执行用 `min(快照, 当前)`。
- **账户集合**：**严格**读注册表（出错即拒），不用会静默回退的 `getClientAdAccounts`（魏征 8）。
- **分子（在投合计）**：对每个注册账户实时读 campaign + adset，**必须 `complete=true`**。**配置状态为 ACTIVE 但已过结束时间的对象，Meta 返回什么状态未验证——一律按在投计入（偏保守：多算只会多拒，不会漏放）**。判"在投"用**配置状态**：系列 `status==='ACTIVE'` 且（CBO 系列：计系列日预算，其下广告组不再计；ABO：计 `status==='ACTIVE'` 的广告组日预算之和）；**不看 `effective_status`**——`PENDING_REVIEW / PREAPPROVED / IN_PROCESS / WITH_ISSUES` 的对象一旦通过就花钱，必须计入（狄 3 / 魏征 8；`DELETED / ARCHIVED` 不计）。
- **lifetime-only**：任何在投对象只有 `lifetime_budget` 没有日预算 → 无法比较 → 拒，**报出是哪个对象**（并非"偏保守"，而是该客户之后每次开启都会被它卡住，直到人处理——这是 fail-closed 的代价，写进文案）。
- **本条**：用 Meta 实时读到的该广告组日预算（须等于草案值，否则指纹已变，#5 先拒）；按币种最小单位（×100）。**币种白名单 `NZD / AUD / USD`（两位小数），其它币种拒**（狄 9）；各账户币种须一致。
- 判定：`在投合计 + 本条 ≤ 上限`，否则 `budget_cap_exceeded`，报三个数。**post-check 时合计已含本条，不再加**。**兄弟对象**（§4.2-4b）若存在，本条的系列按 ACTIVE 计其下全部广告组预算。
- **不适用 `loadClientBudgetRollup` 的原因**：读 24h 快照、要求目标行已在快照里。

## 8. 回执与权威来源

**权威来源（卫青 3）**：Kernel 的 `authorization_decisions`（append-only）与 `action_runs` 是**权威**；`flywheel_actions` 回执和草案状态都是**派生**，可对账、不可作为授权依据。

全部是 `flywheel_actions` 行（`flywheel:'ads'`、`execution_mode:'third_party'`、`vendor:'meta'`）。**公共字段**：`request_id`（run id）、`attempt`、`client_id`、`source_record_id`（草案行 id）、`status`、`phase`、`daily_budget_cents`、`currency`、`ad_account_id`、`object_ids`、`authorization_decision_id`、`operator_email`、`meta_actor:'me_system_user'`（Meta 后台里所有 ME 令牌操作人都显示成同一个，靠 `object_ids` + 时间反查本回执，再反查授权记录）、`created_at`。**幂等**：键 = `(request_id, attempt, action_type, phase)`；`phase` 区分同一次执行里的不同结局（`preflight / apply / readback / post_check / finalize / crash`），所以后写的 `failed(crash)` 不会被先写的 `failed(apply)` 当重复吞掉。写入前按该键查已有行（表无唯一约束，best-effort）：**同键已存在 → 跳过；不同 phase → 追加**；读取方按该键取最新一行。

| action_type | 何时写 | 额外字段 |
|---|---|---|
| `ads.draft_activation.authorized` | 路由批准成功 | `draft_hash`、`approver_scope:'approver_list'`、**文案快照**（买家可见文案 + 预算 + 天数）、`cap_cents_snapshot`、`meta_fingerprint` |
| `ads.draft_activation.executed` | 回读三层 ACTIVE 之后才写 | 回读到的三层状态、开启时刻 |
| `ads.draft_activation.failed` | 任何失败 | `code`、`message`（**不含 Meta 原文**）、`rolled_back`、`rollback_failed_ids[]` |
| `ads.draft_activation.authorization_expired` | 授权过期 | 过期时刻 |
| `ads.budget_cap.changed` | 上限写口改动 | 谁、旧值、新值（审计，不改权限）|

人工任务按 `(draft_id, code)` 去重，对象确认已暂停后自动关闭。

- **"花了多少"**：回执带 `object_ids`，花费用它去 `ad_daily_insights` 查（只到天）。**"何时停 / 谁停的"**：Kernel 暂停动作的 `action_runs` 带目标 id，用 `object_ids` 关联；但 Meta 后台手动停、预算耗尽、到期、被拒审这几种**没有回执**——`ads.draft_activation.stopped` 回执归后续（第 3 步，列未解决）。写进 PR 的"如何回查"一节。
- **补暂停失败 / 函数崩溃**：往今日待办下发人工任务（`pm-todo/manual-items.ts` 模式）。**what**：哪几个 id 仍可能在花钱、每日多少；**how**：去 Meta 广告管理后台暂停哪一层；**href**：直达链接。
- **函数崩溃**（`onFailure`，状态未知）：**先守卫**——该 run 已 `succeeded` 或已有 `executed` 回执 → 只补收尾回执 + 告警，**不暂停**（否则会误停一条已成功的正常广告，卫青）；否则才补暂停（只动本 run 输入里的 id、且该 run 仍是该草案最新的 run），再写 `failed(crash)`。草案不留在 `activating`：卡死巡检（§4.5）兜底。
- **信息泄露（狄 7 / I）**：`meta-ads/actions` GET 和 `fetchAutonomousActionItems`（execution GET）对非管理员按 `action_type` 排除 `ads.draft_activation.*`、`ads.budget_cap.changed`，回执不含 Meta 原文。

## 9. 收口绕闸口子

1. **`boost-post` 退役**：鉴权后返回 410，不调 Meta；`meta/boost.ts` 保留；**架构守卫测试**：`boostPagePost` 不得被任何路由 import，**含经 `meta/client.ts:57` 的重新导出路径**。重写 `boost-post/__tests__/route.test.ts`。PM 知悉：仓库外若有自动化在调它会收到 410。
2. **`ads.reactivate_campaign` 守卫（范围限定、不放行）**：`meta-ads/execute` 在恢复前，若该系列 id 出现在**任何** ME 私信草案记录里 → 一律 422 并指向开启流程（**开启成功之后被自动 / 紧急暂停的，也不能从这里恢复**——否则付费成员绕过开关、上限、授权，狄 C）；账本查询出错也按拒。**不动其它系列**（NAL 等的 Messenger 广告恢复照常）。PM 知悉：ME 私信草案系列被暂停后要恢复须重新走草案；"原地恢复"流程以后需要再单独设计。
3. **通用 `/draft` 私信素材闸**：每条创意的 `videoId` 必须在 `creative_pool` 里 `{kind:'meta_video', status:'approved'}` 且 `approved_by` 非空；**并**用该客户令牌验证视频属于该客户广告账户（列账户 `advideos`，翻页，不完整 = 拒）。读池 / 读归属失败 = 拒（魏征 / 子牙 Q7：池里 `ref` 是人自填文本，必须补归属校验）。
4. **`rejectDraft`** 只允许 `awaiting_approval`。

## 10. 测试与变异自检（DeepSeek 写，Claude 审）

| 模块 | 必测 |
|---|---|
| `activation-budget` | CBO/ABO；按配置状态计（`PENDING_REVIEW` 计入）；lifetime-only 拒且点名；`complete=false` 拒；币种不一致 / 不在白名单拒；上限缺失 / 0 拒；等于上限放行、多 1 分拒；双账户缺账户上限拒；草案自身 id 排除；×100 |
| `activation-approver` | 未配 / 空串 = 全拒；精确匹配；大小写；域名邮箱不行；邮箱未验证拒 |
| 熔断开关路由 | 单次批量插入；注册表读失败整体失败；账户号归一化（带 / 不带 `act_`、大小写读写互通）；actor 形状；邮箱取不到拒；原因必填；代码无 `release`；开关读出错 = 停；停开关后新绑定的账户也被罩住；`release` 路由对 `manual_emergency_stop` 的 trip 只允许授权人 |
| capability | 8 项 preflight（+4b 兄弟对象、4 草案状态）每项一个拒绝用例 + 全过；系列下多一个广告组 / 广告组下多一个广告 → `unexpected_siblings`；指纹各字段组变动分别拒；Meta 异步补相似人群 → 由 `checkLaunch` 判而非指纹误报；签批人不在名单 → `approver_mismatch`；Meta 侧预算被改大 → `meta_side_changed`；apply 前开关被打开 → 拒；apply 抛错 → 补暂停；readback 对不上 → 补暂停；post-check 超上限 → 补暂停；补暂停失败 → incomplete 且列 id；陌生账户 id → `ownership_mismatch`；rollback handler 存在 |
| 路由 `/activate` | 每个错误码一个用例；授权被 `no_policy` 拒后补行再点 → attempt+1 能重试；他人在通用口拒绝 run 后再点 → 能重试；`activation_pending` 期间 `rejectDraft` 被拒；客户付费成员 403；hash 不符 409；并发双点只开一次；`authorized` 未派发时再点会重发；`inngest.send` 失败 502；失败后再点 attempt+1 能重试；操作者不读 body；开关开着 423 且不调 Kernel |
| Inngest 函数 | 条件更新失败(草案已被拒绝) → 不开启、写 `failed(draft_not_pending)`；`onFailure`：run 已 succeeded → 不暂停；run 未成功 → 暂停且只动本 run 的 id；`failed(apply)` 后 `failed(crash)` 不被去重吞掉；成功写 executed 且草案 active；capability 失败写 failed 并退回；授权过期写 `authorization_expired` 不重试；崩溃（onFailure）补暂停 + 任务；回执重复写入按键去重；zod 拒坏 payload |
| 草案 / 素材闸 | 池缺 / 未批准 / 读池失败 / 归属不符 / 归属读不完整 全拒；传统类型不受影响；条件更新 + `rejectDraft` 状态限制 |
| 守卫 | `reactivate` 对 ME 私信草案系列无论有无 executed 一律拒、账本查询出错拒；`boost-post` 410 且 fetch 零调用；`boostPagePost` 无 import（含 re-export）；kill 类型不在 vocabulary；`reactivate` 守卫只拦 ME 私信系列 |
| 架构 | `kernel-architecture` 全绿；键集合 = ACTION_KEYS；`DEDICATED_APPROVAL_ENTRIES` 守卫；`action-submission` 规则；不新增 `execution_items` 写入方 |
| 存量客户 | 无策略行 → `no_policy` 拒（预期）|

**变异（逐个必须变红且红在对应测试）**：兄弟对象不检查；指纹缺字段组；apply 后不复算指纹；熔断账户号不归一化；只查草案账户不查全部注册账户；`attempt` 改数回执；`onFailure` 不守卫直接暂停；`reactivate` 守卫放行已 executed 的；去授权人检查；去 `approver_mismatch`；去 `expectedDraftHash` 比对；去指纹比对；预算用草案值不用 Meta 实时值；`not_paused` 放行；归属不比 account_id；`<=` 改 `<` / `>`；`PENDING_REVIEW` 不计入；币种放行；上限缺失放行；熔断查询出错当未开；apply 前不复查开关；post-check 去掉；readback 不验 ACTIVE；补暂停不调用；`onFailure` 不补暂停；boost-post 又调 Meta；素材池未批准放行；归属校验去掉；授权过期静默重试；`rejectDraft` 不限状态；kill 路由写入 `flywheel_actions`。

## 11. 上线前置与试跑（合并之后，需 PM 另批）

**前置清单（都是一次性配置，进台账卡）**：
1. 部署环境配 `ADS_ACTIVATION_APPROVER_EMAILS`（登记 `docs/ENV.md`，紧挨 `ADMIN_EMAILS`）。**未配 = 所有人都批不了**（fail-closed）。
2. 试跑客户的 `client_automation_policies` 要有 `ads.activate_paused_draft` 的 `require_approval` 行：**等一次每日 reconcile 或手动调 `reconcileAutonomyMode`**，再查表确认（重存同一个自治模式不会触发同步；绝不用"切 bounded_auto 再切回"）。
3. 客户 `daily_budget_cap_cents` 已配（CTS 的 150 是审计文档里说的，未在代码证实）。
4. 手动 Sync `/api/inngest` 注册新函数。

**反向试跑（不花钱，需 PM 同意各步的回滚）**：①改一个字再点 → 409；②用非授权人账号点 → 403；③未配上限 → `budget_unavailable`；④engage 紧急开关再点 → 423，随后用现有 release 路由解除（**会短暂冻结试跑账户的自动动作**）；⑤授权后在 Meta 把广告组预算改大再执行 → `meta_side_changed`。每步回执写 `docs/ledger/evidence/`。
**正向试跑（会真开广告，只在 Pengyu Deng 个人账户，需 PM 另行明确批准）**：5 新西兰元日预算的私信草案 → 批准 → 回读 ACTIVE → **立刻**紧急开关 + 既有暂停动作停掉。真实花费上限 = 开启到暂停之间的几秒。
**合并顺序**：#2224 与第二步 PR 一起由 PM 回「合」（先合 #2224，第二步 PR 以它为底）。

## 12. DeepSeek 分轮（每轮 ≤3 个文件，含测试；Claude 出规格 → aider → Claude 审 diff + 跑测试）

| 轮 | 产出 | 模板 |
|---|---|---|
| R1 | `types.ts` ActionKey + `registry-ads.ts` 定义 + `capabilities/index.ts` 先挂 `deferred-to-human` 式 stub（否则键集合测试变红）| D3 定义 + `deferred-to-human.ts` |
| R1t | registry 测试 | `registry.test.ts` |
| R1b | `dedicated-approval-entries.ts` 登记 + 守卫测试 | 现有一行 |
| R2 | `activation-budget.ts` + 测试（纯函数）| `envelope-facts.ts` 规则 |
| R3a | `activation-approver.ts` + 测试 | `whitelist.ts` |
| R3b | `draft-hash.ts` + 测试 | `kernel/canonical-hash.ts` |
| R3c | `meta-fingerprint.ts`（分组指纹）+ 测试 | 第一步 `created-as-expected.ts` |
| R4a | 熔断开关路由 `activation-kill/route.ts` + 测试 | `circuit/release/route.ts`（注意不含 `release` 字样）|
| R4a2 | 修改 `circuit/release/route.ts`（`manual_emergency_stop` 只授权人可解）+ 测试 | 现有路由 |
| R4b | `activate-paused-draft/preflight.ts` + 测试（8 项 + 4b 小函数）| `pause-unit.ts`、`common.ts` |
| R4c | `activate-paused-draft/index.ts` apply / readback / post-check / rollback + 替换 R1 的 stub + 测试 | `scale-unit-budget.ts` |
| R5 | `action-submission/ads-activate-draft.ts` + 测试 | `ads-o1-budget-scale.ts` |
| R6a | `/activate` 路由 + 测试 | `o1-scale/.../decision/route.ts` |
| R6b1 | `ads-events.ts` 常量 + `functions/index.ts` 注册 | O1 |
| R6b2 | `ads-draft-activation.ts` 函数 + 测试 | `ads-o1-budget-scale.ts`、`ads-campaign-budget.ts` |
| R7pre | 拆 `gateReadback` 到 ≤50 行（不改行为）+ 现有测试仍绿 | — |
| R7a | `readback.ts` 扩字段 + 指纹接入 | 第一步 |
| R7b | `draft-and-gate.ts` 记指纹 / 文案快照 / 条件更新 / `rejectDraft` 限制 + 测试 | 第一步写法 |
| R8 | 审批页（现场回读指纹比对、按钮、弹窗、状态词表、分组）| 现有 `ApproveButtons` |
| R9a | `/draft` 私信素材闸（池 + 归属）+ 测试 | 第一步 `brandRedlines` 写法 |
| R9b1 | `meta-ads/execute` 的 reactivate 守卫 + 测试 | — |
| R9b2 | `meta-ads/actions` GET 与 `execution` GET 的类型过滤 + 测试 | — |
| R9b3 | 两个上限写口的审计回执 + 测试 | — |
| R10 | `boost-post` 410 + 守卫测试 | — |
| R11 | `findStuckActivations` 接进每日待办 + 测试 | `pm-todo/manual-items.ts` |
| R12 | 台账卡 + `ENV.md` + 变更说明 | — |

每轮：提示词写死"只许动列出的文件 / 不跑命令 / 无 any / 新文件 import 写全"；`--no-git --no-detect-urls --edit-format whole`（新文件）+ `yes n |`（>3 个 `--read` 时）；跑完 `wc -l` + `git status`（防嵌套残留）+ 红了先核 fixture 再核代码；测试文件先写到不带双下划线的草稿路径再 `mv`；每轮结束跑 `kernel-architecture` 测试。

## 13. 审查结论与决策（第一轮）

| 问 | 决定 | 依据 |
|---|---|---|
| Q1 走 Kernel | **是** | 子牙同意 |
| Q2 allowedPurposes | **`maintenance`（权宜）**；growth 需挂 goal_id，客户是否有 active goal 未查（不读生产库）；定了不再改，台账卡复查 | 子牙建议先查 |
| Q3 sync 自动同步 | **接受**，已更正事实 + 加前置步骤 | 子牙 3 |
| Q4 授权人未配 | **全拒** | 三位一致 |
| Q5 开关存储 | **`ads_circuit_events` sticky trip** | 子牙 4 / 魏征 7 / 狄 6 |
| Q6 boost-post | **退役** + 含 re-export 守卫 | 三位同意 |
| Q7 素材池 | **补归属校验** | 子牙 5 / 魏征 / 狄 |
| Q8 一次点击 | **接受**，防盲签靠 hash | 子牙 / 魏征 |
| Q9 新状态 | `activation_pending`(路由) / `activating`(函数) / `activation_failed`；分组显式加；条件更新；授权后不可拒绝 | 子牙 / 狄 8 / 卫青 3 / 魏征 4 |
| Q10 apply | **自写逐层改 + 校验**，不动 `activatePublished` | 子牙 |
| Q11 实时读 | 接受（fail-closed）| 子牙 / 魏征 |
| Q12 攻击 | 见 §14（两轮）| 狄 |

## 14. 狄仁杰攻击链处置（两轮）

| 攻击 | 处置 |
|---|---|
| 1 付费成员抢签 | 登记专属入口 + tier `admin` + 路由 / preflight 核对签批人（读 `ctx.decisionId` 那一条，过滤空项）|
| 2 Meta 侧改过 | 指纹四时点比对（建稿存 / 卡片 / 点击 / preflight / apply 后）+ Meta 实时预算 + 起止时间 + 兄弟对象枚举 |
| 3 累计超上限 | 按配置状态计、`PENDING_REVIEW` 计入、post-check（已含本条不重复加）|
| 4 上限被改 | 弹窗三个数 + 快照 + `min` + 当前值空则拒；写口审计；"谁能改"列未解决 |
| 5 旁路 | boost-post 退役；reactivate 对 ME 私信草案系列一律拒；MCP / 后台 / 对账 → §15 |
| 6 开关伪造 | 熔断表（DB CHECK）；vocabulary 守卫 |
| 7 泄露 | actions GET / execution GET 过滤；回执不含 Meta 原文 |
| 8 并发 | 条件更新；`rejectDraft` 限状态；attempt 取 `action_runs`；授权后不可拒绝 |
| 9 小项 | 空串全拒；邮箱验证；币种白名单；`winner-reel-sync` → §15 |
| A 熔断账号写法 | 读写归一化 + 检查全部注册账户 |
| B 兄弟对象 | `unexpected_siblings` 枚举 |
| C reactivate 在 executed 后放行 | 一律拒 |
| D attempt 被锁 | 数 `action_runs` |
| E 视频兜底 | 取消兜底，宁可误报 |
| F 指纹字段 | 扩字段表 + apply 后复核 |
| G 开关权限 | 解除限授权人（`manual_emergency_stop`）|
| H / I | 过滤空项 + 读当前 decision；execution GET 过滤 |

## 15. 未解决（汇报时原样交出）

1. **Meta 后台 / 官方连接器（MCP）直接开启广告**，代码管不到。唯一办法是"未授权在投对账"定时任务（把在投的私信广告组与 `executed` 回执比对，对不上就暂停并告警）——本步不做；建议归第 3 步（衡量与值班）。另需 PM 决定是否在项目规则里写"agent 不得对 ME 账户用 `ads_activate_entity`"（改 CLAUDE.md 属 A 级受保护路径，本步不动）。
2. **留资 / 养受众的开启**仍走旧路径（无开关、无预算检查、客户成员可点）。
3. **谁有权改每日上限**（现在任何域名邮箱管理员）——PM 决策；本步只加审计。
4. 紧急开关冻结账户自动动作的副作用（§6）——PM 知悉。
5. `winner-reel-sync` 的 `target_adset_id` 若指向已授权的私信广告组，可能在其中加未审的 ACTIVE 新广告——需核对。
6. `allowedPurposes` 用 `maintenance` 是权宜之计。
7. 指纹含视频号可能因 Meta 异步换副本而误报，阶段 B 试跑验证。
8. 第一步的未解决项（请求被平台杀掉时已建对象未入账等）仍在。
9. **`ads.draft_activation.stopped` 回执**（谁停的、何时停、停时花费）本步不做——Meta 后台手动停 / 预算耗尽 / 到期 / 被拒审这几种没有回执；归第 3 步（衡量与值班）。
10. 紧急开关的"只罩开启通道、不冻结止损"专用版本——本步不做。
11. 未验证的事实（实现与试跑须核实）：Meta 创意视频号被换成副本的时机；配置状态 ACTIVE 且已过结束时间的广告组在 Meta 的状态取值；CTS 上限 150。
12. 新增台账卡清单：配授权人变量 / 等 reconcile 补策略行 / 确认上限已配 / 手动 Sync Inngest / 反向试跑 / 正向试跑(owner pm) / 未授权在投对账(第 3 步) / 项目规则写"agent 不得对 ME 账户用 `ads_activate_entity`"(owner pm，改 CLAUDE.md 属 A 级) / `stopped` 回执与卡死巡检 / 阶段 B 验指纹抖动 / 留资·养受众开启不对称 / 谁能改上限(owner pm) / `winner-reel-sync` 核对 / `allowedPurposes` 复查。

## 16. Reuse Statement

- **复用**：Kernel（授权记录 / 防盲签 / 幂等 / 步骤 / 回滚钩子 / 专属入口登记）、O1 的链路与 `ads-campaign-budget` 的 `onFailure`、`ads_circuit_events` + `readCircuitState` + 现有 release 路由、`entity-settings` 实时读、严格读注册表、`ad_strategy_configs` 上限与 `creative_pool` 批准登记、`flywheel_actions` 回执、`pausePublished`、第一步的 `draft-redlines` / 回读、`canonical-hash`。
- **platform-shared（新增）**：`ads.activate_paused_draft`；`activation-budget`；`activation-approver`；`draft-hash`；Meta 侧指纹；紧急开关路由。
- **industry-specific**：无。**client-specific**：无写进共享代码——上限、红线、授权人名单全经配置 / 环境读取。
- **客户名 / ID 进 shared runtime？** 否。**学习层**：无写入。
- **对账（tier-gate）**：实现落点与决策分类（L1 治理基础设施 + 既有 Kernel 上的新动作）一致；若审查员认定是新 L1 能力，升 Full Report。
