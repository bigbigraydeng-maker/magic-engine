import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/marketing-plan/promo/facts', () => ({ loadOwnedAccounts: vi.fn() }))
vi.mock('@/lib/marketing-plan/promo/playbooks', () => ({ resolvePromoPlaybook: vi.fn() }))
vi.mock('@/lib/ads-strategy/promo-draft-facts', () => ({ loadAdsDraftFacts: vi.fn() }))
vi.mock('@/lib/meta/lead-forms', () => ({ fetchPageLeadForms: vi.fn() }))
vi.mock('@/lib/meta/graph-base', () => ({ GRAPH_BASE: 'https://graph.example.test/v99.0' }))
vi.mock('@/lib/meta/page-posts', () => ({ getPageAccessToken: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({
  getStoredPageToken: vi.fn(),
  resolveMetaTokenForClient: vi.fn(async () => ({
    token: 'EAABsecretTOKEN1234567890abcdef',
    source: 'client_db',
  })),
}))

import { graphGetJson, loadScopes, loadPromotePages } from '../deps'
import { resolveMetaTokenForClient } from '@/lib/meta/token-manager'

const TOKEN = 'EAABsecretTOKEN1234567890abcdef'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('plan-seed Meta reads', () => {
  beforeEach(() => {
    vi.mocked(resolveMetaTokenForClient).mockResolvedValue({
      token: TOKEN,
      source: 'client_db',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('HTTP 429 -> failed with rate-limit reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(429, {
          error: { code: 4, message: `EAABsecretTOKEN1234567890abcdef leaked` },
        }),
      ),
    )
    const r = await loadScopes('c1')
    expect(r?.scopes).toEqual({ state: 'failed', reason: 'Meta 限流，稍后再试' })
    expect(r?.scopes.state).not.toBe('empty')
  })

  it('body error code 17 or 613 on a 400 -> rate-limit reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(400, { error: { code: 17 } })),
    )
    const r17 = await loadPromotePages('c1', 'act_1')
    expect(r17).toEqual({ state: 'failed', reason: 'Meta 限流，稍后再试' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(400, { error: { code: 613 } })),
    )
    const r613 = await loadPromotePages('c1', 'act_1')
    expect(r613).toEqual({ state: 'failed', reason: 'Meta 限流，稍后再试' })
  })

  it('code 190 -> token invalid reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(400, { error: { code: 190 } })),
    )
    const r = await graphGetJson('https://graph.example.test/v99.0/x', 'tok')
    expect(r).toEqual({ ok: false, reason: '令牌失效，需要重新连接' })
  })

  it('code 10 -> 缺少权限', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(400, { error: { code: 10 } })),
    )
    const r = await graphGetJson('https://graph.example.test/v99.0/x', 'tok')
    expect(r).toEqual({ ok: false, reason: '缺少权限' })
  })

  it('unknown code -> Meta 接口返回错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(400, { error: { code: 999 } })),
    )
    const r = await graphGetJson('https://graph.example.test/v99.0/x', 'tok')
    expect(r).toEqual({ ok: false, reason: 'Meta 接口返回错误' })
  })

  it('request URL has no access_token and token is sent in Authorization header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { data: [{ permission: 'leads_retrieval', status: 'granted' }] }),
      ),
    )
    await loadScopes('c1')
    const scopesCall = vi.mocked(fetch).mock.calls[0]
    const scopesUrl = String(scopesCall[0])
    expect(scopesUrl).not.toContain('access_token')
    expect(scopesUrl).not.toContain('EAAB')
    const scopesInit = scopesCall[1] as RequestInit
    expect(scopesInit.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { data: [{ id: '1' }] })),
    )
    await loadPromotePages('c1', 'act_1')
    const pagesCall = vi.mocked(fetch).mock.calls[0]
    const pagesUrl = String(pagesCall[0])
    expect(pagesUrl).not.toContain('access_token')
    expect(pagesUrl).not.toContain('EAAB')
    expect(pagesUrl).toContain('limit=100')
    const pagesInit = pagesCall[1] as RequestInit
    expect(pagesInit.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })

  it('promote pages with paging.next -> failed', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        data: [{ id: '1' }],
        paging: { next: 'https://graph.example.test/next?access_token=zzz' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await loadPromotePages('c1', 'act_1')
    expect(r).toEqual({
      state: 'failed',
      reason: '可推广主页超过 100 个，只读了前 100 个',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('promote pages without paging -> ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { data: [{ id: '1' }, { id: '2' }] })),
    )
    const r = await loadPromotePages('c1', 'act_1')
    expect(r).toEqual({ state: 'ok', value: ['1', '2'] })
  })

  it('network error text is never copied into the reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(
          `connect ECONNREFUSED ${TOKEN} at https://x?access_token=${TOKEN}`,
        )
      }),
    )
    const r = await graphGetJson('https://graph.example.test/v99.0/x', 'tok')
    expect(r).toEqual({ ok: false, reason: '网络错误' })
    const serialized = JSON.stringify(r)
    expect(serialized).not.toContain('EAAB')
    expect(serialized).not.toContain('ECONNREFUSED')
  })

  it('timeout -> 读取超时', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('timed out')
        err.name = 'TimeoutError'
        throw err
      }),
    )
    const r = await graphGetJson('https://graph.example.test/v99.0/x', 'tok')
    expect(r).toEqual({ ok: false, reason: '读取超时' })
  })

  it('parse failure of body on an error status still classifies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return {
          ok: false,
          status: 500,
          json: async () => {
            throw new Error('invalid json')
          },
        } as unknown as Response
      }),
    )
    const r = await graphGetJson('https://graph.example.test/v99.0/x', 'tok')
    expect(r).toEqual({ ok: false, reason: 'Meta 接口返回错误' })
  })
})
