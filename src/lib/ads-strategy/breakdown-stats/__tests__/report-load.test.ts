import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { loadStats } from '../report-load'

/** Fake that serves `total` rows through .range(), like PostgREST's 1000-row pages. */
function fakeSupabase(total: number): { client: SupabaseClient; calls: number[] } {
  const calls: number[] = []
  const rows = Array.from({ length: total }, (_, i) => ({
    ad_account_id: 'act_1',
    entity_id: `ad_${i % 3}`,
    campaign_id: 'c_lead',
    stat_date: '2026-10-26',
    breakdown_key: i % 2 === 0 ? 'placement_device' : 'hour_account_tz',
    breakdown_value: {},
    spend: '1',
    impressions: 10,
    clicks: 1,
    meta_leads: null,
  }))
  const builder = {
    select: () => builder,
    in: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    range: async (from: number, to: number) => {
      calls.push(from)
      return { data: rows.slice(from, to + 1), error: null }
    },
  }
  const client = { from: () => builder } as unknown as SupabaseClient
  return { client, calls }
}

describe('loadStats', () => {
  it.each([0, 999, 1000, 6000, 6001, 13500])('returns every one of %i rows exactly once', async (total) => {
    const { client } = fakeSupabase(total)
    const { stats } = await loadStats(['act_1'], '2026-10-01', '2026-10-31', {
      supabase: client,
      now: () => new Date('2026-11-01T00:00:00Z'),
    } as Parameters<typeof loadStats>[3])
    expect(stats).toHaveLength(total)
    expect(stats.reduce((sum, s) => sum + s.spend, 0)).toBe(total)
  })

  it('maps ads to accounts from placement rows only', async () => {
    const { client } = fakeSupabase(6)
    const { adAccountMap } = await loadStats(['act_1'], '2026-10-01', '2026-10-31', {
      supabase: client,
      now: () => new Date('2026-11-01T00:00:00Z'),
    } as Parameters<typeof loadStats>[3])
    expect([...adAccountMap.keys()].sort()).toEqual(['ad_0', 'ad_1', 'ad_2'])
  })
})
