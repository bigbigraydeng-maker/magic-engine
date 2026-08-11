import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import { setGa4Property } from '../property'

function record(table: string, method: string, args: unknown[]) {
  mocks.calls.push({ table, method, args })
}

/** platform_oauth_connections: select().eq().eq().eq().limit().maybeSingle() → {data} */
function connectionsTable(existing: { id: string } | null, updateError: { message: string } | null = null) {
  const readChain: Record<string, unknown> = {}
  ;['select', 'eq', 'limit'].forEach((m) => {
    readChain[m] = vi.fn((...args: unknown[]) => { record('platform_oauth_connections', m, args); return readChain })
  })
  readChain.maybeSingle = vi.fn(() => {
    record('platform_oauth_connections', 'maybeSingle', [])
    return Promise.resolve({ data: existing })
  })

  return {
    select: readChain.select,
    update: vi.fn((...updateArgs: unknown[]) => {
      record('platform_oauth_connections', 'update', updateArgs)
      return {
        eq: vi.fn((...eqArgs: unknown[]) => {
          record('platform_oauth_connections', 'update.eq', eqArgs)
          return Promise.resolve({ error: updateError })
        }),
      }
    }),
  }
}

function connectorsTable() {
  return {
    upsert: vi.fn((...args: unknown[]) => {
      record('client_connectors', 'upsert', args)
      return Promise.resolve({ error: null })
    }),
  }
}

function mockTables(existing: { id: string } | null, updateError: { message: string } | null = null) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'platform_oauth_connections') return connectionsTable(existing, updateError)
    if (table === 'client_connectors') return connectorsTable()
    throw new Error(`unexpected table in test: ${table}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.calls.length = 0
})

describe('setGa4Property', () => {
  it('rejects a malformed property string before touching the DB', async () => {
    const result = await setGa4Property('client-1', 'not-a-property-id')

    expect(result).toEqual({ ok: false, reason: 'invalid' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns not_connected when the client has no active google_ga4 row', async () => {
    mockTables(null)

    const result = await setGa4Property('client-1', 'properties/123')

    expect(result).toEqual({ ok: false, reason: 'not_connected' })
    expect(mocks.calls.some(c => c.table === 'client_connectors')).toBe(false)
  })

  it('updates account_id on the existing active connection when found', async () => {
    mockTables({ id: 'conn-1' })

    const result = await setGa4Property('client-1', 'properties/456')

    expect(result).toEqual({ ok: true })
    const update = mocks.calls.find(c => c.table === 'platform_oauth_connections' && c.method === 'update')
    expect(update?.args[0]).toEqual(expect.objectContaining({ account_id: 'properties/456' }))
    const updateEq = mocks.calls.find(c => c.table === 'platform_oauth_connections' && c.method === 'update.eq')
    expect(updateEq?.args).toEqual(['id', 'conn-1'])
  })

  it(
    '魏征 2026-08-11 复审：也同步写 client_connectors — cron/sync 端点读的是这张表，' +
    '只改 platform_oauth_connections 会出现"界面显示已保存，后台其实还在同步旧 Property"的假状态',
    async () => {
      mockTables({ id: 'conn-1' })

      await setGa4Property('client-1', 'properties/456')

      const connectorWrite = mocks.calls.find(c => c.table === 'client_connectors' && c.method === 'upsert')
      expect(connectorWrite).toBeDefined()
      const [row, opts] = connectorWrite!.args as [Record<string, unknown>, Record<string, unknown>]
      expect(row).toEqual(expect.objectContaining({
        client_id: 'client-1',
        anchor:    'ga4',
        status:    'connected',
        config:    { property_id: 'properties/456' },
      }))
      expect(opts).toEqual(expect.objectContaining({ onConflict: 'client_id,anchor' }))
    },
  )

  it('does NOT look up other clients\' rows — no cross-client exclusivity check (GA4 property sharing is normal, spec §2.4)', async () => {
    mockTables({ id: 'conn-1' })

    await setGa4Property('client-1', 'properties/456')

    // The only platform_oauth_connections calls are: this client's own read
    // (select chain) and this client's own update — never a lookup filtered
    // by a DIFFERENT client_id the way setGbpLocation's clash-check does.
    const poConnCalls = mocks.calls.filter(c => c.table === 'platform_oauth_connections')
    const hasNeqCall = poConnCalls.some(c => c.method === 'eq' && c.args[0] === 'client_id' && c.args[1] !== 'client-1')
    expect(hasNeqCall).toBe(false)
  })

  it('does NOT write client_connectors when the platform_oauth_connections update itself fails', async () => {
    mockTables({ id: 'conn-1' }, { message: 'db timeout' })

    const result = await setGa4Property('client-1', 'properties/456')

    expect(result).toEqual({ ok: false, reason: 'not_connected' })
    expect(mocks.calls.some(c => c.table === 'client_connectors')).toBe(false)
  })
})
