import { describe, it, expect } from 'vitest'
import { deriveSegment } from '../segment'
import type { ScoreSignal } from '../score'

const w = (signal: string): ScoreSignal => ({ signal, points: 1, kind: 'weakness' })
const s = (signal: string): ScoreSignal => ({ signal, points: 1, kind: 'strength' })

describe('deriveSegment', () => {
  it('core_target: broken site AND missing tracking', () => {
    expect(deriveSegment({
      breakdown: [w('no_https'), w('slow_lcp'), w('no_ga4'), w('no_meta_pixel'), s('rating_4_plus')],
      has_social_links: true,
      social_posts_30d: 5,
    })).toBe('core_target')
  })

  it('blind_flyer: healthy site but no tracking', () => {
    expect(deriveSegment({
      breakdown: [w('no_ga4'), w('no_meta_pixel')],
      has_social_links: true,
      social_posts_30d: 5,
    })).toBe('blind_flyer')
  })

  it('social_gap: healthy site + tracking but no social links', () => {
    expect(deriveSegment({
      breakdown: [w('missing_h1')],
      has_social_links: false,
      social_posts_30d: null,
    })).toBe('social_gap')
  })

  it('social_gap: social linked but dead (0 posts in 30 days)', () => {
    expect(deriveSegment({
      breakdown: [],
      has_social_links: true,
      social_posts_30d: 0,
    })).toBe('social_gap')
  })

  it('general: active socials and only minor gaps', () => {
    expect(deriveSegment({
      breakdown: [w('missing_description')],
      has_social_links: true,
      social_posts_30d: 8,
    })).toBe('general')
  })
})
