/**
 * GEO Measurement 契约 —— legacy 兼容映射器守卫（Issue #876 / WP02）
 *
 * 每一条断言指向 GEO 测量契约 v1.0 §8 的一条冻结映射规则。
 */

import { describe, it, expect } from 'vitest'
import { mapAiTrackerObservation, mapIndustryAiVisibilityObservation } from '../legacy-mapper'
import type { AiTrackerLegacyRow, IndustryAiVisibilityLegacyRow } from '../types'

const aiTrackerRow = (overrides: Partial<AiTrackerLegacyRow> = {}): AiTrackerLegacyRow => ({
  id: 'row-1',
  aiEngine: 'openai',
  aiModel: 'gpt-4o-mini',
  market: { known: true, value: 'nz' },
  rawResponse: { known: true, value: 'Best migration agent in Auckland is ...' },
  observedAt: '2026-08-03T01:00:00.000Z',
  errorMessage: { known: false, reason: 'not_applicable' },
  ...overrides,
})

const industryRow = (overrides: Partial<IndustryAiVisibilityLegacyRow> = {}): IndustryAiVisibilityLegacyRow => ({
  id: 'iav-1',
  questionHash: 'sha256:abc123',
  platform: 'chatgpt',
  modelVersion: { known: true, value: 'gpt-4o-2026-06' },
  locale: { known: true, value: 'en' },
  country: { known: true, value: 'nz' },
  rawResponse: { known: true, value: 'The top migration agencies are ...' },
  parseConfidence: { known: true, value: 0.91 },
  citationSources: { known: true, value: ['https://example.co.nz/services'] },
  observedAt: '2026-08-03T02:30:00.000Z',
  errorMessage: { known: false, reason: 'not_applicable' },
  ...overrides,
})

describe('mapAiTrackerObservation', () => {
  it('恒为 not_comparable —— 客户级现状缺 QuerySetVersion 与全部 sample 概念', () => {
    const mapped = mapAiTrackerObservation(aiTrackerRow())
    expect(mapped.comparableToNativeObservations).toBe(false)
  })

  it('QuerySetVersion / queryKey / sample 三层 / parser / rules version 全部显式未知，不许补默认值', () => {
    const mapped = mapAiTrackerObservation(aiTrackerRow())
    expect(mapped.acquisition.querySetVersion).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.acquisition.queryKey).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.acquisition.locale).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.acquisition.sample.samplePlan).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.acquisition.sample.sampleIndex).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.acquisition.sample.samplingParameters).toEqual({
      known: false,
      reason: 'not_recorded_by_source',
    })
    expect(mapped.interpretation.parserVersion).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.interpretation.metricRulesVersion).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.confidence).toEqual({ known: false, reason: 'not_recorded_by_source' })
  })

  it('engineFamily 和 modelVersion 按现状可映射', () => {
    const mapped = mapAiTrackerObservation(aiTrackerRow())
    expect(mapped.acquisition.engineFamily).toEqual({ known: true, value: 'openai' })
    expect(mapped.acquisition.modelVersion).toEqual({ known: true, value: 'gpt-4o-mini' })
  })

  it('market 透传但标注来自问题层非观测层（降级维度列表里可见）', () => {
    const mapped = mapAiTrackerObservation(aiTrackerRow())
    expect(mapped.acquisition.market).toEqual({ known: true, value: 'nz' })
    expect(mapped.degradedDimensions.some((d) => d.startsWith('market:'))).toBe(true)
  })

  it('citation 系列指标恒为不可算，绝不是 0', () => {
    const mapped = mapAiTrackerObservation(aiTrackerRow())
    expect(mapped.citationMetricsComputable).toBe(false)
    expect(mapped.citationNotComputableReason.length).toBeGreaterThan(0)
  })

  it('sourceRowId 透传原始行 id，供人工核对', () => {
    const mapped = mapAiTrackerObservation(aiTrackerRow({ id: 'row-42' }))
    expect(mapped.sourceRowId).toBe('row-42')
    expect(mapped.sourceSystem).toBe('ai_tracker')
  })
})

describe('mapIndustryAiVisibilityObservation', () => {
  it('恒为 not_comparable —— 即便有 question_hash 与 parse_confidence，仍缺 QuerySetVersion 与 sample', () => {
    const mapped = mapIndustryAiVisibilityObservation(industryRow())
    expect(mapped.comparableToNativeObservations).toBe(false)
  })

  it('queryKey 可从 question_hash 映射，QuerySetVersion 仍未知', () => {
    const mapped = mapIndustryAiVisibilityObservation(industryRow())
    expect(mapped.acquisition.queryKey).toEqual({ known: true, value: 'sha256:abc123' })
    expect(mapped.acquisition.querySetVersion).toEqual({ known: false, reason: 'not_recorded_by_source' })
  })

  it('locale / market 透传但标注来自问题层非观测层', () => {
    const mapped = mapIndustryAiVisibilityObservation(industryRow())
    expect(mapped.acquisition.locale).toEqual({ known: true, value: 'en' })
    expect(mapped.acquisition.market).toEqual({ known: true, value: 'nz' })
    expect(mapped.degradedDimensions.some((d) => d.startsWith('locale:'))).toBe(true)
    expect(mapped.degradedDimensions.some((d) => d.startsWith('market:'))).toBe(true)
  })

  it('confidence 透传（行业级现状确实有 parse_confidence 字段）', () => {
    const mapped = mapIndustryAiVisibilityObservation(industryRow())
    expect(mapped.confidence).toEqual({ known: true, value: 0.91 })
  })

  it('confidence 未知时如实透传未知，不许补一个假置信度', () => {
    const mapped = mapIndustryAiVisibilityObservation(
      industryRow({ parseConfidence: { known: false, reason: 'not_recorded_by_source' } }),
    )
    expect(mapped.confidence).toEqual({ known: false, reason: 'not_recorded_by_source' })
  })

  it('即使原始行带引用来源数组，citation 系列指标仍不可算（缺 parser/rules version 与域名台账）', () => {
    const mapped = mapIndustryAiVisibilityObservation(industryRow())
    expect(mapped.citationMetricsComputable).toBe(false)
    expect(mapped.citationNotComputableReason.length).toBeGreaterThan(0)
  })

  it('sample 三层与 parser/rules version 全部未知', () => {
    const mapped = mapIndustryAiVisibilityObservation(industryRow())
    expect(mapped.acquisition.sample.samplePlan).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.acquisition.sample.sampleIndex).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.interpretation.parserVersion).toEqual({ known: false, reason: 'not_recorded_by_source' })
    expect(mapped.interpretation.metricRulesVersion).toEqual({ known: false, reason: 'not_recorded_by_source' })
  })
})
