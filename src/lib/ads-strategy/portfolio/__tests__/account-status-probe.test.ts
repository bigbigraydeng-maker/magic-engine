import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: { complete: true, rows: [] as unknown[], error: undefined as { message: string } | undefined },
  latest: [] as unknown[],
  latestError: null as string | null,
  insertError: null as string | null,
  inserted: [] as unknown[][],
  fetchAccountSettings: vi.fn(),
}))

vi.mock('@/lib/meta/entity-settings', () => ({
  fetchAccountSettings: (...a: unknown[]) => h.fetchAccountSettings(...a),
}))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn(async () => 'tok') }))
vi.mock('@/lib/meta/client-ad-accounts', () => ({
  getClientAdAccounts: vi.fn(async () => [{ adAccountId: 'act_1', label: null, isPrimary: true }]),
  findSharedAdAccounts: vi.fn(async () => ({ shared: new Set<string>() })),
}))
vi.mock('../snapshot-sync', async () => {
  const real = await vi.importActual<typeof import('../snapshot-sync')>('../snapshot-sync')
  return { ...real, listSnapshotClients: vi.fn(async () => [{ id: 'c-1', name: 'C' }]) }
})
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.gte = () => q
      q.order = () => q
      q.limit = async () => (h.latestError ? { data: null, error: { message: h.latestError } } : { data: h.latest, error: null })
      q.insert = async (rows: unknown[]) => {
        h.inserted.push(rows)
        return { error: h.insertError ? { message: h.insertError } : null }
      }
      return q
    },
  },
}))

import { probeAccountStatus, probeAllAccountStatuses } from '../account-status-probe'
import { normalizeAccount, settingsHash } from '../snapshot'

const NOW = new Date('2026-10-25T03:00:00Z')
const acct = (status: number) => ({ id: 'act_1', name: 'Main', account_status: status, currency: 'NZD', timezone_name: 'Pacific/Auckland' })
const ctx = { clientId: 'c-1', adAccountId: 'act_1', currency: 'NZD', sharedAccount: false }
const prev = (status: number, capturedAt: string) => ({
  level: 'account',
  entity_id: 'act_1',
  capture_reason: 'daily',
  captured_at: capturedAt,
  settings_hash: settingsHash(normalizeAccount(ctx, acct(status) as never)),
})

beforeEach(() => {
  h.settings = { complete: true, rows: [acct(3)], error: undefined }
  h.latest = []
  h.latestError = null
  h.insertError = null
  h.inserted = []
  h.fetchAccountSettings.mockReset()
  h.fetchAccountSettings.mockImplementation(async () => h.settings)
})

describe('probeAccountStatus', () => {
  it('status changed 1 → 3 → writes exactly one account-level changed row', async () => {
    h.latest = [prev(1, '2026-10-25T01:00:00Z')]
    const r = await probeAccountStatus('c-1', 'act_1', 'tok', { shared: false, now: NOW })
    expect(r.state).toBe('written')
    expect(h.inserted).toHaveLength(1)
    expect(h.inserted[0]).toHaveLength(1)
    expect(h.inserted[0][0]).toMatchObject({ level: 'account', account_status: 3, capture_reason: 'changed' })
  })

  it('same status, same day → writes nothing', async () => {
    h.latest = [prev(3, '2026-10-25T01:00:00Z')]
    expect((await probeAccountStatus('c-1', 'act_1', 'tok', { shared: false, now: NOW })).state).toBe('unchanged')
    expect(h.inserted).toHaveLength(0)
  })

  it('same status on a new day → still no write (only changes are written)', async () => {
    h.latest = [prev(3, '2026-10-23T01:00:00Z')]
    expect((await probeAccountStatus('c-1', 'act_1', 'tok', { shared: false, now: NOW })).state).toBe('unchanged')
    expect(h.inserted).toHaveLength(0)
  })

  it('no previous row → first_seen is written', async () => {
    const r = await probeAccountStatus('c-1', 'act_1', 'tok', { shared: false, now: NOW })
    expect(r.state).toBe('written')
    expect(h.inserted[0][0]).toMatchObject({ capture_reason: 'first_seen' })
  })

  it('Meta unreadable → no write, no throw', async () => {
    h.settings = { complete: false, rows: [], error: { message: 'token expired' } }
    const r = await probeAccountStatus('c-1', 'act_1', 'tok', { shared: false, now: NOW })
    expect(r).toMatchObject({ state: 'unreadable', error: 'token expired' })
    expect(h.inserted).toHaveLength(0)
  })

  it('latest-row read fails or insert fails → error result, no throw', async () => {
    h.latestError = 'db down'
    expect((await probeAccountStatus('c-1', 'act_1', 'tok', { shared: false, now: NOW })).state).toBe('error')
    h.latestError = null
    h.insertError = 'rls'
    expect((await probeAccountStatus('c-1', 'act_1', 'tok', { shared: false, now: NOW })).state).toBe('error')
  })

  it('fetch throws → error result, no throw', async () => {
    h.fetchAccountSettings.mockRejectedValue(new Error('network'))
    expect(await probeAccountStatus('c-1', 'act_1', 'tok', { shared: false, now: NOW })).toMatchObject({
      state: 'error',
      error: 'network',
    })
  })
})

describe('probeAllAccountStatuses', () => {
  it('counts written / failed across clients and never throws', async () => {
    const ok = await probeAllAccountStatuses(NOW)
    expect(ok).toMatchObject({ clients: 1, accounts: 1, written: 1, failed: 0 })
    h.settings = { complete: false, rows: [], error: { message: 'x' } }
    const bad = await probeAllAccountStatuses(NOW)
    expect(bad).toMatchObject({ accounts: 1, written: 0, failed: 1 })
  })

  it('rate-limit codes (4/17/613) are counted separately from other unreadable', async () => {
    h.settings = { complete: false, rows: [], error: { message: 'too many calls', code: 17 } as never }
    const r = await probeAllAccountStatuses(NOW)
    expect(r).toMatchObject({ failed: 1, rateLimited: 1, timedOut: false })
    expect(r.results[0]).toMatchObject({ state: 'unreadable', rateLimited: true })
  })

  it('budget exhausted → stops, timedOut=true and error is recorded, never throws', async () => {
    const r = await probeAllAccountStatuses(NOW, 0)
    expect(r).toMatchObject({ accounts: 0, timedOut: true })
    expect(r.error).toContain('timed out')
    expect(h.fetchAccountSettings).not.toHaveBeenCalled()
  })

  it('a hung Meta read is cut off by the budget', async () => {
    h.fetchAccountSettings.mockImplementation(() => new Promise(() => {}))
    const r = await probeAllAccountStatuses(NOW, 30)
    expect(r).toMatchObject({ accounts: 0, timedOut: true })
  })
})
