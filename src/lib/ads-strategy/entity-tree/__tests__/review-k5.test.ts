import { describe, expect, it } from 'vitest'
import { buildEntityTree, type InsightRow, type SnapshotRow } from '../build'
import { toSnapshotRow } from '../load'
import { audienceChangedOn, judgeCreatives } from '../creative-compare'

function insight(over: Partial<InsightRow> & Pick<InsightRow, 'level' | 'entityId' | 'date'>): InsightRow {
  return { entityName: null, parentId: null, spend: 0, impressions: 0, clicks: 0, leads: 0, messagingConversations: 0, ...over }
}

function snap(over: Partial<SnapshotRow> & Pick<SnapshotRow, 'level' | 'entityId'>): SnapshotRow {
  return { entityName: null, campaignId: null, adsetId: null, effectiveStatus: null, dailyBudgetMinor: null, currency: null, capturedAt: '2024-03-10T00:00:00Z', ...over }
}

const OPTS = { endDate: '2024-03-10', days: 7 }

const campaignSnap = (): SnapshotRow =>
  snap({ level: 'campaign', entityId: 'c1', entityName: 'Campaign', effectiveStatus: 'ACTIVE' })

describe('judgeCreatives target_unknown', () => {
  it('marks every verdict target_unknown when the target is not known', () => {
    const ads = [
      { spend: 100, leads: 5, messagingConversations: 0, linkClicks: 50, linkClicksStored: true },
      { spend: 100, leads: 3, messagingConversations: 0, linkClicks: 40, linkClicksStored: true },
    ]
    const verdicts = judgeCreatives(ads, 'lead', 10, false)
    expect(verdicts.map((v) => v.comparability)).toEqual(['target_unknown', 'target_unknown'])
  })
})

describe('buildEntityTree targetKnown', () => {
  it('reports targetKnown false when no snapshot ever stored a destination or goal', () => {
    const insights = [
      insight({ level: 'adset', entityId: 's1', date: '2024-03-08', spend: 10 }),
      insight({ level: 'ad', entityId: 'a1', date: '2024-03-08', spend: 10, leads: 1 }),
    ]
    const snapshots = [
      campaignSnap(),
      snap({ level: 'adset', entityId: 's1', campaignId: 'c1', effectiveStatus: 'ACTIVE', destinationType: null, optimizationGoal: null }),
      snap({ level: 'ad', entityId: 'a1', adsetId: 's1', effectiveStatus: 'ACTIVE' }),
    ]
    const tree = buildEntityTree(insights, snapshots, OPTS)
    const adset = tree.campaigns[0].adsets[0]
    expect(adset.targetKnown).toBe(false)
    expect(adset.resultType).toBeNull()
    expect(adset.ads[0].creative.comparability).toBe('target_unknown')
  })

  it('uses the latest snapshot that stored a destination/goal, ignoring a later disappeared row', () => {
    const insights = [
      insight({ level: 'adset', entityId: 's1', date: '2024-03-08', spend: 10 }),
      insight({ level: 'ad', entityId: 'a1', date: '2024-03-08', spend: 10, leads: 1 }),
    ]
    const snapshots = [
      campaignSnap(),
      snap({ level: 'adset', entityId: 's1', campaignId: 'c1', effectiveStatus: 'ACTIVE', capturedAt: '2024-03-05T00:00:00Z', destinationType: 'ON_AD', optimizationGoal: 'LEAD_GENERATION' }),
      snap({ level: 'adset', entityId: 's1', campaignId: 'c1', effectiveStatus: 'NOT_RETURNED', capturedAt: '2024-03-09T00:00:00Z', destinationType: null, optimizationGoal: null }),
      snap({ level: 'ad', entityId: 'a1', adsetId: 's1', effectiveStatus: 'ACTIVE' }),
    ]
    const tree = buildEntityTree(insights, snapshots, OPTS)
    const adset = tree.campaigns[0].adsets[0]
    expect(adset.targetKnown).toBe(true)
    expect(adset.resultType).toBe('lead')
  })
})

describe('toSnapshotRow audienceKey', () => {
  it('is null for a NOT_RETURNED ad set row', () => {
    const row = toSnapshotRow({
      level: 'adset',
      entity_id: 's1',
      entity_name: 'Adset',
      campaign_id: 'c1',
      adset_id: null,
      effective_status: 'NOT_RETURNED',
      daily_budget_minor: null,
      currency: null,
      captured_at: '2024-03-09T00:00:00Z',
      creative_page_id: null,
      included_audience_ids: [],
      excluded_audience_ids: [],
      targeting_summary: null,
      advantage_audience: null,
    })
    expect(row).not.toBeNull()
    expect(row?.audienceKey).toBeNull()
  })
})

describe('audienceChangedOn', () => {
  it('ignores a disappeared (null-key) snapshot between two identical keys', () => {
    const rows = [
      { capturedAt: '2024-03-04T10:00:00Z', audienceKey: 'k1' },
      { capturedAt: '2024-03-06T10:00:00Z', audienceKey: null },
      { capturedAt: '2024-03-08T10:00:00Z', audienceKey: 'k1' },
    ]
    expect(audienceChangedOn(rows, '2024-03-01', '2024-03-10')).toBeNull()
  })

  it('buckets days in the given time zone', () => {
    const rows = [
      { capturedAt: '2024-03-02T12:30:00Z', audienceKey: 'a' },
      { capturedAt: '2024-03-03T12:30:00Z', audienceKey: 'b' },
    ]
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10', 'Pacific/Auckland')).toBe('2024-03-04')
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10', 'UTC')).toBeNull()
  })

  it('falls back to UTC for an invalid time zone', () => {
    const rows = [
      { capturedAt: '2024-03-02T12:30:00Z', audienceKey: 'a' },
      { capturedAt: '2024-03-03T12:30:00Z', audienceKey: 'b' },
    ]
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10', 'Not/AZone')).toBeNull()
  })
})

describe('buildEntityTree audienceSnapshots', () => {
  it('reads audience changes from audienceSnapshots, not from snapshots', () => {
    const insights = [
      insight({ level: 'adset', entityId: 's1', date: '2024-03-08', spend: 10 }),
      insight({ level: 'ad', entityId: 'a1', date: '2024-03-08', spend: 10, leads: 1 }),
    ]
    const snapshots = [
      campaignSnap(),
      snap({ level: 'adset', entityId: 's1', campaignId: 'c1', effectiveStatus: 'ACTIVE', capturedAt: '2024-03-05T00:00:00Z', destinationType: 'ON_AD', optimizationGoal: 'LEAD_GENERATION', audienceKey: 'k1' }),
      snap({ level: 'adset', entityId: 's1', campaignId: 'c1', effectiveStatus: 'ACTIVE', capturedAt: '2024-03-08T00:00:00Z', destinationType: 'ON_AD', optimizationGoal: 'LEAD_GENERATION', audienceKey: 'k1' }),
      snap({ level: 'ad', entityId: 'a1', adsetId: 's1', effectiveStatus: 'ACTIVE' }),
    ]
    const audienceSnapshots = [
      snap({ level: 'adset', entityId: 's1', campaignId: 'c1', effectiveStatus: 'ACTIVE', capturedAt: '2024-03-05T00:00:00Z', destinationType: 'ON_AD', optimizationGoal: 'LEAD_GENERATION', audienceKey: 'k1' }),
      snap({ level: 'adset', entityId: 's1', campaignId: 'c1', effectiveStatus: 'ACTIVE', capturedAt: '2024-03-08T00:00:00Z', destinationType: 'ON_AD', optimizationGoal: 'LEAD_GENERATION', audienceKey: 'k2' }),
    ]
    const tree = buildEntityTree(insights, snapshots, { ...OPTS, audienceSnapshots })
    expect(tree.campaigns[0].adsets[0].audienceChangedOn).toBe('2024-03-08')
  })
})
