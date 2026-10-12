import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { checkMediaFile } from '../file-check'

const BODY = new TextEncoder().encode('hello story media')
const BODY_SHA = createHash('sha256').update(Buffer.from(BODY)).digest('hex')

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function okResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(toArrayBuffer(bytes), { status: 200, headers })
}

function item(overrides: Partial<{ media_url: string; media_sha256: string }> = {}) {
  return {
    media_url: 'https://cdn.example.com/a.png',
    media_sha256: BODY_SHA,
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('checkMediaFile', () => {
  it('returns OK when the downloaded bytes match the recorded hash', async () => {
    const fetcher = vi.fn(async () => okResponse(BODY))
    await expect(checkMediaFile(item(), { fetcher })).resolves.toBe('OK')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns CHANGED when the bytes differ', async () => {
    const fetcher = vi.fn(async () => okResponse(new TextEncoder().encode('different')))
    await expect(checkMediaFile(item(), { fetcher })).resolves.toBe('CHANGED')
  })

  it('returns OK when the recorded hash is upper-case', async () => {
    const fetcher = vi.fn(async () => okResponse(BODY))
    await expect(
      checkMediaFile(item({ media_sha256: BODY_SHA.toUpperCase() }), { fetcher }),
    ).resolves.toBe('OK')
  })

  it.each([
    ['http url', 'http://cdn.example.com/a.png'],
    ['not a url', 'not a url'],
    ['empty', ''],
  ])('returns UNREACHABLE for %s without fetching', async (_label, url) => {
    const fetcher = vi.fn(async () => okResponse(BODY))
    await expect(checkMediaFile(item({ media_url: url }), { fetcher })).resolves.toBe(
      'UNREACHABLE',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns UNREACHABLE when fetch throws', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(checkMediaFile(item(), { fetcher })).resolves.toBe('UNREACHABLE')
  })

  it('returns UNREACHABLE on a 404', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 404 }))
    await expect(checkMediaFile(item(), { fetcher })).resolves.toBe('UNREACHABLE')
  })

  it('returns UNREACHABLE from content-length without reading the body', async () => {
    const arrayBuffer = vi.fn(async () => BODY.buffer)
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': String(200 * 1024 * 1024) }),
      arrayBuffer,
    } as unknown as Response
    const fetcher = vi.fn(async () => response)
    await expect(checkMediaFile(item(), { fetcher })).resolves.toBe('UNREACHABLE')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('returns UNREACHABLE for an empty body', async () => {
    const fetcher = vi.fn(async () => okResponse(new Uint8Array(0)))
    await expect(checkMediaFile(item(), { fetcher })).resolves.toBe('UNREACHABLE')
  })

  it('passes an AbortSignal and redirect:error to the fetcher', async () => {
    const seen: Array<RequestInit | undefined> = []
    const fetcher: typeof fetch = async (_url, init) => {
      seen.push(init)
      return okResponse(BODY)
    }
    await checkMediaFile(item(), { fetcher, timeoutMs: 1234 })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.redirect).toBe('error')
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('resolves the default fetcher at call time', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse(BODY))
    await expect(checkMediaFile(item())).resolves.toBe('OK')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
