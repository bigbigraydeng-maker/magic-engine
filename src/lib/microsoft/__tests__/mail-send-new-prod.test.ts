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
  selectData: {} as Record<string, unknown>,
  selectError: null as { table: string; message: string } | null,
  selected: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          state.inserted.push({ table, row })
          return Promise.resolve({ error: state.insertError })
        },
        select() {
          state.selected.push({ table, method: 'select', args: [] })
          const builder: Record<string, unknown> = {}
          for (const method of ['eq', 'in', 'like', 'limit']) {
            builder[method] = (...args: unknown[]) => {
              state.selected.push({ table, method, args })
              return builder
            }
          }
          builder.then = (resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) =>
            resolve(
              state.selectError !== null && state.selectError.table === table
                ? { data: null, error: { message: state.selectError.message } }
                : { data: state.selectData[table] ?? null, error: null },
            )
          return builder
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

import { createMailNewDeps, createMailNewGraph, createMailNewStore, graphGetPage } from '@/lib/microsoft/mail-send-new-prod'

afterEach(() => {
  state.insertError = null
  state.inserted = []
  state.deleted = []
  state.selectData = {}
  state.selectError = null
  state.selected = []
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

describe('recipient lock (one send to an address at a time, whichever contact record it is)', () => {
  it('locks on the address itself, lower-cased, so two contact records that share it collide', async () => {
    const store = createMailNewStore()
    expect(await store.acquireRecipientLock('client-1', ' Amy@Gmail.com ', 'lisa@cts.example')).toBe(true)
    const row = state.inserted.find((i) => i.row.conversation_id === 'mail-lock:to:amy@gmail.com')
    expect(row?.row).toMatchObject({ client_id: 'client-1', channel: 'email', page_id: 'lisa@cts.example' })
    expect(typeof row?.row.subject).toBe('string')
  })

  it('does not collide with a contact lock (a contact id is a uuid, never "to:…")', async () => {
    const store = createMailNewStore()
    await store.acquireContactLock('client-1', 'contact-1', 'lisa@cts.example')
    await store.acquireRecipientLock('client-1', 'amy@gmail.com', 'lisa@cts.example')
    const keys = state.inserted.map((i) => i.row.conversation_id)
    expect(keys).toEqual(['mail-lock:contact-1', 'mail-lock:to:amy@gmail.com'])
  })

  it('a second request for the same address is told the lock is taken', async () => {
    const holder = createMailNewStore()
    const latecomer = createMailNewStore()
    expect(await holder.acquireRecipientLock('client-1', 'amy@gmail.com', 'lisa@cts.example')).toBe(true)
    state.insertError = { code: '23505', message: 'duplicate key' }
    expect(await latecomer.acquireRecipientLock('client-1', 'amy@gmail.com', 'lisa@cts.example')).toBe(false)
  })

  it('releases only its own token, and never touches a lock someone else holds', async () => {
    const holder = createMailNewStore()
    const latecomer = createMailNewStore()
    await holder.acquireRecipientLock('client-1', 'amy@gmail.com', 'lisa@cts.example')
    const token = state.inserted.find((i) => i.row.conversation_id === 'mail-lock:to:amy@gmail.com')?.row.subject
    state.insertError = { code: '23505', message: 'duplicate key' }
    await latecomer.acquireRecipientLock('client-1', 'amy@gmail.com', 'lisa@cts.example')

    state.deleted = []
    await latecomer.releaseRecipientLock('client-1', 'amy@gmail.com')
    expect(releases()).toHaveLength(0)

    await holder.releaseRecipientLock('client-1', 'AMY@gmail.com')
    const [release] = releases()
    expect(release.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'client_id', value: 'client-1' },
        { op: 'eq', column: 'conversation_id', value: 'mail-lock:to:amy@gmail.com' },
        { op: 'eq', column: 'subject', value: token },
      ]),
    )
  })

  it('sweeps a stale address lock and surfaces a real insert failure, like the contact lock', async () => {
    await createMailNewStore().acquireRecipientLock('client-1', 'amy@gmail.com', 'lisa@cts.example')
    const sweep = state.deleted.find(
      (d) => d.filters.some((f) => f.op === 'lt' && f.column === 'created_at') && d.filters.some((f) => f.column === 'conversation_id' && f.value === 'mail-lock:to:amy@gmail.com'),
    )
    expect(sweep).toBeDefined()
    state.insertError = { code: '08006', message: 'connection lost' }
    await expect(createMailNewStore().acquireRecipientLock('client-1', 'amy@gmail.com', 'lisa@cts.example')).rejects.toThrow('connection lost')
  })
})

describe('findPriorSend', () => {
  const REQ = '11111111-1111-4111-8111-111111111111'
  const logRow = { id: 'audit-1', status: 'sent', meta_message_id: `req:${REQ}|msg:AAMk1`, conversation_id: 'conv-1' }

  it('finds the earlier send when it went into this contact\'s own conversation', async () => {
    state.selectData = { conversation_outbound_log: [logRow], conversations: [{ id: 'conv-1' }] }
    const prior = await createMailNewStore().findPriorSend('client-1', REQ, 'contact-1')
    expect(prior).toEqual({ auditId: 'audit-1', status: 'sent', messageId: 'AAMk1', conversationId: 'conv-1' })
    const asked = state.selected.filter((c) => c.table === 'conversations')
    expect(asked).toContainEqual({ table: 'conversations', method: 'eq', args: ['contact_id', 'contact-1'] })
    expect(asked).toContainEqual({ table: 'conversations', method: 'eq', args: ['client_id', 'client-1'] })
  })

  it('does not call a request id reused for ANOTHER contact "already sent"', async () => {
    state.selectData = { conversation_outbound_log: [logRow], conversations: [] }
    expect(await createMailNewStore().findPriorSend('client-1', REQ, 'contact-2')).toBeNull()
  })

  it('a failed lookup is an error, never "nothing was sent before" (a retry would send the mail again)', async () => {
    state.selectError = { table: 'conversation_outbound_log', message: 'timeout' }
    await expect(createMailNewStore().findPriorSend('client-1', REQ, 'contact-1')).rejects.toThrow('timeout')
    state.selectError = { table: 'conversations', message: 'boom' }
    state.selectData = { conversation_outbound_log: [logRow] }
    await expect(createMailNewStore().findPriorSend('client-1', REQ, 'contact-1')).rejects.toThrow('boom')
  })

  it('is null when nothing was logged for the request id', async () => {
    state.selectData = { conversation_outbound_log: [] }
    expect(await createMailNewStore().findPriorSend('client-1', REQ, 'contact-1')).toBeNull()
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

describe('Graph calls are time-limited', () => {
  /** A fetch that never answers on its own and only ends when its signal fires (like a hung network call). */
  function hangingFetch() {
    return vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted due to timeout')))
        }),
    )
  }

  it('a send that hangs comes back as "outcome unknown" (the mail may have gone out), not as a failure, and not after minutes', async () => {
    const fetchMock = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await createMailNewGraph({ timeoutMs: 30 }).sendDraft('conn-1', 'draft-1')
    expect(outcome).toBe('unknown')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/me/messages/draft-1/send')
  })

  it('a hung draft delete gives up instead of hanging', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    await expect(createMailNewGraph({ timeoutMs: 30 }).deleteDraft('conn-1', 'draft-1')).resolves.toBeUndefined()
  })

  it.each([
    [202, 'sent'],
    [400, 'rejected'],
    [403, 'rejected'],
    [500, 'unknown'],
    [503, 'unknown'],
  ])('a %i answer to the send is "%s"', async (status, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(status === 202 ? null : 'nope', { status })))
    expect(await createMailNewGraph().sendDraft('conn-1', 'draft-1')).toBe(expected)
  })

  it('the send carries the immutable-id header and the access token', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    await createMailNewGraph().sendDraft('conn-1', 'draft-1')
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token', Prefer: 'IdType="ImmutableId"' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('reading a draft\'s state and creating a draft are time-limited too', async () => {
    const fetchMock = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const graph = createMailNewGraph({ timeoutMs: 30 })
    expect(await graph.isStillDraft('conn-1', 'm1')).toBeNull()
    expect(await graph.createDraft('conn-1', { to: 'a@b.co', subject: 's', body: 'b' })).toMatchObject({ error: expect.any(String) })
  })
})

describe('createMailNewDeps', () => {
  it('has no template gates unless a client is named', () => {
    expect(createMailNewDeps().gates).toBeUndefined()
    expect(createMailNewDeps('client-1').gates).toBeDefined()
  })
})
