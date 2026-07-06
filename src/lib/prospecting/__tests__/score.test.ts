import { describe, it, expect } from 'vitest'
import { calculateProspectScore, QUALIFICATION_THRESHOLD, type ProspectScoreInput } from '../score'
import type { TrackingSignals } from '../tracking-detector'
import type { OnPageResult } from '@/lib/dataforseo/onpage'

const NO_TRACKING: TrackingSignals = {
  ga4: false, gtm: false, meta_pixel: false, clarity: false,
  legacy_ua: true, contact_form: false, emails: [],
  facebook_url: null, instagram_url: null,
}

const FULL_TRACKING: TrackingSignals = {
  ga4: true, gtm: true, meta_pixel: true, clarity: true,
  legacy_ua: false, contact_form: true, emails: ['hi@biz.com.au'],
  facebook_url: 'https://facebook.com/biz', instagram_url: 'https://instagram.com/biz',
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
    // 32 strength + weakness 14(form)+8(no enquiry path)+10(pixel)+4(ga4)+2(gtm)
    // +3(ua)+4(title)+3(desc)+2(h1)+8(lcp)+5(thin) = 63 → 95
    expect(r.score).toBe(95)
    expect(r.qualified).toBe(true)
  })

  it('does not qualify an already-modern site even with a strong business', () => {
    const r = calculateProspectScore(input({ tracking: FULL_TRACKING }))
    // 32 strength (no size bonus), no weaknesses
    expect(r.score).toBe(32)
    expect(r.qualified).toBe(false)
  })

  it('qualifies a SMALL no-website business (few reviews) — our real target, not the giants', () => {
    const r = calculateProspectScore(input({
      has_website: false, review_count: 8, https_ok: null, tracking: null, onpage: null,
    }))
    expect(r.qualified).toBe(true)
    // No site to audit → no weakness signals fire
    expect(r.breakdown.every(s => s.kind === 'strength')).toBe(true)
  })

  it('does NOT qualify a no-website listing with almost no reviews (likely dead / not trading)', () => {
    const r = calculateProspectScore(input({
      has_website: false, review_count: 2, https_ok: null, tracking: null, onpage: null,
    }))
    expect(r.qualified).toBe(false)
  })

  it('qualifies exactly at the no-website review floor (boundary: review_count === 3)', () => {
    const r = calculateProspectScore(input({
      has_website: false, review_count: 3, has_phone: true, https_ok: null, tracking: null, onpage: null,
    }))
    expect(r.qualified).toBe(true)
  })

  it('does NOT qualify a no-website business with no phone — no way to reach them at all', () => {
    const r = calculateProspectScore(input({
      has_website: false, has_phone: false, review_count: 40, https_ok: null, tracking: null, onpage: null,
    }))
    expect(r.qualified).toBe(false)
  })

  it('does NOT reward the industry leader for sheer size — 500 reviews scores the same as 8', () => {
    const small = calculateProspectScore(input({ review_count: 8 }))
    const giant = calculateProspectScore(input({ review_count: 500 }))
    expect(giant.score).toBe(small.score)   // no reviews_30 / reviews_100 size bonus
  })

  it('weights the enquiry leak (no contact form) as the sharpest lead-leak signal', () => {
    const r = calculateProspectScore(input({ tracking: NO_TRACKING, onpage: null }))
    expect(r.breakdown.find(s => s.signal === 'no_contact_form')?.points).toBe(14)
    expect(r.breakdown.find(s => s.signal === 'no_enquiry_path')?.points).toBe(8)
  })

  it('scores a weak business below threshold even with a weak site', () => {
    const r = calculateProspectScore(input({
      rating: 3.1, review_count: 4, has_phone: false, is_claimed: false,
      tracking: NO_TRACKING,
      onpage: null,
    }))
    // strength: only has_website 6; weakness 14+8+10+4+2+3 = 41 → 47 (< 55)
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
    expect(withoutSsl.score - withSsl.score).toBe(10)
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
    const sum = r.breakdown.reduce((s, x) => s + x.points, 0)
    expect(r.score).toBeLessThanOrEqual(100)
    expect(r.score).toBe(Math.min(100, sum))
  })
})
