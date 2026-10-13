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

describe('checkMediaFile hardening', () => {
  function chunked(chunks: Uint8Array[], onCancel?: () => void): Response {
    let index = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++])
        else controller.close()
      },
      cancel() {
        onCancel?.()
      },
    })
    return new Response(stream, { status: 200 })
  }

  it('hashes a body delivered in several chunks', async () => {
    const half = Math.floor(BODY.length / 2)
    const fetcher: typeof fetch = async () => chunked([BODY.slice(0, half), BODY.slice(half)])
    await expect(checkMediaFile(item(), { fetcher })).resolves.toBe('OK')
  })

  it('stops reading a chunked body that grows past the cap, without a content-length', async () => {
    let cancelled = false
    const big = new Uint8Array(64)
    const fetcher: typeof fetch = async () => chunked([big, big, big, big], () => { cancelled = true })
    await expect(checkMediaFile(item(), { fetcher, maxBytes: 100 })).resolves.toBe('UNREACHABLE')
    expect(cancelled).toBe(true)
  })

  it('only downloads from allowed hosts (exact host or subdomain); an empty list denies all', async () => {
    const calls: string[] = []
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url))
      return okResponse(BODY)
    }
    const ok = item({ media_url: 'https://storage.example.com/a.png' })
    await expect(checkMediaFile(ok, { fetcher, allowedHosts: ['storage.example.com'] })).resolves.toBe('OK')
    await expect(checkMediaFile(ok, { fetcher, allowedHosts: ['example.com'] })).resolves.toBe('OK')
    calls.length = 0
    await expect(checkMediaFile(ok, { fetcher, allowedHosts: ['other.com'] })).resolves.toBe('UNREACHABLE')
    await expect(checkMediaFile(ok, { fetcher, allowedHosts: [] })).resolves.toBe('UNREACHABLE')
    await expect(
      checkMediaFile(item({ media_url: 'https://evil-example.com/a.png' }), { fetcher, allowedHosts: ['example.com'] }),
    ).resolves.toBe('UNREACHABLE')
    await expect(
      checkMediaFile(item({ media_url: 'https://169.254.169.254/latest' }), { fetcher, allowedHosts: ['example.com'] }),
    ).resolves.toBe('UNREACHABLE')
    expect(calls).toEqual([])
  })

  it('asks for a fresh copy (no cache)', async () => {
    const seen: Array<RequestInit | undefined> = []
    const fetcher: typeof fetch = async (_url, init) => {
      seen.push(init)
      return okResponse(BODY)
    }
    await checkMediaFile(item(), { fetcher })
    expect(seen[0]?.cache).toBe('no-store')
  })
})
