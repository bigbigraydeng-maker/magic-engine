/**
 * Tests for src/lib/flywheel/tune/social-post-evaluator.ts — Gate B 步骤 1。
 *
 * 覆盖：4 种决策 + 4 种 INCONCLUSIVE 原因 + 阈值边界 + 阈值覆盖 +
 *       shares 缺席 caveat + cohort 均值为 0 的绝对差路径 +
 *       cohort 过滤（unmeasurable / T+4 / 缺主指标）+ lineage 顺序 +
 *       主指标降级（likes → comments）。
 */

import { describe, expect, it } from 'vitest'
import { evaluateSocialPost, DEFAULT_THRESHOLDS } from '../social-post-evaluator'
import type { PostMeasurement } from '../types'

function m(overrides: Partial<PostMeasurement> = {}): PostMeasurement {
  return {
    actionId:    overrides.actionId    ?? 'act-target',
    windowHours: overrides.windowHours ?? 72,
    status:      overrides.status      ?? 'ok',
    values:      overrides.values      ?? { likes: 10, comments: 2, shares: 1 },
    missing:     overrides.missing     ?? {},
  }
}

function cohort(likesList: number[]): PostMeasurement[] {
  return likesList.map((likes, i) =>
    m({ actionId: `act-c${i}`, values: { likes, comments: 1 } }),
  )
}

describe('evaluateSocialPost — 决策', () => {
  it('REPEAT: target 比 cohort 均值高 ≥ +30%', () => {
    const target = m({ values: { likes: 20 } })
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.decision).toBe('REPEAT')
    expect(rec.primaryMetric).toBe('likes')
    expect(rec.targetValue).toBe(20)
    expect(rec.cohortMean).toBe(10)
    expect(rec.deltaPct).toBe(100)
    expect(rec.sampleSize).toBe(3)
  })

  it('STOP: target 比 cohort 均值低 ≤ -30%', () => {
    const target = m({ values: { likes: 5 } })
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.decision).toBe('STOP')
    expect(rec.deltaPct).toBe(-50)
  })

  it('ITERATE: 落在 ±30% 灰区', () => {
    const target = m({ values: { likes: 12 } })  // +20%
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.decision).toBe('ITERATE')
    expect(rec.deltaPct).toBe(20)
  })

  it('阈值边界：正好 +30% 记 REPEAT（含号）', () => {
    const target = m({ values: { likes: 13 } })  // (13-10)/10 = 30
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.decision).toBe('REPEAT')
  })

  it('阈值边界：正好 -30% 记 STOP（含号）', () => {
    const target = m({ values: { likes: 7 } })  // (7-10)/10 = -30
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.decision).toBe('STOP')
  })
})

describe('evaluateSocialPost — INCONCLUSIVE 四种原因', () => {
  it('missing_t72: target 是 T+4', () => {
    const target = m({ windowHours: 4, values: { likes: 20 } })
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.decision).toBe('INCONCLUSIVE')
    expect(rec.inconclusiveReason).toBe('missing_t72')
    expect(rec.sourceActionIds).toEqual(['act-target'])
  })

  it('unmeasurable_target: target 回执标为 unmeasurable', () => {
    const target = m({ status: 'unmeasurable', values: {} })
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.decision).toBe('INCONCLUSIVE')
    expect(rec.inconclusiveReason).toBe('unmeasurable_target')
  })

  it('insufficient_cohort: 可比样本 < 3', () => {
    const target = m({ values: { likes: 20 } })
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10]) })
    expect(rec.decision).toBe('INCONCLUSIVE')
    expect(rec.inconclusiveReason).toBe('insufficient_cohort')
    expect(rec.sampleSize).toBe(2)
  })

  it('no_comparable_metric: target 只有 shares，cohort 只有 likes', () => {
    const target = m({ values: { shares: 5 }, missing: { likes: 'omitted', comments: 'omitted' } })
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.decision).toBe('INCONCLUSIVE')
    expect(rec.inconclusiveReason).toBe('no_comparable_metric')
  })
})

describe('evaluateSocialPost — cohort 过滤', () => {
  it('过滤掉 cohort 里 windowHours != 72 的样本', () => {
    const target = m({ values: { likes: 20 } })
    const goodCohort = cohort([10, 10, 10])
    const withT4 = [
      ...goodCohort,
      m({ actionId: 'act-t4', windowHours: 4, values: { likes: 999 } }),
    ]
    const rec = evaluateSocialPost({ target, cohort: withT4 })
    expect(rec.sampleSize).toBe(3)  // T+4 那条被过滤
    expect(rec.cohortMean).toBe(10)  // 均值不受 999 污染
  })

  it('过滤掉 cohort 里 unmeasurable 的样本', () => {
    const target = m({ values: { likes: 20 } })
    const withUnmeasurable = [
      ...cohort([10, 10, 10]),
      m({ actionId: 'act-un', status: 'unmeasurable', values: {} }),
    ]
    const rec = evaluateSocialPost({ target, cohort: withUnmeasurable })
    expect(rec.sampleSize).toBe(3)
  })
})

describe('evaluateSocialPost — 主指标降级', () => {
  it('likes 覆盖不够时回退到 comments，并加 caveat', () => {
    const target = m({ values: { likes: 20, comments: 5 } })
    const mixedCohort = [
      m({ actionId: 'c0', values: { likes: 10 } }),               // 只有 likes（1 条）
      m({ actionId: 'c1', values: { comments: 3 } }),             // 只有 comments
      m({ actionId: 'c2', values: { comments: 3 } }),             // 只有 comments
      m({ actionId: 'c3', values: { comments: 3 } }),             // 只有 comments
    ]
    const rec = evaluateSocialPost({ target, cohort: mixedCohort })
    expect(rec.decision).toBe('REPEAT')  // (5-3)/3 = +66%
    expect(rec.primaryMetric).toBe('comments')
    expect(rec.caveats).toContain('fell_back_from_likes_to_comments')
  })
})

describe('evaluateSocialPost — caveats', () => {
  it('target 缺 shares → shares_missing_on_target', () => {
    const target = m({ values: { likes: 20, comments: 5 }, missing: { shares: 'omitted_unverified' } })
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.caveats).toContain('shares_missing_on_target')
  })

  it('cohort 全部缺 shares → shares_missing_across_cohort', () => {
    const target = m({ values: { likes: 20 } })  // target 也没 shares
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.caveats).toContain('shares_missing_across_cohort')
  })

  it('target 是 partial 状态 → target_partial', () => {
    const target = m({ status: 'partial', values: { likes: 20 } })
    const rec = evaluateSocialPost({ target, cohort: cohort([10, 10, 10]) })
    expect(rec.caveats).toContain('target_partial')
  })
})

describe('evaluateSocialPost — 边界：cohort 均值为 0', () => {
  it('cohort 全 0、target > 0 → REPEAT，deltaPct = Infinity', () => {
    const target = m({ values: { likes: 5 } })
    const rec = evaluateSocialPost({ target, cohort: cohort([0, 0, 0]) })
    expect(rec.decision).toBe('REPEAT')
    expect(rec.deltaPct).toBe(Number.POSITIVE_INFINITY)
    expect(rec.rationale).toContain('大幅上升')
  })

  it('cohort 全 0、target 也 0 → ITERATE（deltaPct = 0）', () => {
    const target = m({ values: { likes: 0 } })
    const rec = evaluateSocialPost({ target, cohort: cohort([0, 0, 0]) })
    expect(rec.decision).toBe('ITERATE')
    expect(rec.deltaPct).toBe(0)
  })
})

describe('evaluateSocialPost — 阈值覆盖 & lineage', () => {
  it('Playbook 传入更严格阈值时生效', () => {
    const target = m({ values: { likes: 15 } })  // +50%
    const rec = evaluateSocialPost({
      target,
      cohort: cohort([10, 10, 10]),
      thresholds: { repeatDeltaPct: 60 },  // 提高到 60，此条应记 ITERATE
    })
    expect(rec.decision).toBe('ITERATE')
    expect(rec.thresholdsUsed.repeatDeltaPct).toBe(60)
    expect(rec.thresholdsUsed.minSampleSize).toBe(DEFAULT_THRESHOLDS.minSampleSize)
  })

  it('Playbook 提高最低样本数 → 挡在 insufficient_cohort', () => {
    const target = m({ values: { likes: 20 } })
    const rec = evaluateSocialPost({
      target,
      cohort: cohort([10, 10, 10]),
      thresholds: { minSampleSize: 5 },
    })
    expect(rec.decision).toBe('INCONCLUSIVE')
    expect(rec.inconclusiveReason).toBe('insufficient_cohort')
  })

  it('sourceActionIds 首条永远是 target，其余是入选 cohort 的 actionId', () => {
    const target = m({ actionId: 'act-T', values: { likes: 20 } })
    const rec = evaluateSocialPost({
      target,
      cohort: [
        m({ actionId: 'act-A', values: { likes: 10 } }),
        m({ actionId: 'act-B', values: { likes: 10 } }),
        m({ actionId: 'act-C', values: { likes: 10 } }),
      ],
    })
    expect(rec.sourceActionIds[0]).toBe('act-T')
    expect(rec.sourceActionIds.slice(1).sort()).toEqual(['act-A', 'act-B', 'act-C'])
  })
})
