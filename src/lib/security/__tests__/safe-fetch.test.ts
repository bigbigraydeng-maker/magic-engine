import type { LookupAddress } from 'node:dns'
import { describe, expect, it, vi } from 'vitest'
import {
  createPinnedLookup,
  isPublicIpAddress,
  SafeFetchError,
  safeFetchText,
  type BoundClientFactory,
  type ResolvedAddress,
  type ResolveHost,
} from '../safe-fetch'

const LIMITS = { timeoutMs: 1_000, maxResponseBytes: 1_024, maxRedirects: 3 }

function response(statusCode: number, text = '', location?: string) {
  return {
    statusCode,
    headers: location ? { location } : {},
    body: { text: vi.fn().mockResolvedValue(text), destroy: vi.fn() },
  }
}

function failingResponse(code: string) {
  return {
    statusCode: 200,
    headers: {},
    body: {
      text: vi.fn().mockRejectedValue(Object.assign(new Error(code), { code })),
      destroy: vi.fn(),
    },
  }
}

function fakeClientFactory(responses: ReturnType<typeof response>[]) {
  const origins: string[] = []
  const pins: ResolvedAddress[] = []
  const requests: string[] = []
  const requestHeaders: Array<Readonly<Record<string, string>> | undefined> = []
  const createBoundClient: BoundClientFactory = (origin, pinned) => {
    origins.push(origin)
    pins.push(pinned)
    return {
      request: vi.fn(async ({ path, headers }) => {
        requests.push(path)
        requestHeaders.push(headers)
        const next = responses.shift()
        if (!next) throw new Error('unexpected request')
        return next
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }
  }
  return { createBoundClient, origins, pins, requests, requestHeaders }
}

describe('CIDR-based address classification', () => {
  it('rejects non-public IPv4 ranges and allows public unicast', () => {
    const blocked = [
      '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
      '172.16.0.1', '192.0.2.1', '192.168.0.1', '198.18.0.1', '198.51.100.1',
      '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    ]
    for (const address of blocked) expect(isPublicIpAddress(address), address).toBe(false)
    expect(isPublicIpAddress('8.8.8.8')).toBe(true)
  })

  it('rejects non-public IPv6 ranges, including the full fe80::/10', () => {
    const blocked = [
      '::', '::1', '::7f00:1', '::808:808', 'fc00::1', 'fd00::1', 'fe80::1', 'fe9f::1', 'fea0::1',
      'febf::1', 'ff00::1', '2001:db8::1', '64:ff9b::808:808', '2002:808:808::',
    ]
    for (const address of blocked) expect(isPublicIpAddress(address), address).toBe(false)
    expect(isPublicIpAddress('2001:4860:4860::8888')).toBe(true)
  })

  it('normalises IPv4-mapped IPv6 before classification', () => {
    expect(isPublicIpAddress('::ffff:7f00:1')).toBe(false)
    expect(isPublicIpAddress('::ffff:0808:0808')).toBe(true)
  })
})

describe('connection-bound DNS validation', () => {
  it('returns the pinned address for every connector lookup', async () => {
    const lookup = createPinnedLookup({ address: '8.8.8.8', family: 4 })
    const one = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup('attacker.example', {}, (error, address, family) => {
        if (error) reject(error)
        else resolve({ address: address as string, family: family as number })
      })
    })
    const all = await new Promise<LookupAddress[]>((resolve, reject) => {
      lookup('attacker.example', { all: true }, (error, addresses) => {
        if (error) reject(error)
        else resolve(addresses as LookupAddress[])
      })
    })
    expect(one).toEqual({ address: '8.8.8.8', family: 4 })
    expect(all).toEqual([{ address: '8.8.8.8', family: 4 }])
  })

  it('resolves once and binds the exact validated address to the client', async () => {
    const resolveHost = vi.fn<ResolveHost>().mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
    const fake = fakeClientFactory([response(200, 'ok')])
    const result = await safeFetchText('https://attacker.example/page?q=1', LIMITS, {
      resolveHost,
      createBoundClient: fake.createBoundClient,
    })
    expect(result.text).toBe('ok')
    expect(resolveHost).toHaveBeenCalledTimes(1)
    expect(fake.pins).toEqual([{ address: '8.8.8.8', family: 4 }])
    expect(fake.requests).toEqual(['/page?q=1'])
  })

  it('keeps the original hostname as Client origin for Host, SNI and TLS verification', async () => {
    const fake = fakeClientFactory([response(200, 'ok')])
    await safeFetchText('https://original.example/page', {
      ...LIMITS,
      headers: { Host: 'evil.example', ':authority': 'evil.example', Accept: 'text/plain' },
    }, {
      resolveHost: async () => [{ address: '2001:4860:4860::8888', family: 6 }],
      createBoundClient: fake.createBoundClient,
    })
    expect(fake.origins).toEqual(['https://original.example'])
    expect(fake.pins).toEqual([{ address: '2001:4860:4860::8888', family: 6 }])
    expect(fake.requestHeaders).toEqual([{ Accept: 'text/plain' }])
  })

  it('fails closed when DNS returns a mixed public/private answer set', async () => {
    const resolveHost: ResolveHost = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]
    const createBoundClient = vi.fn<BoundClientFactory>()
    await expect(safeFetchText('https://mixed.example/', LIMITS, { resolveHost, createBoundClient }))
      .rejects.toMatchObject({ code: 'blocked_address' })
    expect(createBoundClient).not.toHaveBeenCalled()
  })

  it('does not perform a second DNS resolution that can be rebound', async () => {
    const resolveHost = vi.fn<ResolveHost>()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    const fake = fakeClientFactory([response(200, 'safe')])
    await safeFetchText('https://rebind.example/', LIMITS, {
      resolveHost,
      createBoundClient: fake.createBoundClient,
    })
    expect(resolveHost).toHaveBeenCalledTimes(1)
    expect(fake.pins).toEqual([{ address: '8.8.8.8', family: 4 }])
  })

  it('accepts public IPv4 and IPv6 DNS answers', async () => {
    const fake = fakeClientFactory([response(200, 'v4'), response(200, 'v6')])
    for (const address of ['8.8.8.8', '2001:4860:4860::8888']) {
      await safeFetchText(`https://${address.includes(':') ? `[${address}]` : address}/`, LIMITS, {
        createBoundClient: fake.createBoundClient,
      })
    }
    expect(fake.pins).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ])
  })
})

describe('redirect and resource bounds', () => {
  const publicDns: ResolveHost = async () => [{ address: '8.8.8.8', family: 4 }]

  it('revalidates every redirect hop and blocks a private destination', async () => {
    const fake = fakeClientFactory([response(302, '', 'http://127.0.0.1/secret')])
    await expect(safeFetchText('https://public.example/start', LIMITS, {
      resolveHost: publicDns,
      createBoundClient: fake.createBoundClient,
    })).rejects.toMatchObject({ code: 'blocked_address' })
    expect(fake.pins).toHaveLength(1)
  })

  it('resolves and binds each public redirect hop independently', async () => {
    const resolveHost = vi.fn<ResolveHost>()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])
    const fake = fakeClientFactory([response(302, '', 'https://next.example/end'), response(200, 'done')])
    await safeFetchText('https://first.example/start', LIMITS, {
      resolveHost,
      createBoundClient: fake.createBoundClient,
    })
    expect(fake.origins).toEqual(['https://first.example', 'https://next.example'])
    expect(fake.pins).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ])
  })

  it('caps redirects', async () => {
    const fake = fakeClientFactory([
      response(302, '', '/1'), response(302, '', '/2'),
      response(302, '', '/3'), response(302, '', '/4'),
    ])
    await expect(safeFetchText('https://public.example/start', LIMITS, {
      resolveHost: publicDns,
      createBoundClient: fake.createBoundClient,
    })).rejects.toMatchObject({ code: 'too_many_redirects' })
    expect(fake.pins).toHaveLength(4)
  })

  it('allows HTTP/HTTPS only and rejects embedded credentials', async () => {
    await expect(safeFetchText('file:///etc/passwd', LIMITS)).rejects.toMatchObject({ code: 'unsupported_scheme' })
    await expect(safeFetchText('https://user:secret@example.com/', LIMITS)).rejects.toMatchObject({ code: 'invalid_url' })
  })

  it('maps response-size and timeout failures to stable error codes', async () => {
    for (const [failure, expected] of [
      ['UND_ERR_RES_EXCEEDED_MAX_SIZE', 'response_too_large'],
      ['UND_ERR_BODY_TIMEOUT', 'timeout'],
    ] as const) {
      const fake = fakeClientFactory([failingResponse(failure)])
      await expect(safeFetchText('https://public.example/', LIMITS, {
        resolveHost: publicDns,
        createBoundClient: fake.createBoundClient,
      })).rejects.toMatchObject({ code: expected })
    }
  })

  it('times out DNS resolution before any socket is created', async () => {
    const createBoundClient = vi.fn<BoundClientFactory>()
    await expect(safeFetchText('https://slow.example/', { ...LIMITS, timeoutMs: 5 }, {
      resolveHost: () => new Promise(() => undefined),
      createBoundClient,
    })).rejects.toMatchObject({ code: 'timeout' })
    expect(createBoundClient).not.toHaveBeenCalled()
  })

  it('supports crawler-style sibling continuation after one poisoned URL', async () => {
    const urls = ['http://127.0.0.1/evil.xml', 'https://public.example/good.xml']
    const fake = fakeClientFactory([response(200, '<urlset/>')])
    const results: string[] = []
    for (const url of urls) {
      try {
        results.push((await safeFetchText(url, LIMITS, {
          resolveHost: publicDns,
          createBoundClient: fake.createBoundClient,
        })).text)
      } catch (error) {
        expect(error).toBeInstanceOf(SafeFetchError)
      }
    }
    expect(results).toEqual(['<urlset/>'])
  })
})
