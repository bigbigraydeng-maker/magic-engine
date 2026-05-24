import { describe, it, expect } from 'vitest'
import { validateWordpressSiteUrl } from './url-guard'

describe('validateWordpressSiteUrl', () => {
  describe('accepts public HTTPS URLs', () => {
    it.each([
      ['https://example.com',                 'https://example.com'],
      ['https://example.com/',                'https://example.com'],          // trailing slash stripped
      ['https://example.com/blog',            'https://example.com'],          // path stripped
      ['https://example.com/?utm_source=x',   'https://example.com'],          // query stripped
      ['https://EXAMPLE.com',                 'https://example.com'],          // host lowercased
      ['https://blog.example.com.au',         'https://blog.example.com.au'],  // subdomain + .com.au
      ['https://example.com:443',             'https://example.com'],          // default 443 collapsed by URL parser
      ['  https://example.com  ',             'https://example.com'],          // whitespace trim
    ])('normalizes %p → %p', (input, expected) => {
      const r = validateWordpressSiteUrl(input)
      expect(r.ok).toBe(true)
      expect(r.normalizedUrl).toBe(expected)
      expect(r.error).toBeUndefined()
    })
  })

  describe('rejects non-HTTPS schemes', () => {
    it.each([
      'http://example.com',
      'ftp://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ])('rejects %p', input => {
      const r = validateWordpressSiteUrl(input)
      expect(r.ok).toBe(false)
      expect(r.error).toBeDefined()
    })
  })

  describe('rejects non-public hosts', () => {
    it.each([
      'https://localhost',
      'https://localhost/wp',
      'https://wordpress.local',
      'https://my-site.lan',
      'https://api.internal',
      'https://thing.test',
      'https://demo.example',
      'https://x.invalid',
      'https://wordpress',                 // single-label host
    ])('rejects %p', input => {
      const r = validateWordpressSiteUrl(input)
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/public domain/i)
    })
  })

  describe('rejects IP literals', () => {
    it.each([
      'https://127.0.0.1',
      'https://10.0.0.1',
      'https://192.168.1.1',
      'https://172.16.0.5',
      'https://169.254.169.254',           // AWS metadata
      'https://100.64.0.1',                // CGNAT
      'https://0.0.0.0',
      'https://224.0.0.1',                 // multicast
      'https://203.0.113.5',               // public IP — still rejected (require domain)
      'https://[::1]',
      'https://[fe80::1]',
    ])('rejects %p', input => {
      const r = validateWordpressSiteUrl(input)
      expect(r.ok).toBe(false)
      expect(r.error).toBeDefined()
    })
  })

  describe('rejects malformed input', () => {
    it.each([
      ['', 'site_url required'],
      ['   ', 'site_url required'],
      ['not a url', /Invalid URL/],
      ['https://', /missing a hostname|Invalid URL/],
      ['https://user:pass@example.com', /credentials/],
      ['https://example.com:8443', /port/],
    ] as const)('rejects %p', (input, expected) => {
      const r = validateWordpressSiteUrl(input)
      expect(r.ok).toBe(false)
      if (typeof expected === 'string') expect(r.error).toBe(expected)
      else                              expect(r.error).toMatch(expected)
    })

    it('rejects non-string input', () => {
      expect(validateWordpressSiteUrl(undefined).ok).toBe(false)
      expect(validateWordpressSiteUrl(null).ok).toBe(false)
      expect(validateWordpressSiteUrl(123).ok).toBe(false)
    })
  })
})
