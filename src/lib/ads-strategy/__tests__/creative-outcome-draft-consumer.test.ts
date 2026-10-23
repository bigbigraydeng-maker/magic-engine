import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ loadConfig: vi.fn(), loadOutcome: vi.fn(), writes: [] as string[] }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        lte: () => query,
        order: () => query,
        range: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: table === 'client_meta_ad_accounts' ? { daily_budget_cap_cents: 50000 } : null, error: null }),
        then: (resolve: (value: unknown) => unknown) => {
          const data = table === 'client_meta_ad_accounts' ? [{ ad_account_id: 'act-1' }] : []
          return Promise.resolve({ data, error: null }).then(resolve)
        },
        insert: () => { m.writes.push(table); return query },
        update: () => { m.writes.push(table); return query },
        upsert: () => { m.writes.push(table); return query },
      }
      return query
    }),
  },
}))
vi.mock('../config', () => ({ loadAdStrategyConfigWithSource: m.loadConfig }))
vi.mock('../portfolio/company-confirmed-bookings', () => ({ loadCompanyConfirmedBookingCreativeReference: m.loadOutcome }))

import { loadAdsDraftFacts } from '../promo-draft-facts'
import { draftAdsStep } from '@/lib/marketing-plan/promo/draft-ads'

const playbook = { draftBudgetShareOfHeadroom: 0.5, draftMaxCreatives: 1 } as never
const outcome = {
  status: 'complete' as const,
  window_start: '2026-10-17',
  window_end: '2026-10-23',
  bookings_by_creative_ref: { 'wo-first': 1, 'wo-second': 3 },
  note: '未校正花费、平台结果或频次，不能比较素材效率/优劣。',
}

beforeEach(() => {
  vi.clearAllMocks()
  m.writes = []
  m.loadConfig.mockResolvedValue({
    source: 'row',
    config: {
      daily_budget_cap_cents: 50000,
      creative_pool: [
        { kind: 'work_order', ref: 'wo-first', status: 'approved' },
        { kind: 'work_order', ref: 'wo-second', status: 'approved' },
        { kind: 'work_order', ref: 'wo-pending', status: 'candidate' },
      ],
    },
  })
  m.loadOutcome.mockResolvedValue(outcome)
})

describe('loadAdsDraftFacts → draftCreatives CRM context', () => {
  it('passes only approved work orders to the verified bridge and displays outcomes without reordering', async () => {
    const facts = await loadAdsDraftFacts({
      clientId: 'client-a',
      adAccountId: 'act-1',
      committedMinor: 0,
      playbook,
      now: new Date('2026-10-23T12:00:00.000Z'),
      companyConfirmedBookingsAllowed: true,
    })
    const draft = draftAdsStep(facts)

    expect(m.loadOutcome).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-a',
      adAccountId: 'act-1',
      windowStart: '2026-10-17',
      windowEnd: '2026-10-23',
      approvedCreatives: [
        { ref: 'wo-first', kind: 'work_order' },
        { ref: 'wo-second', kind: 'work_order' },
      ],
    }))
    expect(draft.creative_refs.ok).toBe(true)
    if (draft.creative_refs.ok) {
      expect(draft.creative_refs.value).toEqual(['wo-first'])
      const reference = draft.creative_refs.basis.find(row => row.label === '公司确认预订（人工参考）')
      expect(reference?.value).toContain('wo-first：1 笔')
      expect(reference?.value).toContain('wo-second：3 笔')
      expect(reference?.value).toContain('原素材库顺序保持不变')
      expect(reference?.value).toContain('不能比较素材效率/优劣')
    }
    expect(m.writes).toEqual([])
  })

  it('does not load or disclose CRM outcomes if the booking permission gate is not granted', async () => {
    const facts = await loadAdsDraftFacts({
      clientId: 'client-a',
      adAccountId: 'act-1',
      committedMinor: 0,
      playbook,
      now: new Date('2026-10-23T12:00:00.000Z'),
      companyConfirmedBookingsAllowed: false,
    })
    const draft = draftAdsStep(facts)

    expect(m.loadOutcome).not.toHaveBeenCalled()
    expect(draft.creative_refs.ok).toBe(true)
    if (draft.creative_refs.ok) {
      expect(draft.creative_refs.value).toEqual(['wo-first'])
      expect(draft.creative_refs.basis.some(row => row.label === '公司确认预订（人工参考）')).toBe(false)
    }
  })
})
