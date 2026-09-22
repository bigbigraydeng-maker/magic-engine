import { describe, expect, it } from 'vitest'
import { normalizeTrafficEstimate } from '../traffic-estimator'

describe('traffic estimate normalization', () => {
  it('normalizes public estimate fields and keeps low-confidence provenance', () => {
    const result = normalizeTrafficEstimate({
      domain: 'https://www.WendyWuTours.co.nz/',
      total_visits: '15.2K',
      visits_change_pct: '+31.0%',
      bounce_rate_pct: 27.9,
      pages_per_visit: 4.36,
      avg_visit_duration: '00:04:22',
      top_country: 'New Zealand',
      top_countries: [{ country: 'New Zealand', share_pct: 90.6 }, { country: 'United States', share_pct: 9.4 }],
      traffic_sources: { organic: 45, direct: 'not-a-number' },
      checked_at: '2026-09-12T17:25:32.902Z',
    }, '2026-09-13T00:00:00.000Z')

    expect(result).toMatchObject({
      domain: 'wendywutours.co.nz',
      total_visits: '15.2K',
      visits_change_pct: 31,
      top_country: 'New Zealand',
      source: 'similarweb_public_estimate_via_apify',
      confidence: 'low',
    })
    expect(result?.traffic_sources).toEqual({ organic: 45 })
  })

  it.each(['', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/path', 'example'])('rejects unsafe or incomplete domain %s', domain => {
    expect(normalizeTrafficEstimate({ domain }, '2026-09-13T00:00:00.000Z')).toBeNull()
  })

  it('rejects summary rows without a domain', () => {
    expect(normalizeTrafficEstimate({ total_visits: '15.2K' }, '2026-09-13T00:00:00.000Z')).toBeNull()
  })
})
