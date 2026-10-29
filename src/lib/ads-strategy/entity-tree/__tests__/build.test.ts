import { describe, it, expect } from 'vitest'
import {
  buildEntityTree,
  type InsightRow,
  type SnapshotRow,
  type TreeOptions,
} from '../build'

const OPTS: TreeOptions = { endDate: '2024-03-10', days: 7 }
// window: since 2024-03-04, until 2024-03-10

function insight(over: Partial<InsightRow> & Pick<InsightRow, 'level' | 'entityId' | 'date'>): InsightRow {
  return {
    entityName: null,
    parentId: null,
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    messagingConversations: 0,
    ...over,
  }
}

function snap(over: Partial<SnapshotRow> & Pick<SnapshotRow, 'level' | 'entityId'>): SnapshotRow {
  return {
    entityName: null,
    campaignId: null,
    adsetId: null,
    effectiveStatus: null,
    dailyBudgetMinor: null,
    currency: null,
    capturedAt: '2024-03-10T00:00:00Z',
    ...over,
  }
}

describe('buildEntityTree', () => {
  it('builds a three-level tree with per-level sums', () => {
    const insights: InsightRow[] = [
      insight({ level: 'campaign', entityId: 'c1', entityName: 'Camp', date: '2024-03-05', spend: 100, impressions: 10000, clicks: 300, leads: 10 }),
      insight({ level: 'adset', entityId: 'sA', entityName: 'Set A', parentId: 'c1', date: '2024-03-05', spend: 40, impressions: 4000, clicks: 120, leads: 4 }),
      insight({ level: 'adset', entityId: 'sB', entityName: 'Set B', parentId: 'c1', date: '2024-03-05', spend: 30, impressions: 3000, clicks: 90, leads: 3 }),
      insight({ level: 'adset', entityId: 'sC', entityName: 'Set C', parentId: 'c1', date: '2024-03-05', spend: 30, impressions: 3000, clicks: 90, leads: 3 }),
      insight({ level: 'ad', entityId: 'aA', entityName: 'Ad A', parentId: 'sA', date: '2024-03-05', spend: 40, impressions: 4000, clicks: 120, leads: 4 }),
      insight({ level: 'ad', entityId: 'aB', entityName: 'Ad B', parentId: 'sB', date: '2024-03-05', spend: 30, impressions: 3000, clicks: 90, leads: 3 }),
      insight({ level: 'ad', entityId: 'aC', entityName: 'Ad C', parentId: 'sC', date: '2024-03-05', spend: 30, impressions: 3000, clicks: 90, leads: 3 }),
    ]
    const snapshots: SnapshotRow[] = [
      snap({ level: 'campaign', entityId: 'c1', entityName: 'Camp', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'adset', entityId: 'sA', entityName: 'Set A', campaignId: 'c1', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'adset', entityId: 'sB', entityName: 'Set B', campaignId: 'c1', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'adset', entityId: 'sC', entityName: 'Set C', campaignId: 'c1', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'ad', entityId: 'aA', entityName: 'Ad A', adsetId: 'sA', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'ad', entityId: 'aB', entityName: 'Ad B', adsetId: 'sB', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'ad', entityId: 'aC', entityName: 'Ad C', adsetId: 'sC', effectiveStatus: 'ACTIVE' }),
    ]
    const tree = buildEntityTree(insights, snapshots, OPTS)
    expect(tree.window).toEqual({ since: '2024-03-04', until: '2024-03-10', days: 7 })
    expect(tree.campaigns).toHaveLength(1)
    const c = tree.campaigns[0]
    expect(c.id).toBe('c1')
    expect(c.adsets).toHaveLength(3)
    expect(c.adsets.map(a => a.id).sort()).toEqual(['sA', 'sB', 'sC'])
    const sA = c.adsets.find(a => a.id === 'sA')!
    expect(sA.ads).toHaveLength(1)
    expect(sA.ads[0].id).toBe('aA')
    expect(c.metrics.spend).toBe(100)
    expect(c.metrics.costPerLead).toBeCloseTo(10)
    expect(c.metrics.ctr).toBeCloseTo(0.03)
    expect(sA.metrics.spend).toBe(40)
    expect(sA.metrics.costPerLead).toBeCloseTo(10)
    expect(sA.metrics.ctr).toBeCloseTo(0.03)
    expect(sA.ads[0].metrics.spend).toBe(40)
  })

  it('uses own-level metrics only (not summed from children)', () => {
    const insights: InsightRow[] = [
      insight({ level: 'campaign', entityId: 'c1', date: '2024-03-05', spend: 999, impressions: 100, clicks: 1, leads: 1 }),
      insight({ level: 'adset', entityId: 's1', parentId: 'c1', date: '2024-03-05', spend: 50, impressions: 500, clicks: 5, leads: 5 }),
      insight({ level: 'ad', entityId: 'a1', parentId: 's1', date: '2024-03-05', spend: 10, impressions: 100, clicks: 1, leads: 1 }),
    ]
    const snapshots: SnapshotRow[] = [
      snap({ level: 'campaign', entityId: 'c1', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'adset', entityId: 's1', campaignId: 'c1', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'ad', entityId: 'a1', adsetId: 's1', effectiveStatus: 'ACTIVE' }),
    ]
    const tree = buildEntityTree(insights, snapshots, OPTS)
    const c = tree.campaigns[0]
    expect(c.metrics.spend).toBe(999)
    expect(c.adsets[0].metrics.spend).toBe(50)
    expect(c.adsets[0].ads[0].metrics.spend).toBe(10)
  })

  it('maps effective_status to delivery state', () => {
    const snapshots: SnapshotRow[] = [
      snap({ level: 'campaign', entityId: 'cActive', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'campaign', entityId: 'cPaused', effectiveStatus: 'PAUSED' }),
      snap({ level: 'campaign', entityId: 'cCampPaused', effectiveStatus: 'CAMPAIGN_PAUSED' }),
      snap({ level: 'campaign', entityId: 'cAdsetPaused', effectiveStatus: 'ADSET_PAUSED' }),
      snap({ level: 'campaign', entityId: 'cInProcess', effectiveStatus: 'IN_PROCESS' }),
      snap({ level: 'campaign', entityId: 'cIssues', effectiveStatus: 'WITH_ISSUES' }),
      snap({ level: 'campaign', entityId: 'cNull', effectiveStatus: null }),
    ]
    const tree = buildEntityTree([], snapshots, OPTS)
    const byId = new Map(tree.campaigns.map(c => [c.id, c.state]))
    expect(byId.get('cActive')).toBe('running')
    expect(byId.get('cPaused')).toBe('stopped')
    expect(byId.get('cCampPaused')).toBe('stopped')
    expect(byId.get('cAdsetPaused')).toBe('stopped')
    expect(byId.get('cInProcess')).toBe('unknown')
    expect(byId.get('cIssues')).toBe('unknown')
    expect(byId.get('cNull')).toBe('unknown')
  })

  it('counts running adsets and running ads', () => {
    const snapshots: SnapshotRow[] = [
      snap({ level: 'campaign', entityId: 'c1', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'adset', entityId: 's1', campaignId: 'c1', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'adset', entityId: 's2', campaignId: 'c1', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'adset', entityId: 's3', campaignId: 'c1', effectiveStatus: 'PAUSED' }),
      snap({ level: 'ad', entityId: 'a1', adsetId: 's1', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'ad', entityId: 'a2', adsetId: 's2', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'ad', entityId: 'a3', adsetId: 's3', effectiveStatus: 'PAUSED' }),
    ]
    const tree = buildEntityTree([], snapshots, OPTS)
    const c = tree.campaigns[0]
    expect(c.runningAdsets).toBe(2)
    expect(c.runningAds).toBe(2)
  })

  it('respects the window boundaries', () => {
    const insights: InsightRow[] = [
      insight({ level: 'campaign', entityId: 'c1', date: '2024-03-03', spend: 1 }),
      insight({ level: 'campaign', entityId: 'c1', date: '2024-03-04', spend: 2 }),
      insight({ level: 'campaign', entityId: 'c1', date: '2024-03-10', spend: 4 }),
      insight({ level: 'campaign', entityId: 'c1', date: '2024-03-11', spend: 8 }),
    ]
    const snapshots: SnapshotRow[] = [snap({ level: 'campaign', entityId: 'c1', effectiveStatus: 'ACTIVE' })]
    const tree = buildEntityTree(insights, snapshots, OPTS)
    expect(tree.campaigns[0].metrics.spend).toBe(6)
    expect(tree.campaigns[0].metrics.activeDays).toBe(2)
  })

  it('uses the latest snapshot per entity', () => {
    const snapshots: SnapshotRow[] = [
      snap({ level: 'campaign', entityId: 'c1', entityName: 'Old', effectiveStatus: 'PAUSED', capturedAt: '2024-03-01T00:00:00Z' }),
      snap({ level: 'campaign', entityId: 'c1', entityName: 'New', effectiveStatus: 'ACTIVE', capturedAt: '2024-03-09T00:00:00Z' }),
    ]
    const tree = buildEntityTree([], snapshots, OPTS)
    expect(tree.snapshotAt).toBe('2024-03-09T00:00:00Z')
    expect(tree.campaigns[0].name).toBe('New')
    expect(tree.campaigns[0].state).toBe('running')
  })

  it('includes snapshot-only entities with zero metrics', () => {
    const snapshots: SnapshotRow[] = [
      snap({ level: 'campaign', entityId: 'c1', entityName: 'Camp', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'adset', entityId: 's1', entityName: 'Set', campaignId: 'c1', effectiveStatus: 'ACTIVE', dailyBudgetMinor: 5000, currency: 'USD' }),
      snap({ level: 'ad', entityId: 'a1', entityName: 'Ad', adsetId: 's1', effectiveStatus: 'ACTIVE' }),
    ]
    const tree = buildEntityTree([], snapshots, OPTS)
    const c = tree.campaigns[0]
    expect(c.metrics.spend).toBe(0)
    expect(c.metrics.costPerLead).toBeNull()
    expect(c.metrics.ctr).toBeNull()
    expect(c.metrics.activeDays).toBe(0)
    const s = c.adsets[0]
    expect(s.dailyBudget).toBe(50)
    expect(s.currency).toBe('USD')
    expect(s.ads[0].metrics.spend).toBe(0)
  })

  it('creates a placeholder campaign for an orphan adset', () => {
    const snapshots: SnapshotRow[] = [
      snap({ level: 'adset', entityId: 's1', entityName: 'Set', campaignId: 'cMissing', effectiveStatus: 'ACTIVE' }),
    ]
    const tree = buildEntityTree([], snapshots, OPTS)
    expect(tree.campaigns).toHaveLength(1)
    const c = tree.campaigns[0]
    expect(c.id).toBe('cMissing')
    expect(c.name).toBe('cMissing')
    expect(c.state).toBe('unknown')
    expect(c.adsets).toHaveLength(1)
    expect(c.adsets[0].id).toBe('s1')
  })

  it('sorts running before stopped, then by spend desc', () => {
    const insights: InsightRow[] = [
      insight({ level: 'campaign', entityId: 'cStopped', date: '2024-03-05', spend: 1000 }),
      insight({ level: 'campaign', entityId: 'cRunLow', date: '2024-03-05', spend: 10 }),
      insight({ level: 'campaign', entityId: 'cRunHigh', date: '2024-03-05', spend: 500 }),
    ]
    const snapshots: SnapshotRow[] = [
      snap({ level: 'campaign', entityId: 'cStopped', effectiveStatus: 'PAUSED' }),
      snap({ level: 'campaign', entityId: 'cRunLow', effectiveStatus: 'ACTIVE' }),
      snap({ level: 'campaign', entityId: 'cRunHigh', effectiveStatus: 'ACTIVE' }),
    ]
    const tree = buildEntityTree(insights, snapshots, OPTS)
    expect(tree.campaigns.map(c => c.id)).toEqual(['cRunHigh', 'cRunLow', 'cStopped'])
  })

  it('returns empty campaigns for empty input', () => {
    const tree = buildEntityTree([], [], OPTS)
    expect(tree.campaigns).toEqual([])
    expect(tree.snapshotAt).toBeNull()
    expect(tree.window).toEqual({ since: '2024-03-04', until: '2024-03-10', days: 7 })
  })
})
