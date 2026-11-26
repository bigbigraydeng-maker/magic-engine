import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { DRY_CLIENT, DRY_NOW, dryDeps } from '../dry'
import { runIntradaySample, type SampleDeps } from '../run'
import { accountDayKey, bucketMinute, draftsForAccount, localMinuteOfDay, spendToMinor } from '../sample'

const base = {
  clientId: 'c1', adAccountId: 'act_synth', accountDay: '2026-11-09',
  sampledAt: DRY_NOW.toISOString(), localMinute: 843, timezone: 'Pacific/Auckland',
  currency: 'NZD', insightsComplete: true,
}

function deps(over: Partial<SampleDeps>): SampleDeps {
  return {
    listClients: async () => [{ id: 'c1' }],
    listAccounts: async () => [{ adAccountId: 'act_a', hidden: false }],
    sharedBareIds: async () => new Set(),
    accountContext: async () => ({ timezone: 'Pacific/Auckland', currency: 'NZD' }),
    token: async () => 'synthetic-token',
    readAccount: async () => ({ complete: true, rateLimited: false, adsets: [], insights: [] }),
    upsert: async () => {},
    purge: async () => 0,
    loadSamples: async () => [],
    capMinor: async () => null,
    ...over,
  }
}

describe('intraday spend sample', () => {
  it('uses the account timezone and 10-minute buckets', () => {
    expect(accountDayKey('Pacific/Auckland', DRY_NOW)).toBe('2026-11-09')
    expect(localMinuteOfDay('Pacific/Auckland', DRY_NOW)).toBe(840)
    expect(bucketMinute(843)).toBe(840)
    expect(bucketMinute(1439)).toBe(1430)
    expect(localMinuteOfDay('Not/AZone', DRY_NOW)).toBeNull()
    expect(spendToMinor('8.00', 'NZD')).toBe(800)
  })

  it('stores live ad sets and one campaign sum, and skips a bad read', () => {
    const drafts = draftsForAccount({
      ...base,
      adsets: [
        { id: 'as_a', campaignId: 'cmp_synth', status: 'ACTIVE' },
        { id: 'as_b', campaignId: 'cmp_synth', status: 'PAUSED' },
        { id: 'as_c', campaignId: 'cmp_synth', status: 'ACTIVE' },
      ],
      insights: [
        { adsetId: 'as_a', spend: '1.00', impressions: '10' },
        { adsetId: 'as_c', spend: '2.50', impressions: '20' },
      ],
    })
    expect(drafts?.map((row) => [row.entityLevel, row.entityId, row.spendMinor])).toEqual([
      ['adset', 'as_a', 100], ['adset', 'as_c', 250], ['campaign', 'cmp_synth', 350],
    ])
    expect(draftsForAccount({ ...base, adsets: [], insights: [], insightsComplete: false })).toBeNull()
    expect(draftsForAccount({
      ...base,
      adsets: [{ id: 'as_a', campaignId: 'cmp_synth', status: 'ACTIVE' }],
      insights: [{ adsetId: 'as_a', spend: 'nope' }],
    })).toBeNull()
  })

  it('does not call Meta when the timezone is unknown, hidden, or shared', async () => {
    const readAccount = vi.fn(async () => ({ complete: true, rateLimited: false, adsets: [], insights: [] }))
    const receipt = await runIntradaySample(deps({
      listAccounts: async () => [
        { adAccountId: 'act_hidden', hidden: true },
        { adAccountId: 'act_shared', hidden: false },
        { adAccountId: 'act_bare', hidden: false },
      ],
      sharedBareIds: async () => new Set(['shared']),
      accountContext: async () => ({ timezone: null, currency: null }),
      readAccount,
    }), { now: DRY_NOW, sleep: async () => {} })
    expect(readAccount).not.toHaveBeenCalled()
    expect(receipt.skippedHidden).toBe(1)
    expect(receipt.skippedShared).toBe(1)
    expect(receipt.skippedTimezone).toBe(1)
    expect(receipt.rows).toBe(0)
  })

  it('backs off once on a rate limit and does not read the next account', async () => {
    const seen: string[] = []
    const sleeps: number[] = []
    const receipt = await runIntradaySample(deps({
      listClients: async () => [{ id: 'c1' }, { id: 'c2' }],
      readAccount: async () => {
        seen.push('read')
        if (seen.length === 1) return { complete: true, rateLimited: false, adsets: [], insights: [] }
        return { complete: false, rateLimited: true, adsets: [], insights: [] }
      },
    }), { now: DRY_NOW, sleep: async (ms) => { sleeps.push(ms) } })
    expect(seen).toHaveLength(3)
    expect(sleeps).toEqual([250, 1000])
    expect(receipt.rateLimited).toBe(true)
    expect(receipt.noLive).toBe(1)
    expect(receipt.failed).toBe(1)
  })

  it('dry run stores today and drops the row past the retention window', async () => {
    const receipt = await runIntradaySample(dryDeps(), { now: DRY_NOW, sleep: async () => {}, dryRun: true })
    expect(receipt.rows).toBe(2)
    expect(receipt.purged).toBe(1)
    expect(receipt.accountsSampled).toBe(1)
    expect(receipt.overCapClients).toEqual([DRY_CLIENT])
    expect(receipt.rateLimited).toBe(false)
  })

  it('names the heartbeat read functions and no budget write', () => {
    const src = readFileSync(path.join(__dirname, '../prod.ts'), 'utf8')
    expect(src).toContain('fetchHeartbeatTodayInsights')
    expect(src).toContain('fetchHeartbeatAdsets')
    expect(src).not.toContain('graph.facebook.com')
    expect(src).not.toMatch(/daily_budget|ads_update|method:\s*'POST'/)
  })
})
