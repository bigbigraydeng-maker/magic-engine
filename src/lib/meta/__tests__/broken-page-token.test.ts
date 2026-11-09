/**
 * Graph 190 / 403 #200 / unverified_shared_token 再试也不会好。
 * 有连接行就标 status=error；没有行就记一条暂停。混着真错误不许隔离。
 */

import { describe, expect, it, vi } from 'vitest'
import { asSupabaseClient, makeBindingFakeDb, type FakeDb } from './binding-fake-db'
import {
  classifyBrokenPageToken,
  clearMetaPageSyncHold,
  isSkippablePageTokenFailure,
  metaPageSyncHeld,
  quarantineBrokenPageToken,
} from '../broken-page-token'

const CLIENT = 'client-1'
const PAGE = 'page-1'

describe('classifyBrokenPageToken', () => {
  it('认 190、#200、403 缺角色、未核实公用令牌', () => {
    expect(classifyBrokenPageToken('HTTP 400 {"error":{"code":190}}')).toBe('graph_190')
    expect(classifyBrokenPageToken('(#190) session invalidated')).toBe('graph_190')
    expect(classifyBrokenPageToken('code=190 token dead')).toBe('graph_190')
    expect(classifyBrokenPageToken('HTTP 403 code=200 (#200) Requires pages_messaging')).toBe('missing_page_role')
    expect(classifyBrokenPageToken('HTTP 403 Forbidden: missing page role')).toBe('missing_page_role')
    expect(classifyBrokenPageToken('page_not_verified: unverified_shared_token')).toBe('unverified_shared_token')
  })

  it('不把 2000、HTTP 200、或混着的真错误当成坏令牌', () => {
    expect(classifyBrokenPageToken('code=2000')).toBeNull()
    expect(classifyBrokenPageToken('HTTP 200 OK but empty body')).toBeNull()
    expect(classifyBrokenPageToken('leadgen_forms HTTP 403: (#278) Requires leads_retrieval permission')).toBeNull()
    expect(classifyBrokenPageToken('page_not_verified: not_bound_page')).toBeNull()
    expect(classifyBrokenPageToken('page_not_verified: bound_to_other_client')).toBeNull()
    expect(classifyBrokenPageToken('HTTP 500 boom | (#190) token')).toBeNull()
    expect(classifyBrokenPageToken(null)).toBeNull()
  })

  it('每一段都是坏令牌时才隔离，种类取第一段', () => {
    expect(classifyBrokenPageToken('code=190 | (#200) Requires pages_read_engagement')).toBe('graph_190')
  })
})

describe('isSkippablePageTokenFailure', () => {
  it('已暂停、或错误本身就是坏令牌，不再把整轮涂红', () => {
    expect(isSkippablePageTokenFailure({ skipped: 'connection_unhealthy' })).toBe(true)
    expect(isSkippablePageTokenFailure({ error: 'connection_unhealthy' })).toBe(true)
    expect(isSkippablePageTokenFailure({ error: 'connection_unhealthy: held' })).toBe(true)
    expect(isSkippablePageTokenFailure({ error: 'code=190' })).toBe(true)
    expect(isSkippablePageTokenFailure({ error: 'HTTP 500 boom' })).toBe(false)
    expect(isSkippablePageTokenFailure({ error: 'page_not_verified: not_bound_page' })).toBe(false)
  })
})

function dbWith(rows: FakeDb) {
  return asSupabaseClient(makeBindingFakeDb(rows))
}

describe('quarantineBrokenPageToken', () => {
  it('已有 active 连接行 → status=error，不另插暂停', async () => {
    const db: FakeDb = {
      platform_oauth_connections: [
        { id: 'conn-1', client_id: CLIENT, provider: 'meta', account_id: PAGE, status: 'active' },
      ],
      meta_page_sync_holds: [],
    }
    const result = await quarantineBrokenPageToken(dbWith(db), {
      clientId: CLIENT,
      pageId: PAGE,
      kind: 'graph_190',
      error: 'code=190',
    })
    expect(result).toEqual({ markedConnection: true, held: false })
    expect(db.platform_oauth_connections[0].status).toBe('error')
    expect(String(db.platform_oauth_connections[0].error_message)).toContain('graph_190')
    expect(db.meta_page_sync_holds).toHaveLength(0)
  })

  it('已经是 error 的行不再插一条重复暂停', async () => {
    const db: FakeDb = {
      platform_oauth_connections: [
        { id: 'conn-1', client_id: CLIENT, provider: 'meta', account_id: PAGE, status: 'error' },
      ],
      meta_page_sync_holds: [],
    }
    const result = await quarantineBrokenPageToken(dbWith(db), {
      clientId: CLIENT,
      pageId: PAGE,
      kind: 'missing_page_role',
      error: '(#200)',
    })
    expect(result).toEqual({ markedConnection: false, held: false })
    expect(db.meta_page_sync_holds).toHaveLength(0)
  })

  it('没有连接行 → 记一条暂停', async () => {
    const db: FakeDb = { platform_oauth_connections: [], meta_page_sync_holds: [] }
    const result = await quarantineBrokenPageToken(dbWith(db), {
      clientId: CLIENT,
      pageId: PAGE,
      kind: 'graph_190',
      error: 'code=190',
    })
    expect(result).toEqual({ markedConnection: false, held: true })
    expect(db.meta_page_sync_holds).toEqual([
      expect.objectContaining({ client_id: CLIENT, page_id: PAGE, reason: 'graph_190' }),
    ])
  })

  it('暂停表还没建 → 不抛，也不假装已经暂停', async () => {
    const supabase = {
      from(table: string) {
        const empty = { data: [] as unknown[], error: null }
        const builder: Record<string, unknown> = {
          update: () => builder,
          select: () => builder,
          eq: () => builder,
          in: () => Promise.resolve(empty),
          upsert: () =>
            Promise.resolve({
              error: { code: '42P01', message: 'relation "public.meta_page_sync_holds" does not exist' },
            }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(empty)),
        }
        return table === 'meta_page_sync_holds'
          ? { upsert: builder.upsert }
          : builder
      },
    }
    const result = await quarantineBrokenPageToken(supabase as never, {
      clientId: CLIENT,
      pageId: PAGE,
      kind: 'graph_190',
      error: 'code=190',
    })
    expect(result).toEqual({ markedConnection: false, held: false })
  })
})

describe('metaPageSyncHeld / clearMetaPageSyncHold', () => {
  it('error 连接或暂停行都算已暂停；重连删掉暂停', async () => {
    const unhealthy: FakeDb = {
      platform_oauth_connections: [
        { id: 'conn-1', client_id: CLIENT, provider: 'meta', account_id: PAGE, status: 'error' },
      ],
    }
    expect(await metaPageSyncHeld(dbWith(unhealthy), CLIENT, PAGE)).toBe(true)

    const held: FakeDb = {
      platform_oauth_connections: [],
      meta_page_sync_holds: [{ client_id: CLIENT, page_id: PAGE, reason: 'graph_190' }],
    }
    expect(await metaPageSyncHeld(dbWith(held), CLIENT, PAGE)).toBe(true)
    await clearMetaPageSyncHold(dbWith(held), CLIENT, PAGE)
    expect(held.meta_page_sync_holds).toHaveLength(0)
    expect(await metaPageSyncHeld(dbWith(held), CLIENT, PAGE)).toBe(false)
  })

  it('别的客户、active 连接、缺表，都不算已暂停', async () => {
    const db: FakeDb = {
      platform_oauth_connections: [
        { id: 'conn-1', client_id: 'other', provider: 'meta', account_id: PAGE, status: 'error' },
        { id: 'conn-2', client_id: CLIENT, provider: 'meta', account_id: PAGE, status: 'active' },
      ],
      meta_page_sync_holds: [],
    }
    expect(await metaPageSyncHeld(dbWith(db), CLIENT, PAGE)).toBe(false)

    const missing = {
      from: () => {
        const error = { code: '42P01', message: 'relation does not exist' }
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
          in: () => Promise.resolve({ data: [], error: null }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: null, error })),
        }
        return builder
      },
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await metaPageSyncHeld(missing as never, CLIENT, PAGE)).toBe(false)
    spy.mockRestore()
  })
})
