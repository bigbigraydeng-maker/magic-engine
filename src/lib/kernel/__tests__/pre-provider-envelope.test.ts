/**
 * 「碰 provider 之前」这道实例闸 —— spec 2026-09-24 §3 G5 的第 3 道。
 *
 * 子牙 WP2 复审当场抓出的缺口：`autonomy-envelope.ts` 的模块头注释和
 * `EnvelopeFactsResolver` 的 `at` 类型都在向后续维护者承诺「有第三层」，
 * 但代码里没人调过 `at: 'pre_provider'`。这份用例就是钉住这句承诺兑现的 ——
 * 变红 = 承诺又被拆穿了。
 *
 * 用纯函数 `preProviderEnvelopeBlockReason` 测（不启动整条 Gateway 流水线）：
 * 判据本身是全部风险所在，Gateway 那边只做「过不了就走 dead_letter」这条编排。
 */

import { describe, expect, it, vi } from 'vitest'
import { preProviderEnvelopeBlockReason } from '../outward-authorization'
import type {
  ActionDefinition,
  ActionKey,
  ActionRun,
  AutonomyEnvelope,
  OutwardAuthorization,
} from '../types'
import type { EnvelopeFactsResolver } from '../deps'
import type { EnvelopeFacts, EnvelopeRequest } from '../autonomy-envelope'

const ENVELOPE: AutonomyEnvelope = {
  maxBudgetDeltaRatio: 0.2,
  respectDailyCapCents: true,
  minHoursSinceLastChange: 72,
  excludeLearningPhase: true,
  excludeAdStudies: true,
  requiresRollbackHandler: true,
}

const BOUNDED: OutwardAuthorization = {
  declaredIn: 'test',
  approval: { mode: 'bounded', envelope: ENVELOPE },
  rollback: 'provider_native',
}
const HUMAN: OutwardAuthorization = {
  declaredIn: 'test',
  approval: { mode: 'human_only' },
  rollback: 'provider_native',
}

function actionDef(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    actionKey: 'ads.pause_unit' as ActionKey,
    version: 1,
    title: 'test',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    capability: 'ads.pause_unit',
    risk: 'high',
    sideEffect: 'outward',
    reversible: true,
    outwardAuthorization: BOUNDED,
    idempotency: { keyFields: ['x'], scope: 'client' },
    costModel: { kind: 'fixed', estimate: () => 0, stepCeilingUsd: { apply: 0 } },
    providerIdempotency: 'unsupported',
    retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 0 },
    verification: { method: 'ads_readback_integrity', delayMs: 0 },
    requiredCapabilityTier: 'paid_client',
    steps: ['snapshot_pre', 'apply', 'readback'],
    allowedPurposes: ['growth'],
    ...overrides,
  }
}

const RUN: Pick<ActionRun, 'id' | 'client_id' | 'action_key' | 'input' | 'triggered_by'> = {
  id: 'run-1',
  client_id: 'client-a',
  action_key: 'ads.pause_unit',
  input: { adset_id: 'as_1' },
  triggered_by: 'agent',
}

const okFacts: EnvelopeFacts = {
  beforeCents: 1000,
  accountDailyTotalBeforeCents: 5000,
  dailyCapCents: 10_000,
  hoursSinceLastChange: 100,
  learningPhaseApplicable: true,
  learningStage: 'SUCCESS',
  adStudyCount: 0,
  hasRollbackHandler: true,
}
const okReq: EnvelopeRequest = { kind: 'pause', afterCents: 0 }

function resolverReturning(payload: { request: EnvelopeRequest; facts: EnvelopeFacts } | { unavailable: string }): EnvelopeFactsResolver {
  return vi.fn(async () => payload)
}

describe('执行前仍按服务端记录的人工止损身份判定', () => {
  const humanRun = { ...RUN, triggered_by: 'human' as const }
  const unknownLearning = { ...okFacts, beforeCents: null, learningStage: null, hoursSinceLastChange: null }

  it('人工暂停 CBO 在学习期未知时仍可通过，且必须重读事实', async () => {
    const resolveFacts = resolverReturning({ request: okReq, facts: unknownLearning })
    expect(await preProviderEnvelopeBlockReason({
      definition: actionDef(), run: humanRun, stepKey: 'apply', resolveFacts,
    })).toBeNull()
    expect(resolveFacts).toHaveBeenCalledWith(expect.objectContaining({ at: 'pre_provider', runId: RUN.id }))
  })

  it('请求 input 自报 human 不会改变已存储的 agent 身份', async () => {
    const run = { ...RUN, input: { ...RUN.input, triggeredBy: 'human', triggered_by: 'human' } }
    expect(await preProviderEnvelopeBlockReason({
      definition: actionDef(), run, stepKey: 'apply',
      resolveFacts: resolverReturning({ request: okReq, facts: unknownLearning }),
    })).not.toBeNull()
  })

  it.each(['facts:query_failed', 'circuit:tripped', 'facts:entity_missing'])('人工也不能跳过 %s', unavailable => {
    return expect(preProviderEnvelopeBlockReason({
      definition: actionDef(), run: humanRun, stepKey: 'apply',
      resolveFacts: resolverReturning({ unavailable }),
    })).resolves.toContain(unavailable)
  })

  it('人工也不能跳过缺失的事实解析器', async () => {
    expect(await preProviderEnvelopeBlockReason({
      definition: actionDef(), run: humanRun, stepKey: 'apply', resolveFacts: undefined,
    })).toContain('解析器')
  })

  it('人工减预算在执行前变成加预算时必须拒绝', async () => {
    const run = { ...humanRun, action_key: 'ads.cut_unit_budget' }
    const resolveFacts = vi.fn<EnvelopeFactsResolver>()
      .mockResolvedValueOnce({ request: { kind: 'budget_change', afterCents: 500 }, facts: { ...unknownLearning, beforeCents: 1000 } })
      .mockResolvedValueOnce({ request: { kind: 'budget_change', afterCents: 500 }, facts: { ...unknownLearning, beforeCents: 400 } })
    const args = { definition: actionDef({ actionKey: 'ads.cut_unit_budget' }), run, stepKey: 'apply', resolveFacts }
    expect(await preProviderEnvelopeBlockReason(args)).toBeNull()
    expect(await preProviderEnvelopeBlockReason(args)).not.toBeNull()
  })
})

describe('pre-provider 实例闸 · 判据本身', () => {
  it('信封内 → 放行（返回 null）', async () => {
    const reason = await preProviderEnvelopeBlockReason({
      definition: actionDef(),
      run: RUN,
      stepKey: 'apply',
      resolveFacts: resolverReturning({ request: okReq, facts: okFacts }),
    })
    expect(reason).toBeNull()
  })

  it('🔴 越界 → 返回原因（走 dead_letter 的那条路要有话说）', async () => {
    // 事实变了：账户从 5000 涨到 20000（远超 10000 上限），加类动作。
    const reason = await preProviderEnvelopeBlockReason({
      definition: actionDef(),
      run: RUN,
      stepKey: 'apply',
      resolveFacts: resolverReturning({
        request: { kind: 'budget_change', afterCents: 5000 },
        facts: { ...okFacts, beforeCents: 1000, accountDailyTotalBeforeCents: 20_000 },
      }),
    })
    expect(reason).not.toBeNull()
    expect(reason).toContain('越界')
  })

  it('🔴 事实读不到 → 返回原因（不许悄悄放行）', async () => {
    const reason = await preProviderEnvelopeBlockReason({
      definition: actionDef(),
      run: RUN,
      stepKey: 'apply',
      resolveFacts: resolverReturning({ unavailable: '账户快照对不上，共用账户会这样' }),
    })
    expect(reason).not.toBeNull()
    expect(reason).toContain('读')
  })

  it('🔴 没有解析器 → 返回原因（缺就是拒，不是跳过）', async () => {
    const reason = await preProviderEnvelopeBlockReason({
      definition: actionDef(),
      run: RUN,
      stepKey: 'apply',
      resolveFacts: undefined,
    })
    expect(reason).not.toBeNull()
    expect(reason).toContain('解析器')
  })
})

describe('pre-provider 实例闸 · 不该检查时不查', () => {
  it('snapshot_pre 步骤 → 不查（那一步就是给这道闸供数据的）', async () => {
    const resolver = vi.fn(async () => ({ unavailable: '本不该被叫到' }))
    const reason = await preProviderEnvelopeBlockReason({
      definition: actionDef(),
      run: RUN,
      stepKey: 'snapshot_pre',
      resolveFacts: resolver,
    })
    expect(reason).toBeNull()
    expect(resolver).not.toHaveBeenCalled()
  })

  it('非 outward 动作 → 不查（内部写不走信封）', async () => {
    const resolver = vi.fn(async () => ({ unavailable: '本不该被叫到' }))
    const reason = await preProviderEnvelopeBlockReason({
      definition: actionDef({ sideEffect: 'internal_write', outwardAuthorization: null }),
      run: RUN,
      stepKey: 'apply',
      resolveFacts: resolver,
    })
    expect(reason).toBeNull()
    expect(resolver).not.toHaveBeenCalled()
  })

  it('human_only 声明 → 不查（走的是人审通道，不是自治通道）', async () => {
    const resolver = vi.fn(async () => ({ unavailable: '本不该被叫到' }))
    const reason = await preProviderEnvelopeBlockReason({
      definition: actionDef({ outwardAuthorization: HUMAN }),
      run: RUN,
      stepKey: 'apply',
      resolveFacts: resolver,
    })
    expect(reason).toBeNull()
    expect(resolver).not.toHaveBeenCalled()
  })
})

describe('pre-provider 实例闸 · 独立性（钉住"两处查实例，拆一处另一处仍拦得住"）', () => {
  it('解析器被调用时 at="pre_provider"，跟授权层的 "authorize" 分开', async () => {
    const spy = vi.fn<EnvelopeFactsResolver>(async () => ({ request: okReq, facts: okFacts }))
    await preProviderEnvelopeBlockReason({
      definition: actionDef(),
      run: RUN,
      stepKey: 'apply',
      resolveFacts: spy,
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0].at).toBe('pre_provider')
  })

  it('两次调用可以给出不同事实：授权时通过、pre_provider 时越界 → 这一层依然会拒', async () => {
    // 模拟：授权时账户 5000，两秒后（snapshot_pre 抓完再算这道闸时）
    // PM 把上限从 10000 改成 4000，或者别的动作把账户加到 20000 —— 这里只做后者。
    const reason = await preProviderEnvelopeBlockReason({
      definition: actionDef(),
      run: RUN,
      stepKey: 'apply',
      resolveFacts: resolverReturning({
        request: { kind: 'budget_change', afterCents: 1100 },
        facts: { ...okFacts, accountDailyTotalBeforeCents: 20_000, beforeCents: 1000 },
      }),
    })
    // 这条动作在授权层可能已经放行；本层用最新事实重算，仍能挡下来。
    expect(reason).not.toBeNull()
  })
})
