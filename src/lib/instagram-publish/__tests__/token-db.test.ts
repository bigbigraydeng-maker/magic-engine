import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  result: { data: [] as unknown, error: null as unknown },
  second: null as null | { data: unknown; error: unknown },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => {
    mocks.calls.push(['from', table])
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'update', 'eq', 'limit']) b[m] = (...a: unknown[]) => { mocks.calls.push([m, ...a]); return b }
    const isUpdate = () => mocks.calls.some(c => c[0] === 'update')
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(isUpdate() && mocks.second ? mocks.second : mocks.result).then(resolve)
    return b
  } },
}))
vi.mock('@/lib/platform-oauth/vocabulary', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/platform-oauth/vocabulary')>()),
  decryptToken: (v: string) => v.replace('enc:', ''), encryptToken: (v: string) => `enc:${v}`,
}))

import { getInstagramPublishToken } from '../token'

const BOTH = ['instagram_business_basic', 'instagram_business_content_publish']
beforeEach(() => { mocks.calls = []; mocks.second = null; vi.stubEnv('INSTAGRAM_PUBLISH_ENABLED', 'true') })

describe('default database access', () => {
  it('🔴 reads only this client\'s active legacy Instagram rows (max 2) and never selects the refresh column', async () => {
    mocks.result = { data: [{ id: 'c1', account_id: '987654321098765432', access_token_enc: 'enc:v',
      token_expiry: new Date(Date.now() + 40 * 864e5).toISOString(), scopes: BOTH }], error: null }
    expect(await getInstagramPublishToken('client-1')).toEqual({ accessToken: 'v', accountId: '987654321098765432' })
    expect(mocks.calls).toEqual([
      ['from', 'platform_oauth_connections'],
      ['select', 'id, account_id, access_token_enc, token_expiry, scopes'],
      ['eq', 'client_id', 'client-1'], ['eq', 'provider', 'instagram'], ['eq', 'purpose', 'legacy'], ['eq', 'status', 'active'],
      ['limit', 2],
    ])
  })
  it('🔴 renewal write is locked to the row id AND the expiry that was read, and counts rows', async () => {
    const expiry = new Date(Date.now() + 3 * 864e5).toISOString()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'renewed', token_type: 'bearer', expires_in: 5184000 }) })))
    mocks.result = { data: [{ id: 'c1', account_id: '987654321098765432', access_token_enc: 'enc:v', token_expiry: expiry, scopes: BOTH }], error: null }
    mocks.second = { data: [{ id: 'c1' }], error: null } // the update's reply; the list query gets mocks.result
    const out = await getInstagramPublishToken('client-1')
    expect(out.accessToken).toBe('renewed')
    const update = mocks.calls.findIndex(c => c[0] === 'update')
    expect(mocks.calls.slice(update)).toEqual([
      ['update', expect.objectContaining({ access_token_enc: 'enc:renewed', token_expiry: expect.any(String) })],
      ['eq', 'id', 'c1'], ['eq', 'token_expiry', expiry], ['select', 'id'],
    ])
    vi.unstubAllGlobals()
  })
})
