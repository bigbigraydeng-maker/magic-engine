import { describe, expect, it, vi } from 'vitest'
import { PlatformConnectionNotFoundError } from '@/lib/platform-oauth/token-manager'
import { getYouTubePublishToken } from '../token'

const CHANNEL = 'UC2s7CY2-zLgsECm9fiJ07iA'
const OTHER = 'UCmJJDRx88y0IuZXJJQuGNFw'

function deps(over: Partial<Parameters<typeof getYouTubePublishToken>[1]> = {}) {
  return {
    getChannelId: vi.fn(async () => CHANNEL as string | null),
    listActive: vi.fn(async () => [{ id: 'conn-1', account_id: CHANNEL }]),
    tokenForConnection: vi.fn(async (id: string) => `token-of-${id}`),
    ...over,
  }
}

describe('getYouTubePublishToken', () => {
  it('恰好一条且频道对得上 → 用它(原有行为不变)', async () => {
    const d = deps()
    expect(await getYouTubePublishToken('c1', d)).toBe('token-of-conn-1')
    expect(d.tokenForConnection).toHaveBeenCalledWith('conn-1')
  })

  it('🔴 客户没配目标频道 → 拒绝,不挑一条凑合', async () => {
    const d = deps({ getChannelId: vi.fn(async () => null) })
    await expect(getYouTubePublishToken('c1', d)).rejects.toThrow(/还没有配置 YouTube 目标频道/)
    expect(d.tokenForConnection).not.toHaveBeenCalled()
  })

  it('没有任何有效授权 → 和原来一样抛「没找到连接」', async () => {
    const d = deps({ listActive: vi.fn(async () => []) })
    await expect(getYouTubePublishToken('c1', d)).rejects.toBeInstanceOf(PlatformConnectionNotFoundError)
    expect(d.tokenForConnection).not.toHaveBeenCalled()
  })

  it('🔴 多条授权时按目标频道精确选,不取最新的', async () => {
    const d = deps({
      listActive: vi.fn(async () => [
        { id: 'newest-but-wrong', account_id: OTHER },
        { id: 'the-right-one', account_id: CHANNEL },
      ]),
    })
    expect(await getYouTubePublishToken('c1', d)).toBe('token-of-the-right-one')
    expect(d.tokenForConnection).toHaveBeenCalledTimes(1)
    expect(d.tokenForConnection).toHaveBeenCalledWith('the-right-one')
  })

  it('🔴 有授权但没有一条对得上目标频道 → 拒绝,不替别的频道发', async () => {
    const d = deps({ listActive: vi.fn(async () => [{ id: 'x', account_id: OTHER }]) })
    await expect(getYouTubePublishToken('c1', d)).rejects.toThrow(/已授权的 YouTube 频道不是目标频道/)
    expect(d.tokenForConnection).not.toHaveBeenCalled()
  })
})
