import { describe, expect, it } from 'vitest'

import { normalizePlatform, SOCIAL_PLATFORMS } from '@/lib/social/platforms'
import {
  CURRENT_FACTORY_OUTPUT_PLATFORM,
  parseCreativeTags,
  readBriefCreativeTags,
  readBriefPlatform,
  stampPlatformAndTags,
} from './creative-tags'

describe('normalizePlatform', () => {
  it('trims and lowercases a valid platform', () => {
    expect(normalizePlatform('Facebook ')).toBe('facebook')
  })

  it('returns null for an unknown platform', () => {
    expect(normalizePlatform('myspace')).toBeNull()
  })

  it('returns null for non-string inputs', () => {
    expect(normalizePlatform(undefined)).toBeNull()
    expect(normalizePlatform(5)).toBeNull()
    expect(normalizePlatform({})).toBeNull()
  })

  it('returns null for prototype keys', () => {
    expect(normalizePlatform('constructor')).toBeNull()
    expect(normalizePlatform('__proto__')).toBeNull()
  })
})

describe('SOCIAL_PLATFORMS', () => {
  it('contains exactly the six supported platforms', () => {
    expect(SOCIAL_PLATFORMS).toHaveLength(6)
    expect(new Set(SOCIAL_PLATFORMS)).toEqual(
      new Set(['facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'x']),
    )
  })
})

describe('stampPlatformAndTags', () => {
  it('accepts each of the six platforms', () => {
    for (const platform of SOCIAL_PLATFORMS) {
      const result = stampPlatformAndTags({ id: 'w1' }, { platform })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.brief.platform).toBe(platform)
      }
    }
  })

  it('defaults a missing platform to facebook and flags it', () => {
    const result = stampPlatformAndTags({ id: 'w1' }, {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.platform).toBe(CURRENT_FACTORY_OUTPUT_PLATFORM)
      expect(result.platform_defaulted).toBe(true)
    }
  })

  it('does not flag an explicit platform as defaulted', () => {
    const result = stampPlatformAndTags({ id: 'w1' }, { platform: 'tiktok' })
    expect(result.ok && result.platform_defaulted).toBe(false)
  })

  it('rejects an unknown platform and mentions it in the detail', () => {
    const result = stampPlatformAndTags({ id: 'w1' }, { platform: 'myspace' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('platform_required')
      expect(result.detail).toContain('myspace')
    }
  })

  it('defaults the platform for non-object requests too', () => {
    for (const request of [undefined, null, 'x']) {
      const result = stampPlatformAndTags({ id: 'w1' }, request)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.brief.platform).toBe('facebook')
        expect(result.platform_defaulted).toBe(true)
      }
    }
  })

  it('parses, trims and drops unknown creative_tags keys', () => {
    const result = stampPlatformAndTags(
      { id: 'w1', title: 'hello' },
      {
        platform: 'facebook',
        creative_tags: {
          opening_type: ' question ',
          series: 'tips',
          topic_source: 'evergreen',
          bgm_track_id: 'b1',
          junk: 1,
        },
      },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.creative_tags).toEqual({
        opening_type: 'question',
        series: 'tips',
        topic_source: 'evergreen',
        bgm_track_id: 'b1',
      })
      expect(result.brief.id).toBe('w1')
      expect(result.brief.title).toBe('hello')
    }
  })

  it('rejects an invalid topic_source', () => {
    const result = stampPlatformAndTags(
      { id: 'w1' },
      { platform: 'facebook', creative_tags: { topic_source: 'viral' } },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('creative_tags_invalid')
    }
  })

  it('rejects non-object, empty-string and over-long creative_tags', () => {
    const cases: unknown[] = [
      'x',
      { opening_type: '' },
      { series: 'a'.repeat(81) },
    ]
    for (const creative_tags of cases) {
      const result = stampPlatformAndTags(
        { id: 'w1' },
        { platform: 'facebook', creative_tags },
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('creative_tags_invalid')
      }
    }
  })

  it('omits creative_tags when empty or only unknown keys', () => {
    for (const creative_tags of [{}, { junk: 1 }]) {
      const result = stampPlatformAndTags(
        { id: 'w1' },
        { platform: 'facebook', creative_tags },
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect('creative_tags' in result.brief).toBe(false)
      }
    }
  })

  it('does not mutate the input brief and returns a new object', () => {
    const brief = { id: 'w1', title: 'hello' }
    const before = JSON.stringify(brief)
    const result = stampPlatformAndTags(brief, { platform: 'tiktok' })
    expect(JSON.stringify(brief)).toBe(before)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief).not.toBe(brief)
    }
  })
})

describe('readBriefPlatform', () => {
  it('returns unknown for missing or invalid platforms', () => {
    expect(readBriefPlatform({})).toBe('unknown')
    expect(readBriefPlatform(null)).toBe('unknown')
    expect(readBriefPlatform('str')).toBe('unknown')
    expect(readBriefPlatform({ platform: 'nope' })).toBe('unknown')
  })

  it('returns the platform when present', () => {
    expect(readBriefPlatform({ platform: 'tiktok' })).toBe('tiktok')
  })
})

describe('readBriefCreativeTags', () => {
  it('returns null for old briefs and invalid tags', () => {
    expect(readBriefCreativeTags({})).toBeNull()
    expect(readBriefCreativeTags(null)).toBeNull()
    expect(
      readBriefCreativeTags({ creative_tags: { topic_source: 'viral' } }),
    ).toBeNull()
  })

  it('returns parsed tags for a valid brief', () => {
    expect(
      readBriefCreativeTags({
        creative_tags: { opening_type: 'question', topic_source: 'trend' },
      }),
    ).toEqual({ opening_type: 'question', topic_source: 'trend' })
  })
})

// Keep parseCreativeTags referenced so the import is exercised directly.
describe('parseCreativeTags', () => {
  it('returns null tags for undefined and null', () => {
    expect(parseCreativeTags(undefined)).toEqual({ ok: true, tags: null })
    expect(parseCreativeTags(null)).toEqual({ ok: true, tags: null })
  })
})
