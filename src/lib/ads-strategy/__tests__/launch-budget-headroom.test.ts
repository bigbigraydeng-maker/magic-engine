import { describe, expect, it } from 'vitest'
import { computeLaunchHeadroom, sumDeliveringDailyMinor, type HeadroomRow } from '../launch-budget-headroom'

const AT = '2026-10-05T12:30:54.253Z'

function row(p: Partial<HeadroomRow> & Pick<HeadroomRow, 'level' | 'entity_id'>): HeadroomRow {
  return {
    ad_account_id: 'acct_a',
    campaign_id: p.level === 'campaign' ? p.entity_id : null,
    budget_level: p.level === 'campaign' ? 'cbo' : 'abo',
    daily_budget_minor: null,
    effective_status: 'ACTIVE',
    currency: 'NZD',
    capture_reason: 'daily',
    captured_at: AT,
    ...p,
  }
}

// 两个 CBO 系列（60 + 40）+ 一个独立 ABO 广告组（15）= 115
const base: HeadroomRow[] = [
  row({ level: 'campaign', entity_id: 'c1', daily_budget_minor: 6000 }),
  row({ level: 'adset', entity_id: 'c1-s1', campaign_id: 'c1', budget_level: 'cbo' }),
  row({ level: 'campaign', entity_id: 'c2', daily_budget_minor: 4000 }),
  row({ level: 'adset', entity_id: 'c2-s1', campaign_id: 'c2', budget_level: 'cbo' }),
  row({ level: 'campaign', entity_id: 'c3', budget_level: 'abo' }),
  row({ level: 'adset', entity_id: 'c3-s1', campaign_id: 'c3', budget_level: 'abo', daily_budget_minor: 1500 }),
]

describe('computeLaunchHeadroom', () => {
  it('sums CBO campaigns once and ABO ad sets, not the CBO children', () => {
    const r = computeLaunchHeadroom({ rows: base, capMinor: 15000, committed: [] })
    expect(r.ok && r.deliveringTotalMinor).toBe(11500)
    expect(r.ok && r.headroomAfterMinor).toBe(3500)
  })

  it('adds committed increases and reports the set-budget headroom (30 new → 5 left)', () => {
    const r = computeLaunchHeadroom({ rows: base, capMinor: 15000, committed: [{ label: 'new series', minor: 3000 }] })
    expect(r).toMatchObject({ ok: true, projectedMinor: 14500, headroomAfterMinor: 500, fits: true })
  })

  it('stacking a second committed increase can push it over the cap', () => {
    const r = computeLaunchHeadroom({
      rows: base,
      capMinor: 15000,
      committed: [
        { label: 'new series', minor: 3000 },
        { label: 'retargeting +20%', minor: 800 },
      ],
    })
    expect(r).toMatchObject({ ok: true, projectedMinor: 15300, headroomAfterMinor: -300, fits: false })
  })

  it('treats exactly-at-cap as fitting and one minor unit over as not fitting', () => {
    const at = computeLaunchHeadroom({ rows: base, capMinor: 11500, committed: [] })
    const over = computeLaunchHeadroom({ rows: base, capMinor: 11500, committed: [{ label: 'x', minor: 1 }] })
    expect(at.ok && at.fits).toBe(true)
    expect(over.ok && over.fits).toBe(false)
  })

  it('does not count paused or campaign-paused units as delivering, but reports them as latent budget', () => {
    const rows: HeadroomRow[] = [
      ...base,
      row({ level: 'campaign', entity_id: 'p1', budget_level: 'abo', effective_status: 'PAUSED' }),
      row({ level: 'adset', entity_id: 'p1-s1', campaign_id: 'p1', budget_level: 'abo', daily_budget_minor: 4000, effective_status: 'CAMPAIGN_PAUSED' }),
      row({ level: 'adset', entity_id: 'c3-s2', campaign_id: 'c3', budget_level: 'abo', daily_budget_minor: 1200, effective_status: 'PAUSED' }),
    ]
    const r = computeLaunchHeadroom({ rows, capMinor: 15000, committed: [] })
    expect(r.ok && r.deliveringTotalMinor).toBe(11500)
    expect(r.ok && r.latentTotalMinor).toBe(5200)
    expect(r.ok && r.latentPerAccountMinor).toEqual({ acct_a: 5200 })
    expect(r.ok && r.latentUnits.map((u) => u.entityId).sort()).toEqual(['c3-s2', 'p1-s1'])
  })

  it('ignores disappeared rows and keeps only the newest snapshot per entity', () => {
    const rows: HeadroomRow[] = [
      ...base,
      row({ level: 'adset', entity_id: 'gone', budget_level: 'abo', daily_budget_minor: 9999, capture_reason: 'disappeared' }),
      row({ level: 'adset', entity_id: 'c3-s1', campaign_id: 'c3', budget_level: 'abo', daily_budget_minor: 500, captured_at: '2026-10-01T00:00:00Z' }),
    ]
    const r = computeLaunchHeadroom({ rows, capMinor: 15000, committed: [] })
    expect(r.ok && r.deliveringTotalMinor).toBe(11500)
  })

  it('sums delivering daily budget, and an empty read is unknown rather than zero', () => {
    expect(sumDeliveringDailyMinor(base)).toBe(11500)
    expect(sumDeliveringDailyMinor([])).toBeNull()
    const pausedOnly = [row({
      level: 'adset', entity_id: 'paused', budget_level: 'abo', daily_budget_minor: 4000, effective_status: 'PAUSED',
    })]
    expect(sumDeliveringDailyMinor(pausedOnly)).toBe(0)
    const broken = [...base, row({ level: 'adset', entity_id: 'bad', budget_level: 'abo', daily_budget_minor: null })]
    expect(sumDeliveringDailyMinor(broken)).toBeNull()
  })

  it('breaks the total down per ad account', () => {
    const rows: HeadroomRow[] = [
      ...base,
      row({ ad_account_id: 'acct_b', level: 'campaign', entity_id: 'b1', budget_level: 'abo' }),
      row({ ad_account_id: 'acct_b', level: 'adset', entity_id: 'b1-s1', campaign_id: 'b1', daily_budget_minor: 2000 }),
    ]
    const r = computeLaunchHeadroom({ rows, capMinor: 15000, committed: [] })
    expect(r.ok && r.perAccountMinor).toEqual({ acct_a: 11500, acct_b: 2000 })
  })

  describe('fails closed', () => {
    it('on a delivering unit with no budget', () => {
      const rows = [...base, row({ level: 'adset', entity_id: 'bad', budget_level: 'abo', daily_budget_minor: null })]
      expect(computeLaunchHeadroom({ rows, capMinor: 15000, committed: [] }).ok).toBe(false)
    })
    it('on mixed currencies', () => {
      const rows = [...base, row({ level: 'adset', entity_id: 'aud', budget_level: 'abo', daily_budget_minor: 1000, currency: 'AUD' })]
      expect(computeLaunchHeadroom({ rows, capMinor: 15000, committed: [] }).ok).toBe(false)
    })
    it('on a missing or invalid cap', () => {
      expect(computeLaunchHeadroom({ rows: base, capMinor: null, committed: [] }).ok).toBe(false)
      expect(computeLaunchHeadroom({ rows: base, capMinor: 0, committed: [] }).ok).toBe(false)
    })
    it('on no snapshot rows', () => {
      expect(computeLaunchHeadroom({ rows: [], capMinor: 15000, committed: [] }).ok).toBe(false)
    })
    it('on a negative committed amount', () => {
      expect(computeLaunchHeadroom({ rows: base, capMinor: 15000, committed: [{ label: 'x', minor: -1 }] }).ok).toBe(false)
    })
    it('on a delivering campaign whose budget level is unknown', () => {
      const rows = [...base, row({ level: 'campaign', entity_id: 'weird', budget_level: null })]
      expect(computeLaunchHeadroom({ rows, capMinor: 15000, committed: [] }).ok).toBe(false)
    })
  })
})
