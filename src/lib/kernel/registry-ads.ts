/**
 * 广告支柱受限自治的六个动作定义（spec `docs/specs/2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md` §3 G4/G5）。
 *
 * PM 2026-09-24 拍板：信封内自动执行、信封外不执行也不转审批，而是落一条可恢复的 deny
 * 并给 PM 三件套待办。
 *
 * 🔴 六个全部 `sideEffect: 'outward'` + `approval: { mode: 'bounded' }`。结构闸（`outward-authorization.ts`）
 *    查声明完不完整；实例闸（`authorize.ts` ⑥c 与 `gateway.ts` 碰 provider 前）各查一次这一次的改动在不在信封内。
 *
 * 🔴 `costModel.stepCeilingUsd` 必须给**每一个** step 一个有限非负金额 —— 结构闸逐 step 查，漏一个就不放行。
 *    广告花费**不进** Kernel 成本字段（§14 K4），这里的上界是「这一步自身会不会烧 API 钱」，全部是 0。
 */

import type { ActionDefinition, AutonomyEnvelope } from './types'

/** 六个广告动作共用的信封。改这里 = 改全部六个的自治边界，要过 review。 */
const ADS_ENVELOPE: AutonomyEnvelope = {
  maxBudgetDeltaRatio: 0.2,
  respectDailyCapCents: true,
  minHoursSinceLastChange: 72,
  excludeLearningPhase: true,
  excludeAdStudies: true,
  requiresRollbackHandler: true,
}

const DECLARED_IN = 'docs/specs/2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md §3 G5'

function zeroCeilings(steps: readonly string[]): Record<string, number> {
  return Object.fromEntries(steps.map(s => [s, 0]))
}

/**
 * `ads.pause_unit` —— **收**类。只会让花费变少，所以不走变动比例那一条；
 * 信封里对它最关键的是 `minHoursSinceLastChange`（反复暂停/恢复会重置 Meta 学习期）。
 */
const ADS_PAUSE_UNIT: ActionDefinition<'ads.pause_unit'> = {
  actionKey: 'ads.pause_unit',
  version: 1,
  title: '暂停一个投放单位（只会让花费变少）',
  inputSchema: {
    type: 'object',
    required: ['cycle_date', 'ad_account_id', 'adset_id'],
    properties: {
      cycle_date: { type: 'string' },
      ad_account_id: { type: 'string' },
      adset_id: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['applied'],
    properties: {
      applied: { type: 'boolean' },
    },
    additionalProperties: true,
  },
  capability: 'ads.pause_unit',
  risk: 'high',
  sideEffect: 'outward',
  reversible: true,
  outwardAuthorization: {
    declaredIn: DECLARED_IN,
    approval: { mode: 'bounded', envelope: ADS_ENVELOPE },
    rollback: 'snapshot_restore',
  },
  idempotency: { keyFields: ['cycle_date', 'adset_id'], scope: 'client' },
  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: zeroCeilings(['snapshot_pre', 'apply', 'readback']),
  },
  providerIdempotency: 'unsupported',
  retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 0 },
  verification: { method: 'ads_readback_integrity', delayMs: 600_000 },
  requiredCapabilityTier: 'paid_client',
  steps: ['snapshot_pre', 'apply', 'readback'],
  allowedPurposes: ['growth'],
}

/**
 * `ads.cut_unit_budget` —— **收**类。砍预算不走变动比例（只会让花费变少），
 * 信封里对它最关键的是 `respectDailyCapCents`（砍完不能低于客户配的日上限口径）。
 */
const ADS_CUT_UNIT_BUDGET: ActionDefinition<'ads.cut_unit_budget'> = {
  actionKey: 'ads.cut_unit_budget',
  version: 1,
  title: '砍一个投放单位的日预算（不超过信封允许的比例）',
  inputSchema: {
    type: 'object',
    required: ['cycle_date', 'ad_account_id', 'adset_id', 'after_cents'],
    properties: {
      cycle_date: { type: 'string' },
      ad_account_id: { type: 'string' },
      adset_id: { type: 'string' },
      after_cents: { type: 'number' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['applied'],
    properties: {
      applied: { type: 'boolean' },
    },
    additionalProperties: true,
  },
  capability: 'ads.cut_unit_budget',
  risk: 'high',
  sideEffect: 'outward',
  reversible: true,
  outwardAuthorization: {
    declaredIn: DECLARED_IN,
    approval: { mode: 'bounded', envelope: ADS_ENVELOPE },
    rollback: 'snapshot_restore',
  },
  idempotency: { keyFields: ['cycle_date', 'adset_id', 'after_cents'], scope: 'client' },
  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: zeroCeilings(['snapshot_pre', 'apply', 'readback']),
  },
  providerIdempotency: 'unsupported',
  retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 0 },
  verification: { method: 'ads_readback_integrity', delayMs: 600_000 },
  requiredCapabilityTier: 'paid_client',
  steps: ['snapshot_pre', 'apply', 'readback'],
  allowedPurposes: ['growth'],
}

/**
 * `ads.scale_unit_budget` —— **放**类。信封里对它最关键的是 `respectDailyCapCents`
 * 与 `maxBudgetDeltaRatio`：加预算同时受客户日上限和 ±20% 两道约束。
 */
const ADS_SCALE_UNIT_BUDGET: ActionDefinition<'ads.scale_unit_budget'> = {
  actionKey: 'ads.scale_unit_budget',
  version: 1,
  title: '给一个表现好的投放单位加日预算（不超过信封允许的比例和日上限）',
  inputSchema: {
    type: 'object',
    required: ['cycle_date', 'ad_account_id', 'adset_id', 'after_cents'],
    properties: {
      cycle_date: { type: 'string' },
      ad_account_id: { type: 'string' },
      adset_id: { type: 'string' },
      after_cents: { type: 'number' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['applied'],
    properties: {
      applied: { type: 'boolean' },
    },
    additionalProperties: true,
  },
  capability: 'ads.scale_unit_budget',
  risk: 'high',
  sideEffect: 'outward',
  reversible: true,
  outwardAuthorization: {
    declaredIn: DECLARED_IN,
    approval: { mode: 'bounded', envelope: ADS_ENVELOPE },
    rollback: 'snapshot_restore',
  },
  idempotency: { keyFields: ['cycle_date', 'adset_id', 'after_cents'], scope: 'client' },
  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: zeroCeilings(['snapshot_pre', 'apply', 'readback']),
  },
  providerIdempotency: 'unsupported',
  retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 0 },
  verification: { method: 'ads_readback_integrity', delayMs: 600_000 },
  requiredCapabilityTier: 'paid_client',
  steps: ['snapshot_pre', 'apply', 'readback'],
  allowedPurposes: ['growth'],
}

/**
 * `ads.budget_move_plan` —— **放**类（先减后加，总额不变）。信封里对它最关键的是
 * `maxBudgetDeltaRatio`：加的那一侧仍受 ±20% 约束，减的一侧不受。
 */
const ADS_BUDGET_MOVE_PLAN: ActionDefinition<'ads.budget_move_plan'> = {
  actionKey: 'ads.budget_move_plan',
  version: 1,
  title: '同角色内挪预算（先减后加，总额不变）',
  inputSchema: {
    type: 'object',
    required: ['cycle_date', 'ad_account_id', 'plan_hash'],
    properties: {
      cycle_date: { type: 'string' },
      ad_account_id: { type: 'string' },
      plan_hash: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['applied'],
    properties: {
      applied: { type: 'boolean' },
    },
    additionalProperties: true,
  },
  capability: 'ads.budget_move_plan',
  risk: 'high',
  sideEffect: 'outward',
  reversible: true,
  outwardAuthorization: {
    declaredIn: DECLARED_IN,
    approval: { mode: 'bounded', envelope: ADS_ENVELOPE },
    rollback: 'snapshot_restore',
  },
  idempotency: { keyFields: ['cycle_date', 'plan_hash'], scope: 'client' },
  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: zeroCeilings(['snapshot_pre', 'apply_decrease', 'apply_increase', 'readback']),
  },
  providerIdempotency: 'unsupported',
  retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 0 },
  verification: { method: 'ads_readback_integrity', delayMs: 600_000 },
  requiredCapabilityTier: 'paid_client',
  steps: ['snapshot_pre', 'apply_decrease', 'apply_increase', 'readback'],
  allowedPurposes: ['growth'],
}

/**
 * `ads.add_retargeting_adset` —— **放**类（新增花费面）。信封里对它最关键的是
 * `respectDailyCapCents`：新建的组先暂停，回读过闸后才开，开之前必须确认不超日上限。
 */
const ADS_ADD_RETARGETING_ADSET: ActionDefinition<'ads.add_retargeting_adset'> = {
  actionKey: 'ads.add_retargeting_adset',
  version: 1,
  title: '新建一条再营销广告组（建出来先暂停，回读过闸后才开）',
  inputSchema: {
    type: 'object',
    required: ['cycle_date', 'ad_account_id', 'campaign_id', 'audience_id'],
    properties: {
      cycle_date: { type: 'string' },
      ad_account_id: { type: 'string' },
      campaign_id: { type: 'string' },
      audience_id: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['applied'],
    properties: {
      applied: { type: 'boolean' },
    },
    additionalProperties: true,
  },
  capability: 'ads.add_retargeting_adset',
  risk: 'high',
  sideEffect: 'outward',
  reversible: true,
  outwardAuthorization: {
    declaredIn: DECLARED_IN,
    approval: { mode: 'bounded', envelope: ADS_ENVELOPE },
    rollback: 'provider_native',
  },
  idempotency: { keyFields: ['cycle_date', 'campaign_id', 'audience_id'], scope: 'client' },
  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: zeroCeilings(['snapshot_pre', 'create_paused', 'readback', 'activate']),
  },
  providerIdempotency: 'unsupported',
  retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 0 },
  verification: { method: 'ads_readback_integrity', delayMs: 600_000 },
  requiredCapabilityTier: 'paid_client',
  steps: ['snapshot_pre', 'create_paused', 'readback', 'activate'],
  allowedPurposes: ['growth'],
}

/**
 * `ads.swap_creative` —— **放**类（换素材会重置学习期）。信封里对它最关键的是
 * `excludeLearningPhase`：学习期中的广告一律不动。
 */
const ADS_SWAP_CREATIVE: ActionDefinition<'ads.swap_creative'> = {
  actionKey: 'ads.swap_creative',
  version: 1,
  title: '给一条广告换一个已批准的素材',
  inputSchema: {
    type: 'object',
    required: ['cycle_date', 'ad_account_id', 'ad_id', 'creative_ref'],
    properties: {
      cycle_date: { type: 'string' },
      ad_account_id: { type: 'string' },
      ad_id: { type: 'string' },
      creative_ref: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    required: ['applied'],
    properties: {
      applied: { type: 'boolean' },
    },
    additionalProperties: true,
  },
  capability: 'ads.swap_creative',
  risk: 'high',
  sideEffect: 'outward',
  reversible: true,
  outwardAuthorization: {
    declaredIn: DECLARED_IN,
    approval: { mode: 'bounded', envelope: ADS_ENVELOPE },
    rollback: 'provider_native',
  },
  idempotency: { keyFields: ['cycle_date', 'ad_id', 'creative_ref'], scope: 'client' },
  costModel: {
    kind: 'fixed',
    estimate: () => 0,
    stepCeilingUsd: zeroCeilings(['snapshot_pre', 'apply', 'readback']),
  },
  providerIdempotency: 'unsupported',
  retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 0 },
  verification: { method: 'ads_readback_integrity', delayMs: 600_000 },
  requiredCapabilityTier: 'paid_client',
  steps: ['snapshot_pre', 'apply', 'readback'],
  allowedPurposes: ['growth'],
}

export const ADS_ACTION_DEFINITIONS = {
  'ads.pause_unit': ADS_PAUSE_UNIT,
  'ads.cut_unit_budget': ADS_CUT_UNIT_BUDGET,
  'ads.scale_unit_budget': ADS_SCALE_UNIT_BUDGET,
  'ads.budget_move_plan': ADS_BUDGET_MOVE_PLAN,
  'ads.add_retargeting_adset': ADS_ADD_RETARGETING_ADSET,
  'ads.swap_creative': ADS_SWAP_CREATIVE,
} as const
