import { describe, it, expect } from 'vitest'
import {
  METRIC_CATALOG,
  SPOTLIGHT_METRIC_KEYS,
  OPTIONAL_SPOTLIGHT_METRIC_KEYS,
  summaryTileKeys,
} from '../metric-catalog'
import { ADS_METRIC_KEY } from '../../vocabulary'

describe('metric catalog — Google Ads keys', () => {
  it('has display metadata for every Google Ads key', () => {
    const googleKeys = Object.values(ADS_METRIC_KEY).filter(key => key.startsWith('ads.google.'))
    expect(googleKeys).toHaveLength(7)
    for (const key of googleKeys) expect(METRIC_CATALOG).toHaveProperty(key)
  })

  it('keeps optional tiles out of the always-on spotlight grid', () => {
    expect(OPTIONAL_SPOTLIGHT_METRIC_KEYS.filter(key => SPOTLIGHT_METRIC_KEYS.includes(key))).toEqual([])
    for (const key of OPTIONAL_SPOTLIGHT_METRIC_KEYS) expect(METRIC_CATALOG).toHaveProperty(key)
  })

  it('leaves the board unchanged for a client with no Google Ads rows', () => {
    expect(summaryTileKeys(new Set())).toEqual(SPOTLIGHT_METRIC_KEYS)
    expect(summaryTileKeys(new Set(SPOTLIGHT_METRIC_KEYS))).toEqual(SPOTLIGHT_METRIC_KEYS)
  })

  it('appends only the optional tiles a client actually has rows for', () => {
    expect(summaryTileKeys(new Set([ADS_METRIC_KEY.GOOGLE_SPEND]))).toEqual([
      ...SPOTLIGHT_METRIC_KEYS,
      ADS_METRIC_KEY.GOOGLE_SPEND,
    ])
    // A Google key that is not a spotlight tile never becomes one.
    expect(summaryTileKeys(new Set([ADS_METRIC_KEY.GOOGLE_CPA]))).toEqual(SPOTLIGHT_METRIC_KEYS)
  })
})
