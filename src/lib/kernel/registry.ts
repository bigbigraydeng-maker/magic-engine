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
 *    `outward`，Gateway 会直接拒绝执行（v1 不允许任何对外副作用）。
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

const DEFINITIONS: Readonly<Record<ActionKey, ActionDefinition>> = {
  'seo.build_publish_package': SEO_BUILD_PUBLISH_PACKAGE,
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
