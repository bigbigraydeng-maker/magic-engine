/**
 * P34-P3.5 — admin-scoped-queries. Confirms each per-client method scopes by
 * the EXPLICIT client_id arg (admin is cross-client by design), throws on
 * empty clientId, and listAllClients returns the minimal field set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { createAdminQueries } from '../admin-scoped-queries'
import { supabaseAdmin } from '@/lib/supabase'

const CLIENT_ID = 'cccccccc-0000-0000-0000-000000000001'
const mockFrom = vi.mocked(supabaseAdmin.from)

function makeChain(result: { data: unknown; count?: number; error: unknown }) {
  const eqCalls: Array<[string, unknown]> = []
  const chain: Record<string, unknown> = {}
  const ret = () => chain
  chain.select = vi.fn(ret)
  chain.eq = vi.fn((c: string, v: unknown) => { eqCalls.push([c, v]); return chain })
  chain.neq = vi.fn(ret)
  chain.in = vi.fn(ret)
  chain.order = vi.fn(ret)
  chain.limit = vi.fn(ret)
  chain.maybeSingle = vi.fn(() => Promise.resolve(result))
  chain.then = (f: (v: unknown) => unknown) => Promise.resolve(result).then(f)
  return { chain, eqCalls }
}

beforeEach(() => vi.resetAllMocks())

describe('createAdminQueries — explicit client_id scoping', () => {
  it('throws when client_id arg is empty', async () => {
    const q = createAdminQueries()
    await expect(q.getOverview('')).rejects.toThrow()
    await expect(q.listGoals('')).rejects.toThrow()
    await expect(q.getSeoPerformance('')).rejects.toThrow()
    await expect(q.listExecutionItems('')).rejects.toThrow()
  })

  it('listGoals scopes by the passed client_id', async () => {
    const { chain, eqCalls } = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain as never)
    await createAdminQueries().listGoals(CLIENT_ID, 'active')
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
    expect(eqCalls).toContainEqual(['status', 'active'])
  })

  it('getTraffic scopes by the passed client_id + throws on empty arg', async () => {
    await expect(createAdminQueries().getTraffic('')).rejects.toThrow()
    const { chain, eqCalls } = makeChain({ data: [{ total_sessions: 5 }], error: null })
    mockFrom.mockReturnValue(chain as never)
    const res = await createAdminQueries().getTraffic(CLIENT_ID)
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
    // ok-branch contract (魏征 Y2): symmetrical to client version.
    expect(res.status).toBe('ok')
  })

  it('getTraffic returns pending_sync on empty data (魏征 Y2)', async () => {
    const { chain } = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain as never)
    const res = await createAdminQueries().getTraffic(CLIENT_ID)
    expect(res.status).toBe('pending_sync')
  })

  it('getSeoPerformance scopes by client_id + pending_sync on empty', async () => {
    const { chain, eqCalls } = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain as never)
    const res = await createAdminQueries().getSeoPerformance(CLIENT_ID)
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
    expect(res.status).toBe('pending_sync')
  })

  it('listExecutionItems scopes by client_id + groups + excludes skipped', async () => {
    const { chain, eqCalls } = makeChain({
      data: [
        { id: '1', title: 'A', status: 'pending', dimension: 'seo', due_date: null },
        { id: '2', title: 'B', status: 'pending', dimension: 'ads', due_date: null },
      ],
      error: null,
    })
    mockFrom.mockReturnValue(chain as never)
    const res = await createAdminQueries().listExecutionItems(CLIENT_ID)
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
    expect((chain as { neq: ReturnType<typeof vi.fn> }).neq).toHaveBeenCalledWith('status', 'skipped')
    expect(Object.keys(res).sort()).toEqual(['ads', 'seo'])
  })

  it('listAllClients returns minimal field set (no sensitive cols)', async () => {
    const { chain } = makeChain({
      data: [{ id: CLIENT_ID, name: 'CTS', domain: 'ctstours.co.nz', semrush_db: 'nz', created_at: 't' }],
      error: null,
    })
    mockFrom.mockReturnValue(chain as never)
    const res = await createAdminQueries().listAllClients()
    expect(res[0]).toEqual({ id: CLIENT_ID, name: 'CTS', domain: 'ctstours.co.nz', market: 'nz', created_at: 't' })
    // minimal — must not carry portal emails / internal flags
    expect(Object.keys(res[0])).toEqual(['id', 'name', 'domain', 'market', 'created_at'])
  })
})
