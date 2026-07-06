import { describe, it, expect } from 'vitest'
import { calculateProspectScore, QUALIFICATION_THRESHOLD, type ProspectScoreInput } from '../score'
import type { TrackingSignals } from '../tracking-detector'
import type { OnPageResult } from '@/lib/dataforseo/onpage'

const NO_TRACKING: TrackingSignals = {
  ga4: false, gtm: false, meta_pixel: false, clarity: false,
  legacy_ua: true, contact_form: false, emails: [],
}

const FULL_TRACKING: TrackingSignals = {
  ga4: true, gtm: true, meta_pixel: true, clarity: true,
  legacy_ua: false, contact_form: true, emails: ['hi@biz.com.au'],
}

function onpage(overrides: Partial<OnPageResult> = {}): OnPageResult {
  return {
    url: 'https://biz.com.au/', status_code: 200,
    title: 'Biz', description: 'desc', canonical: null, h1: 'Biz',
    internal_links: 10, external_links: 2, images_no_alt: 0, images_total: 5,
    word_count: 800, core_web_vitals: { lcp: 1500, cls: 0, tbt: 100 },
    checks: {
      no_title: false, no_description: false, no_h1: false,
      missing_alt_text: false, broken_links: false, redirect_chain: false, https: true,
    },
    ...overrides,
  }
}

function input(overrides: Partial<ProspectScoreInput> = {}): ProspectScoreInput {
  return {
    rating: 4.7, review_count: 120, has_phone: true, is_claimed: true,
    has_website: true, https_ok: true, tracking: NO_TRACKING, onpage: onpage(),
    ...overrides,
  }
}

describe('calculateProspectScore', () => {
  it('qualifies the ideal prospect: strong business, weak digital foundation', () => {
    const r = calculateProspectScore(input({
      onpage: onpage({
        word_count: 150,
        core_web_vitals: { lcp: 6000, cls: 0.3, tbt: 900 },
        checks: {
          no_title: true, no_description: true, no_h1: true,
          missing_alt_text: true, broken_links: false, redirect_chain: false, https: true,
        },
      }),
    }))
    // Full 40 strength + 10(ga4)+4(gtm)+8(pixel)+4(ua)+6(form)+3+3+2+8(lcp)+4(thin) = 92
    expect(r.score).toBe(92)
    expect(r.qualified).toBe(true)
  })

  it('does not qualify an already-modern site even with a strong business', () => {
    const r = calculateProspectScore(input({ tracking: FULL_TRACKING }))
    // 40 strength, no weaknesses
    expect(r.score).toBe(40)
    expect(r.qualified).toBe(false)
  })

  it('never qualifies a prospect without a website', () => {
    const r = calculateProspectScore(input({
      has_website: false, https_ok: null, tracking: null, onpage: null,
    }))
    expect(r.qualified).toBe(false)
    // Weakness signals must not fire without a site to audit
    expect(r.breakdown.every(s => s.kind === 'strength')).toBe(true)
  })

  it('scores a weak business below threshold even with a weak site', () => {
    const r = calculateProspectScore(input({
      rating: 3.1, review_count: 4, has_phone: false, is_claimed: false,
      tracking: NO_TRACKING,
      onpage: null,
    }))
    // strength: only has_website 6; weakness: 10+4+8+4+6 = 32 → 38
    expect(r.score).toBeLessThan(QUALIFICATION_THRESHOLD)
    expect(r.qualified).toBe(false)
  })

  it('does not claim "no GA4" when GTM is present (GA4 may live in the container)', () => {
    const r = calculateProspectScore(input({
      tracking: { ...NO_TRACKING, gtm: true },
    }))
    expect(r.breakdown.find(s => s.signal === 'no_ga4')).toBeUndefined()
    expect(r.breakdown.find(s => s.signal === 'no_gtm')).toBeUndefined()
  })

  it('counts unreachable https as a weakness', () => {
    const withSsl    = calculateProspectScore(input())
    const withoutSsl = calculateProspectScore(input({ https_ok: false }))
    expect(withoutSsl.score - withSsl.score).toBe(8)
  })

  it('caps the score at 100 and sums breakdown to score', () => {
    const r = calculateProspectScore(input({
      https_ok: false,
      onpage: onpage({
        word_count: 10,
        core_web_vitals: { lcp: 9000, cls: 1, tbt: 2000 },
        checks: {
          no_title: true, no_description: true, no_h1: true,
          missing_alt_text: true, broken_links: true, redirect_chain: true, https: false,
        },
      }),
    }))
    expect(r.score).toBeLessThanOrEqual(100)
    expect(r.breakdown.reduce((s, x) => s + x.points, 0)).toBe(r.score)
  })
})
