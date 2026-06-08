import { describe, expect, it } from 'vitest'

import {
  attributionFromSearchParams,
  normaliseAttribution,
  withAttribution,
} from '@/lib/marketing/attribution'

describe('normaliseAttribution', () => {
  it('keeps only supported non-empty string fields', () => {
    expect(
      normaliseAttribution({
        utm_source: ' google ',
        utm_medium: 'cpc',
        ignored: 'x',
        entry_page: '',
      }),
    ).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
    })
  })

  it('returns null when nothing usable is present', () => {
    expect(normaliseAttribution({ ignored: 'x' })).toBeNull()
    expect(normaliseAttribution(null)).toBeNull()
  })
})

describe('attributionFromSearchParams', () => {
  it('reads marketing fields from search params', () => {
    const params = new URLSearchParams(
      'utm_source=google&utm_campaign=nz_zh_ads_validation_v1&entry_page=cn_ads',
    )

    expect(attributionFromSearchParams(params)).toEqual({
      utm_source: 'google',
      utm_campaign: 'nz_zh_ads_validation_v1',
      entry_page: 'cn_ads',
    })
  })
})

describe('withAttribution', () => {
  it('adds attribution to relative links', () => {
    expect(
      withAttribution('/cn/discover?url=example.com', {
        utm_source: 'google',
        entry_offer: 'free_diagnosis',
      }),
    ).toBe('/cn/discover?url=example.com&utm_source=google&entry_offer=free_diagnosis')
  })

  it('adds attribution to absolute links', () => {
    expect(
      withAttribution('https://app.magicengine.com.au/contact?source=ads', {
        utm_campaign: 'nz_zh_ads_validation_v1',
        entry_page: 'cn_ads',
      }),
    ).toBe(
      'https://app.magicengine.com.au/contact?source=ads&utm_campaign=nz_zh_ads_validation_v1&entry_page=cn_ads',
    )
  })
})
