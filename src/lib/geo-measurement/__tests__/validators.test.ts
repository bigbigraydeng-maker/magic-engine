/**
 * GEO Measurement 契约校验器 —— 冻结不变量的守卫（Issue #876 / WP02）
 *
 * 每一条断言都指向 GEO 测量契约 v1.0 里的一条红线，不是为了凑数量。
 */

import { describe, it, expect } from 'vitest'
import {
  validateGeoAcquisitionIdentity,
  validateGeoInterpretationIdentity,
  validateGeoEvidence,
  validateGeoObservation,
  validateGeoMetricsSummary,
} from '../validators'
import type {
  GeoAcquisitionIdentity,
  GeoEvidence,
  GeoInterpretationIdentity,
  GeoMetricKey,
  GeoMetricsSummary,
  GeoObservation,
} from '../types'

// ── 合法样本（就地构造，不建共享 fixture 文件）────────────────────────────────

const acquisition = (): GeoAcquisitionIdentity => ({
  querySetVersion: { known: true, value: 'roman-nz-geo-v1' },
  queryKey: { known: true, value: 'best_migration_agent_auckland' },
  engineFamily: { known: true, value: 'chatgpt' },
  modelVersion: { known: true, value: 'gpt-4o-2026-06' },
  locale: { known: true, value: 'en-NZ' },
  market: { known: true, value: 'nz' },
  sample: {
    samplePlan: { known: true, value: { plannedCount: 3 } },
    sampleIndex: { known: true, value: 1 },
    samplingParameters: { known: false, reason: 'not_recorded_by_source' },
  },
})

const interpretation = (): GeoInterpretationIdentity => ({
  parserVersion: { known: true, value: 'geo-parser@2026-08-01' },
  metricRulesVersion: { known: true, value: 'geo-rules@2026-08-01' },
})

const evidence = (): GeoEvidence => ({
  evidenceId: 'ev-1',
  observationId: 'obs-1',
  rawResponseLocator: { known: true, value: 'geo_evidence/ev-1#raw' },
  citations: [
    {
      url: 'https://example-migration.co.nz/services',
      domain: 'example-migration.co.nz',
      ownedDomain: { known: true, value: true },
      ownedPage: { status: 'associated', pageRef: 'canonical:services' },
    },
  ],
})

const observation = (): GeoObservation => ({
  observationId: 'obs-1',
  batchId: 'batch-1',
  acquisition: acquisition(),
  interpretation: interpretation(),
  confidence: { known: true, value: 0.86 },
  observedAt: '2026-08-10T01:00:00.000Z',
  outcome: { ok: true, evidenceId: 'ev-1' },
})

/** 🔴 每个字段必须传自己的 metricKey —— 校验器现在绑定 key，混用会被拒绝。 */
const metric = (metricKey: GeoMetricKey, overrides: Partial<{ computable: boolean }> = {}) => ({
  metricKey,
  value:
    overrides.computable === false
      ? { computable: false as const, reason: 'no page ledger available' }
      : { computable: true as const, value: 0.42 },
  metricRulesVersion: { known: true as const, value: 'geo-rules@2026-08-01' },
  sampleSize: 12,
})

const metricsSummary = (): GeoMetricsSummary => ({
  qualifiedMention: metric('qualified_mention'),
  recommendation: metric('recommendation'),
  citation: metric('citation'),
  ownedDomainCitation: metric('owned_domain_citation'),
  directOwnedPageCitation: metric('direct_owned_page_citation', { computable: false }),
  conditionalRank: {
    metricRulesVersion: { known: true, value: 'geo-rules@2026-08-01' },
    sampleSize: 5,
    value: { applicable: true, computable: true, rank: 2 },
  },
  engineCoverage: metric('engine_coverage'),
})

const mutate = <T>(base: T, patch: Record<string, unknown>): unknown => ({ ...base, ...patch })

// ── Acquisition identity ──────────────────────────────────────────────────────

describe('validateGeoAcquisitionIdentity', () => {
  it('完整的七项 + 三层 sample 通过', () => {
    expect(validateGeoAcquisitionIdentity(acquisition())).toEqual({ ok: true })
  })

  it('七项全部显式「未知」也通过 —— 不知道是合法状态', () => {
    const unknown = { known: false as const, reason: 'not_recorded_by_source' as const }
    expect(
      validateGeoAcquisitionIdentity({
        querySetVersion: unknown,
        queryKey: unknown,
        engineFamily: unknown,
        modelVersion: unknown,
        locale: unknown,
        market: unknown,
        sample: { samplePlan: unknown, sampleIndex: unknown, samplingParameters: unknown },
      }),
    ).toEqual({ ok: true })
  })

  it('缺任意一项采集身份维度就拒绝', () => {
    const { querySetVersion: _drop, ...rest } = acquisition()
    expect(validateGeoAcquisitionIdentity(rest).ok).toBe(false)
  })

  it('sample 缺三层中任意一层就拒绝', () => {
    const a = acquisition()
    const { samplePlan: _drop, ...restSample } = a.sample
    expect(validateGeoAcquisitionIdentity({ ...a, sample: restSample }).ok).toBe(false)
  })

  it('sample 省略 known/unknown 判别式（例如直接给 null）拒绝', () => {
    const a = acquisition()
    expect(
      validateGeoAcquisitionIdentity(mutate(a, { sample: { ...a.sample, sampleIndex: null } })).ok,
    ).toBe(false)
  })
})

// ── Interpretation identity ───────────────────────────────────────────────────

describe('validateGeoInterpretationIdentity', () => {
  it('完整的解释身份通过', () => {
    expect(validateGeoInterpretationIdentity(interpretation())).toEqual({ ok: true })
  })

  it('两项都未知也通过', () => {
    const unknown = { known: false as const, reason: 'not_recorded_by_source' as const }
    expect(
      validateGeoInterpretationIdentity({ parserVersion: unknown, metricRulesVersion: unknown }),
    ).toEqual({ ok: true })
  })

  it('缺 metricRulesVersion 拒绝 —— v1 冻结它是必填的单一不透明字段', () => {
    const { metricRulesVersion: _drop, ...rest } = interpretation()
    expect(validateGeoInterpretationIdentity(rest).ok).toBe(false)
  })
})

// ── Evidence ───────────────────────────────────────────────────────────────────

describe('validateGeoEvidence', () => {
  it('完整证据通过', () => {
    expect(validateGeoEvidence(evidence())).toEqual({ ok: true })
  })

  it('not_computable 的页面关联必须带 reason', () => {
    const e = evidence()
    expect(
      validateGeoEvidence(
        mutate(e, {
          citations: [{ ...e.citations[0], ownedPage: { status: 'not_computable' } }],
        }),
      ).ok,
    ).toBe(false)
  })

  it('associated 的页面关联必须带 pageRef', () => {
    const e = evidence()
    expect(
      validateGeoEvidence(
        mutate(e, { citations: [{ ...e.citations[0], ownedPage: { status: 'associated' } }] }),
      ).ok,
    ).toBe(false)
  })
})

// ── Observation ─────────────────────────────────────────────────────────────

describe('validateGeoObservation', () => {
  it('成功观测通过', () => {
    expect(validateGeoObservation(observation())).toEqual({ ok: true })
  })

  it('失败观测（ok:false + errorCode）同样是合法观测 —— 失败也要落行', () => {
    const failed: GeoObservation = {
      ...observation(),
      outcome: { ok: false, errorCode: 'upstream_timeout', errorMessage: { known: true, value: 'timed out at 30s' } },
    }
    expect(validateGeoObservation(failed)).toEqual({ ok: true })
  })

  it('outcome.ok=true 缺 evidenceId 拒绝', () => {
    expect(validateGeoObservation(mutate(observation(), { outcome: { ok: true } })).ok).toBe(false)
  })

  it('confidence 为 NaN 拒绝 —— NaN 的 typeof 是 "number"，不能只靠类型判断', () => {
    expect(
      validateGeoObservation(mutate(observation(), { confidence: { known: true, value: Number.NaN } })).ok,
    ).toBe(false)
  })

  it('confidence 超出 [0,1] 范围（例如 1.5）拒绝', () => {
    expect(validateGeoObservation(mutate(observation(), { confidence: { known: true, value: 1.5 } })).ok).toBe(
      false,
    )
  })

  it('内嵌的采集身份不合法时，观测整体拒绝', () => {
    const o = observation()
    expect(
      validateGeoObservation(mutate(o, { acquisition: { ...o.acquisition, queryKey: undefined } })).ok,
    ).toBe(false)
  })
})

// ── Metrics summary ────────────────────────────────────────────────────────

describe('validateGeoMetricsSummary', () => {
  it('七个指标齐全通过', () => {
    expect(validateGeoMetricsSummary(metricsSummary())).toEqual({ ok: true })
  })

  it('缺 conditionalRank 拒绝', () => {
    const { conditionalRank: _drop, ...rest } = metricsSummary()
    expect(validateGeoMetricsSummary(rest).ok).toBe(false)
  })

  it('conditionalRank.applicable=false（未提及）不许附带 rank 之外的合法结构', () => {
    expect(
      validateGeoMetricsSummary(
        mutate(metricsSummary(), { conditionalRank: { ...metricsSummary().conditionalRank, value: { applicable: false } } }),
      ),
    ).toEqual({ ok: true })
  })

  it('conditionalRank.computable=true 但缺 rank 拒绝', () => {
    expect(
      validateGeoMetricsSummary(
        mutate(metricsSummary(), {
          conditionalRank: {
            ...metricsSummary().conditionalRank,
            value: { applicable: true, computable: true },
          },
        }),
      ).ok,
    ).toBe(false)
  })

  it('not_computable 的指标必须带 reason，不许悄悄变成 0', () => {
    expect(
      validateGeoMetricsSummary(
        mutate(metricsSummary(), {
          directOwnedPageCitation: { ...metric('direct_owned_page_citation'), value: { computable: false } },
        }),
      ).ok,
    ).toBe(false)
  })

  it('metricKey 挪错位置（例如把 qualified_mention 塞进 recommendation 字段）拒绝', () => {
    expect(
      validateGeoMetricsSummary(
        mutate(metricsSummary(), { recommendation: metric('qualified_mention') }),
      ).ok,
    ).toBe(false)
  })
})
