/**
 * safe-fetch — fully mocked test suite. No real DNS lookup and no real
 * socket/TLS connection anywhere in this file: node:dns/promises and undici
 * (Agent + fetch) are both mocked; undici's real Response/Headers classes
 * are reused unmocked as in-memory fixtures (no I/O).
 *
 * Covers issue #965's required test list: IPv4/IPv6 restricted ranges
 * (including the full fe80::/10 boundary and IPv4-mapped canonical hex
 * form), mixed public/private DNS fail-closed, simulated DNS rebinding,
 * redirect-to-private, redirect hop limit, legitimate public IPv4/IPv6,
 * prospecting error-semantics regression, and a crawler
 * sibling-continuation minimal integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LookupFunction } from 'node:net'

const dnsLookupMock = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: dnsLookupMock, default: { lookup: dnsLookupMock } }))

const undiciFetchMock = vi.hoisted(() => vi.fn())
const agentCtorMock = vi.hoisted(() => vi.fn())
vi.mock('undici', async importOriginal => {
  const actual = await importOriginal<typeof import('undici')>()
  class MockAgent {
    constructor(opts: unknown) {
      agentCtorMock(opts)
    }
    async close() {}
  }
  return { ...actual, Agent: MockAgent, fetch: undiciFetchMock }
})

import { Response } from 'undici'
import {
  classifyAddress,
  resolveValidatedAddress,
  buildPinnedLookup,
  safeFetch,
  BlockedAddressError,
  DisallowedSchemeError,
  TooManyRedirectsError,
  InvalidRedirectError,
  ResponseTooLargeError,
} from '../safe-fetch'

interface CapturedAgentOpts {
  connect?: { lookup?: LookupFunction }
}

/**
 * Calls a lookup function the way Node's net/tls connect does and resolves
 * with whatever address it hands back. Deliberately tolerant of an
 * asynchronous callback so the assertion under test is the *security*
 * property (which address reaches connect) rather than the incidental
 * detail of whether the callback fired synchronously.
 */
function invokePinned(lookup: LookupFunction, hostname: string): Promise<{ address: string; family?: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('lookup callback was never invoked')), 1_000)
    lookup(hostname, {}, (err, address, family) => {
      clearTimeout(timer)
      if (err) reject(err)
      else resolve({ address: address as string, family })
    })
  })
}

beforeEach(() => {
  dnsLookupMock.mockReset()
  undiciFetchMock.mockReset()
  agentCtorMock.mockReset()
})

// ─── classifyAddress: CIDR-correct IPv4/IPv6 classification ───────────────

describe('classifyAddress — IPv4', () => {
  it('blocks unspecified, loopback, private, link-local, CGNAT, broadcast, multicast, reserved', () => {
    const blocked = [
      '0.0.0.0',           // unspecified
      '127.0.0.1',         // loopback
      '10.0.0.1',          // private RFC1918
      '172.16.0.1', '172.31.255.255',
      '192.168.1.1',       // private RFC1918
      '169.254.169.254',   // link-local / cloud metadata
      '100.64.0.1', '100.127.255.255', // CGNAT RFC6598
      '255.255.255.255',   // broadcast
      '224.0.0.1',         // multicast
      '192.0.2.1', '198.51.100.1', '203.0.113.1', // documentation/TEST-NET
      '198.18.0.1',        // benchmarking
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
  it('blocks unspecified, loopback, unique-local (ULA)', () => {
    for (const ip of ['::', '::1', 'fc00::1', 'fd12:3456::1']) {
      expect(classifyAddress(ip).blocked, ip).toBe(true)
    }
  })

  it('blocks the full fe80::/10 link-local range, not just fe8x/fe9x', () => {
    // fe80::/10 covers the third-nibble range 8-b (binary 1000-1011): fe8x,
    // fe9x, feax, febx. Issue #965's two explicit regression examples are
    // fea0::1 and febf::1 — a prefix check that only recognises "fe8"/"fe9"
    // (PR #963's bug) lets both of these through.
    for (const ip of ['fe80::1', 'fe89::1', 'fe90::1', 'fe99::1', 'fea0::1', 'feaf::1', 'feb0::1', 'febf::1']) {
      expect(classifyAddress(ip).blocked, ip).toBe(true)
    }
  })

  it('does not over-block just past the fe80::/10 boundary', () => {
    // fec0::/10 is a *different* (deprecated site-local) range that also
    // happens to be blocked, so pick an address family member firmly
    // outside both fe80::/10 and any other special range to prove the
    // boundary is precise, not "block everything starting with fe".
    expect(classifyAddress('2001:4860:4860::8888').blocked).toBe(false)
  })

  it('blocks IPv4-mapped IPv6 in both dotted and canonical hex form', () => {
    // ::ffff:127.0.0.1 and ::ffff:7f00:1 are the same address. Node
    // canonicalizes an IPv6-literal URL host to the hex form — a regex that
    // only matches the dotted form (PR #963's bug) misses it.
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe']) {
      const result = classifyAddress(ip)
      expect(result.blocked, ip).toBe(true)
      expect(result.family, ip).toBe(4) // unwrapped to its real IPv4 form before classifying
    }
  })

  it('allows legitimate public IPv6 addresses', () => {
    for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111']) {
      const result = classifyAddress(ip)
      expect(result.blocked, ip).toBe(false)
      expect(result.family, ip).toBe(6)
    }
  })

  it('fails closed on exotic/reserved ranges by allow-listing only "unicast" (not enumerating blocks)', () => {
    // 2001:db8::/32 is the IPv6 documentation range (RFC3849) — not one of
    // the "obvious" categories (loopback/private/link-local) a hand-rolled
    // block-list is likely to remember, which is exactly why this module
    // allow-lists 'unicast' instead of enumerating dangerous ranges by name.
    expect(classifyAddress('2001:db8::1').blocked).toBe(true)
  })
})

// ─── resolveValidatedAddress: resolve-all, validate-all, fail-closed ──────

describe('resolveValidatedAddress', () => {
  it('skips DNS entirely for an IPv4 literal', async () => {
    const result = await resolveValidatedAddress('8.8.8.8')
    expect(result).toEqual({ address: '8.8.8.8', family: 4 })
    expect(dnsLookupMock).not.toHaveBeenCalled()
  })

  it('skips DNS entirely for an IPv6 literal', async () => {
    const result = await resolveValidatedAddress('2001:4860:4860::8888')
    expect(result).toEqual({ address: '2001:4860:4860::8888', family: 6 })
    expect(dnsLookupMock).not.toHaveBeenCalled()
  })

  it('resolves a hostname to its single public address', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    const result = await resolveValidatedAddress('public.example')
    expect(result).toEqual({ address: '8.8.8.8', family: 4 })
    expect(dnsLookupMock).toHaveBeenCalledWith('public.example', { all: true, verbatim: true })
  })

  it('blocks a hostname that resolves to a private address', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }])
    await expect(resolveValidatedAddress('internal.example')).rejects.toThrow(BlockedAddressError)
  })

  it('fails closed when DNS returns mixed public+private answers, public first', async () => {
    dnsLookupMock.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    await expect(resolveValidatedAddress('mixed.example')).rejects.toThrow(BlockedAddressError)
  })

  it('fails closed when DNS returns mixed public+private answers, private first', async () => {
    // A guard that only inspects the first returned address is exactly the
    // bypass this test exists to catch.
    dnsLookupMock.mockResolvedValueOnce([
      { address: '169.254.169.254', family: 4 },
      { address: '8.8.8.8', family: 4 },
    ])
    await expect(resolveValidatedAddress('mixed.example')).rejects.toThrow(BlockedAddressError)
  })

  it('propagates a DNS resolution failure unchanged (fail-closed by natural exception propagation)', async () => {
    const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND ghost.example'), { code: 'ENOTFOUND' })
    dnsLookupMock.mockRejectedValueOnce(notFound)
    await expect(resolveValidatedAddress('ghost.example')).rejects.toMatchObject({ code: 'ENOTFOUND' })
  })
})

// ─── buildPinnedLookup: connection-binding proof ──────────────────────────

describe('buildPinnedLookup', () => {
  it('always returns the pre-validated address, ignoring the hostname/options it is called with', async () => {
    const pinned = buildPinnedLookup({ address: '93.184.216.34', family: 4 })
    for (const hostname of ['whatever.example', 'attacker-controlled.example', '']) {
      await expect(invokePinned(pinned, hostname)).resolves.toEqual({ address: '93.184.216.34', family: 4 })
    }
  })

  it('never touches dns — the pinned function has no way to re-resolve', async () => {
    const pinned = buildPinnedLookup({ address: '93.184.216.34', family: 4 })
    await invokePinned(pinned, 'anything.example')
    await invokePinned(pinned, 'anything-else.example')
    expect(dnsLookupMock).not.toHaveBeenCalled()
  })

  it('is immune to a simulated DNS-rebinding second answer', async () => {
    // First (and only) resolution: the attacker's authoritative DNS answers
    // with a public address so the pre-connect check passes.
    dnsLookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    const validated = await resolveValidatedAddress('rebinder.example')
    expect(dnsLookupMock).toHaveBeenCalledTimes(1)

    // The attacker's DNS now flips to a private/metadata answer for any
    // *subsequent* resolution of the same name — this is what a real
    // rebinding attack relies on the HTTP client re-resolving into.
    dnsLookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }])

    // The address handed to connect must still be the validated one — if the
    // lookup re-resolved, it would hand back 169.254.169.254 here.
    const pinned = buildPinnedLookup(validated)
    await expect(invokePinned(pinned, 'rebinder.example')).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    })
    // And it must not have consulted DNS again — the mock's call count
    // staying at 1 (with the private answer still queued and unused) is the
    // proof that no second resolution ever happens.
    expect(dnsLookupMock).toHaveBeenCalledTimes(1)
  })
})

// ─── safeFetch: end-to-end wiring + policy ────────────────────────────────

describe('safeFetch — connection-bound wiring', () => {
  it('constructs the Agent with a pinned connect.lookup and passes it as the fetch dispatcher', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(new Response('hello', { status: 200 }))

    const res = await safeFetch('https://good.example/')
    expect(res.ok).toBe(true)
    expect(await res.text()).toBe('hello')

    expect(agentCtorMock).toHaveBeenCalledTimes(1)
    const opts = agentCtorMock.mock.calls[0][0] as CapturedAgentOpts
    const lookup = opts.connect?.lookup
    expect(typeof lookup).toBe('function')
    // The connector calls this with whatever hostname it was given
    // (undici passes the *original* hostname straight through — see the
    // module doc comment) — even a hostile one must still resolve to the
    // address this module already validated.
    await expect(invokePinned(lookup!, 'attacker-controlled.example')).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    })

    const fetchArgs = undiciFetchMock.mock.calls[0]
    expect(String(fetchArgs[0])).toBe('https://good.example/')
  })

  it('never delegates redirect-following to the underlying client', async () => {
    // Load-bearing boundary contract, not a style assertion. Because the
    // underlying fetch is mocked in this suite, flipping redirect to 'follow'
    // is invisible to every other test here — yet it would hand hops 1..n to
    // the client, which resolves and connects them *without* this module's
    // validation or address pinning. Per-hop revalidation only exists because
    // this stays 'manual', so assert it directly on every hop.
    dnsLookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '8.8.4.4', family: 4 }])
    undiciFetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://good-2.example/' } }))
      .mockResolvedValueOnce(new Response('final', { status: 200 }))

    await safeFetch('https://good.example/')

    expect(undiciFetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of undiciFetchMock.mock.calls) {
      expect((init as { redirect?: string }).redirect).toBe('manual')
    }
  })
})

describe('safeFetch — scheme and address policy', () => {
  it('rejects a non-http(s) scheme before any DNS or network activity', async () => {
    await expect(safeFetch('ftp://good.example/file')).rejects.toThrow(DisallowedSchemeError)
    expect(dnsLookupMock).not.toHaveBeenCalled()
    expect(undiciFetchMock).not.toHaveBeenCalled()
  })

  it('blocks a private-address target before ever calling fetch', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }])
    await expect(safeFetch('https://internal.example/')).rejects.toThrow(BlockedAddressError)
    expect(undiciFetchMock).not.toHaveBeenCalled()
  })
})

describe('safeFetch — legitimate public traffic', () => {
  it('fetches a legitimate public IPv4 target', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }))
    const res = await safeFetch('https://public.example/')
    expect(res.ok).toBe(true)
    expect(res.hops).toBe(0)
    expect(await res.text()).toBe('<html>ok</html>')
  })

  it('fetches a legitimate public IPv6 target', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '2001:4860:4860::8888', family: 6 }])
    undiciFetchMock.mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }))
    const res = await safeFetch('https://public-v6.example/')
    expect(res.ok).toBe(true)
    expect(await res.text()).toBe('<html>ok</html>')
  })

  it('returns a non-2xx terminal response instead of throwing', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }))
    const res = await safeFetch('https://public.example/missing')
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
  })
})

describe('safeFetch — redirects', () => {
  it('blocks a redirect hop that points at a private address', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } })
    )
    await expect(safeFetch('https://good.example/')).rejects.toThrow(BlockedAddressError)
    expect(undiciFetchMock).toHaveBeenCalledTimes(1) // the private hop never reaches fetch
  })

  it('follows a public redirect and revalidates the new host', async () => {
    dnsLookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]) // hop 0 host
      .mockResolvedValueOnce([{ address: '8.8.4.4', family: 4 }]) // hop 1 host
    undiciFetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://good-2.example/home' } }))
      .mockResolvedValueOnce(new Response('final', { status: 200 }))

    const res = await safeFetch('https://good.example/')
    expect(res.ok).toBe(true)
    expect(res.hops).toBe(1)
    expect(res.url).toBe('https://good-2.example/home')
    expect(await res.text()).toBe('final')
    expect(dnsLookupMock).toHaveBeenCalledTimes(2) // re-resolved on every hop
  })

  it('gives up after maxRedirects hops', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    undiciFetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://good.example/next' } })
    )
    await expect(safeFetch('https://good.example/', { maxRedirects: 2 })).rejects.toThrow(TooManyRedirectsError)
    expect(undiciFetchMock).toHaveBeenCalledTimes(3) // hops 0,1,2 all attempted, then give up
  })

  it('rejects a redirect status with no Location header', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(new Response(null, { status: 301 }))
    await expect(safeFetch('https://good.example/')).rejects.toThrow(InvalidRedirectError)
  })
})

describe('safeFetch — resource bounds', () => {
  it('rejects a response body over the configured size cap', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(new Response('x'.repeat(100), { status: 200 }))
    await expect(safeFetch('https://public.example/big', { maxResponseBytes: 10 })).rejects.toThrow(
      ResponseTooLargeError
    )
  })

  it('propagates a timeout abort without renaming it', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
    const err = await safeFetch('https://public.example/slow').catch(e => e)
    expect(err).toMatchObject({ name: 'TimeoutError' })
  })

  it('propagates a network error (e.g. connection refused) with its cause code unchanged', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
    const err = await safeFetch('https://public.example/down').catch(e => e)
    expect(err).toMatchObject({ cause: { code: 'ECONNREFUSED' } })
  })
})

// ─── Prospecting error-semantics regression ───────────────────────────────

/**
 * Mirrors src/lib/prospecting/audit.ts's classifyFetchError() plus its
 * manual redirect-loop string literals (as of this PR — audit.ts is not
 * modified here). Proves this module's thrown errors carry everything a
 * future caller needs to reproduce audit.ts's exact, externally observable
 * `fetch_error` strings after migrating to safeFetch(); see issue #965
 * "Compatibility".
 */
function mapToProspectingErrorString(err: unknown): string {
  if (err instanceof BlockedAddressError) return 'blocked_private_address'
  if (err instanceof TooManyRedirectsError) return 'too_many_redirects'
  if (err instanceof InvalidRedirectError) return `redirect_without_location_${err.status}`
  if (err instanceof DisallowedSchemeError) return 'non_http_redirect'
  const HARD_FAILURE_CODES = /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/
  const cause = (err as { cause?: { code?: string } })?.cause
  const code = cause?.code ?? (err as { code?: string })?.code ?? ''
  if (HARD_FAILURE_CODES.test(code)) return code
  if ((err as Error)?.name === 'TimeoutError') return 'timeout'
  return code || 'fetch_failed'
}

describe('prospecting error-semantics regression', () => {
  it('blocked private address maps to "blocked_private_address"', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }])
    const err = await safeFetch('https://internal.example/').catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('blocked_private_address')
  })

  it('too many redirects maps to "too_many_redirects"', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://good.example/next' } }))
    const err = await safeFetch('https://good.example/', { maxRedirects: 1 }).catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('too_many_redirects')
  })

  it('redirect without Location maps to "redirect_without_location_<status>"', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce(new Response(null, { status: 301 }))
    const err = await safeFetch('https://good.example/').catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('redirect_without_location_301')
  })

  it('ECONNREFUSED propagates as the same code string', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
    const err = await safeFetch('https://good.example/').catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('ECONNREFUSED')
  })

  it('a timeout abort maps to "timeout"', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    const err = await safeFetch('https://good.example/').catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('timeout')
  })
})

// ─── Crawler sibling-continuation minimal integration ─────────────────────

describe('crawler sibling-continuation minimal integration', () => {
  it('lets independent safeFetch calls fail individually without blocking siblings', async () => {
    // Mirrors site-audit/crawler.ts's existing pattern: a per-child
    // try/catch that reports the failure and continues to the next sibling
    // (e.g. resolveSitemapUrls's child-sitemap loop). No crawler.ts code is
    // imported or modified here — this proves safeFetch composes with that
    // pattern using nothing more than a plain try/catch per call.
    const urls = ['https://good-a.example/', 'http://169.254.169.254/metadata', 'https://good-b.example/']
    dnsLookupMock
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]) // good-a
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }]) // good-b (169.254.169.254 is a literal IP — no DNS call)
    undiciFetchMock
      .mockResolvedValueOnce(new Response('a-ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('b-ok', { status: 200 }))

    const results: Array<{ url: string; ok: boolean; body?: string; error?: string }> = []
    for (const url of urls) {
      try {
        const res = await safeFetch(url)
        results.push({ url, ok: true, body: await res.text() })
      } catch (err) {
        results.push({ url, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }

    expect(results[0]).toEqual({ url: urls[0], ok: true, body: 'a-ok' })
    expect(results[1].ok).toBe(false)
    expect(results[1].error).toMatch(/blocked/i)
    expect(results[2]).toEqual({ url: urls[2], ok: true, body: 'b-ok' })
    expect(undiciFetchMock).toHaveBeenCalledTimes(2) // the blocked middle URL never reached fetch
  })
})
