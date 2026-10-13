import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EMPTY_SETTINGS,
  listMemberEmails,
  listMembers,
  addMember,
  removeMember,
  getSettings,
  saveSettings,
  getPendingPublishRequest,
  upsertPublishRequest,
  markPublishRequestsHandled,
  getClientName,
  reserveAssistantCall,
  recordAssistantCost,
  listChangeActorsSince,
} from '../store-access'

interface FakeDb {
  tables: Record<string, Array<Record<string, unknown>>>
  errors: Record<string, string>
  rpcResults: Record<string, { data: unknown; error: { message: string } | null } | Error>
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
  writes: Array<{
    table: string
    op: 'insert' | 'update' | 'upsert' | 'delete'
    payload?: unknown
    options?: unknown
  }>
}

type Row = Record<string, unknown>

interface QueryState {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  filters: Array<{ column: string; value: unknown; kind: 'eq' | 'is' | 'gt' }>
  order: { column: string; ascending: boolean } | null
  limit: number | null
  maybeSingle: boolean
  payload: unknown
  options: unknown
}

function makeDb(): { db: SupabaseClient; state: FakeDb } {
  const state: FakeDb = {
    tables: {},
    errors: {},
    rpcResults: {},
    rpcCalls: [],
    writes: [],
  }
  let generated = 0

  function tableRows(table: string): Row[] {
    if (!state.tables[table]) state.tables[table] = []
    return state.tables[table]
  }

  function matches(row: Row, filters: QueryState['filters']): boolean {
    for (const filter of filters) {
      const value = row[filter.column]
      if (filter.kind === 'eq') {
        if (value !== filter.value) return false
      } else if (filter.kind === 'is') {
        if (value !== filter.value) return false
      } else {
        if (typeof value !== 'string' || typeof filter.value !== 'string') return false
        if (!(value > filter.value)) return false
      }
    }
    return true
  }

  function applyQuery(query: QueryState): Row[] {
    let rows = tableRows(query.table).filter((row) => matches(row, query.filters))
    if (query.order) {
      const { column, ascending } = query.order
      rows = [...rows].sort((a, b) => {
        const av = String(a[column] ?? '')
        const bv = String(b[column] ?? '')
        if (av < bv) return ascending ? -1 : 1
        if (av > bv) return ascending ? 1 : -1
        return 0
      })
    }
    if (query.limit !== null) {
      rows = rows.slice(0, query.limit)
    }
    return rows
  }

  function keyColumns(options: unknown): string[] {
    if (options !== null && typeof options === 'object' && 'onConflict' in options) {
      const onConflict = (options as { onConflict?: unknown }).onConflict
      if (typeof onConflict === 'string') {
        return onConflict.split(',').map((part) => part.trim())
      }
    }
    return []
  }

  function ignoreDuplicates(options: unknown): boolean {
    if (options !== null && typeof options === 'object' && 'ignoreDuplicates' in options) {
      return (options as { ignoreDuplicates?: unknown }).ignoreDuplicates === true
    }
    return false
  }

  function buildQuery(table: string): Record<string, unknown> {
    const query: QueryState = {
      table,
      op: 'select',
      filters: [],
      order: null,
      limit: null,
      maybeSingle: false,
      payload: undefined,
      options: undefined,
    }

    const builder: Record<string, unknown> = {}

    builder.select = () => builder
    builder.eq = (column: string, value: unknown) => {
      query.filters.push({ column, value, kind: 'eq' })
      return builder
    }
    builder.is = (column: string, value: unknown) => {
      query.filters.push({ column, value, kind: 'is' })
      return builder
    }
    builder.gt = (column: string, value: unknown) => {
      query.filters.push({ column, value, kind: 'gt' })
      return builder
    }
    builder.order = (column: string, options?: { ascending?: boolean }) => {
      query.order = { column, ascending: options?.ascending !== false }
      return builder
    }
    builder.limit = (count: number) => {
      query.limit = count
      return builder
    }
    builder.maybeSingle = () => {
      query.maybeSingle = true
      return builder
    }
    builder.insert = (payload: unknown) => {
      query.op = 'insert'
      query.payload = payload
      return builder
    }
    builder.update = (payload: unknown) => {
      query.op = 'update'
      query.payload = payload
      return builder
    }
    builder.upsert = (payload: unknown, options?: unknown) => {
      query.op = 'upsert'
      query.payload = payload
      query.options = options
      return builder
    }
    builder.delete = () => {
      query.op = 'delete'
      return builder
    }

    builder.then = (
      onFulfilled: (value: { data: unknown; error: { message: string } | null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => {
      const errorMessage = state.errors[table]
      if (errorMessage !== undefined) {
        return Promise.resolve({ data: null, error: { message: errorMessage } }).then(
          onFulfilled,
          onRejected,
        )
      }

      if (query.op === 'select') {
        const rows = applyQuery(query)
        if (query.maybeSingle) {
          return Promise.resolve({ data: rows.length > 0 ? rows[0] : null, error: null }).then(
            onFulfilled,
            onRejected,
          )
        }
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected)
      }

      if (query.op === 'insert') {
        const payload = query.payload
        const rows = Array.isArray(payload) ? payload : [payload]
        for (const row of rows) {
          const record = { ...(row as Row) }
          if (record.id === undefined) {
            generated += 1
            record.id = `gen-${generated}`
          }
          if (record.created_at === undefined) record.created_at = '2026-10-10T00:00:00Z'
          if (record.handled_at === undefined) record.handled_at = null
          tableRows(table).push(record)
        }
        state.writes.push({ table, op: 'insert', payload })
        return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
      }

      if (query.op === 'upsert') {
        const payload = query.payload
        const rows = Array.isArray(payload) ? payload : [payload]
        const keys = keyColumns(query.options)
        const skip = ignoreDuplicates(query.options)
        for (const row of rows) {
          const record = { ...(row as Row) }
          const existing =
            keys.length > 0
              ? tableRows(table).find((candidate) =>
                  keys.every((key) => candidate[key] === record[key]),
                )
              : undefined
          if (existing !== undefined) {
            if (!skip) {
              Object.assign(existing, record)
            }
          } else {
            if (record.id === undefined) {
              generated += 1
              record.id = `gen-${generated}`
            }
            if (record.created_at === undefined) record.created_at = '2026-10-10T00:00:00Z'
            if (record.handled_at === undefined) record.handled_at = null
            tableRows(table).push(record)
          }
        }
        state.writes.push({ table, op: 'upsert', payload, options: query.options })
        return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
      }

      if (query.op === 'update') {
        const patch = query.payload as Row
        for (const row of tableRows(table)) {
          if (matches(row, query.filters)) {
            Object.assign(row, patch)
          }
        }
        state.writes.push({ table, op: 'update', payload: query.payload })
        return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
      }

      // delete
      const remaining = tableRows(table).filter((row) => !matches(row, query.filters))
      state.tables[table] = remaining
      state.writes.push({ table, op: 'delete' })
      return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
    }

    return builder
  }

  const db = {
    from: (table: string) => buildQuery(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })
      const result = state.rpcResults[name]
      if (result instanceof Error) {
        return Promise.reject(result)
      }
      if (result === undefined) {
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve(result)
    },
  }

  return { db: db as unknown as SupabaseClient, state }
}

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
})

describe('listMemberEmails', () => {
  it('returns the lower-cased emails of one client only', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_members = [
      { client_id: 'client-1', email: 'Staff@CTS.Example' },
      { client_id: 'client-1', email: 'other@cts.example' },
      { client_id: 'client-2', email: 'elsewhere@cts.example' },
    ]
    const emails = await listMemberEmails(db, 'client-1')
    expect(emails).toEqual(new Set(['staff@cts.example', 'other@cts.example']))
  })
  it('throws when the table errors', async () => {
    const { db, state } = makeDb()
    state.errors.tour_catalog_members = 'boom'
    await expect(listMemberEmails(db, 'client-1')).rejects.toThrow('boom')
  })
})

describe('listMembers', () => {
  it('maps rows and marks hasLogin for the same client only', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_members = [
      {
        client_id: 'client-1',
        email: 'staff@cts.example',
        granted_by: 'admin@example.com',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        client_id: 'client-1',
        email: 'nologin@cts.example',
        granted_by: 'admin@example.com',
        created_at: '2026-01-02T00:00:00Z',
      },
    ]
    state.tables.client_portal_users = [
      { client_id: 'client-1', email: 'Staff@CTS.Example', access_type: 'dashboard' },
      { client_id: 'client-2', email: 'nologin@cts.example', access_type: 'both' },
    ]
    const members = await listMembers(db, 'client-1')
    expect(members).toEqual([
      {
        email: 'staff@cts.example',
        grantedBy: 'admin@example.com',
        createdAt: '2026-01-01T00:00:00Z',
        hasLogin: true,
      },
      {
        email: 'nologin@cts.example',
        grantedBy: 'admin@example.com',
        createdAt: '2026-01-02T00:00:00Z',
        hasLogin: false,
      },
    ])
  })
  it('hasLogin is true only for access types that can enter the back office', async () => {
    const { db, state } = makeDb()
    const types = ['client', 'dashboard', 'fde', 'both', 'portal', 'self_serve', 'something_new', '']
    state.tables.tour_catalog_members = types.map((type, index) => ({
      client_id: 'client-1',
      email: `m${index}@cts.example`,
      granted_by: 'admin@example.com',
      created_at: `2026-01-0${index + 1}T00:00:00Z`,
    }))
    state.tables.client_portal_users = types.map((type, index) => ({
      client_id: 'client-1',
      email: `m${index}@cts.example`,
      access_type: type,
    }))
    const members = await listMembers(db, 'client-1')
    expect(members.map((member) => member.hasLogin)).toEqual([true, true, true, true, false, false, false, false])
  })

  it('a portal-only row does not hide a second, dashboard row for the same email', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_members = [
      { client_id: 'client-1', email: 'two@cts.example', granted_by: 'admin@example.com', created_at: '2026-01-01T00:00:00Z' },
    ]
    state.tables.client_portal_users = [
      { client_id: 'client-1', email: 'two@cts.example', access_type: 'portal' },
      { client_id: 'client-1', email: 'TWO@cts.example', access_type: 'client' },
    ]
    expect((await listMembers(db, 'client-1'))[0].hasLogin).toBe(true)
  })

  it('still returns members with hasLogin false when the portal lookup errors', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_members = [
      {
        client_id: 'client-1',
        email: 'staff@cts.example',
        granted_by: 'admin@example.com',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    state.errors.client_portal_users = 'portal boom'
    const members = await listMembers(db, 'client-1')
    expect(members).toEqual([
      {
        email: 'staff@cts.example',
        grantedBy: 'admin@example.com',
        createdAt: '2026-01-01T00:00:00Z',
        hasLogin: false,
      },
    ])
    expect(errorSpy).toHaveBeenCalled()
  })
  it('throws when the members table errors', async () => {
    const { db, state } = makeDb()
    state.errors.tour_catalog_members = 'boom'
    await expect(listMembers(db, 'client-1')).rejects.toThrow('boom')
  })
})

describe('addMember', () => {
  it('writes the member row', async () => {
    const { db, state } = makeDb()
    await addMember(db, 'client-1', 'staff@cts.example', 'admin@example.com')
    expect(state.tables.tour_catalog_members).toEqual([
      {
        client_id: 'client-1',
        email: 'staff@cts.example',
        granted_by: 'admin@example.com',
        id: 'gen-1',
        created_at: '2026-10-10T00:00:00Z',
        handled_at: null,
      },
    ])
  })
  it('keeps one row and the first granted_by when adding twice', async () => {
    const { db, state } = makeDb()
    await addMember(db, 'client-1', 'staff@cts.example', 'admin@example.com')
    await addMember(db, 'client-1', 'staff@cts.example', 'other@example.com')
    expect(state.tables.tour_catalog_members).toHaveLength(1)
    expect(state.tables.tour_catalog_members[0].granted_by).toBe('admin@example.com')
  })
  it('throws on error', async () => {
    const { db, state } = makeDb()
    state.errors.tour_catalog_members = 'boom'
    await expect(
      addMember(db, 'client-1', 'staff@cts.example', 'admin@example.com'),
    ).rejects.toThrow('boom')
  })
})

describe('removeMember', () => {
  it('removes only that client row', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_members = [
      { client_id: 'client-1', email: 'staff@cts.example' },
      { client_id: 'client-2', email: 'staff@cts.example' },
    ]
    await removeMember(db, 'client-1', 'staff@cts.example')
    expect(state.tables.tour_catalog_members).toEqual([
      { client_id: 'client-2', email: 'staff@cts.example' },
    ])
  })
})

describe('getSettings', () => {
  it('returns a fresh empty copy when there is no row', async () => {
    const { db } = makeDb()
    const settings = await getSettings(db, 'client-1')
    expect(settings).toEqual({
      logoUrl: null,
      brandPrimary: null,
      brandSecondary: null,
      channelsConnected: false,
      imageHosts: [],
    })
    settings.logoUrl = 'https://changed.example/logo.png'
    expect(EMPTY_SETTINGS.logoUrl).toBeNull()
  })
  it('maps a stored row and treats empty strings as null', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_settings = [
      {
        client_id: 'client-1',
        logo_url: 'https://www.ctstours.co.nz/logo.png',
        brand_primary: '#B61E2E',
        brand_secondary: '',
        channels_connected: true,
      },
    ]
    const settings = await getSettings(db, 'client-1')
    expect(settings).toEqual({
      logoUrl: 'https://www.ctstours.co.nz/logo.png',
      brandPrimary: '#B61E2E',
      brandSecondary: null,
      channelsConnected: true,
      imageHosts: [],
    })
  })
  it('treats a string channels_connected as false', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_settings = [
      {
        client_id: 'client-1',
        logo_url: null,
        brand_primary: null,
        brand_secondary: null,
        channels_connected: 'true',
      },
    ]
    const settings = await getSettings(db, 'client-1')
    expect(settings.channelsConnected).toBe(false)
  })
})

describe('saveSettings', () => {
  it('upserts with the actor and returns the stored values', async () => {
    const { db, state } = makeDb()
    const saved = await saveSettings(
      db,
      'client-1',
      {
        logoUrl: 'https://www.ctstours.co.nz/logo.png',
        brandPrimary: '#B61E2E',
        brandSecondary: '#D6A756',
        channelsConnected: true,
        imageHosts: [],
      },
      'admin@example.com',
    )
    expect(saved).toEqual({
      logoUrl: 'https://www.ctstours.co.nz/logo.png',
      brandPrimary: '#B61E2E',
      brandSecondary: '#D6A756',
      channelsConnected: true,
      imageHosts: [],
    })
    expect(state.tables.tour_catalog_settings).toHaveLength(1)
    expect(state.tables.tour_catalog_settings[0].updated_by).toBe('admin@example.com')
  })
  it('keeps one row when saving twice', async () => {
    const { db, state } = makeDb()
    const base = {
      logoUrl: null,
      brandPrimary: null,
      brandSecondary: null,
      channelsConnected: false,
      imageHosts: [],
    }
    await saveSettings(db, 'client-1', base, 'admin@example.com')
    await saveSettings(
      db,
      'client-1',
      { ...base, channelsConnected: true },
      'admin@example.com',
    )
    expect(state.tables.tour_catalog_settings).toHaveLength(1)
    expect(state.tables.tour_catalog_settings[0].channels_connected).toBe(true)
  })
})

describe('getPendingPublishRequest', () => {
  it('ignores handled rows and other clients and returns the newest open one', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_publish_requests = [
      {
        id: 'old',
        client_id: 'client-1',
        requested_by: 'a@example.com',
        note: 'old',
        created_at: '2026-01-01T00:00:00Z',
        draft_version: 1,
        handled_at: null,
      },
      {
        id: 'new',
        client_id: 'client-1',
        requested_by: 'b@example.com',
        note: 'new',
        created_at: '2026-02-01T00:00:00Z',
        draft_version: 2,
        handled_at: null,
      },
      {
        id: 'handled',
        client_id: 'client-1',
        requested_by: 'c@example.com',
        note: 'handled',
        created_at: '2026-03-01T00:00:00Z',
        draft_version: 3,
        handled_at: '2026-03-02T00:00:00Z',
      },
      {
        id: 'other',
        client_id: 'client-2',
        requested_by: 'd@example.com',
        note: 'other',
        created_at: '2026-04-01T00:00:00Z',
        draft_version: 4,
        handled_at: null,
      },
    ]
    const pending = await getPendingPublishRequest(db, 'client-1')
    expect(pending).toEqual({
      id: 'new',
      requestedBy: 'b@example.com',
      note: 'new',
      createdAt: '2026-02-01T00:00:00Z',
      draftVersion: 2,
    })
  })

  it('returns null when there is none', async () => {
    const { db } = makeDb()
    const pending = await getPendingPublishRequest(db, 'client-1')
    expect(pending).toBeNull()
  })
})

describe('upsertPublishRequest', () => {
  const savedRow = {
    id: 'r-1',
    requested_by: 'a@example.com',
    draft_version: 4,
    note: 'please',
    created_at: '2026-10-10T01:00:00Z',
  }

  it('asks the database once, atomically, and never writes the table itself', async () => {
    const { db, state } = makeDb()
    state.rpcResults.tour_catalog_request_publish = { data: savedRow, error: null }
    const saved = await upsertPublishRequest(db, 'client-1', 'a@example.com', 4, 'please')
    expect(state.rpcCalls).toEqual([
      {
        name: 'tour_catalog_request_publish',
        args: {
          p_client_id: 'client-1',
          p_requested_by: 'a@example.com',
          p_draft_version: 4,
          p_note: 'please',
        },
      },
    ])
    expect(state.writes).toEqual([])
    expect(saved).toEqual({
      id: 'r-1',
      requestedBy: 'a@example.com',
      note: 'please',
      createdAt: '2026-10-10T01:00:00Z',
      draftVersion: 4,
    })
  })

  it('throws the database message when the request is refused', async () => {
    const { db, state } = makeDb()
    state.rpcResults.tour_catalog_request_publish = { data: null, error: { message: 'invalid_actor' } }
    await expect(upsertPublishRequest(db, 'client-1', ' ', 4, '')).rejects.toThrow('invalid_actor')
  })

  it('throws when the database answers without a row', async () => {
    const { db, state } = makeDb()
    state.rpcResults.tour_catalog_request_publish = { data: null, error: null }
    await expect(upsertPublishRequest(db, 'client-1', 'a@example.com', 4, '')).rejects.toThrow(
      'publish_request_not_saved',
    )
  })
})

describe('markPublishRequestsHandled', () => {
  it('marks only that client open rows and clears the pending lookup', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_publish_requests = [
      {
        id: 'r1',
        client_id: 'client-1',
        requested_by: 'a@example.com',
        note: 'n',
        created_at: '2026-01-01T00:00:00Z',
        draft_version: 1,
        handled_at: null,
      },
      {
        id: 'r2',
        client_id: 'client-2',
        requested_by: 'b@example.com',
        note: 'n',
        created_at: '2026-01-01T00:00:00Z',
        draft_version: 1,
        handled_at: null,
      },
    ]
    await markPublishRequestsHandled(db, 'client-1', 7)
    const clientOne = state.tables.tour_catalog_publish_requests.find(
      (row) => row.id === 'r1',
    )
    expect(clientOne?.handled_at).not.toBeNull()
    expect(clientOne?.handled_version).toBe(7)
    const clientTwo = state.tables.tour_catalog_publish_requests.find(
      (row) => row.id === 'r2',
    )
    expect(clientTwo?.handled_at).toBeNull()

    const pending = await getPendingPublishRequest(db, 'client-1')
    expect(pending).toBeNull()
  })

  it('throws on error', async () => {
    const { db, state } = makeDb()
    state.errors.tour_catalog_publish_requests = 'boom'
    await expect(markPublishRequestsHandled(db, 'client-1', 7)).rejects.toThrow('boom')
  })
})

describe('getClientName', () => {
  it('returns the name', async () => {
    const { db, state } = makeDb()
    state.tables.clients = [{ id: 'client-1', name: 'CTS Tours' }]
    expect(await getClientName(db, 'client-1')).toBe('CTS Tours')
  })

  it('returns an empty string when the row is missing', async () => {
    const { db } = makeDb()
    expect(await getClientName(db, 'client-1')).toBe('')
  })

  it('returns an empty string and does not throw when the query errors', async () => {
    const { db, state } = makeDb()
    state.errors.clients = 'boom'
    expect(await getClientName(db, 'client-1')).toBe('')
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('reserveAssistantCall', () => {
  const limits = { userDaily: 10, clientDaily: 100, clientDailyCostUsd: 5 }

  it('maps the rpc result to a reservation', async () => {
    const { db, state } = makeDb()
    state.rpcResults.tour_catalog_assistant_reserve = { data: true, error: null }
    expect(await reserveAssistantCall(db, 'client-1', '2026-10-10', 'a@example.com', limits)).toBe(
      'ok',
    )

    state.rpcResults.tour_catalog_assistant_reserve = { data: false, error: null }
    expect(await reserveAssistantCall(db, 'client-1', '2026-10-10', 'a@example.com', limits)).toBe(
      'limit',
    )

    state.rpcResults.tour_catalog_assistant_reserve = { data: null, error: null }
    expect(await reserveAssistantCall(db, 'client-1', '2026-10-10', 'a@example.com', limits)).toBe(
      'limit',
    )

    state.rpcResults.tour_catalog_assistant_reserve = { data: 'true', error: null }
    expect(await reserveAssistantCall(db, 'client-1', '2026-10-10', 'a@example.com', limits)).toBe(
      'limit',
    )
  })

  it('returns error on an rpc error or rejection', async () => {
    const { db, state } = makeDb()
    state.rpcResults.tour_catalog_assistant_reserve = {
      data: null,
      error: { message: 'boom' },
    }
    expect(await reserveAssistantCall(db, 'client-1', '2026-10-10', 'a@example.com', limits)).toBe(
      'error',
    )

    state.rpcResults.tour_catalog_assistant_reserve = new Error('boom')
    expect(await reserveAssistantCall(db, 'client-1', '2026-10-10', 'a@example.com', limits)).toBe(
      'error',
    )
  })

  it('passes the limits through to the rpc', async () => {
    const { db, state } = makeDb()
    state.rpcResults.tour_catalog_assistant_reserve = { data: true, error: null }
    await reserveAssistantCall(db, 'client-1', '2026-10-10', 'a@example.com', limits)
    expect(state.rpcCalls).toEqual([
      {
        name: 'tour_catalog_assistant_reserve',
        args: {
          p_client_id: 'client-1',
          p_day: '2026-10-10',
          p_email: 'a@example.com',
          p_user_limit: 10,
          p_client_limit: 100,
          p_cost_limit: 5,
        },
      },
    ])
  })
})

describe('recordAssistantCost', () => {
  it('passes the cost through to the rpc', async () => {
    const { db, state } = makeDb()
    await recordAssistantCost(db, 'client-1', '2026-10-10', 'a@example.com', 0.25)
    expect(state.rpcCalls).toEqual([
      {
        name: 'tour_catalog_assistant_record_cost',
        args: {
          p_client_id: 'client-1',
          p_day: '2026-10-10',
          p_email: 'a@example.com',
          p_cost: 0.25,
        },
      },
    ])
  })

  it('clamps negative, NaN and Infinity to zero', async () => {
    const { db, state } = makeDb()
    await recordAssistantCost(db, 'client-1', '2026-10-10', 'a@example.com', -1)
    await recordAssistantCost(db, 'client-1', '2026-10-10', 'a@example.com', Number.NaN)
    await recordAssistantCost(db, 'client-1', '2026-10-10', 'a@example.com', Number.POSITIVE_INFINITY)
    expect(state.rpcCalls.map((call) => call.args.p_cost)).toEqual([0, 0, 0])
  })

  it('never throws when the rpc errors or rejects', async () => {
    const { db, state } = makeDb()
    state.rpcResults.tour_catalog_assistant_record_cost = {
      data: null,
      error: { message: 'boom' },
    }
    await expect(
      recordAssistantCost(db, 'client-1', '2026-10-10', 'a@example.com', 1),
    ).resolves.toBeUndefined()

    state.rpcResults.tour_catalog_assistant_record_cost = new Error('boom')
    await expect(
      recordAssistantCost(db, 'client-1', '2026-10-10', 'a@example.com', 1),
    ).resolves.toBeUndefined()
  })
})

describe('listChangeActorsSince', () => {
  it('returns actors newest first for that client', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_change_log = [
      { client_id: 'client-1', actor: 'old@example.com', created_at: '2026-01-01T00:00:00Z' },
      { client_id: 'client-1', actor: 'new@example.com', created_at: '2026-03-01T00:00:00Z' },
      { client_id: 'client-2', actor: 'other@example.com', created_at: '2026-04-01T00:00:00Z' },
    ]
    const actors = await listChangeActorsSince(db, 'client-1', null)
    expect(actors).toEqual(['new@example.com', 'old@example.com'])
  })

  it('filters by since', async () => {
    const { db, state } = makeDb()
    state.tables.tour_catalog_change_log = [
      { client_id: 'client-1', actor: 'old@example.com', created_at: '2026-01-01T00:00:00Z' },
      { client_id: 'client-1', actor: 'new@example.com', created_at: '2026-03-01T00:00:00Z' },
    ]
    const actors = await listChangeActorsSince(db, 'client-1', '2026-02-01T00:00:00Z')
    expect(actors).toEqual(['new@example.com'])
  })

  it('throws on error', async () => {
    const { db, state } = makeDb()
    state.errors.tour_catalog_change_log = 'boom'
    await expect(listChangeActorsSince(db, 'client-1', null)).rejects.toThrow('boom')
  })
})
