import { describe, expect, it } from 'vitest'
import { DAILY_REEL_HARD_CAP, parsePlanTier, readSocialAgentSettings, TIER_DEFAULTS } from '../tier-defaults'

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
