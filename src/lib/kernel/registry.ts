/**
 * Typed Action Registry —— 平台级动作定义。
 *
 * 🔴 **在代码里，不在数据库里。** 三条理由（ADR-002 采纳）：
 *    ① 版本控制：契约变更走 PR，看得见谁改的、为什么改
 *    ② agent 运行时改不了：模型可以**提出**一个动作，但改不了动作的风险等级
 *    ③ 幂等规则 / 重试策略 / 验证方法漏写会**编译失败**，不是运行时才发现
 *
 * 🔴 未知动作 = deny。不是「先跑跑看」，也不是静默跳过 ——
 *    必须落一条 authorization_decisions 的 deny 记录，否则
 *    「AI 提了个我们没实现的动作」这件事没人看得见。
 */

import type { ActionDefinition, ActionKey } from './types'

/**
 * `seo.build_publish_package` —— Kernel v1 的 safe capability。
 *
 * 做什么：把一篇已经写好的 blog 草稿，连同它的 meta / schema / GEO 块 /
 * 上下文快照，固化成一个 versioned production package，**停在内部态**。
 *
 * 为什么选它做 v1（ADR-004 要求「真实执行但无客户外部副作用」）：
 *   · `production_packages` 表已经带 6 个来源 FK + generation_context_snapshot
 *     —— Kernel 的第一条 lineage 不需要新建关系，只需要接上
 *   · 验证是真的：回读 + content hash 比对 + 必填断言 + FK 可解析性断言，
 *     任何一条失败都是真失败（不像「断言 status 变了」那种同义反复）
 *   · 回滚干净：未发布的 package 没有下游消费者
 *
 * 🔴 `sideEffect: 'internal_write'` 是这个动作的红线。它一旦被改成
 *    `outward`，授权层与 Gateway 会各拒一次 —— 因为它的
 *    `outwardAuthorization` 是 `null`，而对外动作没有逐动作声明就不放行。
 */
const SEO_BUILD_PUBLISH_PACKAGE: ActionDefinition<'seo.build_publish_package'> = {
  actionKey: 'seo.build_publish_package',
  version: 1,
  title: '把过了初审的博客草稿固化成一个可发布包（不发布）',

  // 🔴 `content_hash` 必须由提交方在提交时算好（见 capabilities 的
  //    prepareBuildPublishPackageInput）。它是幂等键的一半，而幂等键的唯一约束
  //    建在 action_runs 上 —— 执行中才产生的值当不了幂等键。
  inputSchema: {
    type: 'object',
    required: ['blog_post_id', 'content_hash'],
    properties: {
      blog_post_id: { type: 'string' },
      content_hash: { type: 'string' },
      note: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['package_id', 'content_hash'],
    properties: {
      package_id: { type: 'string' },
      content_hash: { type: 'string' },
      title: { type: 'string' },
      word_count: { type: 'number' },
    },
    additionalProperties: true,
  },

  capability: 'seo.publish_package_builder',
  risk: 'low',
  // 🔴 内部写。不碰客户网站、不碰商家页、不碰社媒、不花钱。
  sideEffect: 'internal_write',
  reversible: true,

  // 不是对外动作，所以不需要对外许可。**保持 null 就是保持「不放行对外」。**
  outwardAuthorization: null,

  // 同一篇稿子 + 同样的正文 → 同一把键 → 只会有一个 package。
  // 稿子改了 content_hash 就变，那是**另一件事**，该有另一个 package。
  idempotency: { keyFields: ['blog_post_id', 'content_hash'], scope: 'client' },

  // 纯内部组装，不调 LLM、不调外部 API
  costModel: { kind: 'fixed', estimate: () => 0 },

  // 🔴 根本不调外部 provider —— 所以「重试会不会重复收费」这个问题不成立。
  //    将来任何真调外部 API 的动作，必须逐个确认之后如实填 supported / unsupported。
  providerIdempotency: 'not_applicable',

  retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseMs: 500 },

  // 🔴 验证不是可选项。没有它，「写入成功」就会被当成「事情做成了」。
  verification: { method: 'package_integrity', delayMs: 0 },

  requiredCapabilityTier: 'paid_client',

  // 域阶段住在 step_key —— 不往 run 的 status 枚举里加值
  steps: ['build', 'persist', 'verify'],

  allowedPurposes: ['growth'],
}

/**
 * `page.apply_optimization_request` —— v1 outward apply action.
 *
 * 把已经通过 Snapshot → Draft → Diff → Validation → Human Approval 的一份
 * `PageOptimizationRequest` 提交到目标 provider。GitHub v1 = **Draft PR**
 * （不直推 main、不 auto-merge）。verification = execution-integrity only；
 * Growth 层的 matched remeasurement 走下游 Measurement/Verification 链，
 * 不由本 action 承担、不由本 action 调度。
 *
 * spec: docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md
 *
 * 🔴 `sideEffect: 'outward'` + `outwardAuthorization` 非 null + `reversible: true`
 *    这三条同时成立才被 outward-authorization 层放行；`requiresHumanApproval: true`
 *    是字面量 true，policy 层 `auto_approve` 也会被 kernel 反手落
 *    `outward_requires_human_policy` deny 码。
 *
 * 🔴 idempotency key = `(page_url, page_version_token, validated_diff_hash)`：
 *    snapshot 或 diff 一变 → 是另一件事，重新走 authorize；
 *    approval 不进 key，approval 是过程（谁批的）不是事（要做什么）。
 */
const PAGE_APPLY_OPTIMIZATION_REQUEST: ActionDefinition<'page.apply_optimization_request'> = {
  actionKey: 'page.apply_optimization_request',
  version: 1,
  title: '把已授权的页面优化请求提交到目标 provider（GitHub v1: Draft PR，不合并）',

  inputSchema: {
    type: 'object',
    required: [
      'page_url',
      'page_version_token',
      'validated_diff_hash',
      'intents',
      'do_not_touch',
    ],
    properties: {
      page_url:            { type: 'string' },
      page_version_token:  { type: 'string' },
      validated_diff_hash: { type: 'string' },
      intents:             { type: 'array' },
      do_not_touch:        { type: 'array' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['provider', 'run_reference'],
    properties: {
      provider:      { type: 'string' },
      run_reference: { type: 'string' },
    },
    additionalProperties: true,
  },

  capability: 'page.apply_optimization_request',
  risk: 'medium',
  // 🔴 对客户公开面写入；默认拒绝，靠下面 outwardAuthorization 逐动作放行。
  sideEffect: 'outward',
  reversible: true,

  outwardAuthorization: {
    declaredIn: 'docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md',
    requiresHumanApproval: true,
    // 🔴 v1 rollback 语义（复审 2026-08-19 两位 reviewer 一致挑出 P0，随此 commit 修正）：
    //
    //    本字段仅**标注 provider 支持该路径的存在**（Draft PR pre-merge 允许 close
    //    PR + delete branch 复位），**不是**承诺 kernel/capability 会自动调用它。
    //
    //    v1 **不带自动 rollback dispatch**。任何在 branch/PR 已经创建之后失败的
    //    路径（stale-at-commit、open_pr 状态不自洽、record verification 失败），
    //    capability 会把孤儿 artefact 的直达链接写进 `humanReason` /
    //    `verification.failure_reason` —— 经 `failRun → run.last_error →
    //    handoff.ts → 今日待办的 what 字段`，PM 一眼可见并**手工**去客户
    //    GitHub 关 PR + 删分支。
    //
    //    自动化的 rollback handler + gateway dispatch 由 Kernel Outward Execution
    //    Hardening PR 承担（`docs/specs/2026-08-19-me2-kernel-outward-execution-hardening-v1.0.md`）。
    //
    //    post-merge git revert 不是本 v1 责任。
    rollback: 'provider_native',
  },

  // 三者共同确定唯一 run；snapshot 或 diff 一变 → 是另一件事。
  idempotency: {
    keyFields: ['page_url', 'page_version_token', 'validated_diff_hash'],
    scope: 'client',
  },

  // 🔴 outward-authorization.ts 要求 outward 动作每一步都有显式上界；
  //    GitHub API 免费，四步都是 0。
  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: { prepare: 0, commit: 0, open_pr: 0, record: 0 },
  },

  // GitHub `POST /pulls` 用同 `head` 分支是幂等（返回既有 PR），
  // `commitFile` 用同 blobSha 也幂等。
  providerIdempotency: 'supported',

  retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseMs: 1000 },

  // 🔴 execution-integrity only。不做 Growth 复测。
  verification: { method: 'page_apply_integrity', delayMs: 0 },

  requiredCapabilityTier: 'paid_client',

  steps: ['prepare', 'commit', 'open_pr', 'record'],

  allowedPurposes: ['growth'],
}

// ──────────────────────────────────────────────────────────────────────────
// 广告支柱 IMPACT 闭环 · 阶段 2 · 内核注册（P21.K）
//
// 设计文档：`~/.claude/plans/ads-impact-loop-capability.md`
//   §4.1（硬前置）/ §4.2（处方词表）/ §14.1（K1-K14 实施验收条款）
//
// 🔴 本轮只做四条契约声明 + 注册，**不带执行器**（`src/lib/capabilities/`
//    没有为它们注册任何 `CapabilityImplementation`）。K8-K12（挪预算 / 加
//    再营销组的真实执行逻辑）、Inngest 事件链、AD-ADV-1 留给 PR-B/PR-C。
//
// 🔴 四个动作 `costModel.estimate()` 一律返回 0（K4）：这里的"成本"指调用
//    Meta API 本身的内部成本（几乎为零），**不是广告预算金额**——广告花费
//    由 `budget_policy`（执行层，尚未实现）管，不进 Kernel 的成本上限。
//    `stepCeilingUsd` 同理全部声明 0（outward 动作要求每步显式非负上界，
//    不能留空——`outward-authorization.ts` 的判据）。
//
// 🔴 四个动作 `providerIdempotency` 一律 `unsupported`：翻查过
//    `src/lib/meta/client.ts` / `adsets.ts` / `ad-publisher.ts` /
//    `audience-ladder.ts`，没有发现 Meta 广告写入接口认自定义幂等键重放的
//    证据——收费/改资产步骤抛「结果未知」的异常时一律 fail closed 转死信，
//    不自动重试（Gateway 的 `paidStepWithoutIdempotency` 已经处理，
//    这里只需如实声明）。
//
// 🔴 `outwardAuthorization.rollback` 四个都声明 `'provider_native'`（不是
//    正文里"挪预算=恢复改前快照"字面对应的 `'snapshot_restore'`）——原因：
//    这四个动作的撤回**机制**都要靠再调一次 Meta API 才能生效（挪预算的
//    "恢复改前快照"实际做法是拿 K10 记录的改前值再发一次 Meta 更新请求，
//    不是纯本地状态回滚）。`rollback:'provider_native'` 才会触发 Gateway
//    既有的 assembly gate（`assertRollbackHandlerAssembled`，
//    `gateway.ts:243-260`）：capability 没挂 `rollback` handler 就
//    `ROLLBACK_HANDLER_MISSING` fail-closed、不消费授权。这是 K1
//    "拿掉撤回处理函数→执行被拒绝"这条变异点唯一能落地的选择——
//    若声明成 `snapshot_restore`，现有 assembly gate 不会去检查
//    capability 有没有挂 `rollback`，K1 的变异点测不出来。
//    **这是本 PR 对设计文档字面表述的一次具体化解释，不是改写条款本身**
//    ——已在 PR 描述里向 PM 标注这一点。
// ──────────────────────────────────────────────────────────────────────────

const ADS_DECLARED_IN = (clause: string): string =>
  `~/.claude/plans/ads-impact-loop-capability.md §4.2/§14.1 ${clause}`

const ADS_BUDGET_MOVE_PLAN: ActionDefinition<'ads.budget_move_plan'> = {
  actionKey: 'ads.budget_move_plan',
  version: 1,
  title: '按一次性计划挪动客户广告预算（先减后加，总预算不变，人审批）',

  inputSchema: {
    type: 'object',
    required: ['plan_id', 'client_ad_account_id', 'currency', 'legs'],
    properties: {
      plan_id: { type: 'string' },
      client_ad_account_id: { type: 'string' },
      currency: { type: 'string' },
      // 每条腿：{ from_adset_id, to_adset_id, delta_usd }。JsonSchemaLike
      // 不支持嵌套 item 类型，业务校验（腿的形状、总额是否平衡）留给
      // capability（K9/K10），这里只做结构闸。
      legs: { type: 'array' },
      note: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['plan_id', 'executed_legs'],
    properties: {
      plan_id: { type: 'string' },
      executed_legs: { type: 'array' },
      total_delta_usd: { type: 'number' },
    },
    additionalProperties: true,
  },

  capability: 'ads.budget_move_plan',
  risk: 'high',
  // 🔴 改动客户在 Meta 上的真实广告预算分配 —— 作用到客户资产之外。
  sideEffect: 'outward',
  // 🔴 动作本身可撤回（挪回去）。**已经花出去的钱撤不回**——这条只说明
  //    "预算分配"这件事能恢复到改前状态，不是说花费能追回。
  reversible: true,

  outwardAuthorization: {
    declaredIn: ADS_DECLARED_IN('K1（挪预算 ads.budget_move_plan）'),
    requiresHumanApproval: true,
    rollback: 'provider_native',
  },

  // 幂等键 = plan_id（§4.3：重复批准不重复执行）。
  idempotency: { keyFields: ['plan_id'], scope: 'client' },

  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: { decrease_legs: 0, increase_legs: 0, readback: 0, record: 0 },
  },

  providerIdempotency: 'unsupported',

  retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseMs: 1000 },

  verification: { method: 'ads_action_integrity', delayMs: 0 },

  requiredCapabilityTier: 'paid_client',

  // §4.3：先减后加；任一腿失败→自动回滚已执行的腿→回读确认→人工任务。
  steps: ['decrease_legs', 'increase_legs', 'readback', 'record'],

  allowedPurposes: ['growth'],
}

const ADS_ADD_RETARGETING_ADSET: ActionDefinition<'ads.add_retargeting_adset'> = {
  actionKey: 'ads.add_retargeting_adset',
  version: 1,
  title: '在已授权的再营销受众上新建广告组（暂停态起步，回读后再激活，人审批+预算审批）',

  inputSchema: {
    type: 'object',
    required: ['client_ad_account_id', 'campaign_id', 'audience_id', 'creative_ref'],
    properties: {
      client_ad_account_id: { type: 'string' },
      campaign_id: { type: 'string' },
      audience_id: { type: 'string' },
      creative_ref: { type: 'string' },
      budget_mode: { type: 'string' },
      note: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['adset_id', 'status'],
    properties: {
      adset_id: { type: 'string' },
      status: { type: 'string' },
    },
    additionalProperties: true,
  },

  capability: 'ads.add_retargeting_adset',
  risk: 'medium',
  sideEffect: 'outward',
  // 🔴 新建的广告组本身可撤回（暂停/删除）；对外授权判据不覆盖"这期间
  //    已经花出去的钱"——那部分撤不回。
  reversible: true,

  outwardAuthorization: {
    declaredIn: ADS_DECLARED_IN('K1（加再营销组 ads.add_retargeting_adset）'),
    requiresHumanApproval: true,
    rollback: 'provider_native',
  },

  idempotency: { keyFields: ['campaign_id', 'audience_id'], scope: 'client' },

  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: { create_paused: 0, readback: 0, activate: 0, record: 0 },
  },

  providerIdempotency: 'unsupported',

  retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseMs: 1000 },

  verification: { method: 'ads_action_integrity', delayMs: 0 },

  requiredCapabilityTier: 'paid_client',

  // K8：先内核授权→暂停建→回读→激活，同一次运行。
  steps: ['create_paused', 'readback', 'activate', 'record'],

  allowedPurposes: ['growth'],
}

const ADS_CREATE_AUDIENCE: ActionDefinition<'ads.create_audience'> = {
  actionKey: 'ads.create_audience',
  version: 1,
  title: '按 object_id 建一个再营销受众（去重，不按名字匹配；从处方链触发时人审批）',

  inputSchema: {
    type: 'object',
    required: ['client_ad_account_id', 'object_id', 'object_type'],
    properties: {
      client_ad_account_id: { type: 'string' },
      // 🔴 按 object_id 去重（视频 id / 主页 id 等），不按名字匹配（§3.3 D4）。
      object_id: { type: 'string' },
      object_type: { type: 'string' },
      retention_days: { type: 'number' },
      note: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['audience_id', 'status'],
    properties: {
      audience_id: { type: 'string' },
      status: { type: 'string' },
    },
    additionalProperties: true,
  },

  capability: 'ads.create_audience',
  risk: 'low',
  sideEffect: 'outward',
  reversible: true,

  outwardAuthorization: {
    // 🔴 §4.2：独立受众路由时豁免人审批；但**从处方链触发时不享受豁免**
    //    （K2）——这里注册的就是处方链路径，所以 requiresHumanApproval
    //    仍然是字面量 true，跟其余三个动作一致。
    declaredIn: ADS_DECLARED_IN('K1/K2（建受众 ads.create_audience，处方链路径不豁免）'),
    requiresHumanApproval: true,
    rollback: 'provider_native',
  },

  idempotency: { keyFields: ['object_id', 'object_type'], scope: 'client' },

  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: { create: 0, record: 0 },
  },

  providerIdempotency: 'unsupported',

  retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseMs: 1000 },

  verification: { method: 'ads_action_integrity', delayMs: 0 },

  requiredCapabilityTier: 'paid_client',

  steps: ['create', 'record'],

  allowedPurposes: ['growth'],
}

const ADS_PAUSE: ActionDefinition<'ads.pause'> = {
  actionKey: 'ads.pause',
  version: 1,
  title: '暂停一个广告实体（广告系列/广告组/广告），止损动作',

  inputSchema: {
    type: 'object',
    required: ['client_ad_account_id', 'entity_id', 'entity_type'],
    properties: {
      client_ad_account_id: { type: 'string' },
      entity_id: { type: 'string' },
      entity_type: { type: 'string' },
      reason: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['entity_id', 'status'],
    properties: {
      entity_id: { type: 'string' },
      status: { type: 'string' },
    },
    additionalProperties: true,
  },

  capability: 'ads.pause',
  risk: 'medium',
  // 🔴 判断依据：`ads.pause` 直接改动客户在 Meta 上正在投放的广告实体的
  //    投放状态（running → paused），这个状态变化对客户可见、由客户的
  //    真实资产承担——即使方向是"止损/更安全"，仍然是写到客户资产之外，
  //    不满足"不需要 outwardAuthorization"的条件。没有为它省略声明。
  sideEffect: 'outward',
  // 🔴 撤回 = 重新激活（Meta 原生支持 unpause）。同样：暂停期间已经流失的
  //    展示/点击机会不算"撤"的对象，这条只保证"投放状态"能恢复。
  reversible: true,

  outwardAuthorization: {
    declaredIn: ADS_DECLARED_IN('K1（止损暂停 ads.pause）'),
    requiresHumanApproval: true,
    rollback: 'provider_native',
  },

  idempotency: { keyFields: ['entity_id'], scope: 'client' },

  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: { pause: 0, record: 0 },
  },

  providerIdempotency: 'unsupported',

  retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseMs: 1000 },

  verification: { method: 'ads_action_integrity', delayMs: 0 },

  requiredCapabilityTier: 'paid_client',

  steps: ['pause', 'record'],

  allowedPurposes: ['growth'],
}

const DEFINITIONS: Readonly<Record<ActionKey, ActionDefinition>> = {
  'seo.build_publish_package': SEO_BUILD_PUBLISH_PACKAGE,
  'page.apply_optimization_request': PAGE_APPLY_OPTIMIZATION_REQUEST,
  'ads.budget_move_plan': ADS_BUDGET_MOVE_PLAN,
  'ads.add_retargeting_adset': ADS_ADD_RETARGETING_ADSET,
  'ads.create_audience': ADS_CREATE_AUDIENCE,
  'ads.pause': ADS_PAUSE,
}

export interface ActionRegistry {
  /** 认识这个 key 吗。认不出的一律 deny。 */
  has(actionKey: string): actionKey is ActionKey
  /** 拿定义。**认不出返回 null，绝不抛「大概是这个」的猜测。** */
  get(actionKey: string): ActionDefinition | null
  /** 全部已注册的 key —— 用来反向注入 agent prompt，把生成端也收成封闭词汇表。 */
  keys(): readonly ActionKey[]
}

export const ACTION_REGISTRY: ActionRegistry = {
  has(actionKey: string): actionKey is ActionKey {
    return Object.prototype.hasOwnProperty.call(DEFINITIONS, actionKey)
  },
  get(actionKey: string): ActionDefinition | null {
    return ACTION_REGISTRY.has(actionKey) ? DEFINITIONS[actionKey] : null
  },
  keys(): readonly ActionKey[] {
    return Object.keys(DEFINITIONS) as ActionKey[]
  },
}

export const ACTION_KEYS = Object.keys(DEFINITIONS) as readonly ActionKey[]

/**
 * 输入是否符合定义的 input_schema。
 *
 * 刻意只做**结构**校验（必填 + 类型 + 多余字段），不做业务校验 ——
 * 业务校验属于 capability，塞进这里会让注册表悄悄变成业务逻辑的存放地。
 */
export function validateAgainstSchema(
  schema: ActionDefinition['inputSchema'],
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: '输入必须是一个对象' }
  }
  const obj = value as Record<string, unknown>

  for (const key of schema.required ?? []) {
    if (obj[key] === undefined || obj[key] === null) {
      return { ok: false, reason: `缺少必填字段 ${key}` }
    }
  }

  for (const [key, spec] of Object.entries(schema.properties)) {
    const v = obj[key]
    if (v === undefined || v === null) continue
    const actual = Array.isArray(v) ? 'array' : typeof v
    if (actual !== spec.type) {
      return { ok: false, reason: `字段 ${key} 应该是 ${spec.type}，实际是 ${actual}` }
    }
  }

  if (schema.additionalProperties === false) {
    const extra = Object.keys(obj).filter((k) => !(k in schema.properties))
    if (extra.length > 0) {
      return { ok: false, reason: `多了没定义的字段：${extra.join('、')}` }
    }
  }

  return { ok: true }
}
