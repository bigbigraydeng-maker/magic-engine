import { describe, it, expect } from 'vitest'
import { buildNewTourBody, suggestSlug } from '../_components/NewTourDialog'

describe('suggestSlug', () => {
  it('makes a lower-case dashed slug from an English name', () => {
    expect(suggestSlug('China Unveiled')).toBe('china-unveiled')
    expect(suggestSlug('  Tibet & Beyond: 2027! ')).toBe('tibet-beyond-2027')
  })
  it('gives nothing for a name with no latin letters', () => {
    expect(suggestSlug('云南')).toBe('')
  })
})

describe('buildNewTourBody', () => {
  const form = {
    destination: ' china ',
    tier: 'signature',
    slug: 'china-unveiled',
    name: ' China Unveiled ',
    durationText: '14 days',
    displayPriceText: '',
    singleSupplement: 'NZD $950',
    departures: [
      { departOn: '2027-03-22', returnOn: '2027-04-04', priceTextOverride: '' },
      { departOn: '', returnOn: '', priceTextOverride: '' },
    ],
  }
  it('trims text, drops empty optional fields and blank departure rows', () => {
    expect(buildNewTourBody(form)).toEqual({
      destination: 'china',
      tier: 'signature',
      slug: 'china-unveiled',
      tour: { name: 'China Unveiled', durationText: '14 days', singleSupplement: 'NZD $950' },
      departures: [{ departOn: '2027-03-22', returnOn: '2027-04-04' }],
    })
  })
})
