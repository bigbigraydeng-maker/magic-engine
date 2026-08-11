/**
 * Magic Engine 2.0 · Execution Kernel —— 类型契约（Issue #859）
 *
 * 这个文件是 Kernel 的宪法：动作长什么样、授权长什么样、执行实例长什么样。
 * 它**不 import 任何东西**（除了 access tier），因为下面每一层都要 import 它。
 *
 * 三层切分（ADR-002 裁定）：
 *   · ActionDefinition        —— 平台级，**代码内**，版本控制，agent 运行时改不了
 *   · ClientAutomationPolicy  —— 客户级，**入库**，PM/FDE 可改
 *   · AuthorizationDecision   —— 每次判定，**append-only**，谁授权的有据可查
 */

import type { AccessTier } from '@/lib/auth/access-types'

// ── 动作身份 ──────────────────────────────────────────────────────────────────

/**
 * 稳定的动作键，带域前缀。
 *
 * 🔴 为什么必须是封闭枚举：现在动作类型是 AI 现编的自由文本（36 种，含
 *    `diversify_meta_ad_creatives` 与 `diversify_meta_creatives` 这种同义重复）。
 *    只要生成端是开放词汇表，消费端的注册表就永远对不上 ——
 *    注册表建好之后必须把它反向注入 prompt，否则只会从「36 种自由文本」
 *    变成「36 种自由文本 + 一张对不上的表」。
 */
export type ActionKey = 'seo.build_publish_package'

/** 一个 run 为了什么而跑。决定它需不需要挂 Goal。 */
export type ActionPurpose =
  /** 服务某个客户增长目标 —— **必须**挂 goal_id */
  | 'growth'
  /** 法规 / 平台规则驱动（广告用词合规、退订处理）—— 不服务某个增长目标 */
  | 'compliance'
  /** 保持数据新鲜（周度重爬、关键词快照）—— 不属于任何 Goal */
  | 'maintenance'
  /** 修自己（回收超时认领、重置卡死的生成任务） */
  | 'recovery'
  /** 系统卫生（清理过期作业、扫死信） */
  | 'housekeeping'

/** 谁把这个 run 推起来的。 */
export type TriggeredBy = 'signal' | 'schedule' | 'human' | 'agent' | 'run'

export type RiskLevel = 'low' | 'medium' | 'high' | 'irreversible'

/** 副作用作用在哪。`outward` = 会作用到客户自有资产之外，v1 永远不许出现。 */
export type SideEffectClass = 'none' | 'internal_write' | 'external_read' | 'outward'

// ── 动作定义（代码内 typed registry） ─────────────────────────────────────────

/** 最小 JSON Schema 形状 —— 只用来校验 input/output，不引第三方校验器。 */
export interface JsonSchemaLike {
  type: 'object'
  required?: readonly string[]
  properties: Readonly<Record<string, { type: 'string' | 'number' | 'boolean' | 'object' | 'array' }>>
  additionalProperties?: boolean
}

export interface IdempotencyRule {
  /** 从 input 的哪几个字段算幂等键。**必填** —— 不声明过不了类型检查。 */
  readonly keyFields: readonly string[]
  readonly scope: 'client' | 'global'
}

export interface CostModel {
  readonly kind: 'fixed' | 'per_unit' | 'estimated'
  /** 估算这次要花多少美金。纯内部动作返回 0。 */
  estimate(input: Record<string, unknown>): number
  /**
   * 每一步**最多**会花多少美金（step_key → 上界）。
   *
   * 🔴 有了它，「还剩多少预算」才能在**调用供应商之前**判准：
   *    已花 $2、上限 $2、下一步要花 $1 —— 不该等花成 $3 才发现超了。
   *
   *    没声明的步骤 = 成本未知。未知不等于放行也不等于拦死：
   *      · 整个动作的 estimate 是 0（契约说它根本不花钱）→ 视为上界 0；
   *      · 否则只在**预算已经见底**时 fail closed。
   *    这是刻意的 —— 凭空给未知步骤编一个数字，比不判还危险。
   */
  readonly stepCeilingUsd?: Readonly<Record<string, number>>
}

/**
 * 这个动作的外部 provider 支不支持「同一把幂等键重放」。
 *
 * 🔴 它决定的是一件很具体的事：**收费步骤抛出「结果未知」的异常时，能不能自动重试。**
 *    - `supported`     —— provider 认 `CapabilityStepContext.idempotencyKey`，
 *                         重放不会重复收费 / 重复做 → 可以自动重试；
 *    - `unsupported`   —— 重试可能再收一次钱 → **一律 fail closed，转死信让人来判**；
 *    - `not_applicable` —— 这个动作根本不调外部 provider（纯内部写、零成本）。
 *
 * 🔴 声明 `not_applicable` 却又声明了正的每步上限 = 契约自相矛盾，
 *    运行时按最保守的 `unsupported` 处置（有注册表测试盯着这条一致性）。
 */
export type ProviderIdempotency = 'not_applicable' | 'supported' | 'unsupported'

export interface RetryPolicy {
  readonly maxAttempts: number
  readonly backoff: 'exponential' | 'fixed'
  readonly baseMs: number
}

/** 验证方法键 —— 真去回读并断言，不是「写成功了所以算成功」。 */
export type VerificationMethod = 'package_integrity'

export interface VerificationSpec {
  readonly method: VerificationMethod
  readonly delayMs: number
}

/**
 * 平台级动作定义。**代码内、版本控制、agent 运行时改不了。**
 *
 * 每一项都不是装饰：漏掉 idempotency 就会重复执行，漏掉 verification
 * 就会拿「写入成功」冒充「事情做成了」，漏掉 sideEffect 就没人知道
 * 这个动作会不会碰到客户的对外资产。
 */
export interface ActionDefinition<K extends ActionKey = ActionKey> {
  readonly actionKey: K
  /** 契约变更即 +1。旧 run 按记录时的版本回放，新旧版本不许互相兑换授权。 */
  readonly version: number
  readonly title: string
  readonly inputSchema: JsonSchemaLike
  readonly outputSchema: JsonSchemaLike
  /** 执行这个动作需要什么能力（capability 层按它注册处理器） */
  readonly capability: string
  readonly risk: RiskLevel
  readonly sideEffect: SideEffectClass
  readonly reversible: boolean
  readonly idempotency: IdempotencyRule
  readonly costModel: CostModel
  /**
   * 外部 provider 的幂等能力。决定「收费步骤抛出结果未知的异常时能不能自动重试」。
   * 🔴 不许乐观填 —— 填错的代价是客户被重复扣款。
   */
  readonly providerIdempotency: ProviderIdempotency
  readonly retryPolicy: RetryPolicy
  readonly verification: VerificationSpec | null
  /** 谁有资格授权它。复用现成的 auth/access-types.ts，不另发明一套角色。 */
  readonly requiredCapabilityTier: AccessTier
  /** 这个动作的执行阶段。域阶段住这里，不住 run 的 status 枚举。 */
  readonly steps: readonly string[]
  /** 这个 run 允许的 purpose。写死在定义里，防止同一个动作一会儿算增长一会儿算维护。 */
  readonly allowedPurposes: readonly ActionPurpose[]
}

// ── 客户级策略（入库） ────────────────────────────────────────────────────────

export type PolicyMode = 'auto_approve' | 'require_approval' | 'deny'

export interface ClientAutomationPolicy {
  id: string
  client_id: string
  action_key: string
  mode: PolicyMode
  policy_version: number
  spend_cap_per_run_usd: number | null
  spend_cap_per_period_usd: number | null
  spend_cap_period: 'day' | 'week' | 'month' | null
  decision_ttl_seconds: number
  effective_from: string
  effective_to: string | null
  updated_by: string
}

// ── 授权决策（append-only） ───────────────────────────────────────────────────

export type Verdict = 'allow' | 'require_approval' | 'deny'

/**
 * 机器可读的拒绝码。
 *
 * 🔴 `unknown_action` 必须落一条 deny 记录，不能只是静默不执行 ——
 *    否则「AI 提了个我们没实现的动作」这件事没人看得见。
 */
export type DenyCode =
  | 'unknown_action'
  | 'unknown_action_version'
  | 'no_policy'
  | 'policy_deny'
  | 'policy_expired'
  | 'over_cost_cap'
  | 'invalid_input'
  | 'purpose_not_allowed'
  | 'outward_side_effect_blocked'
  /**
   * 挂起等审批期间，客户的规则被改过了（模式变了 / 版本变了）。
   * 🔴 人工批准只能把「当前仍是 require_approval 的同一版政策」变成放行，
   *    不能拿一份旧规则下的审批请求去覆盖新规则。
   */
  | 'policy_changed_since_request'
  /** 找不到当初挂起这条动作的那份审批请求 —— 没有锚就不能签放行。 */
  | 'approval_context_lost'

export interface AuthorizationDecision {
  id: string
  action_run_id: string
  client_id: string
  action_key: string
  action_version: number
  verdict: Verdict
  deny_code: DenyCode | null
  reason: string
  policy_snapshot: Record<string, unknown>
  /**
   * 签发依据的**具体那一行**政策（uuid）。
   * 🔴 只记版本号不够：「auto v1 → 删掉 → 重建 deny v1」时版本号完全一样，
   *    只有行身份能把两条政策分开。没有政策参与的判定（如未知动作）为 null。
   */
  policy_id: string | null
  policy_version: number | null
  decided_by: 'policy' | 'human'
  decided_by_user: string | null
  cost_cap_usd: number | null
  cost_estimate_usd: number | null
  idempotency_key: string
  expires_at: string | null
  consumed_at: string | null
  consumed_by: string | null
  created_at: string
}

// ── 执行实例 ──────────────────────────────────────────────────────────────────

export type RunStatus =
  | 'queued'
  | 'authorizing'
  | 'authorized'
  | 'pending_approval'
  | 'denied'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'dead_letter'
  | 'superseded'

export type StepStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'dead_letter'
  | 'skipped'

export interface ActionRun {
  id: string
  client_id: string
  purpose: ActionPurpose
  goal_id: string | null
  execution_item_id: string | null
  triggered_by: TriggeredBy
  triggered_by_ref: string | null
  action_key: string
  action_version: number
  input: Record<string, unknown>
  rationale: string | null
  evidence: Record<string, unknown>
  idempotency_key: string
  status: RunStatus
  authorization_decision_id: string | null
  correlation_id: string
  cost_cap_usd: number | null
  cost_estimate_usd: number | null
  needs_human: boolean
  last_error: string | null
  /**
   * 运行所有权（租约）。「已经有人在做了」必须意味着 `lease_expires_at > now()`
   * 且 `claimed_by` 不为空 —— 否则这条 run 就是无主的，可以被显式接管。
   */
  claimed_by: string | null
  claimed_at: string | null
  heartbeat_at: string | null
  lease_expires_at: string | null
  previous_claimed_by: string | null
  reclaim_count: number
  last_reclaimed_at: string | null
  /**
   * 🔴 单调递增的**领取代际（fencing token）**。每次换人 +1。
   * 光有 owner 字符串不够：接管之后旧执行者手里的 step_id / run_id 依然有效，
   * 「按 id 更新」的每一句还能写进去。代际让每一次推进性写入都能问
   * 「我这一代还是当前那一代吗」，而且单调 → 不存在 ABA。
   */
  claim_generation: number
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
}

export interface VerificationResult {
  method: VerificationMethod
  passed: boolean
  checks: Array<{ name: string; passed: boolean; detail?: string }>
  failure_reason?: string
}

export interface ActionRunStep {
  /** 这一行属于哪一代执行者。写入守卫直接落在这一列上（见 ActionRun.claim_generation）。 */
  claim_generation: number
  id: string
  run_id: string
  client_id: string
  step_key: string
  step_index: number
  status: StepStatus
  claimed_by: string | null
  claimed_at: string | null
  heartbeat_at: string | null
  attempt: number
  reclaim_count: number
  next_attempt_at: string | null
  output: Record<string, unknown>
  verification: VerificationResult | null
  cost_actual_usd: number
  last_error: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
}

// ── 授权上下文（L2 —— 编译期门面） ────────────────────────────────────────────

/**
 * 🔴 这个 symbol **只声明不导出**，模块外无法写出满足该类型的对象字面量。
 *
 * 唯一的绕过是 `as unknown as AuthorizedExecutionContext` —— 那是一行
 * **显式写下的规避代码**，code review 抓得住，架构测试也扫得出来
 * （`kernel/__tests__/architecture.test.ts` 的 "no forged contexts"）。
 *
 * 更重要的是：伪造 ctx 也没用。Gateway 把 ctx 只当索引，每一个授权事实
 * 都从 append-only 的 authorization_decisions 里重读一遍再比对
 * （见 gateway.ts 的 assertDecisionMatches）。
 */
declare const AUTHORIZED_BRAND: unique symbol

export interface AuthorizedExecutionContext<K extends ActionKey = ActionKey> {
  readonly [AUTHORIZED_BRAND]: 'authorized'
  readonly decisionId: string
  readonly runId: string
  readonly clientId: string
  readonly actionKey: K
  readonly actionVersion: number
  readonly policyVersion: number | null
  readonly costCapUsd: number | null
  readonly idempotencyKey: string
  readonly expiresAt: string | null
}

/** capability 处理器拿到的东西：授权上下文 + 一个只属于本步骤的写句柄。 */
export interface CapabilityStepContext {
  readonly ctx: AuthorizedExecutionContext
  readonly stepKey: string
  readonly attempt: number
  /**
   * 这一步的**外部幂等键**。传给 provider，让重复调用在对方那边收敛成一次。
   *
   * 🔴 生命周期 = 「这个客户的这件事的这一步」，**跨重试、跨死信重跑、跨接管都不变**，
   *    所以刻意**不含 attempt、不含代际、不含 run 的任何一次执行痕迹**。
   *    含了就等于每次重试都是一个新键，provider 那边就会做第二遍。
   *
   * 🔴 它保证的是「我们每次都出示同一张收据」，**不是** exactly-once ——
   *    provider 不认这个键的话，端到端仍然只有 at-least-once。
   *    见 spec §「我们到底保证什么」。
   */
  readonly idempotencyKey: string
  /** 上游步骤的产物。断点续跑时这里带着已完成步骤的 output。 */
  readonly priorOutputs: Readonly<Record<string, Record<string, unknown>>>
}

export interface CapabilityStepResult {
  output: Record<string, unknown>
  /** 这一步真花了多少钱。钱是在具体的外部调用上花掉的，所以记在 step 上。 */
  costActualUsd?: number
  verification?: VerificationResult
}

export type CapabilityStepHandler = (
  step: CapabilityStepContext,
) => Promise<CapabilityStepResult>

/** 一个 capability = 一组按 step_key 索引的处理器。 */
export interface CapabilityImplementation {
  readonly actionKey: ActionKey
  readonly version: number
  readonly steps: Readonly<Record<string, CapabilityStepHandler>>
}
