/**
 * GEO Measurement Runtime —— 可比性接线点（Issue #874 / WP04）
 *
 * 🔴 判据不是「WP04 自己判定能不能比」，而是「WP04 产出的字段喂给
 *    WP02 `evaluateGeoComparability` 之后，得到的是真实判定结果」。
 */

import { describe, it, expect } from 'vitest'
import { evaluateGeoComparability, type GeoObservation } from '@/lib/geo-measurement'
import { computeGeoBatchQuality, toGeoComparabilityCohortInput } from '../comparability-handoff'

function makeObservation(overrides: Partial<GeoObservation> = {}): GeoObservation {
  return {
    observationId: 'obs-1',
    batchId: 'batch-1',
    acquisition: {
      querySetVersion: { known: true, value: 'v1' },
      queryKey: { known: true, value: 'q1' },
      engineFamily: { known: true, value: 'openai' },
      modelVersion: { known: true, value: 'gpt-4o-search-preview' },
      locale: { known: true, value: 'en-NZ' },
      market: { known: true, value: 'NZ' },
      sample: {
        samplePlan: { known: true, value: { plannedCount: 1 } },
        sampleIndex: { known: true, value: 0 },
        samplingParameters: { known: false, reason: 'not_recorded_by_source' },
      },
    },
    interpretation: {
      parserVersion: { known: true, value: 'parser-v1' },
      metricRulesVersion: { known: true, value: 'metrics-v1' },
    },
    confidence: { known: true, value: 0.9 },
    observedAt: '2026-08-11T00:00:00.000Z',
    outcome: { ok: true, evidenceId: 'ev-1' },
    ...overrides,
  }
}

describe('computeGeoBatchQuality', () => {
  it('全部计划引擎都覆盖、无失败时给出高质量信号', () => {
    const quality = computeGeoBatchQuality(
      { engines: ['openai'], models: ['m'], locales: ['en-NZ'], markets: ['NZ'], queryKeys: ['q1'], attempted: 4, succeeded: 4, failed: 0 },
      { engines: ['openai'], models: ['m'], locales: ['en-NZ'], markets: ['NZ'], queryKeys: ['q1'], attempted: 4, succeeded: 0, failed: 0 },
    )
    expect(quality.engineCoverage).toEqual({ known: true, value: 1 })
    expect(quality.failureRate).toEqual({ known: true, value: 0 })
  })

  it('计划引擎为空时 engineCoverage 未知', () => {
    const quality = computeGeoBatchQuality(
      { engines: [], models: [], locales: [], markets: [], queryKeys: [], attempted: 0, succeeded: 0, failed: 0 },
      { engines: [], models: [], locales: [], markets: [], queryKeys: [], attempted: 0, succeeded: 0, failed: 0 },
    )
    expect(quality.engineCoverage.known).toBe(false)
  })

  it('什么都没尝试时 failureRate 未知（不是 0）', () => {
    const quality = computeGeoBatchQuality(
      { engines: [], models: [], locales: [], markets: [], queryKeys: [], attempted: 0, succeeded: 0, failed: 0 },
      { engines: ['openai'], models: ['m'], locales: ['en-NZ'], markets: ['NZ'], queryKeys: ['q1'], attempted: 4, succeeded: 0, failed: 0 },
    )
    expect(quality.failureRate.known).toBe(false)
  })
})

describe('toGeoComparabilityCohortInput → evaluateGeoComparability', () => {
  const highQuality = { engineCoverage: { known: true as const, value: 1 }, failureRate: { known: true as const, value: 0 } }

  it('身份完全相同、质量达标 → WP02 判定 comparable:true', () => {
    const left = toGeoComparabilityCohortInput(makeObservation(), highQuality)
    const right = toGeoComparabilityCohortInput(makeObservation(), highQuality)
    expect(evaluateGeoComparability(left, right)).toEqual({ comparable: true })
  })

  it('cohort 身份不同（engineFamily 不同）→ WP02 判定 not_comparable', () => {
    const left = toGeoComparabilityCohortInput(makeObservation(), highQuality)
    const right = toGeoComparabilityCohortInput(
      makeObservation({ acquisition: { ...makeObservation().acquisition, engineFamily: { known: true, value: 'anthropic' } } }),
      highQuality,
    )
    const result = evaluateGeoComparability(left, right)
    expect(result.comparable).toBe(false)
  })

  it('质量低于阈值（failureRate 超过 0.2）→ WP02 判定 not_comparable', () => {
    const lowQuality = { engineCoverage: { known: true as const, value: 1 }, failureRate: { known: true as const, value: 0.5 } }
    const left = toGeoComparabilityCohortInput(makeObservation(), highQuality)
    const right = toGeoComparabilityCohortInput(makeObservation(), lowQuality)
    const result = evaluateGeoComparability(left, right)
    expect(result.comparable).toBe(false)
  })
})
