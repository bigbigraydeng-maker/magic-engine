import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { AGENT_ADS_DENY_TOOL, AGENT_ADS_PRIVILEGED_ACTIONS, AGENT_ADS_SCOPE } from '../agent-ads-scope'
import {
  authorizeAgentAdsKey,
  rejectAgentAdsBearer,
  rejectAgentAdsCapWrite,
  rejectAgentAdsMetaExecute,
} from '../agent-ads-guard'

const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const KEY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RAW_KEY = 'me_live_fixture'

const mockFrom = vi.mocked(supabaseAdmin.from)

function installDb(opts: {
  row?: Record<string, unknown> | null
  lookupError?: { message: string } | null
  insertError?: { message: string } | null
  insertThrows?: boolean
}) {
  const insert = opts.insertThrows
    ? vi.fn().mockRejectedValue(new Error('insert down'))
    : vi.fn().mockResolvedValue({ error: opts.insertError ?? null })
  mockFrom.mockImplementation((table: string) => {
    if (table === 'mcp_access_log') {
      return { insert } as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: opts.row === undefined ? null : opts.row,
        error: opts.lookupError ?? null,
      }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }
    return chain as unknown as ReturnType<typeof supabaseAdmin.from>
  })
  return insert
}

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: KEY_ID,
    client_id: CLIENT_ID,
    scopes: [AGENT_ADS_SCOPE],
    expires_at: '2099-01-01T00:00:00.000Z',
    revoked_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('authorizeAgentAdsKey', () => {
  it('allows a seed read and a draft save without writing a denial', async () => {
    const insert = installDb({ row: agentRow() })
    for (const action of ['plan_seed_read', 'plan_draft_save'] as const) {
      const result = await authorizeAgentAdsKey({ rawKey: RAW_KEY, clientId: CLIENT_ID, action })
      expect(result).toEqual({ ok: true, status: 200, code: 'allowed', logged: false, keyId: KEY_ID })
    }
    expect(insert).not.toHaveBeenCalled()
  })

  it('returns 403 and writes one denial row for each privileged action', async () => {
    for (const action of AGENT_ADS_PRIVILEGED_ACTIONS) {
      const insert = installDb({ row: agentRow() })
      const result = await authorizeAgentAdsKey({
        rawKey: RAW_KEY,
        clientId: CLIENT_ID,
        action,
        resourceId: 'plan_1',
        sourceIp: '203.0.113.9',
      })
      expect(result).toEqual({ ok: false, status: 403, code: action, logged: true })
      expect(insert).toHaveBeenCalledTimes(1)
      const row = insert.mock.calls[0][0] as Record<string, unknown>
      expect(row).toEqual({
        key_kind: 'client',
        client_key_id: KEY_ID,
        client_id: CLIENT_ID,
        tool: AGENT_ADS_DENY_TOOL,
        ok: false,
        error_code: action,
        source_ip: '203.0.113.9',
        resource_id: 'plan_1',
      })
      expect(JSON.stringify(row)).not.toContain(RAW_KEY)
      expect(row).not.toHaveProperty('key_id')
    }
  })

  it('denies a read-all key and a mixed-scope key, and logs the verified key', async () => {
    const readAll = installDb({ row: agentRow({ scopes: ['read:all'] }) })
    const readAllResult = await authorizeAgentAdsKey({ rawKey: RAW_KEY, clientId: CLIENT_ID, action: 'approve' })
    expect(readAllResult).toMatchObject({ status: 403, code: 'wrong_scope', logged: true })
    expect(readAll).toHaveBeenCalledTimes(1)

    const mixed = installDb({ row: agentRow({ scopes: [AGENT_ADS_SCOPE, 'read:all'] }) })
    const mixedResult = await authorizeAgentAdsKey({ rawKey: RAW_KEY, clientId: CLIENT_ID, action: 'plan_seed_read' })
    expect(mixedResult).toMatchObject({ status: 403, code: 'wrong_scope', logged: true })
    expect(mixed).toHaveBeenCalledTimes(1)
  })

  it('denies a cross-client request and records the requested client as the resource', async () => {
    const insert = installDb({ row: agentRow() })
    const result = await authorizeAgentAdsKey({ rawKey: RAW_KEY, clientId: OTHER_ID, action: 'plan_seed_read' })
    expect(result).toMatchObject({ status: 403, code: 'client_mismatch', logged: true })
    expect(insert.mock.calls[0][0]).toMatchObject({ client_id: CLIENT_ID, resource_id: OTHER_ID })
  })

  it('refuses a missing expiry, and does not log a key the lookup will not return', async () => {
    const missing = installDb({ row: agentRow({ expires_at: null }) })
    const missingResult = await authorizeAgentAdsKey({ rawKey: RAW_KEY, clientId: CLIENT_ID, action: 'plan_draft_save' })
    expect(missingResult).toMatchObject({ status: 403, code: 'missing_expiry', logged: true })
    expect(missing).toHaveBeenCalledTimes(1)

    const expired = installDb({ row: agentRow({ expires_at: '2000-01-01T00:00:00.000Z' }) })
    const expiredResult = await authorizeAgentAdsKey({ rawKey: RAW_KEY, clientId: CLIENT_ID, action: 'approve' })
    expect(expiredResult).toEqual({ ok: false, status: 403, code: 'not_found_or_revoked', logged: false })
    expect(expired).not.toHaveBeenCalled()

    const revoked = installDb({ row: null })
    const revokedResult = await authorizeAgentAdsKey({ rawKey: RAW_KEY, clientId: CLIENT_ID, action: 'approve' })
    expect(revokedResult).toEqual({ ok: false, status: 403, code: 'not_found_or_revoked', logged: false })
    expect(revoked).not.toHaveBeenCalled()
  })

  it('returns 503 when the denial row cannot be written', async () => {
    installDb({ row: agentRow(), insertError: { message: 'db down' } })
    const failed = await authorizeAgentAdsKey({ rawKey: RAW_KEY, clientId: CLIENT_ID, action: 'launch' })
    expect(failed).toEqual({ ok: false, status: 503, code: 'audit_unavailable', logged: false })

    installDb({ row: agentRow(), insertThrows: true })
    const thrown = await authorizeAgentAdsKey({ rawKey: RAW_KEY, clientId: CLIENT_ID, action: 'write_meta' })
    expect(thrown).toEqual({ ok: false, status: 503, code: 'audit_unavailable', logged: false })
  })

  it('drops a source address or resource id that cannot be stored safely', async () => {
    const insert = installDb({ row: agentRow() })
    await authorizeAgentAdsKey({
      rawKey: RAW_KEY,
      clientId: CLIENT_ID,
      action: 'approve',
      sourceIp: 'not an ip',
      resourceId: 'has spaces',
    })
    expect(insert.mock.calls[0][0]).toMatchObject({ source_ip: null, resource_id: null })
  })
})

describe('rejectAgentAdsBearer', () => {
  it('ignores a request with no client bearer', async () => {
    const insert = installDb({ row: agentRow() })
    const response = await rejectAgentAdsBearer(new NextRequest('http://localhost/approve'), {
      clientId: CLIENT_ID,
      action: 'approve',
    })
    expect(response).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('ignores a read-all key so the session route can decide', async () => {
    installDb({ row: agentRow({ scopes: ['read:all'] }) })
    const request = new NextRequest('http://localhost/approve', {
      headers: { authorization: `Bearer ${RAW_KEY}` },
    })
    expect(await rejectAgentAdsBearer(request, { clientId: CLIENT_ID, action: 'approve' })).toBeNull()
  })

  it('returns 503 when a client bearer cannot be checked', async () => {
    installDb({ row: null, lookupError: { message: 'db down' } })
    const request = new NextRequest('http://localhost/approve', {
      headers: { authorization: `Bearer ${RAW_KEY}` },
    })
    const response = await rejectAgentAdsBearer(request, { clientId: CLIENT_ID, action: 'approve' })
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toEqual({ error: 'lookup_error', code: 'lookup_error' })
  })

  it('returns 403 for an agent key on a privileged action', async () => {
    const insert = installDb({ row: agentRow() })
    const request = new NextRequest('http://localhost/approve', {
      headers: { authorization: `Bearer ${RAW_KEY}` },
    })
    const response = await rejectAgentAdsBearer(request, { clientId: CLIENT_ID, action: 'approve', resourceId: 'plan_1' })
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({ error: 'forbidden', code: 'approve' })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('classifies Meta execute and cap writes before refusing', async () => {
    const launch = installDb({ row: agentRow() })
    const launchResponse = await rejectAgentAdsMetaExecute(
      new NextRequest('http://localhost/execute', {
        method: 'POST',
        headers: { authorization: `Bearer ${RAW_KEY}` },
        body: JSON.stringify({ action_type: 'ads.reactivate_campaign', campaign_id: 'camp_1' }),
      }),
      CLIENT_ID,
    )
    expect(launchResponse?.status).toBe(403)
    await expect(launchResponse?.json()).resolves.toMatchObject({ code: 'launch' })
    expect(launch.mock.calls[0][0]).toMatchObject({ error_code: 'launch', resource_id: 'camp_1' })

    const budget = installDb({ row: agentRow() })
    const budgetResponse = await rejectAgentAdsMetaExecute(
      new NextRequest('http://localhost/execute', {
        method: 'POST',
        headers: { authorization: `Bearer ${RAW_KEY}` },
        body: JSON.stringify({ action_type: 'ads.adjust_bid', campaign_id: 'camp_2' }),
      }),
      CLIENT_ID,
    )
    await expect(budgetResponse?.json()).resolves.toMatchObject({ code: 'change_budget' })
    expect(budget).toHaveBeenCalledTimes(1)

    const cap = installDb({ row: agentRow() })
    const capResponse = await rejectAgentAdsCapWrite(
      new NextRequest('http://localhost/config', {
        method: 'PATCH',
        headers: { authorization: `Bearer ${RAW_KEY}` },
        body: JSON.stringify({ daily_budget_cap_cents: 100 }),
      }),
      CLIENT_ID,
    )
    await expect(capResponse?.json()).resolves.toMatchObject({ code: 'change_cap' })
    expect(cap).toHaveBeenCalledTimes(1)
  })
})
