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
import { ADS_ACTION_DEFINITIONS } from './registry-ads'
import { CONFIRMATION_HOLD_DEFINITION } from './registry-confirmation'

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
 *    这三条同时成立才被 outward-authorization 层放行；它声明的是
 *    `approval: { mode: 'human_only' }`，所以即便客户把政策配成 `auto_approve`，
 *    授权层也会反手落一个 `outward_requires_human_policy` deny 码。
 *    （2026-09-24 广告支柱新增了 `bounded` 模式，但**这个动作没有选它** ——
 *    页面写入没有「信封」这个概念，它的边界是人点头。）
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
    approval: { mode: 'human_only' },
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

/**
 * `ads.auto_pause_on_d3` —— 把「花钱没结果」的广告组暂停（诊断层 D3 命中）。
 *
 * 做什么：D1-D9 只读诊断（`src/lib/ads-strategy/portfolio/diagnostics/`）里
 * D3（近 7 天花费 ≥ 2× 目标单次成本、且单次成本 ≥ 2× 目标）命中某个广告组时，
 * 把**那一个**广告组暂停（`setAdSetStatus`）。D3 只在 adset 级命中，
 * 所以这个动作从不碰 campaign 级接口，也不需要「是否所有 adset 都命中」
 * 这种升级判断——那个问题只有复用 campaign 级 `executeStopLoss` 时才存在。
 *
 * 🔴 **为什么是 `outward` + 必须人工批准**（2026-09-22 三轮方案定稿）：
 *    这是一次真实的 Meta API 写入（会立刻停止一条正在花钱的广告组投放），
 *    完全符合本仓 `outward` 的判据（"对客户线上资产的真实写入"，
 *    参照 `page.apply_optimization_request` 同样写客户自己的资产也是 outward）。
 *    `outwardBlockReason` / `authorize.ts` 的对外闸门是硬性不可绕过的
 *    （`requiresHumanApproval` 只能是字面量 `true`，`auto_approve` 策略下
 *    outward 动作永远被拒）——PM 2026-09-22 最初要的"零点击全自动"在这道闸下
 *    做不到，PM 确认后改为"一键批准"：`ad_strategy_configs.autopilot_enabled`
 *    控制要不要为这个客户生成待批准的暂停建议，但真正执行仍然要 FDE/PM
 *    在待办卡片上点一下"批准"（`src/lib/action-submission/ads-auto-pause.ts`
 *    的 `approveAndExecuteAdsAutoPause`，一次调用签批准+执行）。
 *
 * 🔴 **`providerIdempotency: 'supported'`**：暂停是纯状态置位（等价于 PUT
 *    status=PAUSED），reput 不会产生第二次副作用、不会重复扣费——跟
 *    `page.apply_optimization_request` 那种"重放可能第二次真的发生"的创建型
 *    操作不是一回事。这让 Gateway 在结果未知的失败上可以安全自动重试，
 *    不必每次瞬时故障都转人工。
 *
 * 🔴 **`reversible: true` + `rollback: 'provider_native'`**：撤回 = 把广告组
 *    状态设回 `ACTIVE`（同样是幂等的状态置位）。
 */
const ADS_AUTO_PAUSE_ON_D3: ActionDefinition<'ads.auto_pause_on_d3'> = {
  actionKey: 'ads.auto_pause_on_d3',
  version: 1,
  title: '把花钱没结果的广告组暂停（D3 命中，需人工批准）',

  inputSchema: {
    type: 'object',
    required: ['ad_account_id', 'adset_id', 'diagnosis_code', 'insight_date'],
    properties: {
      ad_account_id: { type: 'string' },
      adset_id: { type: 'string' },
      // 目前只有 D3，字段仍然显式声明——将来别的诊断码想复用这个动作，
      // 幂等键天然按诊断码分开，不需要改契约。
      diagnosis_code: { type: 'string' },
      insight_date: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['adset_id', 'paused', 'verified_status'],
    properties: {
      adset_id: { type: 'string' },
      paused: { type: 'boolean' },
      verified_status: { type: 'string' },
    },
    additionalProperties: true,
  },

  capability: 'ads.auto_pause_on_d3',
  risk: 'medium',
  sideEffect: 'outward',
  reversible: true,

  outwardAuthorization: {
    declaredIn: 'docs/specs/2026-09-22-me2-ads-d3-auto-pause-v1.0.md',
    approval: { mode: 'human_only' },
    rollback: 'provider_native',
  },

  // 同一个广告账户 + 同一个广告组 + 同一个诊断码 + 同一个诊断日 → 同一件事。
  // insight_date 进键是刻意的：诊断每天只跑一次，这把键天然做到
  // 「24 小时内同一条广告不重复出手」，不需要另外维护一张去重表。
  idempotency: {
    keyFields: ['ad_account_id', 'adset_id', 'diagnosis_code', 'insight_date'],
    scope: 'client',
  },

  // 暂停不花钱（它只会让花费停下来）。
  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: { pause: 0, verify: 0 },
  },

  providerIdempotency: 'supported',

  retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseMs: 1000 },

  verification: { method: 'ads_pause_integrity', delayMs: 0 },

  requiredCapabilityTier: 'paid_client',

  steps: ['pause', 'verify'],

  // 🔴 不是 'growth'：`submitActionRun` 要求 purpose='growth' 的提交必须挂
  //    goal_id，而 Goal/Initiative/Plan 层目前多数客户是空的（见
  //    project-goal-initiative-plan-layer-underused 记忆）——挂一个不存在
  //    或硬凑的目标，比不挂更危险。「花钱没结果就停」是保护账户基线不被
  //    继续烧钱，不是在追求某个具体增长目标，归类成 maintenance 更诚实。
  allowedPurposes: ['maintenance'],
}

const DEFINITIONS: Readonly<Record<ActionKey, ActionDefinition>> = {
  'seo.build_publish_package': SEO_BUILD_PUBLISH_PACKAGE,
  'page.apply_optimization_request': PAGE_APPLY_OPTIMIZATION_REQUEST,
  'ads.auto_pause_on_d3': ADS_AUTO_PAUSE_ON_D3,
  // 广告支柱受限自治六件（spec 2026-09-24 §3 G4/G5）。定义在 registry-ads.ts，避免本文件继续膨胀。
  ...ADS_ACTION_DEFINITIONS,
  'governance.p0_confirmation': CONFIRMATION_HOLD_DEFINITION,
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
