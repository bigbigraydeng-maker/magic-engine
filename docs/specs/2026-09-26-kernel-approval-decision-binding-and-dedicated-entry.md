# Kernel 审批：绑定「人看到的那份决定」+ 专属审批入口登记表

- 日期：2026-09-26 · 作者：卫青（广告支柱）· 风险级：**A**（Kernel 受保护路径 + 审批安全）
- 基线：`claude/gifted-williams-fce480` @ `ee53a09e`（= origin/main，2026-09-26 22:08 NZST fetch）
- 状态：设计稿 v1 → 待 子牙 / 魏征 / 狄仁杰 设计审

## 0. 目标 / 验收 / 不做

**目标**：D3 自动暂停关掉 dry_run 之前，把两处审批缺口补上。

**验收**
1. 广告暂停的批准 / 驳回，服务端核对「人点的时候页面上那份审批请求 id」；对不上 → 在**任何写入之前**失败（不签决策、不动 run、不调 Meta），界面叫人刷新。
2. 一条等批准的 D3 暂停，今日待办里**只出现一条**（广告专属那条），不再同时出现「审批入口还没上线」那条过时的通用待办。
3. 通用审批页（`/dashboard/kernel-approvals`）对有专属入口的动作**服务端拒绝批准**，界面不画批准按钮、改给专属页链接。
4. 「哪些动作有专属审批入口」只有一张登记表，SEO 3b（孔子）后续直接往表里加一行，不另写。

**不做**：广告判定方向修复（另一窗口）· 记忆抽取 1b（孔子）· 通用 handoff 对**其它**动作的过时文案（记后续）· `manual-items.ts`（6 个在飞 PR 都在改它，本任务一行不碰）· 任何生产数据改动 · 关 dry_run。

## 1. 现状核实（2026-09-26 origin/main `ee53a09e`）

| 事实 | 位置 |
|---|---|
| `approveRun` 支持 `options.expectedDecisionId`，不传 = 服务端重读 `run.authorization_decision_id` | `src/lib/kernel/human-approval.ts:33-58, 417-437` |
| `approveAndRun` **不收** options，恒不传 | `src/lib/kernel/runner.ts:542-547` |
| `rejectPendingRun` 同样不收 options | `src/lib/kernel/runner.ts:801-815` |
| 广告专属路由不收、不传 decision id | `src/app/api/clients/[id]/ad-health/auto-pause/[runId]/decision/route.ts:23-31, 86-92` |
| 广告 submission 的批准 / 驳回包装不传 | `src/lib/action-submission/ads-auto-pause.ts:115, 127` |
| 列表 GET 已返回 `authorizationDecisionId`，但取自 **提交时** 写进 `flywheel_actions.payload` 的值，页面也没用它 | `.../ad-health/auto-pause/route.ts:55`；`page.tsx:14-23, 56-60` |
| 通用 handoff 对所有 `pending_approval` 都发「审批入口还没上线，回我一句」、href 空 | `src/lib/kernel/handoff.ts:77-92` |
| 广告专属待办同时发一条（href → 专属页） | `src/lib/pm-todo/ads-auto-pause-items.ts:32-62` |
| **新发现①**：通用审批页能批 `ads.auto_pause_on_d3`——但它只签不执行（WP07 未建），批完 run 停在 `authorized`、广告**不会暂停**，页面却显示「已批准」；专属页那条随后点批准会报「状态不是等人点头」 | `src/lib/kernel-approval/service.ts:598-618`、`approvalPermissionsFor:154-168` |
| **新发现②**：Inngest 提交成功、写 `flywheel_actions` 失败 → 步骤重试走 `idempotent_hit` 分支不补写账 → 这条 pending run 在专属页和专属待办里都**看不见**（今天靠那条过时的通用待办兜底） | `src/lib/inngest/functions/ads-d3-auto-pause.ts:253-266` |

结论：发现②意味着「handoff 直接跳过有专属入口的动作」会把孤儿 run 变成**没人看得见**。所以专属列表 / 专属待办的真相源必须改成 `action_runs` 本身，再拿 `flywheel_actions` 只补展示字段。

## 2. 设计

### 2.1 Issue 1 — 批准绑定人看到的那份决定

**Kernel（受保护路径，最小改动）** `runner.ts`
```ts
export async function approveAndRun(deps, runId, approvedByUser, options: HumanDecisionOptions = {})
  → approveRun(deps, runId, approvedByUser, options)          // 原样透传
export async function rejectPendingRun(deps, runId, rejectedByUser, reason, options: HumanDecisionOptions = {})
  → rejectRun(deps, runId, rejectedByUser, reason, options)   // 对称，原样透传
```
默认 `{}` 保持现有调用方（测试、恢复路径）行为不变。`HumanDecisionOptions` 从 `human-approval.ts` 复用，不新造类型。判据一个字不改——应用层 `assertDecisionStillCurrent`（写库前）+ 数据库 RPC 锁内第 ③ 步两层都已存在，本次只是让这条路径真的把 id 送进去。

**广告 submission** `action-submission/ads-auto-pause.ts`
- `approveAndExecuteAdsAutoPause(deps, runId, approvedByUser, expectedDecisionId: string)` —— **必填**（类型层就不让漏传）。
- `rejectAdsAutoPause(deps, runId, rejectedByUser, reason, expectedDecisionId: string)` —— 同上。

**决定路由** `.../auto-pause/[runId]/decision/route.ts`
- 请求体新增 `expectedDecisionId`：approve 与 reject **都必填**，必须是 uuid 形态；缺 / 形态不对 → 400，**在 `createKernel` 与任何读写之前**。
- `KernelError('STALE_DECISION')` 仍走现有 409 + `code`，页面据 `code==='STALE_DECISION'` 提示「你看的不是最新的，已刷新，请再看一遍」并重新拉列表。页面**不许**自己换一个新 id 重交（= 替人盲签）。

**列表 GET** `.../auto-pause/route.ts` —— 见 2.3，`expectedDecisionId` 取自**此刻** `action_runs.authorization_decision_id`（与 `ads-auto-pause.ts:78-83` 同一来源），不再用提交时写进 payload 的旧值。理由：提交时的值一旦 run 被重签就永远对不上，这条会变成永远批不了；而「人看到的」= 页面渲染那一刻的当前决定。

**页面** `page.tsx`：持有并回传 `expectedDecisionId`；为 null 时两个按钮都禁用并写原因。

### 2.2 Issue 2 — 专属审批入口登记表（共享，孔子复用）

新文件 `src/lib/kernel/dedicated-approval-entries.ts`（纯数据 + 纯函数，零 import，放 kernel 下是因为 handoff 和 kernel-approval 两个消费方都只准 import `kernel/*` 授权段子模块）：

```ts
export interface DedicatedApprovalEntry {
  readonly actionKey: string
  /** 给人看的入口名：「广告自动暂停待批准页」 */
  readonly label: string
  /** 站内路径（不含域名），入参只有 clientId */
  readonly path: (clientId: string) => string
}
export const DEDICATED_APPROVAL_ENTRIES: readonly DedicatedApprovalEntry[] = [
  { actionKey: 'ads.auto_pause_on_d3', label: '广告自动暂停待批准页',
    path: (c) => `/dashboard/clients/${encodeURIComponent(c)}/ad-health/auto-pause` },
]
export function dedicatedApprovalEntryFor(actionKey: string): DedicatedApprovalEntry | null
```

守卫测试（防假入口，跟 handoff 那条「不许假链接」同一规矩）：
- 表里每个 `actionKey` 必须在 `ACTION_REGISTRY` 里；
- 每个 `path('x')` 对应的 `src/app/**/page.tsx` 文件必须真实存在；
- `actionKey` 不重复。

**消费方 1：通用 handoff** `kernel/handoff.ts`
- `toTodo` 前过滤：`status==='pending_approval' && dedicatedApprovalEntryFor(run.action_key)` → 不发通用待办（专属待办负责）。`dead_letter` / `denied` 不过滤（专属待办只管等批准）。
- 能安全跳过的前提 = 专属待办读的是同一份 Kernel 状态（2.3），孤儿 run 也会被专属待办看到。

**消费方 2：通用审批面** `kernel-approval/service.ts`
- `approvalPermissionsFor`：命中登记表 → `{ canApprove: false, canReject: true, approveBlockedReason: 'dedicated_entry', dedicatedEntry: { label, path } }`（其余情况 `dedicatedEntry: null`）。
- `assertActorMayApprove` 随之**服务端拒绝批准**（新 `forbidden_tier` 文案：「这条要去 <label> 批——那里批完会立刻执行；这里只签不执行，批了广告也不会停」）。
- 拒绝**仍允许**（沿用该模块「拒绝永远允许」的不变量）。见开放问题 Q1。
- `DecisionPanel.tsx`：`approveBlockedReason==='dedicated_entry'` 时不画批准按钮，画「去 <label> 处理」链接；`BLOCKED_REASON_LABEL` 补一行。

**消费方 3（后续）**：SEO 3b 往 `DEDICATED_APPROVAL_ENTRIES` 加一行 + 自己的页面，守卫测试自动覆盖。

### 2.3 专属列表 / 专属待办改读 Kernel 真相

新 helper `src/lib/ads-strategy/auto-pause-pending.ts`：
```ts
listPendingAdsAutoPause(sb, { clientId?: string, limit = 100 }): Promise<PendingAdsAutoPause[]>
```
1. `action_runs`：`action_key='ads.auto_pause_on_d3' AND status='pending_approval'`（可选 `client_id`），按 `created_at` 升序。
2. `flywheel_actions`：按这些 run id 取 `payload.action_run_id ∈ ids` 的行，只补 `adset_name / diagnosis_title / flywheel_action_id`。
3. 没有账行的孤儿 run：`adset_id / ad_account_id / insight_date` 取 `run.input`，标题取 `run.rationale`——照样列出、照样可批。
4. `expectedDecisionId = run.authorization_decision_id`；为空的 run 照列、按钮禁用、说明「库里这条审批请求对不上，先别点」。

消费方：GET 路由（加 `clientId`）、`pm-todo/ads-auto-pause-items.ts`（不带 `clientId`）。两个都不再按 `payload.status='awaiting_approval'` 过滤。决定路由的 `updateLedgerStatus` 保留（有账行就回写终态）。

## 3. 平台层级门（Inline）

> [跟班 · Tier] L1 平台基础设施（Kernel 审批治理）内的修补，不新增能力线；登记表是「动作 → 审批入口」的元数据，按动作登记、无客户维度，不进候选表。
> [跟班 · 红线] 红线 2 ✓：共享代码里无客户名/ID/行业判断；`ads.auto_pause_on_d3` 是动作契约键，不是客户事实。换客户（CTS→Oztop→Roman）/换行业（旅游→物流→地产）默认行为都不变。
> [跟班 · 继续] 无需 PM 拍板，继续。

## 4. 测试计划（每条对应一个变异探针）

| # | 测试 | 变异（应让测试变红） |
|---|---|---|
| T1 | `approveAndRun` 带**旧** id → 抛 `STALE_DECISION`；决策表条数不变、run 仍 `pending_approval`、capability 调用 0 次 | runner 里不透传 options |
| T2 | `approveAndRun` 带**当前** id → 正常批准并执行 | 透传后把 id 写死成别的 |
| T3 | `rejectPendingRun` 带旧 id → `STALE_DECISION`、无写入 | reject 不透传 |
| T4 | `approveAndExecuteAdsAutoPause` 把 id 传到 Kernel（旧 id → 抛） | 包装层丢参 |
| T5 | 决定路由：缺 / 非 uuid `expectedDecisionId` → 400 且 kernel 未被调用；带上 → 原样传入 | 去掉必填校验 |
| T6 | 列表 helper：`expectedDecisionId` 取自 run 当前指针，而非 payload 里的旧值；孤儿 run 也列出；非 pending 的 run 不列 | 改回读 payload / 改回按 payload.status 过滤 |
| T7 | handoff：D3 pending → 不出通用待办；D3 dead_letter → 仍出；其它动作 pending → 仍出（原有守卫测试不动） | 去掉过滤 / 过滤不看 status |
| T8 | 通用审批：D3 → `canApprove=false, reason='dedicated_entry'`，`assertActorMayApprove` 抛；拒绝仍可 | 去掉登记表判断 |
| T9 | 登记表守卫：key 在注册表、页面文件存在、无重复 | 把 path 改成不存在的页 |

验证命令：`npm test -- <上述文件>`、`npm run type-check`（仓库基线红，按基线对比）、`npm run lint`（改动文件）。

## 5. 开放问题（请审稿人裁）

- **Q1**：通用审批面对有专属入口的动作，要不要**连拒绝也挡**？我倾向不挡：①保住该模块「拒绝永远允许」的不变量；②拒绝没有外部副作用；③专属列表改读 run 状态后，别处拒掉的也会从专属页和待办里自然消失。代价：`flywheel_actions` 那行停在 `awaiting_approval`（纯展示账，已无读方按它过滤）。
- **Q2**：登记表放 `src/lib/kernel/` 下的独立文件，还是做成 `ActionDefinition` 上的一个字段？我倾向独立文件——不动 K-WP02 冻结的契约类型，孔子加一行即可；代价是多一个要跟注册表对齐的地方（T9 守卫兜住）。
- **Q3**：`rejectPendingRun` 顺带加 options 算不算越界？我认为是同一个缺口的另一半（驳回的也应是人看到的那份），且只是透传。

## 6. 回滚

纯代码改动，无数据库结构 / 数据变更；回滚 = revert PR。dry_run 保持开启期间 D3 不产生 pending run，本改动对线上无即时影响。

---

## 7. 设计审结果与 v2 修订（2026-09-26）

三审（子牙 / 魏征 / 狄仁杰）均为「有条件通过」。Q1 不挡拒绝、Q2 独立文件、Q3 驳回也透传——三人一致同意。必改项合并后落为：

| # | 来源 | 修订 |
|---|---|---|
| R1 | 子牙1 · 狄1 | 专属决定路由的**批准**分支补档次 + 版本闸：`approvalPermissionsFor` 拆成「基础判定（版本 + 档次，读注册表）」+「专属入口层」；专属路由调基础判定（`assertActorMayApproveAction`），否则会被专属入口层自己挡住。测：门槛改 admin 时 paid_client 拿 403。 |
| R2 | 子牙2 · 魏1 | handoff 的排除下沉到**查询**：`listDeadLetterRuns(sb, since, { excludePendingActionKeys })` 用 `.or('status.neq.pending_approval,action_key.not.in.(…)')`，key 由登记表生成。测：60 条 D3 等批准 + 1 条其它死信，死信仍在。 |
| R3 | 子牙3 · 狄2 | 通用「按动作取等批准 run」放 `kernel-approval/`：客户版**必带** clientId，全客户版单独函数；决策有效性复用 `decisionBelongsToRun`（魏3）。广告 helper 只补展示字段，账行反查按 `client_id = run.client_id` 过滤。 |
| R4 | 子牙4 · 魏3 | 专属待办链接改读登记表；决策 id 无效的 run 待办写「这条坏了，回我一句」，不写「点批准」。 |
| R5 | 狄3 | 包装层运行时校验 id 是非空 uuid（请求体不受类型约束）；路由复用通用面现成的 `readExpectedDecisionId` 判据。 |
| R6 | 狄4 | `decideApproval` 批准分支再判一次专属入口（不只靠路由那一行）。 |
| R7 | 魏2 | 专属待办读失败 → 下发一条「读不出来」待办（三件套齐），补展示字段失败只降级。 |
| R8 | 魏4 | 专属列表降序取、超额如实给 `hasMore`，不静默截掉最新的。 |
| R9 | 魏5 · 魏6 · 魏7 | T8 用满权限账号并断言 `reason==='dedicated_entry'` + 文案含入口名；加一条经 `loadManualItems` 的端到端测试（孤儿 run 恰好一条待办；读失败也有一条）；页面列表键改 run id、任何 409 都重拉；T7 的「其它动作」用断言不在登记表里的键。 |

**记为后续、不在本 PR**（写进台账卡）：
- 关 dry_run 前只读查一次生产库有没有「已签批未执行」的 D3 run（魏征建议项；dry_run 一直开着的话理论上为 0）。
- 通用 handoff 对**其它**动作的「审批入口还没上线」文案已过时（通用审批页已上线）。
- 从通用面拒掉的专属动作，`flywheel_actions` 账行停在 `awaiting_approval`（纯展示账，读方已不按它过滤）。
- `CLIENT_VIEWERS`（名义只读）在权限上等同 paid_client，能批暂停——业务决定，问 PM。
- `runner.ts` 815 行 / `store.ts` 873 行已超 800 行铁律（基线即超），本 PR 净增尽量为零，拆分另立。
