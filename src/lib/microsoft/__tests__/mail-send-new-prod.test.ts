import { afterEach, describe, expect, it, vi } from 'vitest'

interface Filter {
  op: 'eq' | 'lt'
  column: string
  value: unknown
}

const state = vi.hoisted(() => ({
  insertError: null as { code?: string; message: string } | null,
  inserted: [] as Array<{ table: string; row: Record<string, unknown> }>,
  deleted: [] as Array<{ table: string; filters: Filter[] }>,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          state.inserted.push({ table, row })
          return Promise.resolve({ error: state.insertError })
        },
        delete() {
          const filters: Filter[] = []
          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ op: 'eq', column, value })
              return builder
            },
            lt(column: string, value: unknown) {
              filters.push({ op: 'lt', column, value })
              return builder
            },
            then(resolve: (value: { error: null }) => unknown) {
              state.deleted.push({ table, filters })
              return resolve({ error: null })
            },
          }
          return builder
        },
      }
    },
  },
}))

vi.mock('@/lib/microsoft/mail-send', () => ({
  GRAPH: 'https://graph.microsoft.com/v1.0',
  callWithRetry: vi.fn(async (_connectionId: string, call: (token: string) => Promise<unknown>) => call('test-token')),
  sendDraft: vi.fn(),
  writeTouchpoint: vi.fn(),
}))

import { createMailNewDeps, createMailNewStore, graphGetPage } from '@/lib/microsoft/mail-send-new-prod'

afterEach(() => {
  state.insertError = null
  state.inserted = []
  state.deleted = []
  vi.unstubAllGlobals()
})

const releases = () =>
  state.deleted.filter((d) => d.filters.some((f) => f.op === 'eq' && f.column === 'subject'))

describe('contact lock ownership', () => {
  it('writes a random token into the lock row and releases only that token', async () => {
    const store = createMailNewStore()
    expect(await store.acquireContactLock('client-1', 'contact-1', 'lisa@cts.example')).toBe(true)
    const lockRow = state.inserted.find((i) => i.row.conversation_id === 'mail-lock:contact-1')
    const token = lockRow?.row.subject
    expect(typeof token).toBe('string')
    expect((token as string).length).toBeGreaterThan(10)

    await store.releaseContactLock('client-1', 'contact-1')
    const [release] = releases()
    expect(release.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'client_id', value: 'client-1' },
        { op: 'eq', column: 'conversation_id', value: 'mail-lock:contact-1' },
        { op: 'eq', column: 'subject', value: token },
      ]),
    )
  })

  it('does not delete a lock another request holds', async () => {
    const holder = createMailNewStore()
    const latecomer = createMailNewStore()
    expect(await holder.acquireContactLock('client-1', 'contact-1', 'lisa@cts.example')).toBe(true)

    state.insertError = { code: '23505', message: 'duplicate key' }
    expect(await latecomer.acquireContactLock('client-1', 'contact-1', 'lisa@cts.example')).toBe(false)

    state.deleted = []
    await latecomer.releaseContactLock('client-1', 'contact-1')
    expect(releases()).toHaveLength(0)
  })

  it('still sweeps stale locks older than five minutes before taking a new one', async () => {
    const store = createMailNewStore()
    await store.acquireContactLock('client-1', 'contact-1', 'lisa@cts.example')
    const sweep = state.deleted.find((d) => d.filters.some((f) => f.op === 'lt' && f.column === 'created_at'))
    expect(sweep).toBeDefined()
  })

  it('surfaces a real insert failure instead of pretending the lock is taken', async () => {
    state.insertError = { code: '08006', message: 'connection lost' }
    await expect(createMailNewStore().acquireContactLock('client-1', 'contact-1', 'lisa@cts.example')).rejects.toThrow(
      'connection lost',
    )
  })
})

describe('graphGetPage', () => {
  function stubFetch() {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ value: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('reads a relative Graph path, with a request timeout', async () => {
    const fetchMock = stubFetch()
    const res = await graphGetPage('conn-1', '/me/mailFolders/sentitems/messages?$top=100')
    expect(res).toEqual({ ok: true, json: { value: [] } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=100')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('follows a next-page link on the Graph host without doubling the prefix', async () => {
    const fetchMock = stubFetch()
    await graphGetPage('conn-1', 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc')
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc')
  })

  it.each([
    'https://evil.example/v1.0/me/messages',
    'https://graph.microsoft.com.evil.example/v1.0/me/messages',
    'https://graph.microsoft.com/v1.0.evil.example/me',
    'http://graph.microsoft.com/v1.0/me/messages',
    '//evil.example/me',
    'me/messages',
  ])('refuses to follow %s', async (target) => {
    const fetchMock = stubFetch()
    const res = await graphGetPage('conn-1', target)
    expect(res.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports an HTTP failure instead of an empty page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    const res = await graphGetPage('conn-1', '/me/messages')
    expect(res.ok).toBe(false)
  })
})

describe('createMailNewDeps', () => {
  it('has no template gates unless a client is named', () => {
    expect(createMailNewDeps().gates).toBeUndefined()
    expect(createMailNewDeps('client-1').gates).toBeDefined()
  })
})
