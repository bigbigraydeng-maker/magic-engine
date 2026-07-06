import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normaliseUrl, isPrivateIp, runProspectAudit } from '../audit'

vi.mock('@/lib/validation-utils', () => ({
  validateEnvVar: () => 'test',
}))

vi.mock('@/lib/dataforseo/onpage', () => ({
  getOnPageInstant: vi.fn().mockResolvedValue(null),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

describe('normaliseUrl', () => {
  it('upgrades bare domains and http to https', () => {
    expect(normaliseUrl('ozflooring.com.au')).toBe('https://ozflooring.com.au/')
    expect(normaliseUrl('http://ozflooring.com.au/about')).toBe('https://ozflooring.com.au/about')
  })

  it('returns null instead of throwing on poison inputs', () => {
    for (const poison of ['', '   ', 'https://', 'exa mple.com', 'https://exa mple.com']) {
      expect(normaliseUrl(poison)).toBeNull()
    }
  })
})

describe('isPrivateIp', () => {
  it('blocks private, loopback, link-local and CGNAT ranges', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.9.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '203.0.113.5', '2404:6800::1']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})

describe('runProspectAudit', () => {
  it('returns indeterminate audit for an invalid URL without fetching', async () => {
    const audit = await runProspectAudit('   ')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('invalid_url')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('blocks private-IP hosts without fetching', async () => {
    const audit = await runProspectAudit('https://169.254.169.254/latest/meta-data')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('blocked_private_address')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('classifies connection refusal as definitively unreachable (https_ok=false)', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    }))
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBe(false)
    expect(audit.fetch_error).toBe('ECONNREFUSED')
  })

  it('treats a WAF 403 as indeterminate, not as missing SSL', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, headers: new Headers() } as Response)
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('http_403')
  })

  it('blocks a redirect hopping to a private address', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 302,
      headers: new Headers({ location: 'https://10.0.0.1/internal' }),
    } as Response)
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('blocked_private_address')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('follows a public redirect and audits the final page', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false, status: 301,
        headers: new Headers({ location: 'https://9.9.9.9/home' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200, url: 'https://9.9.9.9/home',
        headers: new Headers(),
        text: () => Promise.resolve('<html><script src="https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD"></script></html>'),
      } as unknown as Response)
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBe(true)
    expect(audit.final_url).toBe('https://9.9.9.9/home')
    expect(audit.tracking?.gtm).toBe(true)
  })

  it('gives up after too many redirects', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 302,
      headers: new Headers({ location: 'https://8.8.8.8/loop' }),
    } as Response)
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('too_many_redirects')
  })
})
