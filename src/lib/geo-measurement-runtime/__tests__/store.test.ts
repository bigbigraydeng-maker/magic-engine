/**
 * GEO Measurement Runtime —— in-memory fake store 原子性（Issue #874 / WP04）
 */

import { describe, it, expect } from 'vitest'
import { createInMemoryGeoStore } from '../store'
import type { GeoBatchRow, GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'

function makeBatchRow(overrides: Partial<GeoBatchRow> = {}): GeoBatchRow {
  return {
    id: 'batch-1',
    client_id: 'client-1',
    query_set_id: 'qs-1',
    started_at: '2026-08-11T00:00:00.000Z',
    completed_at: '2026-08-11T00:01:00.000Z',
    completed_at_unknown_reason: null,
    status: 'completed',
    planned_coverage: { engines: ['openai'], models: ['m1'], locales: ['en-NZ'], markets: ['NZ'], queryKeys: ['q1'], attempted: 1, succeeded: 0, failed: 0 },
    actual_coverage: { engines: ['openai'], models: ['m1'], locales: ['en-NZ'], markets: ['NZ'], queryKeys: ['q1'], attempted: 1, succeeded: 1, failed: 0 },
    cost_usd: 0.01,
    cost_usd_unknown_reason: null,
    triggered_by: 'test',
    triggered_by_unknown_reason: null,
    created_at: '2026-08-11T00:01:00.000Z',
    ...overrides,
  }
}

function makeSucceededObservationRow(overrides: Partial<GeoObservationRow> = {}): GeoObservationRow {
  return {
    id: 'obs-1',
    client_id: 'client-1',
    batch_id: 'batch-1',
    query_set_version: 'v1',
    query_set_version_unknown_reason: null,
    query_key: 'q1',
    query_key_unknown_reason: null,
    engine_family: 'openai',
    engine_family_unknown_reason: null,
    model_version: 'm1',
    model_version_unknown_reason: null,
    locale: 'en-NZ',
    locale_unknown_reason: null,
    market: 'NZ',
    market_unknown_reason: null,
    sample_planned_count: 1,
    sample_planned_count_unknown_reason: null,
    sample_index: 0,
    sample_index_unknown_reason: null,
    sampling_parameters: null,
    sampling_parameters_unknown_reason: 'not_recorded_by_source',
    parser_version: 'p1',
    parser_version_unknown_reason: null,
    metric_rules_version: 'mr1',
    metric_rules_version_unknown_reason: null,
    confidence: 0.9,
    confidence_unknown_reason: null,
    observed_at: '2026-08-11T00:00:30.000Z',
    outcome_ok: true,
    error_code: null,
    error_message: null,
    error_message_unknown_reason: null,
    source_observation_id: null,
    created_at: '2026-08-11T00:00:30.000Z',
    ...overrides,
  }
}

function makeEvidenceRow(overrides: Partial<GeoEvidenceRow> = {}): GeoEvidenceRow {
  return {
    id: 'evidence-1',
    client_id: 'client-1',
    observation_id: 'obs-1',
    raw_response: 'raw text',
    raw_response_unknown_reason: null,
    raw_response_locator: 'raw text',
    citations: [],
    created_at: '2026-08-11T00:00:30.000Z',
    ...overrides,
  }
}

describe('createInMemoryGeoStore · 原子提交', () => {
  it('合法的一批（batch+observation+evidence）一次性生效', () => {
    const store = createInMemoryGeoStore()
    const result = store.commitBatchResult({
      batch: makeBatchRow(),
      observations: [makeSucceededObservationRow()],
      evidence: [makeEvidenceRow()],
    })
    expect(result).toEqual({ ok: true })
    expect(store.getBatch('batch-1')).toBeDefined()
    expect(store.getObservations('batch-1')).toHaveLength(1)
    expect(store.getEvidence('obs-1')).toBeDefined()
  })

  it('成功观测缺证据 → 整批回滚，不留下任何部分行（incomplete success 必须 fail closed）', () => {
    const store = createInMemoryGeoStore()
    const result = store.commitBatchResult({
      batch: makeBatchRow(),
      observations: [makeSucceededObservationRow()],
      evidence: [], // 声称成功但没有证据
    })
    expect(result.ok).toBe(false)
    expect(store.getBatch('batch-1')).toBeUndefined()
    expect(store.getObservations('batch-1')).toEqual([])
  })

  it('失败观测带证据 → 整批回滚（失败的观测不许有证据）', () => {
    const store = createInMemoryGeoStore()
    const failedObs = makeSucceededObservationRow({
      outcome_ok: false,
      error_code: 'timeout',
      error_message: null,
      error_message_unknown_reason: 'not_recorded_by_source',
      confidence: null,
      confidence_unknown_reason: 'not_applicable',
    })
    const result = store.commitBatchResult({
      batch: makeBatchRow(),
      observations: [failedObs],
      evidence: [makeEvidenceRow()],
    })
    expect(result.ok).toBe(false)
    expect(store.getBatch('batch-1')).toBeUndefined()
  })

  it('观测行的 known/unknown 列对违反 num_nonnulls=1 时回滚', () => {
    const store = createInMemoryGeoStore()
    const badObs = makeSucceededObservationRow({ query_key: null, query_key_unknown_reason: null }) // 两列都空
    const result = store.commitBatchResult({
      batch: makeBatchRow(),
      observations: [badObs],
      evidence: [makeEvidenceRow()],
    })
    expect(result.ok).toBe(false)
    expect(store.getBatch('batch-1')).toBeUndefined()
  })

  it('同一 batchId 二次提交被拒绝（内部去重守卫，不是 provider exactly-once）', () => {
    const store = createInMemoryGeoStore()
    const first = store.commitBatchResult({
      batch: makeBatchRow(),
      observations: [makeSucceededObservationRow()],
      evidence: [makeEvidenceRow()],
    })
    expect(first.ok).toBe(true)

    const second = store.commitBatchResult({
      batch: makeBatchRow(),
      observations: [makeSucceededObservationRow()],
      evidence: [makeEvidenceRow()],
    })
    expect(second.ok).toBe(false)
    expect(second.ok ? '' : second.reason).toContain('not provider exactly-once')
    // 二次提交没有污染已存在的第一批数据
    expect(store.getObservations('batch-1')).toHaveLength(1)
  })

  it('批次内同一维度组合出现两次时回滚（内部重试不应插出两条观测）', () => {
    const store = createInMemoryGeoStore()
    const dup1 = makeSucceededObservationRow({ id: 'obs-1' })
    const dup2 = makeSucceededObservationRow({ id: 'obs-2' }) // 相同 query_key/engine/model/locale/market/sample_index
    const result = store.commitBatchResult({
      batch: makeBatchRow(),
      observations: [dup1, dup2],
      evidence: [makeEvidenceRow({ id: 'ev-1', observation_id: 'obs-1' }), makeEvidenceRow({ id: 'ev-2', observation_id: 'obs-2' })],
    })
    expect(result.ok).toBe(false)
    expect(store.getBatch('batch-1')).toBeUndefined()
  })
})
