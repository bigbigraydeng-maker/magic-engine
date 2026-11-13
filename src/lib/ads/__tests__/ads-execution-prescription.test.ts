import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  aggregateExperienceRows,
  appendExperienceHint,
  formatExperienceHint,
  parseExecutionReviewPreference,
} from '../ads-execution-prescription-experience'
import {
  applyExperienceToPrescriptionItems,
  generateAdsExecutionPrescription,
} from '../ads-execution-prescription'
import { DEFAULT_ADS_EXECUTION_PRESCRIPTION_READBACK_RULES } from '../ads-execution-prescription-rules'

describe('parseExecutionReviewPreference', () => {
  it('parses kind and tier from auto_extracted content', () => {
    expect(parseExecutionReviewPreference('调日预算执行回顾：结论「有用」 改前…')).toEqual({
      kind: 'budget',
      tier: 'useful',
    })
    expect(parseExecutionReviewPreference('暂停广告组执行回顾：结论「没用」')).toEqual({
      kind: 'pause',
      tier: 'not_useful',
    })
    expect(parseExecutionReviewPreference('暂停广告组执行回顾：结论「看不出」')).toEqual({
      kind: 'pause',
      tier: 'unclear',
    })
    expect(parseExecutionReviewPreference('别的内容')).toEqual({ kind: null, tier: null })
  })
})

describe('aggregateExperienceRows', () => {
  it('counts useful and not_useful; ignores unclear', () => {
    const counts = aggregateExperienceRows([
      { content: '调日预算执行回顾：结论「有用」' },
      { content: '调日预算执行回顾：结论「有用」' },
      { content: '调日预算执行回顾：结论「没用」' },
      { content: '暂停广告组执行回顾：结论「看不出」' },
    ])
    expect(counts.budget).toEqual({ useful: 2, not_useful: 1 })
    expect(counts.pause).toEqual({ useful: 0, not_useful: 0 })
  })
})

describe('formatExperienceHint', () => {
  it('returns null when there is no weighted tier', () => {
    expect(formatExperienceHint('budget', { useful: 0, not_useful: 0 }, 90)).toBeNull()
  })

  it('formats a short hint', () => {
    expect(formatExperienceHint('pause', { useful: 1, not_useful: 2 }, 30)).toBe(
      '近 30 天暂停广告组卡回顾：有用 1 次、没用 2 次。',
    )
  })
})

describe('applyExperienceToPrescriptionItems', () => {
  const rules = DEFAULT_ADS_EXECUTION_PRESCRIPTION_READBACK_RULES
  const experience = aggregateExperienceRows([
    { content: '暂停广告组执行回顾：结论「没用」' },
    { content: '调日预算执行回顾：结论「有用」' },
  ])

  it('down-ranks types with enough not_useful verdicts', () => {
    const items = applyExperienceToPrescriptionItems([
      { type: 'pause', priority: 10 },
      { type: 'budget', priority: 10 },
    ], experience, rules)
    expect(items[0]?.type).toBe('budget')
    expect(items[1]?.type).toBe('pause')
    expect(items[1]?.adjustedPriority).toBe(10 + rules.notUsefulDownrankPenalty)
  })

  it('attaches per-type hints', () => {
    const items = applyExperienceToPrescriptionItems([
      { type: 'budget', priority: 0 },
    ], experience, rules)
    expect(items[0]?.experienceHint).toContain('调日预算')
  })
})

describe('generateAdsExecutionPrescription', () => {
  it('loads preferences and returns sorted items', async () => {
    const sb = {
      from() {
        const self = {
          select() { return self },
          eq() { return self },
          gte() { return self },
          limit: async () => ({
            data: [{ content: '暂停广告组执行回顾：结论「没用」' }],
            error: null,
          }),
        }
        return self
      },
    } as unknown as SupabaseClient
    const prescription = await generateAdsExecutionPrescription(sb, {
      clientId: 'c-1',
      items: [
        { type: 'pause', priority: 1 },
        { type: 'budget', priority: 1 },
      ],
      now: new Date('2026-11-12T00:00:00.000Z'),
    })
    expect(prescription.items[0]?.type).toBe('budget')
    expect(prescription.items[1]?.type).toBe('pause')
    expect(prescription.items[1]?.experienceHint).toContain('没用')
  })
})

describe('appendExperienceHint', () => {
  it('leaves scope unchanged when hint is null', () => {
    expect(appendExperienceHint('scope', null)).toBe('scope')
  })
})
