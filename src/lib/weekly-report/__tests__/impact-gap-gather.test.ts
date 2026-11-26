import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { gatherCiSlice, gatherM2Slice } from '../impact-gap-gather'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

describe('impact-gap-gather', () => {
  it('M-2：多币种不合计', async () => {
    const sb = createFakeSupabase({
      client_meta_ad_accounts: [
        { client_id: CLIENT, ad_account_id: 'act_111', daily_budget_cap_cents: null },
        { client_id: CLIENT, ad_account_id: 'act_222', daily_budget_cap_cents: null },
      ],
      ad_daily_insights: [
        { client_id: CLIENT, ad_account_id: 'act_111', level: 'campaign', insight_date: '2026-11-07', spend: 10, currency: 'NZD' },
        { client_id: CLIENT, ad_account_id: 'act_222', level: 'campaign', insight_date: '2026-11-07', spend: 5, currency: 'AUD' },
      ],
      ad_strategy_configs: [{ client_id: CLIENT, daily_budget_cap_cents: 5000 }],
    })
    const slice = await gatherM2Slice(sb, CLIENT, new Date('2026-11-08T00:00:00Z'))
    expect(slice.mixedCurrency).toBe(true)
    expect(slice.spend7dTotal).toBeNull()
  })

  it('C-i：样本不足时 winnerHold=false', async () => {
    const sb = createFakeSupabase({
      ad_daily_insights: [
        {
          client_id: CLIENT,
          entity_id: 'ad-1',
          level: 'ad',
          insight_date: '2026-11-07',
          spend: 100,
          impressions: 1000,
          leads: 5,
          link_clicks: 20,
          video_3s_views: 200,
          messaging_conversations: 0,
        },
      ],
    })
    const slice = await gatherCiSlice(sb, CLIENT, new Date('2026-11-08T00:00:00Z'))
    expect(slice.winnerHold).toBe(false)
    expect(slice.segments[0]?.state).toBe('unknown')
  })
})
