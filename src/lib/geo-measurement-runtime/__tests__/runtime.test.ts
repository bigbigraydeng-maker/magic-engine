/**
 * GEO Measurement Runtime —— 批次编排端到端行为（Issue #874 / WP04）
 *
 * `explicit frozen plan → budget preflight → bounded fake-provider execution →
 *  WP02 validation → atomic fake-store persistence → honest completed/partial/failed result`
 */

import { describe, it, expect } from 'vitest'
import { createFakeGeoProvider } from '../fake-provider'
import { runGeoBatch } from '../runtime'
import { createInMemoryGeoStore } from '../store'
import type { GeoRuntimePlan, GeoRuntimeProviderOutcome, GeoRuntimeStore } from '../types'

function makePlan(overrides: Partial<GeoRuntimePlan> = {}): GeoRuntimePlan {
  return {
    clientId: 'client-1',
    querySetId: 'query-set-row-1',
    querySetVersion: 'v1',
    cohort: { engineFamily: 'openai', modelVersion: 'gpt-4o-search-preview', locale: 'en-NZ', market: 'NZ' },
    queries: [
      { queryKey: 'q1', questionText: 'best tour operator in Queenstown?' },
      { queryKey: 'q2', questionText: 'top NZ adventure tours?' },
    ],
    samplePlan: { plannedCount: 1 },
    parserVersion: 'parser-v1',
    metricRulesVersion: 'metrics-v1',
    triggeredBy: 'wp04-test',
    maxPlannedObservations: 10,
    ...overrides,
  }
}

function makeIdGenerator(): () => string {
  let counter = 0
  return () => `id-${counter++}`
}

function makeClock(): () => string {
  let counter = 0
  return () => new Date(2026, 7, 11, 0, 0, counter++).toISOString()
}

describe('runGeoBatch · 计划校验', () => {
  it('无效计划直接抛错，不发起任何 provider 调用', async () => {
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 0.01,
      script: [() => ({ kind: 'success', rawResponse: 'r', citations: [], confidence: 0.9, costUsd: 0.01 })],
    })
    const invalidPlan = makePlan({ queries: [] })
    await expect(
      runGeoBatch({ plan: invalidPlan, provider, store: createInMemoryGeoStore(), budget: { authorizedUsd: 100 } }),
    ).rejects.toThrow()
    expect(provider.callLog).toHaveLength(0)
  })
})

describe('runGeoBatch · 预算 preflight', () => {
  it('首次尝试前预算就不够 → attempted=0，status=failed，stopReason=budget_refused_before_first_attempt', async () => {
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 10,
      script: [() => ({ kind: 'success', rawResponse: 'r', citations: [], confidence: 0.9, costUsd: 10 })],
    })
    const result = await runGeoBatch({
      plan: makePlan(),
      provider,
      store: createInMemoryGeoStore(),
      budget: { authorizedUsd: 1 }, // 单次成本上界 10 > 剩余 1
      idGenerator: makeIdGenerator(),
      clock: makeClock(),
    })
    expect(result.status).toBe('failed')
    expect(result.stopReason).toBe('budget_refused_before_first_attempt')
    expect(result.actualCoverage.attempted).toBe(0)
    expect(provider.callLog).toHaveLength(0)
    expect(result.persistence.ok).toBe(true)
  })

  it('跑到一半预算耗尽 → 提前停止，status=partial，stopReason=budget_exhausted_mid_run，且每次尝试前都重新 preflight', async () => {
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 3,
      script: [() => ({ kind: 'success', rawResponse: 'r', citations: [], confidence: 0.9, costUsd: 3 })],
    })
    // 3 个问题 × 1 样本 = 3 个计划观测；预算只够 2 次（3*2=6 <= 7 < 9）
    const result = await runGeoBatch({
      plan: makePlan({
        queries: [
          { queryKey: 'q1', questionText: 'a' },
          { queryKey: 'q2', questionText: 'b' },
          { queryKey: 'q3', questionText: 'c' },
        ],
        maxPlannedObservations: 10,
      }),
      provider,
      store: createInMemoryGeoStore(),
      budget: { authorizedUsd: 7 },
      idGenerator: makeIdGenerator(),
      clock: makeClock(),
    })
    expect(result.status).toBe('partial')
    expect(result.stopReason).toBe('budget_exhausted_mid_run')
    expect(result.actualCoverage.attempted).toBe(2)
    expect(result.actualCoverage.succeeded).toBe(2)
    expect(provider.callLog).toHaveLength(2)
  })
})

describe('runGeoBatch · 失败分类，绝不折算成成功', () => {
  const kinds: readonly [string, GeoRuntimeProviderOutcome][] = [
    ['timeout', { kind: 'timeout', costUsd: 0 }],
    ['rate_limited', { kind: 'rate_limited', errorCode: 'rate_limited', costUsd: 0 }],
    ['provider_failure', { kind: 'provider_failure', errorCode: 'provider_error', errorMessage: 'boom', costUsd: 0.01 }],
    ['ambiguous', { kind: 'ambiguous', reason: 'network ambiguity after timeout, provider idempotency unsupported', costUsd: 0.01 }],
  ]

  for (const [label, outcome] of kinds) {
    it(`${label} → 记为失败观测，无证据，不计入成功`, async () => {
      const provider = createFakeGeoProvider({ costCeilingUsdPerCall: 0.01, script: [() => outcome] })
      const store = createInMemoryGeoStore()
      const result = await runGeoBatch({
        plan: makePlan({ queries: [{ queryKey: 'q1', questionText: 'a' }], maxPlannedObservations: 5 }),
        provider,
        store,
        budget: { authorizedUsd: 10 },
        idGenerator: makeIdGenerator(),
        clock: makeClock(),
      })
      expect(result.status).toBe('failed')
      expect(result.actualCoverage.succeeded).toBe(0)
      expect(result.actualCoverage.failed).toBe(1)
      expect(result.evidence).toHaveLength(0)
      expect(result.observations[0].outcome.ok).toBe(false)
      expect(store.getObservations(result.batchId).every((o) => !o.outcome_ok)).toBe(true)
    })
  }

  it('ambiguous 结果不会被自动重放 —— provider 只被调用一次', async () => {
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 0.01,
      script: [() => ({ kind: 'ambiguous', reason: 'unknown after timeout', costUsd: 0.01 })],
    })
    const result = await runGeoBatch({
      plan: makePlan({ queries: [{ queryKey: 'q1', questionText: 'a' }], maxPlannedObservations: 5 }),
      provider,
      store: createInMemoryGeoStore(),
      budget: { authorizedUsd: 10 },
      idGenerator: makeIdGenerator(),
      clock: makeClock(),
    })
    expect(provider.callLog).toHaveLength(1)
    const outcome = result.observations[0].outcome
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.errorCode).toContain('no_replay')
    }
  })

  it('parser/evidence 形状不合法（validateGeoEvidence 拒绝）→ 降级为失败观测，不落库为成功', async () => {
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 0.01,
      script: [
        () => ({
          kind: 'success',
          rawResponse: 'r',
          citations: [{ url: '', domain: '', ownedDomain: { known: false, reason: 'not_applicable' } }], // 非法：url/domain 不能为空
          confidence: 0.9,
          costUsd: 0.01,
        }),
      ],
    })
    const result = await runGeoBatch({
      plan: makePlan({ queries: [{ queryKey: 'q1', questionText: 'a' }], maxPlannedObservations: 5 }),
      provider,
      store: createInMemoryGeoStore(),
      budget: { authorizedUsd: 10 },
      idGenerator: makeIdGenerator(),
      clock: makeClock(),
    })
    expect(result.status).toBe('failed')
    expect(result.evidence).toHaveLength(0)
    const outcome = result.observations[0].outcome
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.errorCode).toBe('parser_validation_failed')
    }
  })
})

describe('runGeoBatch · 成功路径与覆盖率/终态', () => {
  it('全部成功 → completed，coverage 精确记录，evidence 与 observation 一一对应', async () => {
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 0.01,
      script: [() => ({ kind: 'success', rawResponse: 'r', citations: [], confidence: 0.9, costUsd: 0.01 })],
    })
    const store = createInMemoryGeoStore()
    const result = await runGeoBatch({
      plan: makePlan(),
      provider,
      store,
      budget: { authorizedUsd: 10 },
      idGenerator: makeIdGenerator(),
      clock: makeClock(),
    })
    expect(result.status).toBe('completed')
    expect(result.stopReason).toBe('plan_exhausted')
    expect(result.actualCoverage).toEqual({
      engines: ['openai'],
      models: ['gpt-4o-search-preview'],
      locales: ['en-NZ'],
      markets: ['NZ'],
      queryKeys: ['q1', 'q2'],
      attempted: 2,
      succeeded: 2,
      failed: 0,
    })
    expect(result.persistence).toEqual({ ok: true })
    expect(store.getObservations(result.batchId)).toHaveLength(2)
    for (const obs of store.getObservations(result.batchId)) {
      expect(store.getEvidence(obs.id)).toBeDefined()
    }
  })

  it('部分成功部分失败 → partial（不是 completed，也不是 failed）', async () => {
    let call = 0
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 0.01,
      script: [
        () => {
          call += 1
          return call === 1
            ? { kind: 'success', rawResponse: 'r', citations: [], confidence: 0.9, costUsd: 0.01 }
            : { kind: 'provider_failure', errorCode: 'server_error', errorMessage: null, costUsd: 0.01 }
        },
      ],
    })
    const result = await runGeoBatch({
      plan: makePlan(),
      provider,
      store: createInMemoryGeoStore(),
      budget: { authorizedUsd: 10 },
      idGenerator: makeIdGenerator(),
      clock: makeClock(),
    })
    expect(result.status).toBe('partial')
    expect(result.actualCoverage.succeeded).toBe(1)
    expect(result.actualCoverage.failed).toBe(1)
  })
})

describe('runGeoBatch · 原子持久化 rollback', () => {
  it('store 提交失败时 persistence.ok=false，且不留下部分行；measurement 结果仍诚实反映实际发生了什么', async () => {
    const inner = createInMemoryGeoStore()
    const poisonedStore: GeoRuntimeStore = {
      ...inner,
      commitBatchResult: () => ({ ok: false, reason: 'simulated persistence failure' }),
    }
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 0.01,
      script: [() => ({ kind: 'success', rawResponse: 'r', citations: [], confidence: 0.9, costUsd: 0.01 })],
    })
    const result = await runGeoBatch({
      plan: makePlan(),
      provider,
      store: poisonedStore,
      budget: { authorizedUsd: 10 },
      idGenerator: makeIdGenerator(),
      clock: makeClock(),
    })
    expect(result.persistence.ok).toBe(false)
    expect(result.status).toBe('completed') // 测量本身是诚实的：两次调用都真的成功了
    expect(inner.getBatch(result.batchId)).toBeUndefined() // 但没有任何东西留在 store 里
  })
})

describe('runGeoBatch · 重复运行 / 内部去重', () => {
  it('同一份计划跑两次 → 两个独立批次（各自的 batchId），都各自诚实持久化，不是 provider 层面的 exactly-once', async () => {
    const store = createInMemoryGeoStore()
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 0.01,
      script: [() => ({ kind: 'success', rawResponse: 'r', citations: [], confidence: 0.9, costUsd: 0.01 })],
    })
    const first = await runGeoBatch({ plan: makePlan(), provider, store, budget: { authorizedUsd: 10 }, idGenerator: makeIdGenerator(), clock: makeClock() })
    const second = await runGeoBatch({ plan: makePlan(), provider, store, budget: { authorizedUsd: 10 }, idGenerator: makeIdGenerator(), clock: makeClock() })

    expect(first.batchId).not.toBe(second.batchId)
    expect(first.persistence.ok).toBe(true)
    expect(second.persistence.ok).toBe(true)
    expect(store.getBatch(first.batchId)).toBeDefined()
    expect(store.getBatch(second.batchId)).toBeDefined()
  })

  it('若同一 batchId 被要求二次提交（模拟内部重放同一次尝试），store 拒绝且不覆盖已存在的数据', async () => {
    const store = createInMemoryGeoStore()
    const fixedIdGenerator = () => 'fixed-batch-id'
    const provider = createFakeGeoProvider({
      costCeilingUsdPerCall: 0.01,
      script: [() => ({ kind: 'success', rawResponse: 'r', citations: [], confidence: 0.9, costUsd: 0.01 })],
    })
    const first = await runGeoBatch({
      plan: makePlan({ queries: [{ queryKey: 'q1', questionText: 'a' }] }),
      provider,
      store,
      budget: { authorizedUsd: 10 },
      idGenerator: fixedIdGenerator,
      clock: makeClock(),
    })
    const second = await runGeoBatch({
      plan: makePlan({ queries: [{ queryKey: 'q1', questionText: 'a' }] }),
      provider,
      store,
      budget: { authorizedUsd: 10 },
      idGenerator: fixedIdGenerator,
      clock: makeClock(),
    })
    const secondPersistence = second.persistence
    expect(first.persistence.ok).toBe(true)
    expect(secondPersistence.ok).toBe(false)
    expect(secondPersistence.ok ? '' : secondPersistence.reason).toContain('not provider exactly-once')
  })
})
