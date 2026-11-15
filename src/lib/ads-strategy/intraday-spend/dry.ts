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
      insights: [{
        adsetId: 'as_synth',
        spend: '8.00',
        impressions: '100',
        inlineLinkClicks: '4',
        actions: [
          { action_type: 'lead', value: '2' },
          { action_type: 'onsite_conversion.lead_grouped', value: '2' },
          { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '1' },
        ],
      }],
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
    loadSamples: async () => rows.filter((row) => row.clientId === DRY_CLIENT),
    capMinor: async () => 1000,
  }
}

function seed(): SpendDraft[] {
  const today = accountDayKey(TZ, DRY_NOW) ?? '2026-11-09'
  const rows: SpendDraft[] = []
  for (let ago = 1; ago <= 4; ago += 1) {
    const day = shiftDay(today, -ago)
    for (let hour = 0; hour <= 24; hour += 1) {
      const localMinute = hour === 24 ? 1430 : hour * 60
      const spendMinor = hour === 24 ? 1000 : Math.round((1000 * localMinute) / 1440)
      rows.push(draft(day, localMinute, spendMinor, new Date(DRY_NOW.getTime() - ago * 86_400_000).toISOString()))
    }
  }
  rows.push(draft(shiftDay(today, -30), 0, 1, new Date(DRY_NOW.getTime() - 30 * 86_400_000).toISOString()))
  return rows
}

function draft(day: string, localMinute: number, spendMinor: number, sampledAt: string): SpendDraft {
  return {
    clientId: DRY_CLIENT, adAccountId: ACCOUNT, accountDay: day, sampledAt,
    localMinute, entityLevel: 'campaign', entityId: 'cmp_synth', spendMinor,
    impressions: 10, linkClicks: null, results: null, currency: 'NZD', timezone: TZ,
  }
}
