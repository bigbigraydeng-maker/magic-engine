import { describe, expect, it } from 'vitest'
import { loadRecentSamples, outcomeColumnsReady, upsertSamples } from '../db'
import type { SpendDraft } from '../sample'

const draft: SpendDraft = {
  clientId: 'c1',
  adAccountId: 'act_synth',
  accountDay: '2026-11-13',
  sampledAt: '2026-11-13T00:00:00.000Z',
  localMinute: 600,
  entityLevel: 'adset',
  entityId: 'as_synth',
  spendMinor: 100,
  impressions: 10,
  linkClicks: 4,
  results: 2,
  currency: 'NZD',
  timezone: 'Pacific/Auckland',
}

const missing = { message: "Could not find the 'link_clicks' column of 'ad_intraday_spend_samples' in the schema cache" }

function client(select: (cols: string) => { error: { message: string } | null; data?: unknown[] | null }) {
  const upserts: unknown[][] = []
  const sb = {
    from() {
      return {
        select(cols: string) {
          const chain = {
            eq() { return chain },
            gte() { return chain },
            limit: async () => select(cols),
          }
          return chain
        },
        upsert: async (rows: unknown[]) => {
          upserts.push(rows)
          return { error: null }
        },
      }
    },
  }
  return { sb: sb as never, upserts }
}

describe('intraday sample outcome columns', () => {
  it('keeps writing spend when the new columns are not applied yet', async () => {
    const fake = client((cols) => (
      cols === 'link_clicks'
        ? { error: missing, data: null }
        : { error: null, data: [] }
    ))
    expect(await outcomeColumnsReady(fake.sb)).toBe(false)
    await upsertSamples(fake.sb, [draft])
    expect(fake.upserts[0][0]).not.toHaveProperty('link_clicks')
    expect(fake.upserts[0][0]).not.toHaveProperty('results')
    expect(fake.upserts[0][0]).toMatchObject({ spend_minor: 100, impressions: 10 })
  })

  it('reads a null outcome as null and writes the counts once the columns exist', async () => {
    const row = {
      client_id: 'c1',
      ad_account_id: 'act_synth',
      account_day: '2026-11-13',
      local_minute: 600,
      entity_level: 'adset',
      entity_id: 'as_synth',
      spend_minor: 100,
      impressions: 10,
      link_clicks: null,
      results: null,
      currency: 'NZD',
      timezone: 'Pacific/Auckland',
      sampled_at: '2026-11-13T00:00:00.000Z',
    }
    const fake = client((cols) => (
      cols === 'link_clicks'
        ? { error: null, data: [] }
        : { error: null, data: [row] }
    ))
    expect(await outcomeColumnsReady(fake.sb)).toBe(true)
    await upsertSamples(fake.sb, [draft])
    expect(fake.upserts[0][0]).toMatchObject({ link_clicks: 4, results: 2 })
    const loaded = await loadRecentSamples(fake.sb, 'c1', '2026-11-01')
    expect(loaded?.[0]).toMatchObject({ spendMinor: 100, linkClicks: null, results: null })
  })
})
