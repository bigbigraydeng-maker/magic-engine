/**
 * 客户凭据解析的测试（Issue #1397 PR2）。
 *
 * 这一层唯一的职责是 **fail-closed**：配齐了才给凭据，缺一样就报错停下。
 * 之所以值得单独测，是因为它跟既有的 `getMetaTokenForClient` 有一处
 * 刻意的不同 —— **不回落到共享令牌**。回落对"读广告数据"无害，
 * 对"写成交"则可能把 B 客户的成交写进 A 客户的广告优化里，而且撤不回。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const maybeSingle = vi.fn()
// 实测：mock 按表名分流；platform_oauth_connections 返回空使 DB 查找落空、走 env-var 路径
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'platform_oauth_connections') {
        const c: Record<string, unknown> = {}
        c.select = () => c; c.eq = () => c; c.order = () => c; c.limit = () => c
        c.maybeSingle = async () => ({ data: null, error: null })
        return c
      }
      return { select: () => ({ eq: () => ({ maybeSingle }) }) }
    },
  }),
}))

import { resolveCapiConfig, CapiConfigError, pixelEnvVar, tokenEnvVar } from '../config'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const ENV_KEYS = [
  'META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ',
  'META_PIXEL_ID_CTSTOURS_CO_NZ',
  'META_SYSTEM_USER_TOKEN',
]

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  maybeSingle.mockReset()
  maybeSingle.mockResolvedValue({ data: { id: CLIENT, domain: 'ctstours.co.nz' }, error: null })
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('环境变量命名沿用既有规范', () => {
  it('域名转成 env key 的方式跟令牌那边完全一致', () => {
    expect(tokenEnvVar('ctstours.co.nz')).toBe('META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ')
    expect(pixelEnvVar('ctstours.co.nz')).toBe('META_PIXEL_ID_CTSTOURS_CO_NZ')
    expect(pixelEnvVar('oztopbuildingsupplies.com.au')).toBe(
      'META_PIXEL_ID_OZTOPBUILDINGSUPPLIES_COM_AU',
    )
  })
})

describe('配齐了才给凭据', () => {
  it('令牌 + pixel 都在 → 返回凭据，并带上来源变量名', async () => {
    process.env.META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ = 'tok'
    process.env.META_PIXEL_ID_CTSTOURS_CO_NZ = '1824094338280968'

    const c = await resolveCapiConfig(CLIENT)
    expect(c.pixelId).toBe('1824094338280968')
    expect(c.accessToken).toBe('tok')
    // 来源要带出来：出问题时待办才能告诉人「去配哪个变量」。
    expect(c.source.tokenEnv).toBe('META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ')
  })
})

describe('fail-closed：缺什么就停，绝不猜', () => {
  it('🔴 有共享令牌但没有该客户专属的 → 仍然报错，不回落', async () => {
    // 这是本模块存在的全部理由。
    // 拿共享令牌配这个客户的 pixel，成交可能写进错的广告账户 —— 而 Meta 没有删除端点。
    process.env.META_SYSTEM_USER_TOKEN = '共享令牌'
    process.env.META_PIXEL_ID_CTSTOURS_CO_NZ = '1824094338280968'

    await expect(resolveCapiConfig(CLIENT)).rejects.toThrow(CapiConfigError)
    await expect(resolveCapiConfig(CLIENT)).rejects.toThrow('不回落到共享令牌')
  })

  it('缺 pixel → 报错，并指名该配哪个变量', async () => {
    process.env.META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ = 'tok'
    await expect(resolveCapiConfig(CLIENT)).rejects.toMatchObject({
      missing: 'pixel',
      envHint: 'META_PIXEL_ID_CTSTOURS_CO_NZ',
    })
  })

  it('缺令牌 → 报错，并指名该配哪个变量', async () => {
    process.env.META_PIXEL_ID_CTSTOURS_CO_NZ = '1824094338280968'
    await expect(resolveCapiConfig(CLIENT)).rejects.toMatchObject({
      missing: 'token',
      envHint: 'META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ',
    })
  })

  it('客户没有域名 → 报错（推导不出变量名就不猜）', async () => {
    maybeSingle.mockResolvedValue({ data: { id: CLIENT, domain: null }, error: null })
    await expect(resolveCapiConfig(CLIENT)).rejects.toMatchObject({ missing: 'domain' })
  })

  it('客户不存在 → 报错', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(resolveCapiConfig(CLIENT)).rejects.toMatchObject({ missing: 'client' })
  })

  it('读库失败 → 报错，不当成"没配"', async () => {
    // 把"读不到"和"没配"混为一谈，会让一次数据库抖动看起来像配置缺失。
    maybeSingle.mockResolvedValue({ data: null, error: { message: '连接超时' } })
    await expect(resolveCapiConfig(CLIENT)).rejects.toMatchObject({ missing: 'client' })
  })
})

describe('错误信息不泄露凭据', () => {
  it('报错文案里不含令牌的值', async () => {
    process.env.META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ = 'super-secret-token'
    try {
      await resolveCapiConfig(CLIENT) // 缺 pixel，会抛
      throw new Error('本该抛错')
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret-token')
    }
  })
})
