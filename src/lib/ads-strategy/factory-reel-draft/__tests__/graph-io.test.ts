import { describe, expect, it, vi } from 'vitest'
import { GRAPH_BASE } from '@/lib/meta/graph-base'
import {
  createGraphGet,
  GRAPH_READ_TIMEOUT_MS,
  probeMetaToken,
  type FetchLike,
} from '../graph-io'

interface FakeResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

function textResponse(text: string, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  }
}

const TOKEN = 'SECRET_TOKEN_abc123'

describe('createGraphGet', () => {
  it('builds the exact URL with path, query and access_token, and passes method GET + signal', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ data: [] }))
    const graphGet = createGraphGet(fetchImpl, TOKEN)

    await graphGet('/123/published_posts', { fields: 'id,created_time', limit: '25' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]

    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe(`${GRAPH_BASE}/123/published_posts`)
    expect(parsed.searchParams.get('fields')).toBe('id,created_time')
    expect(parsed.searchParams.get('limit')).toBe('25')
    expect(parsed.searchParams.get('access_token')).toBe(TOKEN)

    expect(init?.method).toBe('GET')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns ok/status/body for a JSON response', async () => {
    const payload = { data: [{ id: '1_2' }] }
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(payload))
    const graphGet = createGraphGet(fetchImpl, TOKEN)

    const result = await graphGet('/123/published_posts', {})

    expect(result).toEqual({ ok: true, status: 200, body: payload })
  })

  it('returns body null for non-JSON text', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => textResponse('not json at all'))
    const graphGet = createGraphGet(fetchImpl, TOKEN)

    const result = await graphGet('/123/published_posts', {})

    expect(result).toEqual({ ok: true, status: 200, body: null })
  })

  it('passes through ok false with status 400', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ error: 'bad' }, 400))
    const graphGet = createGraphGet(fetchImpl, TOKEN)

    const result = await graphGet('/123/published_posts', {})

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  })

  it('rethrows a fixed Chinese message that does not contain the token', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error(`request failed for https://graph.facebook.com/x?access_token=${TOKEN}`)
    })
    const graphGet = createGraphGet(fetchImpl, TOKEN)

    let caught: unknown
    try {
      await graphGet('/123/published_posts', {})
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).toBe('读取 Meta 失败（网络或超时）')
    expect(message).not.toContain(TOKEN)
  })

  it('uses the configured read timeout', () => {
    expect(GRAPH_READ_TIMEOUT_MS).toBe(15_000)
  })
})

describe('probeMetaToken', () => {
  it('returns ok true for a valid token with ads_management', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { is_valid: true, scopes: ['ads_management'], expires_at: 0 } }),
    )

    const result = await probeMetaToken(fetchImpl, TOKEN)

    expect(result).toEqual({ ok: true })
  })

  it('returns 令牌已失效 when is_valid is false', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { is_valid: false, scopes: ['ads_management'] } }),
    )

    const result = await probeMetaToken(fetchImpl, TOKEN)

    expect(result.ok).toBe(false)
    expect(result.detail).toBe('令牌已失效')
  })

  it('returns missing-scope message when ads_management is absent', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { is_valid: true, scopes: ['public_profile'] } }),
    )

    const result = await probeMetaToken(fetchImpl, TOKEN)

    expect(result.ok).toBe(false)
    expect(result.detail).toBe('令牌缺少 ads_management 权限')
  })

  it('returns missing-scope message when scopes is missing or not an array', async () => {
    const missing = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { is_valid: true } }),
    )
    const notArray = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { is_valid: true, scopes: 'ads_management' } }),
    )

    const missingResult = await probeMetaToken(missing, TOKEN)
    const notArrayResult = await probeMetaToken(notArray, TOKEN)

    expect(missingResult.detail).toBe('令牌缺少 ads_management 权限')
    expect(notArrayResult.detail).toBe('令牌缺少 ads_management 权限')
  })

  it('returns 令牌已过期 when expires_at is in the past', async () => {
    const past = Math.floor((Date.now() - 60_000) / 1000)
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { is_valid: true, scopes: ['ads_management'], expires_at: past } }),
    )

    const result = await probeMetaToken(fetchImpl, TOKEN)

    expect(result.ok).toBe(false)
    expect(result.detail).toBe('令牌已过期')
  })

  it('returns ok true when expires_at is 0 (never expires)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { is_valid: true, scopes: ['ads_management'], expires_at: 0 } }),
    )

    const result = await probeMetaToken(fetchImpl, TOKEN)

    expect(result).toEqual({ ok: true })
  })

  it('returns 探测令牌失败（Meta 返回异常） on HTTP 500', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ error: 'boom' }, 500))

    const result = await probeMetaToken(fetchImpl, TOKEN)

    expect(result.ok).toBe(false)
    expect(result.detail).toBe('探测令牌失败（Meta 返回异常）')
  })

  it('returns 探测令牌失败（网络或超时） on fetch throw, without leaking the token', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error(`network down for https://graph.facebook.com/debug_token?access_token=${TOKEN}`)
    })

    const result = await probeMetaToken(fetchImpl, TOKEN)

    expect(result.ok).toBe(false)
    expect(result.detail).toBe('探测令牌失败（网络或超时）')
    expect(result.detail).not.toContain(TOKEN)
  })

  it('sends the encoded token in the request URL but never in the result', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { is_valid: true, scopes: ['ads_management'], expires_at: 0 } }),
    )

    const result = await probeMetaToken(fetchImpl, TOKEN)

    const [url] = fetchImpl.mock.calls[0]
    const parsed = new URL(url)
    expect(parsed.searchParams.get('input_token')).toBe(TOKEN)
    expect(parsed.searchParams.get('access_token')).toBe(TOKEN)

    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })
})
