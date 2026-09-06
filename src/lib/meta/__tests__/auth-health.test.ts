/**
 * Meta 授权体检的判据。
 *
 * 这个文件守两件容易悄悄坏掉的事：
 *
 * 1. **问不到 Meta 绝不能算成没问题**（fail-closed）。这是整个功能的意义所在 ——
 *    如果「问不到」塌成「健康」，那这条 cron 就是每天生成一份假的安心报告。
 * 2. **公共兜底令牌不许让客户看起来是健康的**。拿全局那条
 *    `META_SYSTEM_USER_TOKEN` 去探客户 A 的主页，探通了只证明「某个身份能访问
 *    它」，不证明 A 自己有授权 —— 那会让一个从未授权的客户天天显示正常。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/meta/token-manager', () => ({
  getStoredPageToken: vi.fn(),
  domainToEnvKey: (d: string) => d.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
  pageIdToEnvVar: (p: string) => `META_SYSTEM_USER_TOKEN_PAGE_${p.replace(/[^A-Za-z0-9]/g, '_')}`,
}))
vi.mock('@/lib/meta-oauth/client', () => ({
  getStoredPageToken: undefined,
  listGrantedScopes: vi.fn(),
  META_PAGE_SCOPES: ['pages_show_list', 'pages_manage_posts', 'leads_retrieval'] as const,
}))

import { checkMetaAuth, needsHuman, isHealthy, META_AUTH_HEALTH_JOB, type MetaAuthHealth } from '../auth-health'
import { getStoredPageToken } from '@/lib/meta/token-manager'
import { listGrantedScopes } from '@/lib/meta-oauth/client'

const mockStored = vi.mocked(getStoredPageToken)
const mockScopes = vi.mocked(listGrantedScopes)

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OTHER_CLIENT = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const PAGE = '1616575215312482'
const NOW = new Date('2026-09-04T00:00:00Z')

const ALL_SCOPES = ['pages_show_list', 'pages_manage_posts', 'leads_retrieval']

/** 只对 platform_oauth_connections 建模 —— 别的表被碰到就炸，暴露越界读取。 */
function fakeSupabase(row: Record<string, unknown> | null, spy?: (f: Record<string, unknown>) => void) {
  return {
    from(table: string) {
      if (table !== 'platform_oauth_connections') {
        throw new Error(`fake supabase: table '${table}' is not modelled`)
      }
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => {
        filters[col] = val
        return chain
      }
      chain.order = () => chain
      chain.limit = () => chain
      chain.maybeSingle = () => {
        spy?.(filters)
        return Promise.resolve({ data: row, error: null })
      }
      return chain
    },
  } as never
}

function okFetch(): typeof fetch {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: PAGE, name: 'CTS Tours' }) }) as never
}
function rejectFetch(message: string, status = 400): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: { message, code: 190 } }),
  }) as never
}

const ENV_KEYS = [
  'META_SYSTEM_USER_TOKEN',
  'META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ',
  `META_SYSTEM_USER_TOKEN_PAGE_${PAGE}`,
]
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {}
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  mockStored.mockResolvedValue(null)
  mockScopes.mockResolvedValue(ALL_SCOPES)
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.clearAllMocks()
})

function input(over: Record<string, unknown> = {}) {
  return { clientId: CLIENT, pageId: PAGE, domain: 'ctstours.co.nz', ...over } as never
}

describe('运行记录名字', () => {
  it('🔴 常量与 cron 路由里的字面量同值 —— 待办查的 job_name 必须等于日志里写的', () => {
    // 路由为了静态对账用字面量 startCronRun('meta-auth-health')；待办层用这个常量
    // 查同一批记录。两者一旦漂移，待办会查一个没人写的名字、永远空。
    expect(META_AUTH_HEALTH_JOB).toBe('meta-auth-health')
  })
})

describe('健康的那一种', () => {
  it('存下来的主页授权能读到主页、权限齐全 → ok', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const h = await checkMetaAuth(fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }), input(), {
      now: NOW,
      fetcher: okFetch(),
    })
    expect(h.state).toBe('ok')
    expect(h.token_source).toBe('stored_connection')
    expect(isHealthy(h)).toBe(true)
    expect(needsHuman(h)).toBe(false)
    expect(h.checked_at).toBe(NOW.toISOString())
  })

  it('存下来的授权用记录里的权限清单，不去问 /me/permissions（那是用户令牌才有的东西）', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    await checkMetaAuth(fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }), input(), {
      now: NOW,
      fetcher: okFetch(),
    })
    expect(mockScopes).not.toHaveBeenCalled()
  })

  it('走环境变量那条时才问 Meta 现在还剩哪些权限', async () => {
    process.env.META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ = 'env-user-token'
    const h = await checkMetaAuth(fakeSupabase(null), input(), { now: NOW, fetcher: okFetch() })
    expect(h.token_source).toBe('client_env')
    expect(mockScopes).toHaveBeenCalledWith('env-user-token')
    expect(h.state).toBe('ok')
  })
})

describe('🔴 fail-closed —— 问不到不许算成没问题', () => {
  it('Meta 回 5xx → unknown，而且要有人看见', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const h = await checkMetaAuth(fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }), input(), {
      now: NOW,
      fetcher: rejectFetch('Internal error', 500),
    })
    expect(h.state).toBe('unknown')
    expect(isHealthy(h)).toBe(false)
    expect(needsHuman(h)).toBe(true)
  })

  it('网络整个抛异常 → unknown', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const boom = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as never
    const h = await checkMetaAuth(fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }), input(), {
      now: NOW,
      fetcher: boom,
    })
    expect(h.state).toBe('unknown')
    expect(h.provider_error).toContain('ECONNRESET')
  })

  it('令牌能读主页但权限清单问不出来 → unknown，不许当成「权限齐全」', async () => {
    process.env.META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ = 'env-user-token'
    mockScopes.mockResolvedValue(null)
    const h = await checkMetaAuth(fakeSupabase(null), input(), { now: NOW, fetcher: okFetch() })
    expect(h.state).toBe('unknown')
    expect(h.granted_scopes).toBeNull()
  })

  it('权限「问不到」和「一个都没有」是两件事', async () => {
    process.env.META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ = 'env-user-token'
    mockScopes.mockResolvedValue([])
    const h = await checkMetaAuth(fakeSupabase(null), input(), { now: NOW, fetcher: okFetch() })
    expect(h.state).toBe('scope_missing')
    expect(h.granted_scopes).toEqual([])
    expect(h.missing_scopes).toEqual(ALL_SCOPES)
  })

  it('🔴 HTTP 200 但返回体不是这张主页（代理错误页 / 登录墙）→ unknown，不许塌成健康', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const htmlErrorPage = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => null }) as never
    const h = await checkMetaAuth(
      fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }),
      input(),
      { now: NOW, fetcher: htmlErrorPage },
    )
    expect(h.state).toBe('unknown')
  })

  it('🔴 HTTP 200 但 id 是别的主页 → unknown，不认作这张主页活着', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const wrongPage = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '999999999', name: '别人的主页' }),
    }) as never
    const h = await checkMetaAuth(
      fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }),
      input(),
      { now: NOW, fetcher: wrongPage },
    )
    expect(h.state).toBe('unknown')
  })
})

describe('🔴 隔离 —— 公共兜底令牌不许让客户看起来健康', () => {
  it('只有全局那条 META_SYSTEM_USER_TOKEN 时报 no_token，绝不拿它去探', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'shared-token-for-everyone'
    const fetcher = okFetch()
    const h = await checkMetaAuth(fakeSupabase(null), input(), { now: NOW, fetcher })
    expect(h.state).toBe('no_token')
    expect(h.token_source).toBe('none')
    // 一次 Graph 调用都不该发生 —— 发了就说明我们拿公共令牌去替客户作证了
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('查授权记录必须同时按 client_id / provider / 这个主页三个条件过滤', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    let seen: Record<string, unknown> = {}
    await checkMetaAuth(
      fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }, (f) => {
        seen = f
      }),
      input(),
      { now: NOW, fetcher: okFetch() },
    )
    expect(seen).toEqual({ client_id: CLIENT, provider: 'meta', account_id: PAGE })
  })

  it('每个客户只用自己的令牌 —— 结果里的 client_id 就是传进来的那个', async () => {
    mockStored.mockImplementation(async (clientId: string) =>
      clientId === CLIENT ? 'cts-token' : 'oztop-token',
    )
    const fetcher = okFetch()
    await checkMetaAuth(fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }), input(), {
      now: NOW,
      fetcher,
    })
    const url = String((fetcher as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
    expect(url).toContain('cts-token')
    expect(url).not.toContain('oztop-token')

    const other = await checkMetaAuth(
      fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }),
      input({ clientId: OTHER_CLIENT }),
      { now: NOW, fetcher: okFetch() },
    )
    expect(other.client_id).toBe(OTHER_CLIENT)
  })
})

describe('坏掉的那几种', () => {
  it('Meta 明确拒了令牌 → rejected，并带上 Meta 的原话', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const h = await checkMetaAuth(fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: null }), input(), {
      now: NOW,
      fetcher: rejectFetch('Error validating access token: Session has expired'),
    })
    expect(h.state).toBe('rejected')
    expect(h.provider_error).toContain('Session has expired')
  })

  it('缺权限 → scope_missing，并列出缺的是哪几项', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const h = await checkMetaAuth(
      fakeSupabase({ scopes: ['pages_show_list'], status: 'active', token_expiry: null }),
      input(),
      { now: NOW, fetcher: okFetch() },
    )
    expect(h.state).toBe('scope_missing')
    expect(h.missing_scopes).toEqual(['pages_manage_posts', 'leads_retrieval'])
  })

  it('🔴 记录说已撤销，但令牌实测还能读 → 仍报 rejected，不让一次侥幸盖掉记录', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const h = await checkMetaAuth(
      fakeSupabase({ scopes: ALL_SCOPES, status: 'revoked', token_expiry: null }),
      input(),
      { now: NOW, fetcher: okFetch() },
    )
    expect(h.state).toBe('rejected')
    expect(h.connection_status).toBe('revoked')
  })

  it('🔴 记录上的到期时间已过 → rejected（手工令牌 60 天到期就是这么悄悄坏的）', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const h = await checkMetaAuth(
      fakeSupabase({ scopes: ALL_SCOPES, status: 'active', token_expiry: '2026-09-01T00:00:00Z' }),
      input(),
      { now: NOW, fetcher: okFetch() },
    )
    expect(h.state).toBe('rejected')
    expect(h.provider_error).toContain('2026-09-01')
  })

  it('没登记主页 → no_page，而且不下发（客户压根没打算连 Facebook）', async () => {
    const h = await checkMetaAuth(fakeSupabase(null), input({ pageId: null }), { now: NOW, fetcher: okFetch() })
    expect(h.state).toBe('no_page')
    expect(needsHuman(h)).toBe(false)
    expect(isHealthy(h)).toBe(false)
  })

  it('授权记录还在但取不出令牌时，把记录状态说出来', async () => {
    const h = await checkMetaAuth(
      fakeSupabase({ scopes: [], status: 'error', token_expiry: null }),
      input(),
      { now: NOW, fetcher: okFetch() },
    )
    expect(h.state).toBe('no_token')
    expect(h.provider_error).toContain('error')
  })

  it('读授权记录本身挂了不许带崩体检', async () => {
    mockStored.mockResolvedValue('stored-page-token')
    const broken = {
      from() {
        throw new Error('db down')
      },
    } as never
    const h: MetaAuthHealth = await checkMetaAuth(broken, input(), { now: NOW, fetcher: okFetch() })
    // 记录读不到 → 没有权限清单可比 → fail-closed
    expect(h.state).toBe('unknown')
  })
})
