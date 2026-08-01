/**
 * Unit tests for the pure verdict mapping in gsc/inspect.ts and the
 * daysSince helper feeding R5 (22.E.S15 后半).
 */

import { describe, it, expect } from 'vitest'
import { isIndexedState } from '../inspect'
import { daysSince } from '@/lib/seo-patrol/page-signals'

describe('isIndexedState', () => {
  it('PASS verdict is always indexed', () => {
    expect(isIndexedState('PASS', 'Submitted and indexed')).toBe(true)
    expect(isIndexedState('PASS', 'Indexed, not submitted in sitemap')).toBe(true)
  })

  it('"Discovered - currently not indexed" is not indexed', () => {
    expect(isIndexedState('NEUTRAL', 'Discovered - currently not indexed')).toBe(false)
  })

  it('"Crawled - currently not indexed" is not indexed', () => {
    expect(isIndexedState('NEUTRAL', 'Crawled - currently not indexed')).toBe(false)
  })

  it('non-PASS verdict with an indexed coverageState still counts as indexed', () => {
    expect(isIndexedState('NEUTRAL', 'Indexed, not submitted in sitemap')).toBe(true)
  })

  it('unknown states default to not indexed', () => {
    expect(isIndexedState('VERDICT_UNSPECIFIED', 'UNKNOWN')).toBe(false)
    expect(isIndexedState('FAIL', 'URL is unknown to Google')).toBe(false)
  })
})

describe('daysSince', () => {
  const now = new Date('2026-08-01T12:00:00Z')

  it('computes whole days since the timestamp', () => {
    expect(daysSince('2026-07-24T12:00:00Z', now)).toBe(8)
    expect(daysSince('2026-08-01T02:00:00Z', now)).toBe(0)
  })

  it('returns null for null/invalid input', () => {
    expect(daysSince(null, now)).toBeNull()
    expect(daysSince('not-a-date', now)).toBeNull()
  })
})
