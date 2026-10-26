import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { asSupabaseClient, makeBindingFakeDb, type FakeDb } from '@/lib/meta/__tests__/binding-fake-db'
import { pushBrokenPageHoldItems } from '../broken-page-hold-items'
import type { ManualItem } from '../manual-item-types'

const CLIENT = 'client-1'

function queryClient(db: FakeDb): SupabaseClient {
  return asSupabaseClient(makeBindingFakeDb(db))
}

describe('pushBrokenPageHoldItems', () => {
  it('190 和缺角色下发重连待办，未核实公用令牌不在这里重复', async () => {
    const items: ManualItem[] = []
    await pushBrokenPageHoldItems(
      queryClient({
        meta_page_sync_holds: [
          { client_id: CLIENT, page_id: 'page-1', reason: 'graph_190' },
          { client_id: CLIENT, page_id: 'page-2', reason: 'missing_page_role' },
          { client_id: CLIENT, page_id: 'page-3', reason: 'unverified_shared_token' },
        ],
        clients: [{ id: CLIENT, name: 'Sample Client' }],
      }),
      items,
    )

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      kind: 'platform_connection_broken',
      client_id: CLIENT,
      client_name: 'Sample Client',
      href: `https://app.magicengine.com.au/dashboard/clients/${CLIENT}?settings=platform`,
    })
    expect(items[0].what).toContain('令牌失效')
    expect(items[0].how).toContain('连接 Meta')
    expect(items[1].what).toContain('没有被批准的角色')
    expect(JSON.stringify(items)).not.toContain('unverified_shared_token')
  })

  it('暂停表还没建 → 安静跳过；别的读失败要抛出去', async () => {
    const missing = {
      from: () => ({
        select: () => ({
          limit: () =>
            Promise.resolve({
              data: null,
              error: { code: '42P01', message: 'relation "public.meta_page_sync_holds" does not exist' },
            }),
        }),
      }),
    } as unknown as SupabaseClient
    const items: ManualItem[] = []
    await expect(pushBrokenPageHoldItems(missing, items)).resolves.toBeUndefined()
    expect(items).toHaveLength(0)

    const broken = {
      from: () => ({
        select: () => ({
          limit: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }),
        }),
      }),
    } as unknown as SupabaseClient
    await expect(pushBrokenPageHoldItems(broken, [])).rejects.toThrow(/meta_page_sync_holds query failed/)
  })
})
