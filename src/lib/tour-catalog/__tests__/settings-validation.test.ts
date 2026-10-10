import { describe, expect, it } from 'vitest'
import {
  hostBelongsToDomain,
  normaliseMemberEmail,
  validateSettings,
} from '../settings-validation'

const DOMAIN = 'ctstours.co.nz'
const LOGO = 'https://www.ctstours.co.nz/logo.png'

function settings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    logoUrl: LOGO,
    brandPrimary: '#B61E2E',
    brandSecondary: '#D6A756',
    channelsConnected: false,
    imageHosts: [],
    ...overrides,
  }
}

describe('validateSettings — happy paths', () => {
  it('accepts a full valid settings object', () => {
    const result = validateSettings(settings(), DOMAIN)
    expect(result).toEqual({
      ok: true,
      value: {
        logoUrl: LOGO,
        brandPrimary: '#B61E2E',
        brandSecondary: '#D6A756',
        channelsConnected: false,
        imageHosts: [],
      },
    })
  })

  it('accepts a stored domain written as a full URL', () => {
    const result = validateSettings(settings(), 'https://www.CTSTours.co.nz/')
    expect(result.ok).toBe(true)
  })

  it('accepts a logo on the bare registered domain', () => {
    const result = validateSettings(settings({ logoUrl: 'https://ctstours.co.nz/a.png' }), DOMAIN)
    expect(result.ok).toBe(true)
  })

  it('accepts a logo on a subdomain of the registered domain', () => {
    const result = validateSettings(settings({ logoUrl: 'https://cdn.ctstours.co.nz/a.png' }), DOMAIN)
    expect(result.ok).toBe(true)
  })

  it('accepts all-null nullable fields with channelsConnected true', () => {
    const result = validateSettings(
      { logoUrl: null, brandPrimary: null, brandSecondary: null, channelsConnected: true, imageHosts: [] },
      DOMAIN,
    )
    expect(result).toEqual({
      ok: true,
      value: {
        logoUrl: null,
        brandPrimary: null,
        brandSecondary: null,
        channelsConnected: true,
        imageHosts: [],
      },
    })
  })
})

describe('validateSettings — colours', () => {
  const badColors = ['red', '#fff', '#B61E2E;', '#GGGGGG', 123, '']

  it.each(badColors)('rejects brandPrimary %p', (color) => {
    expect(validateSettings(settings({ brandPrimary: color }), DOMAIN)).toEqual({
      ok: false,
      error: 'invalid_color',
    })
  })

  it.each(badColors)('rejects brandSecondary %p', (color) => {
    expect(validateSettings(settings({ brandSecondary: color }), DOMAIN)).toEqual({
      ok: false,
      error: 'invalid_color',
    })
  })
})

describe('validateSettings — logo URLs', () => {
  const badLogos: unknown[] = [
    'http://www.ctstours.co.nz/logo.png',
    'javascript:alert(1)',
    'not a url',
    '//www.ctstours.co.nz/x.png',
    'https://user:pw@www.ctstours.co.nz/x.png',
    'https://www.ctstours.co.nz:8443/x.png',
    'https://www.ctstours.co.nz/a b.png',
    `https://www.ctstours.co.nz/${'a'.repeat(501)}`,
    123,
  ]

  it.each(badLogos)('rejects logo %p', (logo) => {
    expect(validateSettings(settings({ logoUrl: logo }), DOMAIN)).toEqual({
      ok: false,
      error: 'invalid_logo_url',
    })
  })

  const foreignLogos = [
    'https://evil.example/logo.png',
    'https://ctstours.co.nz.evil.example/logo.png',
    'https://evilctstours.co.nz/logo.png',
  ]

  it.each(foreignLogos)('rejects foreign logo %p', (logo) => {
    expect(validateSettings(settings({ logoUrl: logo }), DOMAIN)).toEqual({
      ok: false,
      error: 'logo_not_on_client_domain',
    })
  })

  it('rejects a logo when the client domain is null', () => {
    expect(validateSettings(settings(), null)).toEqual({
      ok: false,
      error: 'logo_not_on_client_domain',
    })
  })

  it('rejects a logo when the client domain is empty', () => {
    expect(validateSettings(settings(), '')).toEqual({
      ok: false,
      error: 'logo_not_on_client_domain',
    })
  })

  it('accepts a null logo when the client domain is null', () => {
    const result = validateSettings(settings({ logoUrl: null }), null)
    expect(result.ok).toBe(true)
  })
})

describe('validateSettings — malformed requests', () => {
  const badInputs: unknown[] = [
    'nope',
    [],
    null,
    { logoUrl: LOGO, brandPrimary: '#B61E2E', brandSecondary: '#D6A756' },
    settings({ channelsConnected: 'true' }),
    { brandPrimary: '#B61E2E', brandSecondary: '#D6A756', channelsConnected: false },
    { logoUrl: LOGO, brandSecondary: '#D6A756', channelsConnected: false },
  ]

  it.each(badInputs)('rejects %p', (input) => {
    expect(validateSettings(input, DOMAIN)).toEqual({ ok: false, error: 'invalid_request' })
  })
})

describe('hostBelongsToDomain', () => {
  it('accepts the registered domain and its subdomains', () => {
    expect(hostBelongsToDomain('www.ctstours.co.nz', DOMAIN)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(hostBelongsToDomain('CTSTOURS.CO.NZ', DOMAIN)).toBe(true)
  })

  it('rejects a lookalike host', () => {
    expect(hostBelongsToDomain('notctstours.co.nz', DOMAIN)).toBe(false)
  })

  it('rejects a domain without a dot', () => {
    expect(hostBelongsToDomain('nz', 'nz')).toBe(false)
  })

  it('rejects everything when the client domain is null', () => {
    expect(hostBelongsToDomain('www.ctstours.co.nz', null)).toBe(false)
  })
})

describe('normaliseMemberEmail', () => {
  it('trims and lower-cases a valid address', () => {
    expect(normaliseMemberEmail('  Staff@Example.COM ')).toBe('staff@example.com')
  })

  it('accepts a short valid address', () => {
    expect(normaliseMemberEmail('a@b.co')).toBe('a@b.co')
  })

  const badEmails: unknown[] = [
    '',
    'no-at',
    'a@b',
    'a b@c.de',
    'a@b@c.de',
    '<x>@c.de',
    `${'a'.repeat(250)}@example.com`,
    42,
    null,
  ]

  it.each(badEmails)('rejects %p', (email) => {
    expect(normaliseMemberEmail(email)).toBeNull()
  })
})

describe('validateSettings — image hosts (design §6.11.1 item 7)', () => {
  it('accepts up to 10 bare lower-case hostnames and drops duplicates', () => {
    const hosts = Array.from({ length: 10 }, (_, i) => `img${i}.example-cdn.com`)
    const result = validateSettings(settings({ imageHosts: hosts }), DOMAIN)
    expect(result.ok && result.value.imageHosts).toEqual(hosts)
    const deduped = validateSettings(settings({ imageHosts: ['a.example.com', 'a.example.com'] }), DOMAIN)
    expect(deduped.ok && deduped.value.imageHosts).toEqual(['a.example.com'])
  })

  it.each([
    ['missing', undefined],
    ['not an array', 'a.example.com'],
    ['11 hosts', Array.from({ length: 11 }, (_, i) => `img${i}.example-cdn.com`)],
    ['upper case', ['Img.Example.com']],
    ['with a scheme', ['https://img.example.com']],
    ['with a path', ['img.example.com/a']],
    ['with a port', ['img.example.com:8443']],
    ['an IPv4 literal', ['10.0.0.1']],
    ['an IPv6 literal', ['[::1]']],
    ['no dot', ['localhost']],
    ['a wildcard', ['*.example.com']],
    ['an empty string', ['']],
    ['a number', [42]],
    ['a trailing dot', ['img.example.com.']],
    ['a space', ['img.example.com ']],
    ['an angle bracket', ['img.example.com>']],
  ])('refuses the whole request when imageHosts is %s', (_label, imageHosts) => {
    expect(validateSettings(settings({ imageHosts }), DOMAIN)).toEqual({ ok: false, error: 'invalid_request' })
  })
})
