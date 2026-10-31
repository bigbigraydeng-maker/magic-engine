import { describe, it, expect } from 'vitest'
import { buildEntityTree, type InsightRow, type SnapshotRow } from '../build'
import { scopeToClientPage } from '../scope'
import { dedupeInsights } from '../load'

const OPTS = { endDate: '2024-03-10', days: 7 }

const ins = (level: InsightRow['level'], entityId: string, parentId: string | null, spend: number, leads = 0): InsightRow => ({
  level, entityId, entityName: entityId, parentId, date: '2024-03-10', spend, impressions: 1000, clicks: 20, leads, messagingConversations: 0,
})
const snap = (level: SnapshotRow['level'], entityId: string, extra: Partial<SnapshotRow> = {}): SnapshotRow => ({
  level, entityId, entityName: entityId, campaignId: null, adsetId: null, effectiveStatus: 'ACTIVE',
  dailyBudgetMinor: null, currency: null, capturedAt: '2024-03-10T00:00:00Z', creativePageId: null, ...extra,
})

describe('P1/P2 fixes from the independent review of PR 3395', () => {
  it('an ad\'s insight parent is its CAMPAIGN: a deleted ad is not hung under a non-existent ad set, it is counted as unplaced', () => {
    const insights = [
      ins('campaign', 'c1', null, 100), ins('adset', 's1', 'c1', 100),
      ins('ad', 'a-live', 'c1', 40, 2), ins('ad', 'a-deleted', 'c1', 60, 1),
    ]
    const snapshots = [snap('campaign', 'c1'), snap('adset', 's1', { campaignId: 'c1' }), snap('ad', 'a-live', { adsetId: 's1', campaignId: 'c1' })]
    const tree = buildEntityTree(insights, snapshots, OPTS)
    const c = tree.campaigns[0]
    expect(c.adsets[0].ads.map(a => a.id)).toEqual(['a-live'])
    expect(c.unplacedAds).toEqual({ count: 1, spend: 60, leads: 1 })
  })

  it('campaigns listed in sharedCampaignIds show no campaign totals', () => {
    const insights = [ins('campaign', 'c1', null, 300, 5), ins('adset', 's1', 'c1', 100, 2)]
    const snapshots = [snap('campaign', 'c1'), snap('adset', 's1', { campaignId: 'c1' })]
    const tree = buildEntityTree(insights, snapshots, { ...OPTS, sharedCampaignIds: new Set(['c1']) })
    expect(tree.campaigns[0].metricsShared).toBe(true)
    expect(tree.campaigns[0].metrics.spend).toBe(0)
    expect(tree.campaigns[0].adsets[0].metrics.spend).toBe(100)
  })

  it('scope: a campaign that also holds another page\'s ad set that spent is flagged shared', () => {
    const MINE = '1616575215312482'
    const OTHER = '748077268383005'
    const snapshots = [
      snap('campaign', 'c1'),
      snap('adset', 's-mine', { campaignId: 'c1' }), snap('ad', 'a-mine', { adsetId: 's-mine', creativePageId: MINE }),
      snap('adset', 's-other', { campaignId: 'c1' }), snap('ad', 'a-other', { adsetId: 's-other', creativePageId: OTHER }),
    ]
    const insights = [ins('campaign', 'c1', null, 300), ins('adset', 's-mine', 'c1', 100), ins('adset', 's-other', 'c1', 200)]
    const out = scopeToClientPage(insights, snapshots, MINE)
    expect([...out.sharedCampaignIds]).toEqual(['c1'])
    expect(out.droppedAdsets).toBe(1)
  })

  it('scope: a new ad set with no spend and no ad yet does not taint its campaign', () => {
    const MINE = '1616575215312482'
    const snapshots = [snap('campaign', 'c1'), snap('adset', 's-mine', { campaignId: 'c1' }), snap('ad', 'a-mine', { adsetId: 's-mine', creativePageId: MINE }), snap('adset', 's-new', { campaignId: 'c1' })]
    const insights = [ins('campaign', 'c1', null, 100), ins('adset', 's-mine', 'c1', 100)]
    const out = scopeToClientPage(insights, snapshots, MINE)
    expect(out.sharedCampaignIds.size).toBe(0)
  })

  it('scope: reports that no page is registered instead of silently returning nothing', () => {
    expect(scopeToClientPage([], [], null).noPageRegistered).toBe(true)
    expect(scopeToClientPage([], [], '123').noPageRegistered).toBe(false)
  })

  it('scope: a deleted ad of a kept campaign keeps its insight rows (so it can be shown as unplaced)', () => {
    const MINE = '1616575215312482'
    const snapshots = [snap('campaign', 'c1'), snap('adset', 's1', { campaignId: 'c1' }), snap('ad', 'a1', { adsetId: 's1', creativePageId: MINE })]
    const insights = [ins('adset', 's1', 'c1', 100), ins('ad', 'a1', 'c1', 40), ins('ad', 'a-deleted', 'c1', 60)]
    const out = scopeToClientPage(insights, snapshots, MINE)
    expect(out.insights.map(r => r.entityId).sort()).toEqual(['a-deleted', 'a1', 's1'])
  })

  it('load: a row read twice by offset paging is counted once', () => {
    const row = ins('adset', 's1', 'c1', 100, 2)
    expect(dedupeInsights([row, { ...row }, ins('adset', 's2', 'c1', 5)])).toHaveLength(2)
  })
})
