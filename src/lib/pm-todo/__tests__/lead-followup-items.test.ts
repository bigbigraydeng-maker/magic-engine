import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pushLeadFollowupItems,
  type LeadFollowupDeps,
} from '@/lib/pm-todo/lead-followup-items'
import type { LeadDueResult, LeadBacklogResult } from '@/lib/crm/lead-followup-due'
import type { LeadDueItem } from '@/lib/crm/lead-followup-due'
import { NEVER_DROP_KINDS, type ManualItem } from '@/lib/pm-todo/manual-item-types'
import { BLIND_SPOT_NOTE } from '@/lib/pm-todo/five-kinds'

const NOW = new Date('2026-10-18T00:00:00Z')
const NAL = 'client-nal'
const CTS = 'client-cts'
const SUPABASE = {} as SupabaseClient

function lead(daysAgo: number, displayName = 'Secret Person'): LeadDueItem {
  return {
    clientId: NAL,
    contactId: `contact-${daysAgo}`,
    displayName,
    interest: '搬家报价',
    leadAt: new Date(NOW.getTime() - daysAgo * 24 * 3_600_000).toISOString(),
  }
}

function due(items: LeadDueItem[], dropped = 0): LeadDueResult {
  return { items, dropped, orphans: 0 }
}

function backlog(count: number): LeadBacklogResult {
  return { backlog: count, lookbackDays: 180 }
}

function deps(overrides: Partial<LeadFollowupDeps>): LeadFollowupDeps {
  return {
    findDue: async () => due([]),
    countBacklog: async () => backlog(0),
    ...overrides,
  }
}

const nameOf = (id: string) => (id === NAL ? 'New Asian Logistics' : 'CTS Tours NZ')

describe('pushLeadFollowupItems', () => {
  it('没人等 → 不下发，也不去算积压', async () => {
    const items: ManualItem[] = []
    let backlogCalls = 0
    await pushLeadFollowupItems(
      SUPABASE,
      items,
      [NAL],
      NOW,
      nameOf,
      deps({
        findDue: async () => due([]),
        countBacklog: async () => {
          backlogCalls++
          return backlog(0)
        },
      }),
    )
    expect(items).toEqual([])
    expect(backlogCalls).toBe(0)
  })

  it('3 条明细 + 2 条被丢 → 一条待办，说 5 个客人、最久 3 天', async () => {
    const items: ManualItem[] = []
    await pushLeadFollowupItems(
      SUPABASE,
      items,
      [NAL],
      NOW,
      nameOf,
      deps({ findDue: async () => due([lead(3), lead(2), lead(1)], 2) }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'lead_followup_due',
      client_id: NAL,
      client_name: 'New Asian Logistics',
    })
    expect(items[0].what).toContain('5 个客人')
    expect(items[0].what).toContain('3 天')
  })

  it('有积压 → 补一句「另有 N 个更早的」', async () => {
    const items: ManualItem[] = []
    await pushLeadFollowupItems(
      SUPABASE,
      items,
      [NAL],
      NOW,
      nameOf,
      deps({
        findDue: async () => due([lead(2)]),
        countBacklog: async () => backlog(170),
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('另有 170 个更早的')
  })

  it('积压算不出来 → 说一句没算出来，主待办照发', async () => {
    const items: ManualItem[] = []
    await pushLeadFollowupItems(
      SUPABASE,
      items,
      [NAL],
      NOW,
      nameOf,
      deps({
        findDue: async () => due([lead(2)]),
        countBacklog: async () => {
          throw new Error('backlog boom')
        },
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('lead_followup_due')
    expect(items[0].what).toContain('这次没算出来')
  })

  it('A 取数失败不影响 B；A 留一条 check_failed，href 为空', async () => {
    const items: ManualItem[] = []
    await pushLeadFollowupItems(
      SUPABASE,
      items,
      [NAL, CTS],
      NOW,
      nameOf,
      deps({
        findDue: async (_s, clientId) => {
          if (clientId === NAL) throw new Error('query timeout')
          return due([lead(2)])
        },
      }),
    )
    expect(items).toHaveLength(2)

    const failed = items.find((i) => i.kind === 'lead_followup_check_failed')
    expect(failed).toBeDefined()
    expect(failed?.client_id).toBe(NAL)
    expect(failed?.href).toBe('')
    expect(failed?.what).toContain('query timeout')
    expect(failed?.what).toContain('没有结果不等于没有人在等')

    const ok = items.find((i) => i.kind === 'lead_followup_due')
    expect(ok).toBeDefined()
    expect(ok?.client_id).toBe(CTS)
  })

  it('what / how / href 里绝不出现客人姓名', async () => {
    const items: ManualItem[] = []
    await pushLeadFollowupItems(
      SUPABASE,
      items,
      [NAL],
      NOW,
      nameOf,
      deps({ findDue: async () => due([lead(3, 'Secret Person')]) }),
    )
    expect(items).toHaveLength(1)
    const { what, how, href } = items[0]
    expect(what).not.toContain('Secret Person')
    expect(how).not.toContain('Secret Person')
    expect(href).not.toContain('Secret Person')
  })

  it('href 指向 CRM「全部客人」页', async () => {
    const items: ManualItem[] = []
    await pushLeadFollowupItems(
      SUPABASE,
      items,
      [NAL],
      NOW,
      nameOf,
      deps({ findDue: async () => due([lead(1)]) }),
    )
    expect(items[0].href).toBe(
      `https://app.magicengine.com.au/dashboard/clients/${NAL}/crm/all`,
    )
  })
})

describe('魏征审查补充', () => {
  it('窗口内只有被封顶丢弃的（items 为空、dropped>0）→ 仍出一条，按 1 天算', async () => {
    const items: ManualItem[] = []
    await pushLeadFollowupItems({} as SupabaseClient, items, [NAL], NOW, () => 'NAL', deps({
      findDue: async () => due([], 4),
    }))
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('4 个客人')
    expect(items[0].what).toContain('1 天')
  })

  it('失败条目只带错误类别，不带报错原文', async () => {
    const items: ManualItem[] = []
    await pushLeadFollowupItems({} as SupabaseClient, items, [NAL], NOW, () => 'NAL', deps({
      findDue: async () => {
        throw new Error('relation "x" filter value=secret@example.com')
      },
    }))
    expect(items[0].kind).toBe('lead_followup_check_failed')
    expect(items[0].what).not.toContain('secret@example.com')
  })

  it('两个新类型都登记了：不会被探活丢掉、读失败时 PM 那栏有提示', () => {
    expect(NEVER_DROP_KINDS.has('lead_followup_due')).toBe(true)
    expect(NEVER_DROP_KINDS.has('lead_followup_check_failed')).toBe(true)
    expect(BLIND_SPOT_NOTE.lead_followup_check_failed).toBeTruthy()
  })
})
