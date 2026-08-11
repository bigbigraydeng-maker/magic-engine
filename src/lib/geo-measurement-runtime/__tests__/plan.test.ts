/**
 * GEO Measurement Runtime —— 计划校验与展开（Issue #874 / WP04）
 */

import { describe, it, expect } from 'vitest'
import { RUNTIME_MAX_BATCH_OBSERVATIONS, expandGeoRuntimePlan, validateGeoRuntimePlan } from '../plan'
import type { GeoRuntimePlan } from '../types'

function basePlan(overrides: Partial<GeoRuntimePlan> = {}): GeoRuntimePlan {
  return {
    clientId: 'client-1',
    querySetId: 'query-set-row-1',
    querySetVersion: 'v1',
    cohort: { engineFamily: 'openai', modelVersion: 'gpt-4o-search-preview', locale: 'en-NZ', market: 'NZ' },
    queries: [
      { queryKey: 'q1', questionText: 'best tour operator in Queenstown?' },
      { queryKey: 'q2', questionText: 'top NZ adventure tours?' },
    ],
    samplePlan: { plannedCount: 2 },
    parserVersion: 'parser-v1',
    metricRulesVersion: 'metrics-v1',
    triggeredBy: 'wp04-discovery-test',
    maxPlannedObservations: 10,
    ...overrides,
  }
}

describe('validateGeoRuntimePlan', () => {
  it('接受一份完整显式的计划', () => {
    expect(validateGeoRuntimePlan(basePlan())).toEqual({ ok: true })
  })

  it('缺 clientId 时 fail closed', () => {
    const plan = basePlan({ clientId: '' })
    expect(validateGeoRuntimePlan(plan)).toEqual({ ok: false, reason: expect.stringContaining('clientId') })
  })

  it('缺 cohort 维度时 fail closed（无隐藏默认值）', () => {
    const plan = basePlan({ cohort: { engineFamily: 'openai', modelVersion: '', locale: 'en-NZ', market: 'NZ' } })
    const result = validateGeoRuntimePlan(plan)
    expect(result.ok).toBe(false)
  })

  it('queries 为空数组时拒绝', () => {
    expect(validateGeoRuntimePlan(basePlan({ queries: [] })).ok).toBe(false)
  })

  it('queries 出现重复 queryKey 时拒绝', () => {
    const plan = basePlan({
      queries: [
        { queryKey: 'q1', questionText: 'a' },
        { queryKey: 'q1', questionText: 'b' },
      ],
    })
    expect(validateGeoRuntimePlan(plan).ok).toBe(false)
  })

  it('samplePlan.plannedCount 非正整数时拒绝', () => {
    expect(validateGeoRuntimePlan(basePlan({ samplePlan: { plannedCount: 0 } })).ok).toBe(false)
    expect(validateGeoRuntimePlan(basePlan({ samplePlan: { plannedCount: 1.5 } })).ok).toBe(false)
  })

  it('maxPlannedObservations 缺失或非正整数时拒绝', () => {
    expect(validateGeoRuntimePlan(basePlan({ maxPlannedObservations: 0 })).ok).toBe(false)
    expect(
      validateGeoRuntimePlan({ ...basePlan(), maxPlannedObservations: undefined as unknown as number }).ok,
    ).toBe(false)
  })

  it('展开后的观测数超过 maxPlannedObservations 时拒绝（oversized plan）', () => {
    const plan = basePlan({ maxPlannedObservations: 3 }) // 2 queries × 2 samples = 4 > 3
    const result = validateGeoRuntimePlan(plan)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toContain('exceeds maxPlannedObservations')
  })

  it('maxPlannedObservations 超过运行时硬顶时拒绝（unbounded plan 防御）', () => {
    const plan = basePlan({ maxPlannedObservations: RUNTIME_MAX_BATCH_OBSERVATIONS + 1 })
    const result = validateGeoRuntimePlan(plan)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toContain('runtime hard ceiling')
  })

  it('展开数本身超过运行时硬顶时拒绝，即便调用方声称的 max 更大也不行', () => {
    const manyQueries = Array.from({ length: RUNTIME_MAX_BATCH_OBSERVATIONS + 5 }, (_, i) => ({
      queryKey: `q${i}`,
      questionText: `question ${i}`,
    }))
    const plan = basePlan({
      queries: manyQueries,
      samplePlan: { plannedCount: 1 },
      maxPlannedObservations: RUNTIME_MAX_BATCH_OBSERVATIONS,
    })
    const result = validateGeoRuntimePlan(plan)
    expect(result.ok).toBe(false)
  })
})

describe('expandGeoRuntimePlan', () => {
  it('按 query × sampleIndex 展开成确定性列表', () => {
    const plan = basePlan()
    const slots = expandGeoRuntimePlan(plan)
    expect(slots).toHaveLength(4)
    expect(slots.map((s) => `${s.query.queryKey}#${s.sampleIndex}`)).toEqual(['q1#0', 'q1#1', 'q2#0', 'q2#1'])
  })
})
