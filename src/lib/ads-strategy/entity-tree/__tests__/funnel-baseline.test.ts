import { describe, expect, it } from 'vitest'
import { buildEntityTree, type InsightRow, type SnapshotRow } from '../build'
import { pickWinnerBaseline, ratesFromMetrics, type FunnelMetrics } from '../funnel-baseline'

const day = '2024-03-10'

function adMetrics(over: Partial<FunnelMetrics>): FunnelMetrics {
  return { spend: 100, impressions: 1000, linkClicks: 40, leads: 20, video3sViews: 300, costPerLead: 5, ...over }
}

describe('account winner baseline', () => {
  it('needs at least 20 leads; otherwise there is no winner', () => {
    expect(pickWinnerBaseline([adMetrics({ leads: 19, costPerLead: 1 })])).toBeNull()
    const winner = pickWinnerBaseline([
      adMetrics({ leads: 20, spend: 200, costPerLead: 10, linkClicks: 50 }),
      adMetrics({ leads: 30, spend: 90, costPerLead: 3, linkClicks: 20, video3sViews: 100 }),
    ])
    expect(winner).toEqual(ratesFromMetrics(adMetrics({
      leads: 30, spend: 90, costPerLead: 3, linkClicks: 20, video3sViews: 100,
    })))
    expect(winner?.linkCtr).toBe(0.02)
    expect(winner?.completion).toBe(1.5)
  })

  it('does not turn a missing link-click count into 0%', () => {
    const rates = ratesFromMetrics({ ...adMetrics({ leads: 20, costPerLead: 5, linkClicks: 0 }), ctr: null })
    expect(rates.linkCtr).toBeNull()
    expect(rates.completion).toBeNull()
    const winner = pickWinnerBaseline([{ ...adMetrics({ leads: 20, costPerLead: 5, linkClicks: 0 }), ctr: null }])
    expect(winner?.linkCtr).toBeNull()
  })
})

describe('entity tree link CTR', () => {
  it('rates an ad from link clicks, not from all clicks', () => {
    const insight = (over: Partial<InsightRow> & Pick<InsightRow, 'level' | 'entityId'>): InsightRow => ({
      entityName: over.entityId,
      parentId: null,
      date: day,
      spend: 40,
      impressions: 1000,
      clicks: 80,
      leads: 2,
      messagingConversations: 0,
      linkClicks: 10,
      video3sViews: 250,
      ...over,
    })
    const snap = (level: SnapshotRow['level'], entityId: string, extra: Partial<SnapshotRow> = {}): SnapshotRow => ({
      level,
      entityId,
      entityName: entityId,
      campaignId: level === 'campaign' ? null : 'c1',
      adsetId: level === 'ad' ? 's1' : null,
      effectiveStatus: 'ACTIVE',
      dailyBudgetMinor: null,
      currency: null,
      capturedAt: '2024-03-10T00:00:00Z',
      ...extra,
    })
    const tree = buildEntityTree(
      [
        insight({ level: 'campaign', entityId: 'c1' }),
        insight({ level: 'adset', entityId: 's1', parentId: 'c1' }),
        insight({ level: 'ad', entityId: 'a1', parentId: 's1', leads: 19, spend: 95 }),
      ],
      [snap('campaign', 'c1'), snap('adset', 's1', { campaignId: 'c1' }), snap('ad', 'a1')],
      { endDate: day, days: 7 },
    )
    expect(tree.campaigns[0].metrics.ctr).toBe(0.01)
    expect(tree.campaigns[0].adsets[0].ads[0].metrics.ctr).toBe(0.01)
    expect(tree.winnerBaseline).toBeNull()
  })
})
