/**
 * GBP location matching — the guard against publishing a client's content
 * on someone else's storefront.
 */

import { describe, expect, it } from 'vitest'
import { hostRoot, composeLocationResource, pickClientLocation } from '../location'

const loc = (name: string, title: string | null, websiteUri: string | null) => ({
  name, title, websiteUri,
})

const CTS = { domain: 'ctstours.co.nz', name: 'CTS Tours NZ' }

describe('hostRoot', () => {
  it('strips protocol, www and path', () => {
    expect(hostRoot('https://www.ctstours.co.nz/tours')).toBe('ctstours.co.nz')
    expect(hostRoot('HTTP://CTSTOURS.CO.NZ')).toBe('ctstours.co.nz')
    expect(hostRoot(null)).toBe('')
  })
})

describe('composeLocationResource', () => {
  it('joins the v1 bare location name onto the account path (v4 post needs both)', () => {
    expect(composeLocationResource('accounts/123', 'locations/456')).toBe('accounts/123/locations/456')
    expect(composeLocationResource('accounts/123/', 'locations/456')).toBe('accounts/123/locations/456')
  })

  it('passes through an already-qualified name unchanged', () => {
    expect(composeLocationResource('accounts/123', 'accounts/999/locations/456'))
      .toBe('accounts/999/locations/456')
  })
})

describe('pickClientLocation', () => {
  it('matches on website host first, even when another title looks similar', () => {
    const { match } = pickClientLocation([
      loc('locations/1', 'CTS Tours NZ', 'https://impostor.co.nz'),
      loc('locations/2', 'Some Other Trading Name', 'https://www.ctstours.co.nz'),
    ], CTS)
    expect(match?.name).toBe('locations/2')
  })

  it('falls back to an exact title match when no website matches', () => {
    const { match } = pickClientLocation([
      loc('locations/1', 'Unrelated Shop', null),
      loc('locations/2', 'cts tours nz', null),
    ], CTS)
    expect(match?.name).toBe('locations/2')
  })

  it('takes the only location when it carries no website (nothing contradicts it)', () => {
    const { match } = pickClientLocation([loc('locations/9', 'Whatever Ltd', null)], CTS)
    expect(match?.name).toBe('locations/9')
  })

  it('REFUSES the only location when it visibly belongs to someone else', () => {
    // 真实场景: CTS 和 oztop 用同一个 Google 账号授权。若该账号此刻只暴露
    // CTS 一家门店，天真的「只有一家就用」会把 oztop 的帖子绑到 CTS 门店上。
    const { match, reason } = pickClientLocation(
      [loc('locations/1', 'CTS Tours NZ', 'https://www.ctstours.co.nz')],
      { domain: 'oztopbuildingsupplies.com.au', name: 'oztop' },
    )
    expect(match).toBeNull()
    expect(reason).toBe('ambiguous')
  })

  it('the only location on the client own website is still accepted', () => {
    const { match } = pickClientLocation(
      [loc('locations/1', 'Trading Name Ltd', 'https://ctstours.co.nz')],
      CTS,
    )
    expect(match?.name).toBe('locations/1')
  })

  it('refuses to guess between several unmatched locations', () => {
    const { match, reason } = pickClientLocation([
      loc('locations/1', 'Branch A', 'https://other-a.co.nz'),
      loc('locations/2', 'Branch B', 'https://other-b.co.nz'),
    ], CTS)
    expect(match).toBeNull()
    expect(reason).toBe('ambiguous')
  })

  it('several branches on the client own host stay ambiguous (which branch is a human call)', () => {
    const { match, reason } = pickClientLocation([
      loc('locations/1', 'CTS Auckland', 'https://www.ctstours.co.nz'),
      loc('locations/2', 'CTS Christchurch', 'https://www.ctstours.co.nz'),
    ], CTS)
    expect(match).toBeNull()
    expect(reason).toBe('ambiguous')
  })

  it('same trading name on two different businesses stays ambiguous', () => {
    // Titles are not unique across businesses, so a duplicate title must not
    // resolve — that is exactly how content lands on a stranger storefront.
    const { match, reason } = pickClientLocation([
      loc('locations/1', 'CTS Tours NZ', 'https://impostor-a.co.nz'),
      loc('locations/2', 'CTS Tours NZ', 'https://impostor-b.co.nz'),
    ], CTS)
    expect(match).toBeNull()
    expect(reason).toBe('ambiguous')
  })

  it('reports no_locations for an empty account', () => {
    const { match, reason } = pickClientLocation([], CTS)
    expect(match).toBeNull()
    expect(reason).toBe('no_locations')
  })

  it('a client with no domain still matches by title', () => {
    const { match } = pickClientLocation(
      [loc('locations/1', 'Oztop Building Supplies', 'https://x.com')],
      { domain: null, name: 'Oztop Building Supplies' },
    )
    expect(match?.name).toBe('locations/1')
  })
})
