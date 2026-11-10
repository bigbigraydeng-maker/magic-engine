import { describe, expect, it } from 'vitest'
import { buildEntityTree, type InsightRow, type SnapshotRow, type TreeOptions } from '../build'
import { toSnapshotRow } from '../load'

const OPTS: TreeOptions = { endDate: '2024-03-10', days: 7 }

function insight(over: Partial<InsightRow> & Pick<InsightRow, 'level' | 'entityId' | 'date'>): InsightRow {
  return { entityName: null, parentId: null, spend: 0, impressions: 0, clicks: 0, leads: 0, messagingConversations: 0, ...over }
}

function snap(over: Partial<SnapshotRow> & Pick<SnapshotRow, 'level' | 'entityId'>): SnapshotRow {
  return { entityName: null, campaignId: null, adsetId: null, effectiveStatus: null, dailyBudgetMinor: null, currency: null, capturedAt: '2024-03-10T00:00:00Z', ...over }
}

function campaignSnap(id: string): SnapshotRow {
  return snap({ level: 'campaign', entityId: id, entityName: id })
}

function adsetSnap(id: string, campaignId: string, over: Partial<SnapshotRow> = {}): SnapshotRow {
  return snap({ level: 'adset', entityId: id, entityName: id, campaignId, ...over })
}

function adSnap(id: string, adsetId: string, campaignId: string): SnapshotRow {
  return snap({ level: 'ad', entityId: id, entityName: id, adsetId, campaignId })
}

function adRow(id: string, over: Partial<InsightRow> = {}): InsightRow {
  return insight({ level: 'ad', entityId: id, date: '2024-03-05', spend: 100, ...over })
}

describe('buildEntityTree creative draft', () => {
  it('judges a lead-form ad set: enough vs too_few_clicks', () => {
    const insights: InsightRow[] = [
      adRow('ad1', { leads: 5, linkClicks: 200 }),
      adRow('ad2', { leads: 2, linkClicks: 40 }),
    ]
    const snapshots: SnapshotRow[] = [
      campaignSnap('c1'),
      adsetSnap('s1', 'c1', { destinationType: 'ON_AD', optimizationGoal: 'LEAD_GENERATION' }),
      adSnap('ad1', 's1', 'c1'),
      adSnap('ad2', 's1', 'c1'),
    ]
    const tree = buildEntityTree(insights, snapshots, { ...OPTS, minLinkClicks: 150 })
    const adset = tree.campaigns[0].adsets[0]
    expect(adset.resultType).toBe('lead')
    const byId = new Map(adset.ads.map((a) => [a.id, a]))
    expect(byId.get('ad1')?.creative.comparability).toBe('enough')
    expect(byId.get('ad1')?.creative.results).toBe(5)
    expect(byId.get('ad2')?.creative.comparability).toBe('too_few_clicks')
  })

  it('judges a WhatsApp ad set on messaging conversations', () => {
    const insights: InsightRow[] = [
      adRow('ad1', { messagingConversations: 7, linkClicks: 200 }),
      adRow('ad2', { messagingConversations: 3, linkClicks: 200 }),
    ]
    const snapshots: SnapshotRow[] = [
      campaignSnap('c1'),
      adsetSnap('s1', 'c1', { destinationType: 'WHATSAPP', optimizationGoal: 'CONVERSATIONS' }),
      adSnap('ad1', 's1', 'c1'),
      adSnap('ad2', 's1', 'c1'),
    ]
    const tree = buildEntityTree(insights, snapshots, { ...OPTS, minLinkClicks: 150 })
    const adset = tree.campaigns[0].adsets[0]
    expect(adset.resultType).toBe('messaging_started')
    const byId = new Map(adset.ads.map((a) => [a.id, a]))
    expect(byId.get('ad1')?.creative.results).toBe(7)
    expect(byId.get('ad2')?.creative.results).toBe(3)
  })

  it('marks every ad no_result_type when the ad set is a video-views set (goal known, no lead / chat result)', () => {
    const insights: InsightRow[] = [
      adRow('ad1', { linkClicks: 200 }),
      adRow('ad2', { linkClicks: 200 }),
    ]
    const snapshots: SnapshotRow[] = [
      campaignSnap('c1'),
      adsetSnap('s1', 'c1', { optimizationGoal: 'THRUPLAY' }),
      adSnap('ad1', 's1', 'c1'),
      adSnap('ad2', 's1', 'c1'),
    ]
    const tree = buildEntityTree(insights, snapshots, { ...OPTS, minLinkClicks: 150 })
    const adset = tree.campaigns[0].adsets[0]
    expect(adset.targetKnown).toBe(true)
    expect(adset.resultType).toBeNull()
    for (const ad of adset.ads) expect(ad.creative.comparability).toBe('no_result_type')
  })

  it('marks no_threshold when minLinkClicks is not set', () => {
    const insights: InsightRow[] = [
      adRow('ad1', { leads: 1, linkClicks: 200 }),
      adRow('ad2', { leads: 1, linkClicks: 200 }),
    ]
    const snapshots: SnapshotRow[] = [
      campaignSnap('c1'),
      adsetSnap('s1', 'c1', { destinationType: 'ON_AD', optimizationGoal: 'LEAD_GENERATION' }),
      adSnap('ad1', 's1', 'c1'),
      adSnap('ad2', 's1', 'c1'),
    ]
    const tree = buildEntityTree(insights, snapshots, OPTS)
    const adset = tree.campaigns[0].adsets[0]
    for (const ad of adset.ads) expect(ad.creative.comparability).toBe('no_threshold')
  })

  it('marks only_one when just one ad has spend', () => {
    const insights: InsightRow[] = [
      adRow('ad1', { leads: 1, linkClicks: 200 }),
      adRow('ad2', { leads: 0, linkClicks: 200, spend: 0 }),
    ]
    const snapshots: SnapshotRow[] = [
      campaignSnap('c1'),
      adsetSnap('s1', 'c1', { destinationType: 'ON_AD', optimizationGoal: 'LEAD_GENERATION' }),
      adSnap('ad1', 's1', 'c1'),
      adSnap('ad2', 's1', 'c1'),
    ]
    const tree = buildEntityTree(insights, snapshots, { ...OPTS, minLinkClicks: 150 })
    const adset = tree.campaigns[0].adsets[0]
    for (const ad of adset.ads) expect(ad.creative.comparability).toBe('only_one')
  })

  it('marks clicks_not_stored when ad rows have no linkClicks field', () => {
    const insights: InsightRow[] = [
      adRow('ad1', { leads: 1 }),
      adRow('ad2', { leads: 1 }),
    ]
    const snapshots: SnapshotRow[] = [
      campaignSnap('c1'),
      adsetSnap('s1', 'c1', { destinationType: 'ON_AD', optimizationGoal: 'LEAD_GENERATION' }),
      adSnap('ad1', 's1', 'c1'),
      adSnap('ad2', 's1', 'c1'),
    ]
    const tree = buildEntityTree(insights, snapshots, { ...OPTS, minLinkClicks: 150 })
    const adset = tree.campaigns[0].adsets[0]
    for (const ad of adset.ads) {
      expect(ad.metrics.linkClicksStored).toBe(false)
      expect(ad.creative.comparability).toBe('clicks_not_stored')
    }
  })

  it('reports the first day the audience changed inside the window', () => {
    const insights: InsightRow[] = [adRow('ad1', { leads: 1, linkClicks: 200 })]
    const snapshots: SnapshotRow[] = [
      campaignSnap('c1'),
      adsetSnap('s1', 'c1', { capturedAt: '2024-03-03T00:00:00Z', audienceKey: 'k1' }),
      adsetSnap('s1', 'c1', { capturedAt: '2024-03-06T00:00:00Z', audienceKey: 'k2' }),
      adsetSnap('s1', 'c1', { capturedAt: '2024-03-10T00:00:00Z', audienceKey: 'k2' }),
      adSnap('ad1', 's1', 'c1'),
    ]
    const tree = buildEntityTree(insights, snapshots, { ...OPTS, minLinkClicks: 150 })
    expect(tree.campaigns[0].adsets[0].audienceChangedOn).toBe('2024-03-06')
  })

  it('reports null when the audience key never changes', () => {
    const insights: InsightRow[] = [adRow('ad1', { leads: 1, linkClicks: 200 })]
    const snapshots: SnapshotRow[] = [
      campaignSnap('c1'),
      adsetSnap('s1', 'c1', { capturedAt: '2024-03-03T00:00:00Z', audienceKey: 'k1' }),
      adsetSnap('s1', 'c1', { capturedAt: '2024-03-06T00:00:00Z', audienceKey: 'k1' }),
      adsetSnap('s1', 'c1', { capturedAt: '2024-03-10T00:00:00Z', audienceKey: 'k1' }),
      adSnap('ad1', 's1', 'c1'),
    ]
    const tree = buildEntityTree(insights, snapshots, { ...OPTS, minLinkClicks: 150 })
    expect(tree.campaigns[0].adsets[0].audienceChangedOn).toBeNull()
  })
})

describe('toSnapshotRow audienceKey', () => {
  it('is order-independent for adset rows', () => {
    const a = toSnapshotRow({
      level: 'adset',
      entity_id: 's1',
      entity_name: 's1',
      campaign_id: 'c1',
      adset_id: null,
      effective_status: null,
      daily_budget_minor: null,
      currency: null,
      captured_at: '2024-03-10T00:00:00Z',
      creative_page_id: null,
      included_audience_ids: ['b', 'a'],
    })
    const b = toSnapshotRow({
      level: 'adset',
      entity_id: 's1',
      entity_name: 's1',
      campaign_id: 'c1',
      adset_id: null,
      effective_status: null,
      daily_budget_minor: null,
      currency: null,
      captured_at: '2024-03-10T00:00:00Z',
      creative_page_id: null,
      included_audience_ids: ['a', 'b'],
    })
    expect(a?.audienceKey).not.toBeNull()
    expect(a?.audienceKey).toBe(b?.audienceKey)
  })

  it('is null for ad rows', () => {
    const row = toSnapshotRow({
      level: 'ad',
      entity_id: 'ad1',
      entity_name: 'ad1',
      campaign_id: 'c1',
      adset_id: 's1',
      effective_status: null,
      daily_budget_minor: null,
      currency: null,
      captured_at: '2024-03-10T00:00:00Z',
      creative_page_id: null,
      included_audience_ids: ['a', 'b'],
    })
    expect(row?.audienceKey).toBeNull()
  })
})
