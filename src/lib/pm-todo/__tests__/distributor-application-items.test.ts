/** 经销商申请待办：有在等审核的申请才下发一条；表没上线或读失败时不报、不抛。 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushDistributorApplicationItems } from '../distributor-application-items'
import type { ManualItem } from '../manual-items'

function fakeSupabase(result: { data: unknown; error: { message: string; code?: string } | null }, seen: Record<string, unknown> = {}): SupabaseClient {
  const b = {
    select: () => b,
    eq: (k: string, v: unknown) => { seen[k] = v; return b },
    order: () => b,
    limit: () => Promise.resolve(result),
  }
  const client = { from: (t: string) => { seen.table = t; return b } }
  return client as never
}

const NOW = new Date('2026-11-12T00:00:00Z')

describe('pushDistributorApplicationItems', () => {
  it('pushes one decide item for pending applications, linked to the distributor page', async () => {
    const items: ManualItem[] = []
    const seen: Record<string, unknown> = {}
    await pushDistributorApplicationItems(fakeSupabase({ data: [{ created_at: '2026-11-10T00:00:00Z' }, { created_at: '2026-11-11T00:00:00Z' }], error: null }, seen), items, NOW)
    expect(seen).toMatchObject({ table: 'distributors', source: 'application', status: 'pending' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'distributor_application_pending', href: 'https://app.magicengine.com.au/dashboard/admin/distributors' })
    expect(items[0].what).toContain('有 2 个人')
    expect(items[0].what).toContain('等了 2 天')
  })

  it('stays quiet with no applications or when the table is not there yet', async () => {
    const items: ManualItem[] = []
    await pushDistributorApplicationItems(fakeSupabase({ data: [], error: null }), items, NOW)
    await pushDistributorApplicationItems(fakeSupabase({ data: null, error: { message: 'missing', code: '42P01' } }), items, NOW)
    expect(items).toEqual([])
  })
})
