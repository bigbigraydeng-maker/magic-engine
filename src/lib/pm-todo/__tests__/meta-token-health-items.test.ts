import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TokenOwnerRow } from '@/lib/meta/token-selection'
import {
  META_TOKEN_FIX_URL,
  clearMetaTokenProbeCache,
  pushMetaTokenHealthItems,
  type FetchLike,
} from '../meta-token-health-items'
import type { ManualItem } from '../manual-item-types'

const row = (over: Partial<TokenOwnerRow>): TokenOwnerRow => ({
  id: 'c1',
  name: 'Client One',
  domain: 'client-one.example',
  facebook_page_id: null,
  created_at: '2026-01-01T00:00:00Z',
  source: 'fde',
  ...over,
})

// 实测：mock 只需覆盖被测函数实际调用的方法链；platform_oauth_connections 返回空使 DB 查找落空、走 env-var 路径
function db(rows: TokenOwnerRow[] | 'error') {
  return {
    from(table: string) {
      if (table === 'platform_oauth_connections') {
        const c: Record<string, unknown> = {}
        c.select = () => c; c.eq = () => c; c.order = () => c; c.limit = () => c
        c.maybeSingle = async () => ({ data: null, error: null })
        return c
      }
      expect(table).toBe('clients')
      const chain = {
        select: () => chain,
        order: () => chain,
        range: async () =>
          rows === 'error'
            ? { data: null, error: { message: 'boom' } }
            : { data: rows, error: null },
      }
      return chain
    },
  } as unknown as SupabaseClient
}

const ALIVE = { id: '1' }
const DEAD = {
  error: { code: 190, error_subcode: 460, message: 'Error validating access token: The session has been invalidated' },
}
const RATE_LIMITED = { error: { code: 17, message: 'User request limit reached' } }

/** Reads the token out of the Authorization header and answers per token. */
function fakeFetch(answers: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const header = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
    const token = header.replace('Bearer ', '')
    const answer = answers[token] ?? { status: 200, body: ALIVE }
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  })
}

const tokenFrom = (call: [string, RequestInit?]) =>
  ((call[1]?.headers as Record<string, string> | undefined)?.Authorization ?? '').replace('Bearer ', '')

describe('meta token health items', () => {
  beforeEach(() => clearMetaTokenProbeCache())

  it('pushes one item for a dead domain token', async () => {
    const env = { META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-dead' }
    const fetchImpl = fakeFetch({ 'tok-dead': { status: 400, body: DEAD } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), items, env, fetchImpl)

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('meta_token_dead')
    expect(items[0].client_id).toBe('c1')
    expect(items[0].what).toContain('META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE')
    expect(items[0].how).toContain('META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE')
    expect(items[0].href).toBe(META_TOKEN_FIX_URL)
  })

  it('pushes nothing for an alive domain token', async () => {
    const env = { META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-alive' }
    const fetchImpl = fakeFetch({ 'tok-alive': { status: 200, body: ALIVE } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), items, env, fetchImpl)
    expect(items).toEqual([])
  })

  it('pushes nothing when rate limited or when the fetch throws', async () => {
    const env = {
      META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-rate',
      META_SYSTEM_USER_TOKEN: 'tok-alive',
    }
    const rateLimited = fakeFetch({
      'tok-rate': { status: 400, body: RATE_LIMITED },
      'tok-alive': { status: 200, body: ALIVE },
    })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), items, env, rateLimited)
    expect(items).toEqual([])

    const throwing: FetchLike = async (url, init) => {
      const header = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
      if (header === 'Bearer tok-alive') {
        return new Response(JSON.stringify(ALIVE), { status: 200 })
      }
      throw new Error('network')
    }
    const afterThrow: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), afterThrow, env, throwing)
    expect(afterThrow).toEqual([])
  })

  it('pushes one item for a dead page-keyed token', async () => {
    const env = { META_SYSTEM_USER_TOKEN_PAGE_123: 'tok-page' }
    const fetchImpl = fakeFetch({ 'tok-page': { status: 400, body: DEAD } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(
      db([row({ domain: null, facebook_page_id: '123' })]),
      items,
      env,
      fetchImpl,
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('META_SYSTEM_USER_TOKEN_PAGE_123')
  })

  it('only reports the owning client when a self-serve row shares the domain', async () => {
    const env = { META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-dead' }
    const fetchImpl = fakeFetch({ 'tok-dead': { status: 400, body: DEAD } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(
      db([
        row({ id: 'c1', source: 'fde', created_at: '2026-01-01T00:00:00Z' }),
        row({ id: 'c2', source: 'self_serve', created_at: '2026-02-01T00:00:00Z' }),
      ]),
      items,
      env,
      fetchImpl,
    )
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe('c1')
  })

  it('reports the shared token last, after any scoped token', async () => {
    const env = {
      META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-dead',
      META_SYSTEM_USER_TOKEN: 'tok-shared',
    }
    const fetchImpl = fakeFetch({
      'tok-dead': { status: 400, body: DEAD },
      'tok-shared': { status: 400, body: DEAD },
    })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), items, env, fetchImpl)

    expect(items).toHaveLength(2)
    expect(items[0].client_id).toBe('c1')
    expect(items[1].client_id).toBe('infra')
    expect(items[1].client_name).toBe('Magic Engine 后台')
  })

  it('reports the shared token alone when no scoped token is configured', async () => {
    const env = { META_SYSTEM_USER_TOKEN: 'tok-shared' }
    const fetchImpl = fakeFetch({ 'tok-shared': { status: 400, body: DEAD } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), items, env, fetchImpl)
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe('infra')
  })

  it('probes a shared token value only once across two owning clients', async () => {
    const env = {
      META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-same',
      META_SYSTEM_USER_TOKEN_CLIENT_TWO_EXAMPLE: 'tok-same',
    }
    const fetchImpl = fakeFetch({ 'tok-same': { status: 400, body: DEAD } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(
      db([
        row({ id: 'c1', domain: 'client-one.example' }),
        row({ id: 'c2', domain: 'client-two.example' }),
      ]),
      items,
      env,
      fetchImpl,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(items).toHaveLength(2)
  })

  it('rejects when the clients table cannot be read', async () => {
    await expect(pushMetaTokenHealthItems(db('error'), [], {}, fakeFetch({}))).rejects.toThrow()
  })

  it('rejects on a zero-row clients read instead of reporting all clear', async () => {
    const fetchImpl = fakeFetch({ 'tok-shared': { status: 200, body: ALIVE } })
    await expect(
      pushMetaTokenHealthItems(db([]), [], { META_SYSTEM_USER_TOKEN: 'tok-shared' }, fetchImpl),
    ).rejects.toThrow('零行')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the shared-token fix to the system users page, not the personal token tool', async () => {
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(
      db([row({})]), items, { META_SYSTEM_USER_TOKEN: 'tok-shared' },
      fakeFetch({ 'tok-shared': { status: 400, body: DEAD } }),
    )
    expect(items[0].href).toBe('https://business.facebook.com/settings/system-users')
    expect(items[0].how).toContain('系统用户')
  })

  it('pushes one item for a dead legacy per-name token', async () => {
    const env = { CLIENT_ONE_META_SYSTEM_USER_TOKEN: 'tok-legacy' }
    const fetchImpl = fakeFetch({ 'tok-legacy': { status: 400, body: DEAD } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(
      db([row({ id: 'c1', name: 'Client One', domain: null })]),
      items,
      env,
      fetchImpl,
    )
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe('c1')
    expect(items[0].what).toContain('CLIENT_ONE_META_SYSTEM_USER_TOKEN')
  })

  it('only reports the legacy name owner when a self-serve row shares the name', async () => {
    const env = { CLIENT_ONE_META_SYSTEM_USER_TOKEN: 'tok-legacy' }
    const fetchImpl = fakeFetch({ 'tok-legacy': { status: 400, body: DEAD } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(
      db([
        row({ id: 'c1', name: 'Client One', domain: null, source: 'fde', created_at: '2026-01-01T00:00:00Z' }),
        row({ id: 'c2', name: 'Client One', domain: null, source: 'self_serve', created_at: '2026-02-01T00:00:00Z' }),
      ]),
      items,
      env,
      fetchImpl,
    )
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe('c1')
  })

  it('caches an alive/dead probe for the same token', async () => {
    const env = { META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-dead' }
    const fetchImpl = fakeFetch({ 'tok-dead': { status: 400, body: DEAD } })
    const now = () => 1_000

    const first: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), first, env, fetchImpl, now)
    const second: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), second, env, fetchImpl, now)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
  })

  it('re-probes once the cache TTL has passed', async () => {
    const env = { META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-dead' }
    const fetchImpl = fakeFetch({ 'tok-dead': { status: 400, body: DEAD } })

    await pushMetaTokenHealthItems(db([row({})]), [], env, fetchImpl, () => 1_000)
    await pushMetaTokenHealthItems(db([row({})]), [], env, fetchImpl, () => 1_000 + 10 * 60 * 1000 + 1)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('never caches an unknown probe result', async () => {
    // An alive shared token keeps the all-unknown guard from firing, so this isolates caching.
    const env = { META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-rate', META_SYSTEM_USER_TOKEN: 'tok-alive' }
    const fetchImpl = fakeFetch({ 'tok-rate': { status: 400, body: RATE_LIMITED } })
    const now = () => 1_000

    const first: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), first, env, fetchImpl, now)
    const second: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), second, env, fetchImpl, now)

    const rateCalls = fetchImpl.mock.calls.filter((c) => tokenFrom(c) === 'tok-rate')
    expect(rateCalls).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(first).toEqual([])
    expect(second).toEqual([])
  })

  it('does not echo Meta raw error text into the todo', async () => {
    const env = { META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-dead' }
    const fetchImpl = fakeFetch({ 'tok-dead': { status: 400, body: DEAD } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), items, env, fetchImpl)

    expect(items[0].what).not.toContain('session has been invalidated')
    expect(items[0].what).toContain('错误码 190')
  })

  it('rejects when every probe is unknown (single rate-limited scoped token)', async () => {
    const env = { META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-rate' }
    const fetchImpl = fakeFetch({ 'tok-rate': { status: 400, body: RATE_LIMITED } })
    await expect(
      pushMetaTokenHealthItems(db([row({})]), [], env, fetchImpl),
    ).rejects.toThrow('问不到')
  })

  it('rejects when every probe is unknown because the fetch throws', async () => {
    const env = {
      META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-secret',
      META_SYSTEM_USER_TOKEN: 'tok-shared',
    }
    const throwing: FetchLike = async () => {
      throw new Error('network')
    }
    await expect(
      pushMetaTokenHealthItems(db([row({})]), [], env, throwing),
    ).rejects.toThrow('问不到')
  })

  it('resolves with no items when one probe is alive and one is unknown', async () => {
    const env = {
      META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-rate',
      META_SYSTEM_USER_TOKEN: 'tok-alive',
    }
    const fetchImpl = fakeFetch({
      'tok-rate': { status: 400, body: RATE_LIMITED },
      'tok-alive': { status: 200, body: ALIVE },
    })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), items, env, fetchImpl)
    expect(items).toEqual([])
  })

  it('tells the PM to grant the ad permissions and to deploy on save', async () => {
    const env = { META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-dead' }
    const fetchImpl = fakeFetch({ 'tok-dead': { status: 400, body: DEAD } })
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), items, env, fetchImpl)
    expect(items[0].how).toContain('ads_management')
    expect(items[0].how).toContain('Save only')
  })

  it('tells the PM to deploy on save for the shared token too', async () => {
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(
      db([row({})]), items, { META_SYSTEM_USER_TOKEN: 'tok-shared' },
      fakeFetch({ 'tok-shared': { status: 400, body: DEAD } }),
    )
    expect(items[0].how).toContain('Save only')
  })

  it('resolves with no items and never probes when no tokens are configured', async () => {
    const fetchImpl = fakeFetch({})
    const items: ManualItem[] = []
    await pushMetaTokenHealthItems(db([row({})]), items, {}, fetchImpl)
    expect(items).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never puts the token in the request URL', async () => {
    const env = {
      META_SYSTEM_USER_TOKEN_CLIENT_ONE_EXAMPLE: 'tok-secret',
      META_SYSTEM_USER_TOKEN: 'tok-shared',
    }
    const fetchImpl = fakeFetch({
      'tok-secret': { status: 400, body: DEAD },
      'tok-shared': { status: 400, body: DEAD },
    })
    await pushMetaTokenHealthItems(db([row({})]), [], env, fetchImpl)

    for (const call of fetchImpl.mock.calls) {
      expect(call[0]).not.toContain('tok-secret')
      expect(call[0]).not.toContain('tok-shared')
    }
    expect(fetchImpl.mock.calls.map(tokenFrom)).toEqual(['tok-secret', 'tok-shared'])
  })
})
