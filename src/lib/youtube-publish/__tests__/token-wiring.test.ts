import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
  eqs: [] as Array<[string, unknown]>,
  channelId: 'UC2s7CY2-zLgsECm9fiJ07iA' as string | null,
  tokenForConnection: vi.fn(async (id: string) => `token-of-${id}`),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = (k: string, v: unknown) => { mocks.eqs.push([k, v]); return b }
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mocks.error ? null : mocks.rows, error: mocks.error }).then(resolve)
      return b
    },
  },
}))
vi.mock('../store', () => ({ getClientChannelId: vi.fn(async () => mocks.channelId) }))
vi.mock('@/lib/platform-oauth/token-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform-oauth/token-manager')>()),
  getValidTokenForConnection: mocks.tokenForConnection,
}))

import { getYouTubePublishToken } from '../token'

beforeEach(() => {
  mocks.rows = [{ id: 'conn-1', account_id: 'UC2s7CY2-zLgsECm9fiJ07iA' }]
  mocks.error = null; mocks.eqs = []; mocks.channelId = 'UC2s7CY2-zLgsECm9fiJ07iA'
  mocks.tokenForConnection.mockClear()
})

describe('getYouTubePublishToken —— 真实查询条件(不注入替身)', () => {
  it('🔴 只查本客户、YouTube、有效、purpose=legacy 的授权(少一个条件就会跨客户或取到失效的)', async () => {
    expect(await getYouTubePublishToken('client-xyz')).toBe('token-of-conn-1')
    expect(mocks.eqs).toEqual(expect.arrayContaining([
      ['client_id', 'client-xyz'], ['provider', 'google_youtube'], ['status', 'active'], ['purpose', 'legacy'],
    ]))
  })

  it('查库出错 → 抛明确原因(不伪装成「没连过」)', async () => {
    mocks.error = { message: 'db down' }
    await expect(getYouTubePublishToken('c1')).rejects.toThrow(/YouTube 授权查询失败/)
    expect(mocks.tokenForConnection).not.toHaveBeenCalled()
  })
})

describe('YouTube 发布接线', () => {
  it('🔴 inngest 函数取令牌走 getYouTubePublishToken,不能改回通用的 getValidToken(它按「最新一条」取)', () => {
    const src = readFileSync(join(__dirname, '../../inngest/functions/youtube-publish.ts'), 'utf8')
    expect(src).toMatch(/getYouTubePublishToken\(clientId\)/)
    expect(src).not.toMatch(/\bgetValidToken\s*\(/)
  })
})
