import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { creatomateFetch } from './client'
import { CreatomateApiError } from './types'

vi.mock('@/lib/validation-utils', () => ({ validateEnvVar: () => 'test-key' }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonRes(status: number, body: unknown): Response {
  return { ok: status < 300, status, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) } as Response
}
function textRes(status: number, body: string): Response {
  return { ok: status < 300, status, text: () => Promise.resolve(body), json: () => Promise.reject(new Error('not json')) } as Response
}

describe('creatomateFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('成功请求原样返回解析后的 json', async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { id: 'r1', status: 'planned' }))
    const result = await creatomateFetch('/renders', { method: 'POST', body: {} })
    expect(result).toEqual({ id: 'r1', status: 'planned' })
  })

  it('400 → JSON {hint,documentation} 解析进 CreatomateApiError，不重试（只打 1 次）', async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(400, { hint: '模板不存在', documentation: 'https://...' }))

    await expect(creatomateFetch('/renders', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 400,
      hint: '模板不存在',
    } satisfies Partial<CreatomateApiError>)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('429 → 纯文本响应体，不当 JSON 解析；内部退避重试，最终仍 429 则抛出', async () => {
    mockFetch.mockResolvedValue(textRes(429, 'rate limited, slow down'))

    const promise = creatomateFetch('/renders', { method: 'GET' })
    const assertion = expect(promise).rejects.toMatchObject({ status: 429, message: 'rate limited, slow down' })
    await vi.runAllTimersAsync()
    await assertion

    // 3 次退避 + 首次 = 4 次总请求
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('429 重试一次后 5xx→200 成功，不把已经花的钱的语义搞错（这里只验证重试→成功链路）', async () => {
    mockFetch
      .mockResolvedValueOnce(textRes(429, 'slow down'))
      .mockResolvedValueOnce(jsonRes(200, { id: 'r2', status: 'succeeded', url: 'https://cdn.creatomate.com/x.mp4' }))

    const promise = creatomateFetch('/renders/r2', { method: 'GET' })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toMatchObject({ id: 'r2', status: 'succeeded' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
