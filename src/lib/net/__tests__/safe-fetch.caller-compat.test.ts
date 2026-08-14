/**
 * safe-fetch — caller-compatibility regression suite (mocked).
 *
 * Issue #965 requires that `prospecting/audit.ts`'s externally observable
 * behaviour and error strings stay unchanged. This PR does not modify that
 * file at all (it is at zero diff versus origin/main), so there is nothing to
 * regress *yet* — what these tests lock down is that the errors this module
 * throws carry enough information for a future migration to reproduce those
 * exact strings, and the sibling-continuation shape the crawler relies on.
 *
 * The mappers below are copies of the caller logic as it exists on
 * origin/main, deliberately duplicated here rather than imported: importing
 * would couple this suite to a file this PR must not touch, and a copy that
 * drifts is caught the moment the migration PR wires the real caller up.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dnsLookupMock = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: dnsLookupMock, default: { lookup: dnsLookupMock } }))

const undiciFetchMock = vi.hoisted(() => vi.fn())
vi.mock('undici', async importOriginal => {
  const actual = await importOriginal<typeof import('undici')>()
  class MockAgent {
    async close() {}
  }
  return { ...actual, Agent: MockAgent, fetch: undiciFetchMock }
})

import { Response } from 'undici'
import {
  safeFetchText,
  BlockedAddressError,
  DisallowedSchemeError,
  TooManyRedirectsError,
  InvalidRedirectError,
} from '../safe-fetch'

const publicAnswer = [{ address: '93.184.216.34', family: 4 }]

beforeEach(() => {
  dnsLookupMock.mockReset()
  undiciFetchMock.mockReset()
})

// ─── Caller error-semantics regression ────────────────────────────────────

/**
 * Mirrors `src/lib/prospecting/audit.ts`'s `classifyFetchError()` plus its
 * redirect-loop string literals as they exist on `origin/main` (that file is
 * NOT modified by this PR). Proves the errors this module throws carry enough
 * information for a future migration to reproduce audit.ts's exact,
 * externally observable `fetch_error` strings — issue #965 "Compatibility".
 */
function mapToProspectingErrorString(err: unknown): string {
  if (err instanceof BlockedAddressError) return 'blocked_private_address'
  if (err instanceof TooManyRedirectsError) return 'too_many_redirects'
  if (err instanceof InvalidRedirectError) return `redirect_without_location_${err.status}`
  if (err instanceof DisallowedSchemeError) return 'non_http_redirect'
  const HARD = /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/
  const cause = (err as { cause?: { code?: string } })?.cause
  const code = cause?.code ?? (err as { code?: string })?.code ?? ''
  if (HARD.test(code)) return code
  if ((err as Error)?.name === 'TimeoutError') return 'timeout'
  return code || 'fetch_failed'
}

describe('prospecting error-semantics regression', () => {
  it('blocked private address maps to "blocked_private_address"', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }])
    const err = await safeFetchText('https://internal.example/').catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('blocked_private_address')
  })

  it('too many redirects maps to "too_many_redirects"', async () => {
    dnsLookupMock.mockResolvedValue(publicAnswer)
    undiciFetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://good.example/next' } })
    )
    const err = await safeFetchText('https://good.example/', { maxRedirects: 1 }).catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('too_many_redirects')
  })

  it('redirect without Location maps to "redirect_without_location_<status>"', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockResolvedValueOnce(new Response(null, { status: 301 }))
    const err = await safeFetchText('https://good.example/').catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('redirect_without_location_301')
  })

  it('a scheme-changing Location maps to "non_http_redirect"', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'ftp://good.example/x' } })
    )
    const err = await safeFetchText('https://good.example/').catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('non_http_redirect')
  })

  it('ECONNREFUSED propagates as the same code string', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockRejectedValueOnce(
      Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    )
    const err = await safeFetchText('https://good.example/').catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('ECONNREFUSED')
  })

  it('a timeout abort maps to "timeout"', async () => {
    dnsLookupMock.mockResolvedValueOnce(publicAnswer)
    undiciFetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    const err = await safeFetchText('https://good.example/').catch(e => e)
    expect(mapToProspectingErrorString(err)).toBe('timeout')
  })
})

// ─── Crawler sibling continuation ─────────────────────────────────────────

describe('crawler sibling-continuation interface', () => {
  it('lets independent calls fail individually without blocking siblings', async () => {
    // Mirrors site-audit/crawler.ts's per-child try/catch that reports a
    // failure and continues to the next sibling. No crawler.ts code is
    // imported or modified — this shows safeFetchText composes with that
    // pattern using nothing but a plain try/catch per call.
    const urls = ['https://good-a.example/', 'http://169.254.169.254/metadata', 'https://good-b.example/']
    dnsLookupMock
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])   // good-a
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])   // good-b (the metadata IP is a literal — no DNS)
    undiciFetchMock
      .mockResolvedValueOnce(new Response('a-ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('b-ok', { status: 200 }))

    const results: Array<{ url: string; ok: boolean; body?: string; error?: string }> = []
    for (const url of urls) {
      try {
        const res = await safeFetchText(url)
        results.push({ url, ok: true, body: res.text })
      } catch (err) {
        results.push({ url, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }

    expect(results[0]).toEqual({ url: urls[0], ok: true, body: 'a-ok' })
    expect(results[1].ok).toBe(false)
    expect(results[1].error).toMatch(/blocked/i)
    expect(results[2]).toEqual({ url: urls[2], ok: true, body: 'b-ok' })
    expect(undiciFetchMock).toHaveBeenCalledTimes(2) // the blocked URL never reached fetch
  })
})
