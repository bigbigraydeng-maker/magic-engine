import { describe, it, expect } from 'vitest'
import { gscPageKey, GSC_PAGE_KEY_TRACKING_KEYS, GSC_PAGE_KEY_TRACKING_PREFIXES } from '../page-key'

describe('gscPageKey', () => {
  it('strips tracking params, keeps the rest sorted', () => {
    expect(
      gscPageKey('https://oztop.com.au/products?utm_source=fb&b=2&gclid=x&a=1&fbclid=y&msclkid=z&srsltid=q'),
    ).toBe('oztop.com.au/products?a=1&b=2')
  })

  it('tracking keys are matched case-insensitively', () => {
    expect(gscPageKey('https://example.com/a?UTM_Source=x&GCLID=1&keep=1')).toBe('example.com/a?keep=1')
  })

  it('🔴 a non-tracking query is kept, so /?da_image=8548 does not collapse into the home page', () => {
    expect(gscPageKey('https://www.oztop.com.au/?da_image=8548')).toBe('oztop.com.au/?da_image=8548')
    expect(gscPageKey('https://www.oztop.com.au/?da_image=8548')).not.toBe(
      gscPageKey('https://www.oztop.com.au/'),
    )
    expect(gscPageKey('https://www.oztop.com.au/')).toBe('oztop.com.au/')
  })

  it('http/https and www/bare give the same key', () => {
    expect(gscPageKey('http://www.example.com/a/')).toBe('example.com/a')
    expect(gscPageKey('https://example.com/a')).toBe('example.com/a')
  })

  it('host lower-cased, path case preserved', () => {
    expect(gscPageKey('https://Example.COM/Tours/NZ')).toBe('example.com/Tours/NZ')
  })

  it('fragment dropped', () => {
    expect(gscPageKey('https://example.com/a#section-2')).toBe('example.com/a')
  })

  it('trailing slashes', () => {
    expect(gscPageKey('https://example.com')).toBe('example.com/')
    expect(gscPageKey('https://example.com/')).toBe('example.com/')
    expect(gscPageKey('https://example.com/a//')).toBe('example.com/a')
  })

  it('percent-encoding normalised to upper-case hex', () => {
    expect(gscPageKey('https://example.com/caf%c3%a9')).toBe('example.com/caf%C3%A9')
    expect(gscPageKey('https://example.com/café')).toBe('example.com/caf%C3%A9')
  })

  it('query values re-encoded deterministically', () => {
    expect(gscPageKey('https://example.com/s?q=a+b')).toBe('example.com/s?q=a%20b')
    expect(gscPageKey('https://example.com/s?q=a%20b')).toBe('example.com/s?q=a%20b')
  })

  it('same-key params keep their original order', () => {
    expect(gscPageKey('https://example.com/l?sort=price&sort=date')).toBe(
      'example.com/l?sort=price&sort=date',
    )
    expect(gscPageKey('https://example.com/l?sort=date&sort=price')).toBe(
      'example.com/l?sort=date&sort=price',
    )
  })

  it('only tracking params → no ?', () => {
    expect(gscPageKey('https://example.com/a?utm_source=x&utm_medium=y')).toBe('example.com/a')
  })

  it('non-default port kept', () => {
    expect(gscPageKey('https://example.com:8443/a')).toBe('example.com:8443/a')
  })

  it('invalid input → null', () => {
    expect(gscPageKey('')).toBeNull()
    expect(gscPageKey('   ')).toBeNull()
    expect(gscPageKey('not a url')).toBeNull()
    expect(gscPageKey('ftp://example.com/x')).toBeNull()
    expect(gscPageKey('mailto:someone@example.com')).toBeNull()
  })

  it('the tracking list is pinned (changing it changes stored keys)', () => {
    expect([...GSC_PAGE_KEY_TRACKING_KEYS]).toEqual(['gclid', 'fbclid', 'msclkid', 'srsltid'])
    expect([...GSC_PAGE_KEY_TRACKING_PREFIXES]).toEqual(['utm_'])
  })
})
