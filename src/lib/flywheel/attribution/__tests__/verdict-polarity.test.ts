import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { computeOutcomeVerdict } from '../job'

describe('computeOutcomeVerdict polarity', () => {
  it('marks cost per lead rising 6% as reversed', () => {
    const result = computeOutcomeVerdict(
      'ads.account.cost_per_lead',
      0.65,
      6,
      null,
    )
    expect(result.verdict).toBe('reversed')
  })

  it('marks cost per lead falling 6% as confirmed', () => {
    const result = computeOutcomeVerdict(
      'ads.account.cost_per_lead',
      -0.65,
      -6,
      null,
    )
    expect(result.verdict).toBe('confirmed')
  })

  it('marks cost per lead falling 1% as inconclusive', () => {
    const result = computeOutcomeVerdict(
      'ads.account.cost_per_lead',
      -0.1,
      -1,
      null,
    )
    expect(result.verdict).toBe('inconclusive')
  })

  it.each([
    'ads.account.cpa',
    'ads.account.cpc',
    'ads.account.cost_per_conversation',
  ])('marks %s rising 6% as reversed', (key) => {
    const result = computeOutcomeVerdict(key, 0.65, 6, null)
    expect(result.verdict).toBe('reversed')
  })

  it('marks geo.query.avg_rank rising 10% as reversed', () => {
    const result = computeOutcomeVerdict('geo.query.avg_rank', 1, 10, null)
    expect(result.verdict).toBe('reversed')
  })

  it('marks geo.query.avg_rank falling 10% as confirmed', () => {
    const result = computeOutcomeVerdict('geo.query.avg_rank', -1, -10, null)
    expect(result.verdict).toBe('confirmed')
  })

  it('marks clicks rising 6% as confirmed', () => {
    const result = computeOutcomeVerdict('ads.account.clicks', 60, 6, null)
    expect(result.verdict).toBe('confirmed')
  })

  it('marks clicks falling 6% as reversed', () => {
    const result = computeOutcomeVerdict('ads.account.clicks', -60, -6, null)
    expect(result.verdict).toBe('reversed')
  })

  it('marks spend rising 50% as inconclusive with zero confidence', () => {
    const result = computeOutcomeVerdict('ads.account.spend', 100, 50, null)
    expect(result.verdict).toBe('inconclusive')
    expect(result.confidence).toBe(0)
  })

  it('marks spend falling 50% as inconclusive', () => {
    const result = computeOutcomeVerdict('ads.account.spend', -100, -50, null)
    expect(result.verdict).toBe('inconclusive')
  })

  it('does not flip an explicit expectedDelta when direction matches (rising)', () => {
    const result = computeOutcomeVerdict(
      'ads.account.cost_per_lead',
      2,
      20,
      1,
    )
    expect(result.verdict).toBe('confirmed')
  })

  it('does not flip an explicit expectedDelta when direction matches (falling)', () => {
    const result = computeOutcomeVerdict(
      'ads.account.cost_per_lead',
      -2,
      -20,
      -1,
    )
    expect(result.verdict).toBe('confirmed')
  })

  it('keeps GSC rank improvement confirmed for seo.gsc.page_avg_position', () => {
    const result = computeOutcomeVerdict(
      'seo.gsc.page_avg_position',
      2,
      20,
      1,
    )
    expect(result.verdict).toBe('confirmed')
  })

  it('returns a valid verdict for seo.gsc.avg_position', () => {
    const result = computeOutcomeVerdict('seo.gsc.avg_position', 2, 20, 1)
    expect(['confirmed', 'inconclusive']).toContain(result.verdict)
  })
})
