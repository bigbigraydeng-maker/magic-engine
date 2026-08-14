/**
 * safe-fetch — mocked unit suite. `node:dns/promises` and undici's
 * `Agent`/`fetch` are all mocked; undici's real `Response`/`Headers` classes
 * are reused as in-memory fixtures (no I/O). No DNS, no socket, no network.
 *
 * 🔴 What this file structurally CANNOT prove: that the validated address
 *    actually reaches a socket. The transport is mocked, so every assertion
 *    here is about the options object handed to undici. #968's first head
 *    passed a suite like this while failing 100% of real connections, because
 *    its harness invoked the pinned lookup with an empty options object —
 *    asserting a calling convention Node never uses. Socket binding is proven
 *    in safe-fetch.integration.test.ts against real loopback listeners; the
 *    two suites are complementary and neither is sufficient alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LookupFunction } from 'node:net'
import type dns from 'node:dns'

const dnsLookupMock = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: dnsLookupMock, default: { lookup: dnsLookupMock } }))

const undiciFetchMock = vi.hoisted(() => vi.fn())
const agentCtorMock = vi.hoisted(() => vi.fn())
const agentCloseMock = vi.hoisted(() => vi.fn())
vi.mock('undici', async importOriginal => {
  const actual = await importOriginal<typeof import('undici')>()
  class MockAgent {
    constructor(opts: unknown) {
      agentCtorMock(opts)
    }
    async close() {
      agentCloseMock()
    }
  }
  return { ...actual, Agent: MockAgent, fetch: undiciFetchMock }
})

import { Response, Headers } from 'undici'
import {
  classifyAddress,
  resolveValidatedAddress,
  buildPinnedLookup,
  assertHeadersAllowed,
  isRedirectStatus,
  safeFetchText,
  BlockedAddressError,
  DisallowedSchemeError,
  TooManyRedirectsError,
  InvalidRedirectError,
  ResponseTooLargeError,
  DnsTimeoutError,
  PinnedHostMismatchError,
  ForbiddenHeaderError,
} from '../safe-fetch'

interface CapturedAgentOpts {
  connect?: { lookup?: LookupFunction }
}

/**
 * The options Node actually passes to a custom `lookup` on its default
 * happy-eyeballs path. Observed empirically against Node 24 + undici 6.28, not
 * guessed — passing `{}` here is exactly the mistake that hid #968's P0.
 */
const NODE_HAPPY_EYEBALLS_OPTS = { hints: 1024, all: true } as const
const NODE_SINGLE_OPTS = { hints: 1024 } as const

/** Calls a lookup the way Node does, normalising both result shapes to a list. */
function invokePinned(
  lookup: LookupFunction,
  hostname: string,
  options: dns.LookupOptions = NODE_HAPPY_EYEBALLS_OPTS,
): Promise<Array<{ address: string; family?: number }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('lookup callback was never invoked')), 1_000)
    lookup(hostname, options, (err, address, family) => {
      clearTimeout(timer)
      if (err) reject(err)
      else if (Array.isArray(address)) resolve(address)
      else resolve([{ address, family }])
    })
  })
}

const publicAnswer = [{ address: '93.184.216.34', family: 4 }]

beforeEach(() => {
  dnsLookupMock.mockReset()
  undiciFetchMock.mockReset()
  agentCtorMock.mockReset()
  agentCloseMock.mockReset()
})

// ─── CIDR classification ──────────────────────────────────────────────────

describe('classifyAddress — IPv4', () => {
  it('blocks unspecified, loopback, private, link-local, CGNAT, broadcast, multicast, reserved', () => {
    const blocked = [
      '0.0.0.0',
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1', '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',                // cloud metadata
      '100.64.0.1', '100.127.255.255',  // CGNAT RFC6598
      '255.255.255.255',
      '224.0.0.1',
      '192.0.2.1', '198.51.100.1', '203.0.113.1',
      '198.18.0.1',
    ]
    for (const ip of blocked) {
      expect(classifyAddress(ip).blocked, ip).toBe(true)
    }
  })

  it('allows legitimate public addresses', () => {
    for (const ip of ['8.8.8.8', '8.8.4.4', '1.1.1.1', '93.184.216.34']) {
      const result = classifyAddress(ip)
      expect(result.blocked, ip).toBe(false)
      expect(result.range, ip).toBe('unicast')
      expect(result.family, ip).toBe(4)
    }
  })
})

describe('classifyAddress — IPv6', () => {
  it('blocks unspecified, loopback and unique-local (ULA)', () => {
    for (const ip of ['::', '::1', 'fc00::1', 'fd12:3456::1']) {
      expect(classifyAddress(ip).blocked, ip).toBe(true)
    }
  })

  it('blocks the full fe80::/10 link-local range, not just fe8x/fe9x', () => {
    // fe80::/10 spans third-nibble 8-b: fe8x, fe9x, feax, febx. #965 names
    // fea0::1 and febf::1 explicitly — a fe8/fe9 prefix check passes both.
    for (const ip of ['fe80::1', 'fe89::1', 'fe90::1', 'fe99::1', 'fea0::1', 'feaf::1', 'feb0::1', 'febf::1']) {
      expect(classifyAddress(ip).blocked, ip).toBe(true)
    }
  })

  it('does not over-block just past the fe80::/10 boundary', () => {
    expect(classifyAddress('2001:4860:4860::8888').blocked).toBe(false)
  })

  it('blocks IPv4-MAPPED IPv6 in both dotted and canonical hex form', () => {
    // Node canonicalizes [::ffff:127.0.0.1] to ::ffff:7f00:1, which a
    // dotted-quad regex misses.
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe']) {
      const result = classifyAddress(ip)
      expect(result.blocked, ip).toBe(true)
      expect(result.family, ip).toBe(4) // unwrapped to its real IPv4 form
    }
  })

  it('blocks IPv4-COMPATIBLE IPv6 (::/96), which the range table calls plain unicast', () => {
    // Distinct from mapped above: ipaddr.js has no ::/96 entry and process()
    // does not unwrap it, so these classify as 'unicast' from the table alone.
    for (const ip of ['::7f00:1', '::a9fe:a9fe', '::a00:1', '0:0:0:0:0:0:7f00:1', '::2']) {
      const result = classifyAddress(ip)
      expect(result.blocked, ip).toBe(true)
      expect(result.range, ip).toBe('ipv4Compatible')
    }
  })

  it('blocks NAT64, 6to4 and Teredo prefixes that can embed a private IPv4', () => {
    for (const ip of ['64:ff9b::7f00:1', '2002:7f00:1::1', '2001:0:1234::1']) {
      expect(classifyAddress(ip).blocked, ip).toBe(true)
    }
  })

  it('allows legitimate public IPv6 addresses', () => {
    for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111']) {
      const result = classifyAddress(ip)
      expect(result.blocked, ip).toBe(false)
      expect(result.family, ip).toBe(6)
    }
  })

  it('fails closed on exotic/reserved ranges by allow-listing only "unicast"', () => {
    // 2001:db8::/32 is IPv6 documentation — not one of the "obvious"
    // categories a hand-rolled block-list remembers. Allow-listing makes it
    // fail closed for free.
    expect(classifyAddress('2001:db8::1').blocked).toBe(true)
  })

  it('fails closed (blocked) on unparseable input rather than throwing', () => {
    // Exported as a reusable classifier: a caller doing instanceof-based error
    // mapping must never see a parse failure as "allowed".
    for (const bad of ['', 'not-an-ip', '1.2.3.4.5', '999.1.1.1', 'fe80::zz']) {
      expect(() => classifyAddress(bad), bad).not.toThrow()
      expect(classifyAddress(bad).blocked, bad).toBe(true)
      expect(classifyAddress(bad).range, bad).toBe('unparseable')
    }
  })
})

// ─── Resolve-all, validate-all, fail-closed ───────────────────────────────

describe('resolveValidatedAddress', () => {
  it('skips DNS entirely for an IPv4 literal', async () => {
    const result = await resolveValidatedAddress('8.8.8.8')
    expect(result).toEqual({ address: '8.8.8.8', family: 4, hostname: '8.8.8.8' })
    expect(dnsLookupMock).not.toHaveBeenCalled()
  })

  it('skips DNS entirely for an IPv6 literal', async () => {
    const result = await resolveValidatedAddress('2001:4860:4860::8888')
    expect(result.family).toBe(6)
    expect(dnsLookupMock).not.toHaveBeenCalled()
  })

  it('resolves a hostname to its single public address', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    const result = await resolveValidatedAddress('public.example')
    expect(result).toEqual({ address: '93.184.216.34', family: 4, hostname: 'public.example' })
    expect(dnsLookupMock).toHaveBeenCalledWith('public.example', { all: true, verbatim: true })
  })

  it('blocks a hostname that resolves to a private address', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }])
    await expect(resolveValidatedAddress('internal.example')).rejects.toThrow(BlockedAddressError)
  })

  it('fails closed on mixed public+private answers — public first', async () => {
    dnsLookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    await expect(resolveValidatedAddress('mixed.example')).rejects.toThrow(BlockedAddressError)
  })

  it('fails closed on mixed public+private answers — private first', async () => {
    // A guard that inspects only answer[0] is bypassable by ordering; both
    // orders must fail.
    dnsLookupMock.mockResolvedValueOnce([
      { address: '169.254.169.254', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ])
    await expect(resolveValidatedAddress('mixed.example')).rejects.toThrow(BlockedAddressError)
  })

  it('fails closed when a later answer is IPv6 private and the first is public IPv4', async () => {
    dnsLookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: 'fea0::1', family: 6 },
    ])
    await expect(resolveValidatedAddress('mixed6.example')).rejects.toThrow(BlockedAddressError)
  })

  it('propagates a DNS resolution failure unchanged', async () => {
    const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND ghost.example'), { code: 'ENOTFOUND' })
    dnsLookupMock.mockRejectedValueOnce(notFound)
    await expect(resolveValidatedAddress('ghost.example')).rejects.toMatchObject({ code: 'ENOTFOUND' })
  })

  it('bounds DNS time — a nameserver that never answers cannot stall the hop', async () => {
    // dns.lookup takes no AbortSignal, so this time sits entirely outside the
    // per-hop request timeout.
    dnsLookupMock.mockImplementationOnce(() => new Promise(() => {}))
    await expect(resolveValidatedAddress('blackhole.example', 40)).rejects.toThrow(DnsTimeoutError)
  })
})

// ─── Pinned lookup ────────────────────────────────────────────────────────

describe('buildPinnedLookup', () => {
  const pin = () => buildPinnedLookup({ address: '93.184.216.34', family: 4, hostname: 'host.example' })

  it('returns the pre-validated address for the hostname it was validated for', async () => {
    for (const options of [NODE_HAPPY_EYEBALLS_OPTS, NODE_SINGLE_OPTS, {}]) {
      await expect(invokePinned(pin(), 'host.example', options)).resolves.toEqual([
        { address: '93.184.216.34', family: 4 },
      ])
    }
  })

  it("honours Node's requested result shape on both the all:true and single paths", async () => {
    // Node signals the shape via options.all and rejects the other with a hard
    // ERR_INVALID_IP_ADDRESS — a functional requirement, not a nicety. The
    // real-socket suite proves Node accepts what we return.
    const pinned = pin()
    const arrayShape = await new Promise<unknown>(resolve =>
      pinned('host.example', NODE_HAPPY_EYEBALLS_OPTS, (_e, addr) => resolve(addr))
    )
    expect(Array.isArray(arrayShape)).toBe(true)
    expect(arrayShape).toEqual([{ address: '93.184.216.34', family: 4 }])

    const stringShape = await new Promise<unknown>(resolve =>
      pinned('host.example', NODE_SINGLE_OPTS, (_e, addr) => resolve(addr))
    )
    expect(Array.isArray(stringShape)).toBe(false)
    expect(stringShape).toBe('93.184.216.34')
  })

  it('returns exactly one address — Node dials every address a lookup returns', async () => {
    await expect(invokePinned(pin(), 'host.example')).resolves.toHaveLength(1)
  })

  it('refuses to resolve a hostname it was not validated for (defence in depth)', async () => {
    // Unreachable today (one Agent per hop), but if a future change shared an
    // Agent, silently dialing host B at host A's address would be a bypass.
    for (const other of ['attacker-controlled.example', 'host.example.evil.test']) {
      await expect(invokePinned(pin(), other)).rejects.toThrow(PinnedHostMismatchError)
    }
  })

  it('never touches dns — the pinned function has no way to re-resolve', async () => {
    await invokePinned(pin(), 'host.example')
    await invokePinned(pin(), 'host.example', NODE_SINGLE_OPTS)
    expect(dnsLookupMock).not.toHaveBeenCalled()
  })

  it('is immune to a simulated DNS-rebinding second answer', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    const validated = await resolveValidatedAddress('rebinder.example')
    expect(dnsLookupMock).toHaveBeenCalledTimes(1)

    // The attacker's DNS now flips to metadata for any *subsequent*
    // resolution — what a real rebinding attack relies on the client doing.
    dnsLookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }])

    await expect(invokePinned(buildPinnedLookup(validated), 'rebinder.example')).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
    ])
    // Still 1: the malicious answer was never consumed.
    expect(dnsLookupMock).toHaveBeenCalledTimes(1)
  })
})

// ─── Header policy ────────────────────────────────────────────────────────

describe('header policy — v1 forbids credentials and Host override', () => {
  it('rejects credential and authority headers in any casing', async () => {
    for (const name of [
      'Authorization', 'authorization', 'AUTHORIZATION',
      'Cookie', 'cookie',
      'Proxy-Authorization', 'proxy-authorization',
      'Host', 'host', ':authority',
    ]) {
      expect(() => assertHeadersAllowed({ [name]: 'x' }), name).toThrow(ForbiddenHeaderError)
    }
  })

  it('rejects them with surrounding whitespace too', () => {
    expect(() => assertHeadersAllowed({ ' Authorization ': 'x' })).toThrow(ForbiddenHeaderError)
  })

  it('allows ordinary headers', () => {
    expect(() => assertHeadersAllowed({ Accept: 'text/html', 'X-Probe': '1' })).not.toThrow()
    expect(() => assertHeadersAllowed(undefined)).not.toThrow()
  })

  it('rejects before any DNS or fetch happens', async () => {
    // Runtime enforcement matters because a JS caller, or `as any`, bypasses
    // the type-level ban entirely.
    await expect(
      safeFetchText('https://good.example/', { headers: { Authorization: 'Bearer x' } })
    ).rejects.toThrow(ForbiddenHeaderError)
    expect(dnsLookupMock).not.toHaveBeenCalled()
    expect(undiciFetchMock).not.toHaveBeenCalled()
  })
})

// ─── Redirect status classification ───────────────────────────────────────

describe('isRedirectStatus', () => {
  it('treats only 301/302/303/307/308 as redirects', () => {
    for (const s of [301, 302, 303, 307, 308]) expect(isRedirectStatus(s), String(s)).toBe(true)
  })

  it('does NOT treat 300/304/305/306 or any 2xx/4xx/5xx as redirects', () => {
    // 304 is a normal conditional-GET response with no Location; a
    // `status >= 300 && status < 400` check turns it into a spurious error.
    for (const s of [200, 204, 299, 300, 304, 305, 306, 309, 400, 404, 500]) {
      expect(isRedirectStatus(s), String(s)).toBe(false)
    }
  })
})

// ─── safeFetchText: wiring ────────────────────────────────────────────────

describe('safeFetchText — connection-bound wiring', () => {
  it('constructs the Agent with a pinned connect.lookup and uses it as dispatcher', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockResolvedValueOnce(new Response('hello', { status: 200 }))

    const res = await safeFetchText('https://good.example/')
    expect(res.ok).toBe(true)
    expect(res.text).toBe('hello')

    expect(agentCtorMock).toHaveBeenCalledTimes(1)
    const lookup = (agentCtorMock.mock.calls[0][0] as CapturedAgentOpts).connect?.lookup
    expect(typeof lookup).toBe('function')
    await expect(invokePinned(lookup!, 'good.example')).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
    ])
    expect(String(undiciFetchMock.mock.calls[0][0])).toBe('https://good.example/')
  })

  it('always issues a GET and never delegates redirect-following to the client', async () => {
    // Load-bearing: with fetch mocked, flipping redirect to 'follow' is
    // otherwise invisible, and per-hop revalidation would silently vanish.
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await safeFetchText('https://good.example/')
    const init = undiciFetchMock.mock.calls[0][1] as { method?: string; redirect?: string; body?: unknown }
    expect(init.method).toBe('GET')
    expect(init.redirect).toBe('manual')
    expect(init.body).toBeUndefined()
  })

  it('bounds the request with an abort signal and closes the Agent afterwards', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockResolvedValueOnce(new Response('hello', { status: 200 }))
    await safeFetchText('https://good.example/', { timeoutMs: 1_234 })
    const init = undiciFetchMock.mock.calls[0][1] as { signal?: AbortSignal }
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(agentCloseMock).toHaveBeenCalledTimes(1)
  })

  it('closes the Agent even when the fetch itself throws', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockRejectedValueOnce(
      Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })
    )
    await safeFetchText('https://good.example/').catch(() => {})
    expect(agentCloseMock).toHaveBeenCalledTimes(1)
  })

  it('forwards headers and User-Agent', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await safeFetchText('https://good.example/', {
      headers: { 'X-Probe': 'probe-value' },
      userAgent: 'Custom-UA',
    })
    const headers = (undiciFetchMock.mock.calls[0][1] as { headers?: Record<string, string> }).headers ?? {}
    expect(headers['X-Probe']).toBe('probe-value')
    expect(headers['User-Agent']).toBe('Custom-UA')
  })

  it('passes dnsTimeoutMs through to resolution', async () => {
    dnsLookupMock.mockImplementationOnce(() => new Promise(() => {}))
    await expect(safeFetchText('https://slow-dns.example/', { dnsTimeoutMs: 30 })).rejects.toThrow(DnsTimeoutError)
    expect(undiciFetchMock).not.toHaveBeenCalled()
  })
})

// ─── safeFetchText: address & scheme policy ───────────────────────────────

describe('safeFetchText — address and scheme policy', () => {
  it('rejects a non-http(s) scheme before any DNS or network activity', async () => {
    for (const url of ['ftp://good.example/f', 'file:///etc/passwd', 'data:text/plain,x', 'gopher://g.example/']) {
      dnsLookupMock.mockReset()
      undiciFetchMock.mockReset()
      await expect(safeFetchText(url), url).rejects.toThrow(DisallowedSchemeError)
      expect(dnsLookupMock, url).not.toHaveBeenCalled()
      expect(undiciFetchMock, url).not.toHaveBeenCalled()
    }
  })

  it('blocks a private-address target before ever calling fetch', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }])
    await expect(safeFetchText('https://internal.example/')).rejects.toThrow(BlockedAddressError)
    expect(undiciFetchMock).not.toHaveBeenCalled()
  })

  it('blocks an IPv6-literal loopback URL, brackets and all', async () => {
    await expect(safeFetchText('http://[::ffff:7f00:1]/')).rejects.toThrow(BlockedAddressError)
    await expect(safeFetchText('http://[::7f00:1]/')).rejects.toThrow(BlockedAddressError)
    expect(undiciFetchMock).not.toHaveBeenCalled()
  })
})

// ─── safeFetchText: legitimate traffic and terminal responses ─────────────

describe('safeFetchText — legitimate public traffic', () => {
  it('fetches a legitimate public IPv4 target', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }))
    const res = await safeFetchText('https://public.example/')
    expect(res.ok).toBe(true)
    expect(res.hops).toBe(0)
    expect(res.text).toBe('<html>ok</html>')
  })

  it('fetches a legitimate public IPv6 target', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '2001:4860:4860::8888', family: 6 }])
    undiciFetchMock.mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }))
    const res = await safeFetchText('https://public-v6.example/')
    expect(res.ok).toBe(true)
    expect(res.text).toBe('<html>ok</html>')
  })

  it('returns a non-2xx terminal response instead of throwing', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }))
    const res = await safeFetchText('https://public.example/missing')
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
  })

  it('returns 304 and other non-redirect 3xx as terminal, with no Location required', async () => {
    // The #968 defect: a `status >= 300 && status < 400` check demanded a
    // Location header here and raised InvalidRedirectError on a normal 304.
    for (const status of [300, 304, 305, 306]) {
      dnsLookupMock.mockReset()
      undiciFetchMock.mockReset()
      dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      undiciFetchMock.mockResolvedValueOnce(new Response(null, { status }))

      const res = await safeFetchText('https://public.example/cached')
      expect(res.status, String(status)).toBe(status)
      expect(res.ok, String(status)).toBe(false)
      expect(res.hops, String(status)).toBe(0)
      expect(undiciFetchMock, String(status)).toHaveBeenCalledTimes(1) // not followed
    }
  })
})

// ─── safeFetchText: redirects ─────────────────────────────────────────────

describe('safeFetchText — redirects', () => {
  it('blocks a redirect hop that points at a private address', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } })
    )
    await expect(safeFetchText('https://good.example/')).rejects.toThrow(BlockedAddressError)
    expect(undiciFetchMock).toHaveBeenCalledTimes(1) // the private hop never reached fetch
  })

  it('follows a public redirect and re-resolves + re-pins the new host', async () => {
    dnsLookupMock
      .mockResolvedValueOnce(publicAnswer)
      .mockResolvedValueOnce([{ address: '8.8.4.4', family: 4 }])
    undiciFetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://good-2.example/home' } }))
      .mockResolvedValueOnce(new Response('final', { status: 200 }))

    const res = await safeFetchText('https://good.example/')
    expect(res.text).toBe('final')
    expect(res.hops).toBe(1)
    expect(res.url).toBe('https://good-2.example/home')
    expect(dnsLookupMock).toHaveBeenCalledTimes(2)   // re-resolved per hop
    expect(agentCtorMock).toHaveBeenCalledTimes(2)   // fresh Agent per hop
    // The second Agent must be pinned to the second host, not the first.
    const lookup2 = (agentCtorMock.mock.calls[1][0] as CapturedAgentOpts).connect?.lookup
    await expect(invokePinned(lookup2!, 'good-2.example')).resolves.toEqual([
      { address: '8.8.4.4', family: 4 },
    ])
  })

  it('follows every redirect status in the set', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      dnsLookupMock.mockReset()
      undiciFetchMock.mockReset()
      dnsLookupMock
        .mockResolvedValueOnce(publicAnswer)
        .mockResolvedValueOnce([{ address: '8.8.4.4', family: 4 }])
      undiciFetchMock
        .mockResolvedValueOnce(new Response(null, { status, headers: { location: 'https://good-2.example/x' } }))
        .mockResolvedValueOnce(new Response('arrived', { status: 200 }))

      const res = await safeFetchText('https://good.example/')
      expect(res.text, String(status)).toBe('arrived')
      // Always a GET, on every hop — no method downgrade logic exists.
      const init = undiciFetchMock.mock.calls[1][1] as { method?: string; body?: unknown }
      expect(init.method, String(status)).toBe('GET')
      expect(init.body, String(status)).toBeUndefined()
    }
  })

  it('gives up after maxRedirects hops', async () => {
    dnsLookupMock.mockResolvedValue(publicAnswer)
    undiciFetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://good.example/next' } })
    )
    await expect(safeFetchText('https://good.example/', { maxRedirects: 2 })).rejects.toThrow(TooManyRedirectsError)
    expect(undiciFetchMock).toHaveBeenCalledTimes(3) // hops 0,1,2 attempted, then stop
  })

  it('rejects a redirect status with no Location header', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockResolvedValueOnce(new Response(null, { status: 301 }))
    await expect(safeFetchText('https://good.example/')).rejects.toThrow(InvalidRedirectError)
  })

  it('rejects a Location that switches to a non-http(s) scheme', async () => {
    for (const location of ['file:///etc/passwd', 'ftp://good.example/x', 'gopher://good.example/']) {
      dnsLookupMock.mockReset()
      undiciFetchMock.mockReset()
      dnsLookupMock.mockResolvedValueOnce(publicAnswer)
      undiciFetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }))
      await expect(safeFetchText('https://good.example/'), location).rejects.toThrow(DisallowedSchemeError)
      expect(undiciFetchMock, location).toHaveBeenCalledTimes(1)
    }
  })

  it('resolves a protocol-relative Location and still address-checks it', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: '//169.254.169.254/latest/meta-data' } })
    )
    await expect(safeFetchText('https://good.example/')).rejects.toThrow(BlockedAddressError)
  })

  it('resolves a relative Location against the current hop', async () => {
    dnsLookupMock.mockResolvedValue(publicAnswer)
    undiciFetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/second' } }))
      .mockResolvedValueOnce(new Response('rel', { status: 200 }))
    const res = await safeFetchText('https://good.example/first')
    expect(res.url).toBe('https://good.example/second')
    expect(res.text).toBe('rel')
  })

  it('cancels the redirect body before closing the Agent', async () => {
    // undici's close() waits on in-flight responses, so an unread 3xx body
    // over ~64 KiB stalls the hop until the abort timer fires. Order matters:
    // cancelling after a hung close is too late.
    const order: string[] = []
    const cancel = vi.fn(async () => { order.push('cancel') })
    agentCloseMock.mockImplementation(() => { order.push('close') })
    dnsLookupMock
      .mockResolvedValueOnce(publicAnswer)
      .mockResolvedValueOnce([{ address: '8.8.4.4', family: 4 }])
    undiciFetchMock
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'https://good-2.example/' }),
        body: { cancel },
      })
      .mockResolvedValueOnce(new Response('final', { status: 200 }))

    await safeFetchText('https://good.example/')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['cancel', 'close', 'close'])
  })
})

// ─── safeFetchText: resource bounds ───────────────────────────────────────

describe('safeFetchText — resource bounds', () => {
  it('rejects a response body over the configured size cap', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(new Response('x'.repeat(100), { status: 200 }))
    await expect(safeFetchText('https://public.example/big', { maxResponseBytes: 10 })).rejects.toThrow(
      ResponseTooLargeError
    )
  })

  it('enforces the cap across chunks, before buffering the one that exceeds it', async () => {
    // A single-chunk fixture only covers the first loop iteration and cannot
    // catch the check being moved after the push.
    const cancel = vi.fn(async () => {})
    let produced = 0
    const body = {
      getReader: () => ({
        read: async () => {
          if (produced >= 10) return { done: true, value: undefined }
          produced += 1
          return { done: false, value: new Uint8Array(40) }
        },
        cancel,
      }),
    }
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce({ status: 200, statusText: 'OK', headers: new Headers(), body })

    await expect(safeFetchText('https://public.example/stream', { maxResponseBytes: 100 })).rejects.toThrow(
      ResponseTooLargeError
    )
    expect(produced).toBe(3)                  // stopped as soon as the cap tripped
    expect(cancel).toHaveBeenCalledTimes(1)   // stream cancelled, not drained
  })

  it('propagates a timeout abort without renaming it', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
    const err = await safeFetchText('https://public.example/slow').catch(e => e)
    expect(err).toMatchObject({ name: 'TimeoutError' })
  })

  it('propagates a network error with its cause code unchanged', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockRejectedValueOnce(
      Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    )
    const err = await safeFetchText('https://public.example/down').catch(e => e)
    expect(err).toMatchObject({ cause: { code: 'ECONNREFUSED' } })
  })
})
