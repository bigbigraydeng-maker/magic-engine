import { describe, expect, it } from 'vitest'
import {
  DAILY_REEL_HARD_CAP,
  parseImagePostRecipe,
  parsePlanTier,
  readSocialAgentSettings,
  TIER_DEFAULTS,
} from '../tier-defaults'

describe('readSocialAgentSettings', () => {
  it('returns off when config is missing, null, an array, or social_agent is missing', () => {
    const cases: unknown[] = [
      undefined,
      null,
      [],
      {},
      { social_agent: null },
      { social_agent: [] },
      { social_agent: 'nope' },
    ]

    for (const config of cases) {
      const result = readSocialAgentSettings(config, 'growth')
      expect(result.enabled).toBe(false)
      expect(result.reelPerDay).toBe(0)
      expect(result.reelSource).toBe('off')
    }
  })

  it('treats enabled: "true" (string) as disabled', () => {
    const result = readSocialAgentSettings({ social_agent: { enabled: 'true' } }, 'growth')
    expect(result.enabled).toBe(false)
    expect(result.reelPerDay).toBe(0)
    expect(result.reelSource).toBe('off')
  })

  it('uses the tier default when enabled with growth tier and no client value', () => {
    const result = readSocialAgentSettings({ social_agent: { enabled: true } }, 'growth')
    expect(result.enabled).toBe(true)
    expect(result.reelPerDay).toBe(1)
    expect(result.reelSource).toBe('tier')
    expect(result.tier).toBe('growth')
  })

  it('caps the enterprise tier default to the daily reel hard cap', () => {
    expect(TIER_DEFAULTS.enterprise.reelPerDay).toBe(2)
    const result = readSocialAgentSettings({ social_agent: { enabled: true } }, 'enterprise')
    expect(result.enabled).toBe(true)
    expect(result.reelPerDay).toBe(DAILY_REEL_HARD_CAP)
    expect(result.reelPerDay).toBe(1)
    expect(result.reelSource).toBe('tier')
    expect(result.tier).toBe('enterprise')
  })

  it('honors a client reel_per_day of 0 (client can turn reels off)', () => {
    const result = readSocialAgentSettings(
      { social_agent: { enabled: true, reel_per_day: 0 } },
      'growth',
    )
    expect(result.enabled).toBe(true)
    expect(result.reelPerDay).toBe(0)
    expect(result.reelSource).toBe('client')
  })

  it('caps a client reel_per_day of 5 to the daily reel hard cap', () => {
    const result = readSocialAgentSettings(
      { social_agent: { enabled: true, reel_per_day: 5 } },
      'growth',
    )
    expect(result.enabled).toBe(true)
    expect(result.reelPerDay).toBe(1)
    expect(result.reelSource).toBe('client')
  })

  it('ignores invalid client reel_per_day values and falls back to the tier default', () => {
    const invalidValues: unknown[] = [1.5, -1, '1']

    for (const reel_per_day of invalidValues) {
      const result = readSocialAgentSettings(
        { social_agent: { enabled: true, reel_per_day } },
        'growth',
      )
      expect(result.enabled).toBe(true)
      expect(result.reelPerDay).toBe(TIER_DEFAULTS.growth.reelPerDay)
      expect(result.reelSource).toBe('tier')
      expect(result.tier).toBe('growth')
    }
  })

  it('returns off when enabled with an unknown tier and no client value', () => {
    const result = readSocialAgentSettings({ social_agent: { enabled: true } }, 'gold')
    expect(result.enabled).toBe(true)
    expect(result.reelPerDay).toBe(0)
    expect(result.reelSource).toBe('off')
    expect(result.tier).toBeNull()
  })
})

describe('parsePlanTier', () => {
  it('returns the tier for exact matches', () => {
    expect(parsePlanTier('growth')).toBe('growth')
  })

  it('returns null for case-mismatched values', () => {
    expect(parsePlanTier('Growth')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(parsePlanTier(undefined)).toBeNull()
  })
})

describe('TIER_DEFAULTS', () => {
  it('has starter postPerDay of 0', () => {
    expect(TIER_DEFAULTS.starter.postPerDay).toBe(0)
  })
})

describe('imagePostRecipe (social_agent.image_post_recipe)', () => {
  it('defaults to null when the key is absent — opt-in only', () => {
    expect(readSocialAgentSettings({ social_agent: { enabled: true } }, 'growth').imagePostRecipe).toBeNull()
  })

  it('reads tour_poster_v1 when enabled', () => {
    const result = readSocialAgentSettings(
      { social_agent: { enabled: true, image_post_recipe: 'tour_poster_v1' } },
      'growth',
    )
    expect(result.imagePostRecipe).toBe('tour_poster_v1')
    // other fields untouched by the new key
    expect(result.imagePostPerDay).toBe(TIER_DEFAULTS.growth.postPerDay)
    expect(result.reelPerDay).toBe(1)
  })

  it('is null when the agent is disabled, even if a recipe is configured', () => {
    const result = readSocialAgentSettings(
      { social_agent: { enabled: false, image_post_recipe: 'tour_poster_v1' } },
      'growth',
    )
    expect(result.enabled).toBe(false)
    expect(result.imagePostRecipe).toBeNull()
  })

  it('strict whitelist: unknown / mis-cased / non-string values read as null', () => {
    for (const raw of ['tour_poster_v2', 'TOUR_POSTER_V1', ' tour_poster_v1', '', 1, true, null, {}]) {
      expect(parseImagePostRecipe(raw)).toBeNull()
      const result = readSocialAgentSettings({ social_agent: { enabled: true, image_post_recipe: raw } }, 'growth')
      expect(result.imagePostRecipe).toBeNull()
    }
  })
})

describe('standalone image posts (agent off)', () => {
  const read = (agent: Record<string, unknown>) => readSocialAgentSettings({ social_agent: agent }, 'growth')

  it('drafts image posts without turning on the daily agent or reels', () => {
    const r = read({ image_post_standalone: true, image_post_per_day: 1, image_post_recipe: 'tour_poster_v1' })
    expect(r.enabled).toBe(false)
    expect(r.reelPerDay).toBe(0)
    expect(r.reelSource).toBe('off')
    expect(r.imagePostPerDay).toBe(1)
    expect(r.imagePostSource).toBe('client')
    expect(r.imagePostRecipe).toBe('tour_poster_v1')
  })

  it('caps the standalone quota at the daily hard cap', () => {
    expect(read({ image_post_standalone: true, image_post_per_day: 5 }).imagePostPerDay).toBe(1)
  })

  it('stays off without the explicit switch, without a quota, or with a non-integer quota', () => {
    const cases: Record<string, unknown>[] = [
      { image_post_per_day: 1 },
      { image_post_standalone: 'true', image_post_per_day: 1 },
      { image_post_standalone: true },
      { image_post_standalone: true, image_post_per_day: 0 },
      { image_post_standalone: true, image_post_per_day: 1.5 },
      { image_post_standalone: true, image_post_per_day: '1' },
    ]
    for (const agent of cases) {
      const r = read(agent)
      expect(r.imagePostPerDay).toBe(0)
      expect(r.imagePostSource).toBe('off')
      expect(r.imagePostRecipe).toBeNull()
      expect(r.enabled).toBe(false)
    }
  })

  it('does not use the tier default for standalone image posts', () => {
    expect(read({ image_post_standalone: true }).imagePostPerDay).toBe(0)
  })

  it('leaves enabled-agent behaviour unchanged', () => {
    const r = read({ enabled: true, image_post_standalone: true, image_post_per_day: 0 })
    expect(r.enabled).toBe(true)
    expect(r.imagePostPerDay).toBe(0)
    expect(r.reelPerDay).toBe(TIER_DEFAULTS.growth.reelPerDay)
  })
})

