import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
  calls: [] as Array<[string, ...unknown[]]>,
  needsRefresh: vi.fn(() => false),
  refreshTokens: vi.fn(),
}))

function builder() {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'update']) {
    b[m] = (...args: unknown[]) => { mocks.calls.push([m, ...args]); return b }
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: mocks.error ? null : mocks.rows, error: mocks.error }).then(resolve)
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => builder() } }))
vi.mock('@/lib/platform-oauth/vocabulary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform-oauth/vocabulary')>()),
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))
vi.mock('@/lib/tiktok-oauth/client', () => ({
  needsRefresh: mocks.needsRefresh,
  refreshTokens: mocks.refreshTokens,
}))

import { getValidTikTokToken, TikTokAmbiguousConnectionError } from './token'

const row = (id: string, openId: string, extra: Record<string, unknown> = {}) => ({
  id, account_id: openId, access_token_enc: `enc:access-${id}`, refresh_token_enc: `enc:refresh-${id}`,
  token_expiry: '2099-01-01T00:00:00Z', ...extra,
})

beforeEach(() => {
  mocks.rows = []; mocks.error = null; mocks.calls = []
  mocks.needsRefresh.mockReset().mockReturnValue(false)
  mocks.refreshTokens.mockReset()
})

describe('getValidTikTokToken', () => {
  it('没有授权 → null(调用方按「没连过」处理)', async () => {
    expect(await getValidTikTokToken('c1')).toBeNull()
  })

  it('查库出错 → null(不当成有授权)', async () => {
    mocks.error = { message: 'db down' }
    expect(await getValidTikTokToken('c1')).toBeNull()
  })

  it('恰好一条有效授权 → 用它', async () => {
    mocks.rows = [row('a', 'open-a')]
    expect(await getValidTikTokToken('c1')).toEqual({ accessToken: 'access-a', openId: 'open-a' })
  })

  it('🔴 同一客户有两条有效授权 → 拒绝(不取最新),且不刷新、不写库', async () => {
    mocks.rows = [row('a', 'open-a'), row('b', 'open-b')]
    await expect(getValidTikTokToken('c1')).rejects.toBeInstanceOf(TikTokAmbiguousConnectionError)
    expect(mocks.refreshTokens).not.toHaveBeenCalled()
    expect(mocks.calls.some(([m]) => m === 'update')).toBe(false)
  })

  it('🔴 多条授权时拒绝,即使其中一条已过期需要刷新(不会替错的账号去换新令牌)', async () => {
    mocks.needsRefresh.mockReturnValue(true)
    mocks.rows = [row('a', 'open-a', { token_expiry: '2000-01-01T00:00:00Z' }), row('b', 'open-b')]
    await expect(getValidTikTokToken('c1')).rejects.toBeInstanceOf(TikTokAmbiguousConnectionError)
    expect(mocks.refreshTokens).not.toHaveBeenCalled()
  })

  it('🔴 提示文案是人话,且不含 token 字样(否则会被翻成「重新点连接 TikTok」)', () => {
    const msg = new TikTokAmbiguousConnectionError().message
    expect(msg).toBe('存在多个 TikTok 授权,已暂停发布,请联系团队核实')
    expect(msg).not.toMatch(/token/i)
  })

  it('只查本客户、TikTok、有效的授权,且不再按创建时间取最新', async () => {
    mocks.rows = [row('a', 'open-a')]
    await getValidTikTokToken('client-xyz')
    const eqs = mocks.calls.filter(([m]) => m === 'eq').map(([, k, v]) => `${k}=${v}`)
    expect(eqs).toEqual(expect.arrayContaining(['client_id=client-xyz', 'provider=tiktok', 'status=active']))
    expect(mocks.calls.some(([m]) => m === 'order')).toBe(false)
    // 必须多取一条才看得出「有多条」;改成 limit(1) 会悄悄回到「取一条就用」
    expect(mocks.calls.find(([m]) => m === 'limit')?.[1]).toBe(2)
  })

  it('唯一一条已过期 → 用刷新令牌换新并存回(原有行为不变)', async () => {
    mocks.needsRefresh.mockReturnValue(true)
    mocks.rows = [row('a', 'open-a', { token_expiry: '2000-01-01T00:00:00Z' })]
    mocks.refreshTokens.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 86400, openId: 'open-a' })
    expect(await getValidTikTokToken('c1')).toEqual({ accessToken: 'new-access', openId: 'open-a' })
    expect(mocks.refreshTokens).toHaveBeenCalledWith('refresh-a')
    expect(mocks.calls.filter(([m]) => m === 'update')).toHaveLength(1)
    expect(mocks.calls.some(([m, k, v]) => m === 'eq' && k === 'id' && v === 'a')).toBe(true)
  })
})
