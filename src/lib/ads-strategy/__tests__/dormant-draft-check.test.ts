import { describe, expect, it } from 'vitest'
import { checkDormantDraft, type DormantSnapshotRow, type DormantSpendEvidence } from '../dormant-draft-check'

const NOW = new Date('2026-10-06T02:00:00Z')
const AT = '2026-10-05T12:30:00Z'

function snap(p: Partial<DormantSnapshotRow> & Pick<DormantSnapshotRow, 'level' | 'entity_id'>): DormantSnapshotRow {
  return {
    campaign_id: p.level === 'campaign' ? p.entity_id : 'c1',
    status: 'PAUSED',
    effective_status: 'PAUSED',
    captured_at: AT,
    ...p,
  }
}

const allPaused: DormantSnapshotRow[] = [
  snap({ level: 'campaign', entity_id: 'c1' }),
  snap({ level: 'adset', entity_id: 's1' }),
  snap({ level: 'ad', entity_id: 'a1' }),
  snap({ level: 'ad', entity_id: 'a2' }),
]
const liveZero: DormantSpendEvidence = { source: 'meta_live', throughDate: '2026-10-05', rows: [] }

const run = (over: Partial<Parameters<typeof checkDormantDraft>[0]> = {}) =>
  checkDormantDraft({
    campaignIds: ['c1'],
    rows: allPaused,
    spend: liveZero,
    sinceDate: '2026-10-01',
    requiredThroughDate: '2026-10-05',
    now: NOW,
    ...over,
  })

describe('checkDormantDraft', () => {
  it('passes when all three layers are paused by their own status and live spend is zero', () => {
    const r = run()
    expect(r.verdict).toBe('ok')
    expect(r.layers).toEqual({ campaign: { count: 1, notPaused: [] }, adset: { count: 1, notPaused: [] }, ad: { count: 2, notPaused: [] } })
    expect(r.findings).toEqual([])
  })

  it('flags a child that is ACTIVE by itself even though the parent hides it as CAMPAIGN_PAUSED', () => {
    const rows = [
      snap({ level: 'campaign', entity_id: 'c1' }),
      snap({ level: 'adset', entity_id: 's1', status: 'ACTIVE', effective_status: 'CAMPAIGN_PAUSED' }),
      snap({ level: 'ad', entity_id: 'a1', status: 'ACTIVE', effective_status: 'CAMPAIGN_PAUSED' }),
    ]
    const r = run({ rows })
    expect(r.verdict).toBe('violation')
    expect(r.layers.adset.notPaused).toEqual(['s1'])
    expect(r.layers.ad.notPaused).toEqual(['a1'])
  })

  it('flags an opened campaign', () => {
    const rows = [snap({ level: 'campaign', entity_id: 'c1', status: 'ACTIVE', effective_status: 'ACTIVE' }), ...allPaused.slice(1)]
    expect(run({ rows }).verdict).toBe('violation')
  })

  it('flags any spend since the draft was created', () => {
    const spend: DormantSpendEvidence = { source: 'meta_live', throughDate: '2026-10-05', rows: [{ entity_id: 'a1', insight_date: '2026-10-03', spend: 1.51 }] }
    const r = run({ spend })
    expect(r.verdict).toBe('violation')
    expect(r.spendTotal).toBeCloseTo(1.51)
  })

  it('ignores spend dated before sinceDate', () => {
    const spend: DormantSpendEvidence = { source: 'meta_live', throughDate: '2026-10-05', rows: [{ entity_id: 'a1', insight_date: '2026-09-20', spend: 9 }] }
    expect(run({ spend }).verdict).toBe('ok')
  })

  it('cannot prove zero spend from a stale db table (zero-spend days have no rows)', () => {
    const spend: DormantSpendEvidence = { source: 'db_insights', latestInsightDate: '2026-09-22', rows: [] }
    const r = run({ spend })
    expect(r.verdict).toBe('unverified')
    expect(r.findings.join()).toContain('Meta 实时读回')
  })

  it('accepts db evidence once its latest date covers the required day', () => {
    const spend: DormantSpendEvidence = { source: 'db_insights', latestInsightDate: '2026-10-05', rows: [] }
    expect(run({ spend }).verdict).toBe('ok')
  })

  it('is unverified when a whole layer has no snapshot', () => {
    const r = run({ rows: allPaused.filter((x) => x.level !== 'ad') })
    expect(r.verdict).toBe('unverified')
  })

  it('is unverified when the own status is unreadable', () => {
    const rows = [...allPaused.slice(0, 3), snap({ level: 'ad', entity_id: 'a2', status: null })]
    expect(run({ rows }).verdict).toBe('unverified')
  })

  it('is unverified when the snapshot is too old', () => {
    const rows = allPaused.map((r) => ({ ...r, captured_at: '2026-10-03T00:00:00Z' }))
    expect(run({ rows }).verdict).toBe('unverified')
  })

  it('violation wins over unverified', () => {
    const rows = [snap({ level: 'campaign', entity_id: 'c1', status: 'ACTIVE' })]
    expect(run({ rows }).verdict).toBe('violation')
  })

  it('ignores rows that belong to other campaigns', () => {
    const rows = [...allPaused, snap({ level: 'adset', entity_id: 'other', campaign_id: 'c9', status: 'ACTIVE' })]
    expect(run({ rows }).verdict).toBe('ok')
  })

  it('refuses to judge with no campaign ids', () => {
    expect(run({ campaignIds: [] }).verdict).toBe('unverified')
  })
})
