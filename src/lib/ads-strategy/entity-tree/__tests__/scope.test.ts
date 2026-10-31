import { describe, it, expect } from 'vitest'
import { scopeToClientPage } from '../scope'
import type { InsightRow, SnapshotRow } from '../build'

const snap = (level: SnapshotRow['level'], id: string, extra: Partial<SnapshotRow> = {}): SnapshotRow => ({
  level, entityId: id, entityName: id, campaignId: null, adsetId: null, effectiveStatus: 'ACTIVE',
  dailyBudgetMinor: null, currency: null, capturedAt: '2026-10-28T12:30:00Z', creativePageId: null, ...extra,
})
const ins = (level: InsightRow['level'], id: string, parentId: string | null): InsightRow => ({
  level, entityId: id, entityName: id, parentId, date: '2026-10-28', spend: 10, impressions: 100, clicks: 2, leads: 1, messagingConversations: 0,
})

const MINE = '1616575215312482'
const OTHER = '748077268383005'

describe('scopeToClientPage', () => {
  it('keeps own ad sets and drops another page\'s in the same shared account', () => {
    const snapshots = [
      snap('campaign', 'c1'), snap('adset', 's-mine', { campaignId: 'c1' }), snap('ad', 'a-mine', { adsetId: 's-mine', creativePageId: MINE }),
      snap('campaign', 'c2'), snap('adset', 's-other', { campaignId: 'c2' }), snap('ad', 'a-other', { adsetId: 's-other', creativePageId: OTHER }),
    ]
    const insights = [ins('adset', 's-mine', 'c1'), ins('ad', 'a-mine', 's-mine'), ins('adset', 's-other', 'c2'), ins('ad', 'a-other', 's-other')]
    const out = scopeToClientPage(insights, snapshots, MINE)
    expect(out.snapshots.map(r => r.entityId).sort()).toEqual(['a-mine', 'c1', 's-mine'])
    expect(out.insights.map(r => r.entityId).sort()).toEqual(['a-mine', 's-mine'])
    expect(out.droppedAdsets).toBe(1)
  })

  it('drops an ad set that mixes own and other pages', () => {
    const snapshots = [snap('adset', 's1', { campaignId: 'c1' }), snap('ad', 'a1', { adsetId: 's1', creativePageId: MINE }), snap('ad', 'a2', { adsetId: 's1', creativePageId: OTHER })]
    expect(scopeToClientPage([], snapshots, MINE).snapshots).toHaveLength(0)
  })

  it('drops an ad set with no ad to prove ownership (fail-closed)', () => {
    const out = scopeToClientPage([ins('adset', 's1', 'c1')], [snap('adset', 's1', { campaignId: 'c1' })], MINE)
    expect(out.insights).toHaveLength(0)
    expect(out.droppedAdsets).toBe(1)
  })

  it('returns nothing when the client has no registered page', () => {
    const snapshots = [snap('adset', 's1'), snap('ad', 'a1', { adsetId: 's1', creativePageId: MINE })]
    const out = scopeToClientPage([], snapshots, null)
    expect(out.snapshots).toHaveLength(0)
  })

  it('uses the latest snapshot of an ad (page changed later)', () => {
    const snapshots = [
      snap('adset', 's1', { campaignId: 'c1' }),
      snap('ad', 'a1', { adsetId: 's1', creativePageId: MINE, capturedAt: '2026-10-27T12:30:00Z' }),
      snap('ad', 'a1', { adsetId: 's1', creativePageId: OTHER, capturedAt: '2026-10-28T12:30:00Z' }),
    ]
    expect(scopeToClientPage([], snapshots, MINE).snapshots).toHaveLength(0)
  })
})
