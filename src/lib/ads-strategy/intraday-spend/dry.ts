import type { SampleDeps } from './run'
import { accountDayKey, shiftDay, type SpendDraft } from './sample'

export const DRY_CLIENT = '11111111-1111-4111-8111-111111111111'
export const DRY_NOW = new Date('2026-11-09T01:00:00.000Z')
const ACCOUNT = 'act_synth'
const TZ = 'Pacific/Auckland'

/** Fixture reader. No network, no database, no real account. */
export function dryDeps(): SampleDeps {
  const rows: SpendDraft[] = seed()
  return {
    listClients: async () => [{ id: DRY_CLIENT }],
    listAccounts: async () => [{ adAccountId: ACCOUNT, hidden: false }],
    sharedBareIds: async () => new Set(),
    accountContext: async () => ({ timezone: TZ, currency: 'NZD' }),
    token: async () => 'synthetic-token',
    readAccount: async () => ({
      complete: true,
      rateLimited: false,
      adsets: [{ id: 'as_synth', campaignId: 'cmp_synth', status: 'ACTIVE' }],
      insights: [{ adsetId: 'as_synth', spend: '8.00', impressions: '100' }],
    }),
    upsert: async (drafts: SpendDraft[]) => {
      rows.push(...drafts)
    },
    purge: async (beforeIso: string) => {
      const before = Date.parse(beforeIso)
      const kept = rows.filter((row) => Date.parse(row.sampledAt) >= before)
      const removed = rows.length - kept.length
      rows.splice(0, rows.length, ...kept)
      return removed
    },
  }
}

function seed(): SpendDraft[] {
  const today = accountDayKey(TZ, DRY_NOW) ?? '2026-11-09'
  return [{
    clientId: DRY_CLIENT,
    adAccountId: ACCOUNT,
    accountDay: shiftDay(today, -30),
    sampledAt: new Date(DRY_NOW.getTime() - 30 * 86_400_000).toISOString(),
    localMinute: 0,
    entityLevel: 'campaign',
    entityId: 'cmp_synth',
    spendMinor: 1,
    impressions: 1,
    currency: 'NZD',
    timezone: TZ,
  }]
}
