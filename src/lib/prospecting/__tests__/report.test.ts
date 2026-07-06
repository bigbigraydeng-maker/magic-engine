import { describe, it, expect } from 'vitest'
import { buildLeakReport, type LeakReportInput } from '../report'
import type { ProspectAnalysis } from '../analyze'
import type { TrackingSignals } from '../tracking-detector'
import type { ScoreSignal } from '../score'

const TRACKING_ALL_GOOD: TrackingSignals = {
  ga4: true, gtm: true, meta_pixel: true, clarity: true, legacy_ua: false,
  contact_form: true, emails: ['hi@biz.com.au'], facebook_url: null, instagram_url: null,
}

const TRACKING_ALL_MISSING: TrackingSignals = {
  ga4: false, gtm: false, meta_pixel: false, clarity: false, legacy_ua: false,
  contact_form: false, emails: [], facebook_url: null, instagram_url: null,
}

function analysis(over: Partial<ProspectAnalysis> = {}): ProspectAnalysis {
  return {
    analyzed_at: '2026-07-06T00:00:00.000Z',
    segment: 'core_target',
    owner_name: null,
    top_problems: [],
    email_hook: '',
    pillars: {
      seo: { score: 50, summary: '' }, geo: { score: 50, summary: '' },
      social: { score: 50, summary: '' }, gbp: { score: 50, summary: '' },
    },
    geo_probe: null,
    social_activity: null,
    skips: [],
    ...over,
  }
}

function baseInput(over: Partial<LeakReportInput> = {}): LeakReportInput {
  return {
    business_name: 'Sunny Dental',
    industry: 'dentists',
    city: 'auckland',
    country: 'NZ',
    has_website: true,
    rating: 4.8,
    review_count: 120,
    https_ok: true,
    tracking: TRACKING_ALL_GOOD,
    breakdown: [],
    analysis: analysis(),
    ...over,
  }
}

describe('buildLeakReport — always five stages in funnel order', () => {
  it('returns the five stages in customer-journey order', () => {
    const r = buildLeakReport(baseInput())
    expect(r.stages.map(s => s.key)).toEqual(['found', 'trust', 'contact', 'alive', 'engine'])
  })
})

describe('① found', () => {
  it('flags a leak when AI search misses the business and names the competitor', () => {
    const r = buildLeakReport(baseInput({
      analysis: analysis({ geo_probe: { question: 'q', mentioned: false, competitors_mentioned: ['Bright Smiles'] } }),
    }))
    const found = r.stages[0]
    expect(found.status).toBe('leak')
    expect(found.finding).toContain('Sunny Dental')
    expect(found.finding).toContain('Bright Smiles')
  })

  it('is a soft spot when SEO tags are missing', () => {
    const breakdown: ScoreSignal[] = [{ signal: 'missing_title', points: 3, kind: 'weakness' }]
    const r = buildLeakReport(baseInput({ breakdown }))
    expect(r.stages[0].status).toBe('weak')
  })
})

describe('② trust', () => {
  it('flags a leak when the site has no https', () => {
    const r = buildLeakReport(baseInput({ https_ok: false }))
    expect(r.stages[1].status).toBe('leak')
    expect(r.stages[1].finding).toMatch(/not secure/i)
  })

  it('uses the real review count and rating — never invents them', () => {
    const r = buildLeakReport(baseInput())
    expect(r.stages[1].finding).toContain('120 reviews at 4.8')
  })
})

describe('③ contact — the sharpest lead-leak stage', () => {
  it('flags a leak when there is no form and no visible email', () => {
    const r = buildLeakReport(baseInput({ tracking: TRACKING_ALL_MISSING }))
    expect(r.stages[2].status).toBe('leak')
    expect(r.stages[2].fix).toMatch(/WhatsApp/)
  })

  it('is a soft spot when an email exists but no form', () => {
    const r = buildLeakReport(baseInput({
      tracking: { ...TRACKING_ALL_MISSING, emails: ['hi@biz.com.au'] },
    }))
    expect(r.stages[2].status).toBe('weak')
  })
})

describe('④ alive', () => {
  it('flags a leak for a social page dead over 30 days', () => {
    const r = buildLeakReport(baseInput({
      analysis: analysis({ social_activity: { platform: 'facebook', followers: 800, posts_last_30d: 0 } }),
    }))
    expect(r.stages[3].status).toBe('leak')
    expect(r.stages[3].finding).toMatch(/facebook/i)
  })
})

describe('⑤ engine — the active-acquisition gap', () => {
  it('flags a leak when there is no pixel and no analytics', () => {
    const r = buildLeakReport(baseInput({ tracking: TRACKING_ALL_MISSING }))
    expect(r.stages[4].status).toBe('leak')
    expect(r.stages[4].fix).toMatch(/video ads/)
  })
})

describe('summary_points — the email body', () => {
  it('puts leaks before soft spots and caps at four', () => {
    const r = buildLeakReport(baseInput({
      https_ok: false,                       // trust → leak
      tracking: TRACKING_ALL_MISSING,        // contact + engine → leak
      breakdown: [{ signal: 'missing_title', points: 3, kind: 'weakness' }], // found → weak
      analysis: analysis({ social_activity: { platform: 'facebook', followers: 1, posts_last_30d: 0 } }), // alive → leak
    }))
    expect(r.summary_points.length).toBe(4)
    expect(r.leak_count).toBe(4)
  })

  it('never fabricates a leak from an all-healthy prospect', () => {
    const r = buildLeakReport(baseInput())
    expect(r.leak_count).toBe(0)
    expect(r.summary_points).toEqual([])
    expect(r.headline).toMatch(/quick wins/i)
  })

  it('degrades safely with no analysis and no tracking — no false leaks', () => {
    const r = buildLeakReport(baseInput({ analysis: null, tracking: null, breakdown: null, https_ok: null }))
    expect(r.leak_count).toBe(0)
    expect(r.stages).toHaveLength(5)
  })
})

describe('no-website funnel ($99 one-page-site opportunity)', () => {
  it('marks found / trust / contact as leaks when there is no website', () => {
    const r = buildLeakReport(baseInput({ has_website: false, tracking: null }))
    expect(r.stages.slice(0, 3).map(s => s.status)).toEqual(['leak', 'leak', 'leak'])
    expect(r.stages[0].finding).toMatch(/don't have a website/i)
    expect(r.stages[0].fix).toMatch(/\$99/)
  })

  it('surfaces the no-website leaks in the email summary', () => {
    const r = buildLeakReport(baseInput({ has_website: false, tracking: null }))
    expect(r.summary_points.length).toBeGreaterThanOrEqual(3)
    expect(r.leak_count).toBeGreaterThanOrEqual(3)
  })
})

describe('headline', () => {
  it('is singular for one leak', () => {
    const r = buildLeakReport(baseInput({ https_ok: false }))
    expect(r.headline).toBe('1 place where enquiries are leaking')
  })
})

describe('health_score + verdict', () => {
  it('is 100 / fairly tight for an all-healthy prospect', () => {
    const r = buildLeakReport(baseInput())
    expect(r.health_score).toBe(100)
    expect(r.verdict).toBe('Fairly tight')
  })

  it('drops into high-leak-risk territory when everything leaks', () => {
    const r = buildLeakReport(baseInput({
      https_ok: false, tracking: TRACKING_ALL_MISSING,
      analysis: analysis({
        geo_probe: { question: 'q', mentioned: false, competitors_mentioned: ['Rival'] },
        social_activity: { platform: 'facebook', followers: 1, posts_last_30d: 0 },
      }),
    }))
    expect(r.leak_count).toBe(5)
    expect(r.health_score).toBe(10)       // 100 - 5*18
    expect(r.verdict).toBe('High leak risk')
  })

  it('never goes below zero', () => {
    const r = buildLeakReport(baseInput({
      https_ok: false, tracking: TRACKING_ALL_MISSING,
      breakdown: [{ signal: 'missing_title', points: 3, kind: 'weakness' }],
      analysis: analysis({
        geo_probe: { question: 'q', mentioned: false, competitors_mentioned: ['Rival'] },
        social_activity: { platform: 'facebook', followers: 1, posts_last_30d: 0 },
      }),
    }))
    expect(r.health_score).toBeGreaterThanOrEqual(0)
  })
})
