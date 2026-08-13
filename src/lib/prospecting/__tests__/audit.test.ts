import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SafeFetchError } from '@/lib/security/safe-fetch'
import { discoverContactEmail, isPrivateIp, normaliseUrl, runProspectAudit } from '../audit'

const { mockSafeFetchText } = vi.hoisted(() => ({ mockSafeFetchText: vi.fn() }))

vi.mock('@/lib/security/safe-fetch', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/security/safe-fetch')>(),
  safeFetchText: mockSafeFetchText,
}))

vi.mock('@/lib/validation-utils', () => ({ validateEnvVar: () => 'test' }))

vi.mock('@/lib/dataforseo/onpage', () => ({
  getOnPageInstant: vi.fn().mockResolvedValue(null),
}))

beforeEach(() => mockSafeFetchText.mockReset())

function okPage(url: string, html: string) {
  return { ok: true, status: 200, finalUrl: url, text: html }
}

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
  it('blocks every non-public class delegated to the shared classifier', () => {
    const blocked = [
      '10.0.0.1', '127.0.0.1', '172.16.9.1', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fea0::1', 'febf::1',
      '::ffff:7f00:1', '203.0.113.5',
    ]
    for (const ip of blocked) expect(isPrivateIp(ip), ip).toBe(true)
  })

  it('allows public IPv4 and IPv6 addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2404:6800::1']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})

describe('runProspectAudit safe-fetch integration', () => {
  it('returns indeterminate audit for an invalid URL without fetching', async () => {
    const audit = await runProspectAudit('   ')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('invalid_url')
    expect(mockSafeFetchText).not.toHaveBeenCalled()
  })

  it('keeps the existing private-address error string', async () => {
    mockSafeFetchText.mockRejectedValueOnce(new SafeFetchError(
      'blocked_address',
      'https://169.254.169.254/latest/meta-data',
    ))
    const audit = await runProspectAudit('https://169.254.169.254/latest/meta-data')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('blocked_private_address')
  })

  it('classifies connection refusal as definitively unreachable', async () => {
    mockSafeFetchText.mockRejectedValueOnce(new SafeFetchError('request_failed', 'https://8.8.8.8/', {
      cause: Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }),
    }))
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBe(false)
    expect(audit.fetch_error).toBe('ECONNREFUSED')
  })

  it('treats a WAF 403 as indeterminate, not as missing SSL', async () => {
    mockSafeFetchText.mockResolvedValue({ ok: false, status: 403, finalUrl: 'https://8.8.8.8/', text: '' })
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('http_403')
  })

  it('preserves redirect and timeout error strings', async () => {
    const cases = [
      [new SafeFetchError('unsupported_scheme', 'file:///etc/passwd'), 'non_http_redirect'],
      [new SafeFetchError('redirect_without_location', 'https://8.8.8.8/', { status: 302 }), 'redirect_without_location_302'],
      [new SafeFetchError('too_many_redirects', 'https://8.8.8.8/'), 'too_many_redirects'],
      [new SafeFetchError('timeout', 'https://8.8.8.8/'), 'timeout'],
      [new SafeFetchError('response_too_large', 'https://8.8.8.8/'), 'fetch_failed'],
    ] as const
    for (const [error, expected] of cases) {
      mockSafeFetchText.mockRejectedValueOnce(error)
      const audit = await runProspectAudit('https://8.8.8.8/')
      expect(audit.fetch_error).toBe(expected)
      expect(audit.https_ok).toBeNull()
    }
  })

  it('blocks a redirect hopping to a private address', async () => {
    mockSafeFetchText.mockRejectedValueOnce(new SafeFetchError(
      'blocked_address',
      'https://10.0.0.1/internal',
    ))
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('blocked_private_address')
    expect(mockSafeFetchText).toHaveBeenCalledTimes(1)
  })

  it('follows a public redirect and audits the final page', async () => {
    mockSafeFetchText.mockResolvedValue(okPage(
      'https://9.9.9.9/home',
      '<html><script src="https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD"></script></html>',
    ))
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBe(true)
    expect(audit.final_url).toBe('https://9.9.9.9/home')
    expect(audit.tracking?.gtm).toBe(true)
  })

  it('gives up after too many redirects', async () => {
    mockSafeFetchText.mockRejectedValueOnce(new SafeFetchError(
      'too_many_redirects',
      'https://8.8.8.8/',
    ))
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.https_ok).toBeNull()
    expect(audit.fetch_error).toBe('too_many_redirects')
  })

  it('scrapes an email off the contact page when the homepage has none', async () => {
    mockSafeFetchText
      .mockResolvedValueOnce(okPage('https://8.8.8.8/', '<html>call us on 09 123 4567</html>'))
      .mockResolvedValueOnce(okPage('https://8.8.8.8/contact', '<a href="mailto:hello@realbiz.co.nz">Email</a>'))
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.tracking?.emails).toEqual(['hello@realbiz.co.nz'])
    expect(mockSafeFetchText).toHaveBeenCalledTimes(2)
  })

  it('does not fetch contact pages when the homepage already has an email', async () => {
    mockSafeFetchText.mockResolvedValueOnce(okPage(
      'https://8.8.8.8/',
      '<a href="mailto:info@onhome.co.nz">a</a>',
    ))
    const audit = await runProspectAudit('https://8.8.8.8/')
    expect(audit.tracking?.emails).toEqual(['info@onhome.co.nz'])
    expect(mockSafeFetchText).toHaveBeenCalledTimes(1)
  })
})

describe('discoverContactEmail (P35.11 re-scan)', () => {
  it('returns the homepage email without touching contact pages', async () => {
    mockSafeFetchText.mockResolvedValueOnce(okPage(
      'https://8.8.8.8/',
      '<a href="mailto:info@biz.co.nz">a</a>',
    ))
    expect(await discoverContactEmail('https://8.8.8.8/')).toEqual(['info@biz.co.nz'])
    expect(mockSafeFetchText).toHaveBeenCalledTimes(1)
  })

  it('falls through to a contact page when the homepage has no email', async () => {
    mockSafeFetchText
      .mockResolvedValueOnce(okPage('https://8.8.8.8/', '<html>phone 09 1234</html>'))
      .mockResolvedValueOnce(okPage('https://8.8.8.8/contact', '<a href="mailto:hi@biz.co.nz">x</a>'))
    expect(await discoverContactEmail('8.8.8.8')).toEqual(['hi@biz.co.nz'])
  })

  it('returns [] on an invalid URL without fetching', async () => {
    expect(await discoverContactEmail('not a url')).toEqual([])
    expect(mockSafeFetchText).not.toHaveBeenCalled()
  })

  it('returns [] (never throws) when the fetch fails', async () => {
    mockSafeFetchText.mockRejectedValueOnce(new SafeFetchError('dns_failed', 'https://8.8.8.8/'))
    expect(await discoverContactEmail('https://8.8.8.8/')).toEqual([])
  })
})
