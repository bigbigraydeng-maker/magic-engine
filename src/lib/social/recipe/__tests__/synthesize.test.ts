import { describe, expect, it } from 'vitest'
import { platformRulesFor } from '../platform-rules'
import type { StageSignals } from '../stage'
import {
  synthesizeWeeklyRecipe,
  type SynthesizeResult,
  type WeeklyRecipe,
} from '../synthesize'

const starting: StageSignals = {
  platform: 'facebook',
  hasPublishAuth: true,
  factCount: 5,
  verifiedAssetCount: 3,
  consecutiveOnTimeWeeks: 1,
  receiptsPerFormatMax: 0,
  consecutivePeriodsAtThreshold: 0,
  circuitBreakerTripped: false,
  complaintSpike: false,
}

const growing: StageSignals = {
  platform: 'facebook',
  hasPublishAuth: true,
  factCount: 20,
  verifiedAssetCount: 15,
  consecutiveOnTimeWeeks: 4,
  receiptsPerFormatMax: 0,
  consecutivePeriodsAtThreshold: 0,
  circuitBreakerTripped: false,
  complaintSpike: false,
}

const mature: StageSignals = {
  platform: 'facebook',
  hasPublishAuth: true,
  factCount: 50,
  verifiedAssetCount: 50,
  consecutiveOnTimeWeeks: 12,
  receiptsPerFormatMax: 10,
  consecutivePeriodsAtThreshold: 2,
  circuitBreakerTripped: false,
  complaintSpike: false,
}

const sig = (o: Partial<StageSignals>): StageSignals => ({ ...growing, ...o })

function ready(result: SynthesizeResult): WeeklyRecipe {
  if (result.status !== 'ready') {
    throw new Error('not ready')
  }
  return result
}

const TRAVEL_MIX = {
  travel_mood: 35,
  practical_info: 25,
  guest_stories: 20,
  tour_intro: 15,
  expertise_history: 5,
}

const LOGISTICS_MIX = {
  how_to_ship: 30,
  packaging_prohibited_damage: 25,
  warehouse_loading_arrival: 25,
  route_service_scenes: 15,
  other: 5,
}

describe('synthesizeWeeklyRecipe - platform status', () => {
  it('returns not_connected for instagram', () => {
    const result = synthesizeWeeklyRecipe({
      platform: 'instagram',
      industryKey: 'travel',
      stageSignals: { ...growing, platform: 'instagram' },
    })
    expect(result).toEqual({ status: 'not_connected', platform: 'instagram' })
  })

  it('returns not_connected for tiktok', () => {
    const result = synthesizeWeeklyRecipe({
      platform: 'tiktok',
      industryKey: 'travel',
      stageSignals: { ...growing, platform: 'tiktok' },
    })
    expect(result).toEqual({ status: 'not_connected', platform: 'tiktok' })
  })

  it('throws when stageSignals.platform does not match platform', () => {
    expect(() =>
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: { ...growing, platform: 'instagram' },
      }),
    ).toThrow()
  })
})

describe('synthesizeWeeklyRecipe - travel starting', () => {
  it('uses cold-start quotas, template mix and stage emphasis', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: starting,
      }),
    )
    expect(recipe.quotas).toEqual({
      reelPerWeek: 1,
      postPerWeek: 3,
      storyPerDay: 1,
    })
    expect(recipe.sources.reelPerWeek).toBe('stage')
    expect(recipe.sources.postPerWeek).toBe('stage')
    expect(recipe.sources.storyPerDay).toBe('stage')
    expect(recipe.mix.pillars).toEqual(TRAVEL_MIX)
    expect(recipe.sources.mix).toBe('industry')
    expect(recipe.mix.emphasisKey).toBe('tour_intro')
    expect(recipe.sources.mixEmphasis).toBe('stage')
    expect(recipe.platformPlan).toBe('facebook_only')
    expect(recipe.suggestions).toEqual([])
  })
})

describe('synthesizeWeeklyRecipe - travel growing', () => {
  it('uses industry quotas, connect cards and FAQ template cards', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
      }),
    )
    expect(recipe.quotas).toEqual({
      reelPerWeek: 2,
      postPerWeek: 3,
      storyPerDay: 1,
    })
    expect(recipe.sources.reelPerWeek).toBe('industry')
    expect(recipe.sources.postPerWeek).toBe('industry')
    expect(recipe.sources.storyPerDay).toBe('industry')
    expect(recipe.mix.emphasisKey).toBeNull()
    expect(recipe.platformPlan).toBe('facebook_with_connect_cards')
    expect(recipe.interaction.suggestFaqTemplateCards).toBe(true)
    expect(recipe.interaction.humanReplyTopics).toContain('price')
    expect(recipe.interaction.humanReplyTopics).toContain('complaint')
    expect(recipe.interaction.humanReplyTopics).toContain('refund')
    expect(recipe.interaction.humanReplyTopics).toContain('visa_individual_case')
    expect(recipe.interaction.autoReplyScope).toBe('greeting_faq_only')
  })
})

describe('synthesizeWeeklyRecipe - logistics mature', () => {
  it('uses the logistics template mix and industry quotas', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'logistics',
        stageSignals: mature,
      }),
    )
    expect(recipe.stage).toBe('mature')
    expect(recipe.mix.pillars).toEqual(LOGISTICS_MIX)
    expect(recipe.sources.mix).toBe('industry')
    expect(recipe.quotas).toEqual({
      reelPerWeek: 2,
      postPerWeek: 3,
      storyPerDay: 1,
    })
    expect(recipe.sources.reelPerWeek).toBe('industry')
    expect(recipe.sources.postPerWeek).toBe('industry')
    expect(recipe.sources.storyPerDay).toBe('industry')
  })
})

describe('synthesizeWeeklyRecipe - unknown industry', () => {
  it('returns null industry data and platform-only human reply topics when growing', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'real_estate',
        stageSignals: growing,
      }),
    )
    expect(recipe.industryKey).toBeNull()
    expect(recipe.quotas).toEqual({
      reelPerWeek: null,
      postPerWeek: null,
      storyPerDay: null,
    })
    expect(recipe.sources.reelPerWeek).toBe('none')
    expect(recipe.sources.postPerWeek).toBe('none')
    expect(recipe.sources.storyPerDay).toBe('none')
    expect(recipe.mix.pillars).toBeNull()
    expect(recipe.sources.mix).toBe('none')
    expect(recipe.interaction.humanReplyTopics).toEqual([
      'price',
      'complaint',
      'refund',
    ])
    expect(recipe.sources.humanReplyTopics).toBe('platform')
    expect(recipe.mix.pillars).not.toEqual(TRAVEL_MIX)
  })

  it('still uses cold-start quotas from the stage when starting', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'real_estate',
        stageSignals: starting,
      }),
    )
    expect(recipe.quotas).toEqual({
      reelPerWeek: 1,
      postPerWeek: 3,
      storyPerDay: 1,
    })
    expect(recipe.sources.reelPerWeek).toBe('stage')
    expect(recipe.sources.postPerWeek).toBe('stage')
    expect(recipe.sources.storyPerDay).toBe('stage')
    expect(recipe.mix.emphasisKey).toBeNull()
  })
})

describe('synthesizeWeeklyRecipe - client values win', () => {
  it('keeps client quotas and suggests the industry values', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
        clientConfig: {
          quota: { post_per_day: 1, reel_per_week: 5, story_per_day: 2 },
        },
      }),
    )
    expect(recipe.quotas).toEqual({
      reelPerWeek: 5,
      postPerWeek: 7,
      storyPerDay: 2,
    })
    expect(recipe.sources.reelPerWeek).toBe('client')
    expect(recipe.sources.postPerWeek).toBe('client')
    expect(recipe.sources.storyPerDay).toBe('client')

    const reelSuggestion = recipe.suggestions.find(
      (s) => s.field === 'reelPerWeek',
    )
    expect(reelSuggestion).toEqual({
      field: 'reelPerWeek',
      layer: 'industry',
      clientValue: 5,
      suggestedValue: 2,
    })

    const postSuggestion = recipe.suggestions.find(
      (s) => s.field === 'postPerWeek',
    )
    expect(postSuggestion).toEqual({
      field: 'postPerWeek',
      layer: 'industry',
      clientValue: 7,
      suggestedValue: 3,
    })

    const storySuggestion = recipe.suggestions.find(
      (s) => s.field === 'storyPerDay',
    )
    expect(storySuggestion).toEqual({
      field: 'storyPerDay',
      layer: 'industry',
      clientValue: 2,
      suggestedValue: 1,
    })

    expect(recipe.quotas.reelPerWeek).not.toBe(2)
    expect(recipe.quotas.postPerWeek).not.toBe(3)
    expect(recipe.quotas.storyPerDay).not.toBe(1)
  })

  it('does not suggest a field when the client value equals the layer value', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
        clientConfig: { quota: { reel_per_week: 2 } },
      }),
    )
    expect(recipe.quotas.reelPerWeek).toBe(2)
    expect(recipe.sources.reelPerWeek).toBe('client')
    expect(
      recipe.suggestions.some((s) => s.field === 'reelPerWeek'),
    ).toBe(false)
  })

  it('treats client 0 as a filled value', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
        clientConfig: { quota: { story_per_day: 0 } },
      }),
    )
    expect(recipe.quotas.storyPerDay).toBe(0)
    expect(recipe.sources.storyPerDay).toBe('client')
  })

  it('treats null and negative client values as not filled', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
        clientConfig: { quota: { reel_per_week: null, story_per_day: -1 } },
      }),
    )
    expect(recipe.sources.reelPerWeek).toBe('industry')
    expect(recipe.sources.storyPerDay).toBe('industry')
    expect(recipe.quotas.reelPerWeek).toBe(2)
    expect(recipe.quotas.storyPerDay).toBe(1)
  })
})

describe('synthesizeWeeklyRecipe - client content pillars', () => {
  it('uses client pillars and suggests the template mix when they differ', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
        clientConfig: {
          content_pillars: [
            { id: 'a', post_ratio: 0.6 },
            { id: 'b', post_ratio: 0.4 },
          ],
        },
      }),
    )
    expect(recipe.mix.pillars).toEqual({ a: 60, b: 40 })
    expect(recipe.sources.mix).toBe('client')

    const mixSuggestion = recipe.suggestions.find((s) => s.field === 'mix')
    expect(mixSuggestion).toEqual({
      field: 'mix',
      layer: 'industry',
      clientValue: { a: 60, b: 40 },
      suggestedValue: TRAVEL_MIX,
    })
  })

  it('does not suggest a mix when client pillars match the template', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
        clientConfig: {
          content_pillars: [
            { id: 'travel_mood', post_ratio: 0.35 },
            { id: 'practical_info', post_ratio: 0.25 },
            { id: 'guest_stories', post_ratio: 0.2 },
            { id: 'tour_intro', post_ratio: 0.15 },
            { id: 'expertise_history', post_ratio: 0.05 },
          ],
        },
      }),
    )
    expect(recipe.sources.mix).toBe('client')
    expect(recipe.suggestions.some((s) => s.field === 'mix')).toBe(false)
  })
})

describe('synthesizeWeeklyRecipe - paused stage', () => {
  it('zeroes quotas and holds new drafts when paused', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: sig({ circuitBreakerTripped: true }),
      }),
    )
    expect(recipe.stage).toBe('paused')
    expect(recipe.holdNewDrafts).toBe(true)
    expect(recipe.quotas).toEqual({
      reelPerWeek: 0,
      postPerWeek: 0,
      storyPerDay: 0,
    })
    expect(recipe.sources.reelPerWeek).toBe('stage')
    expect(recipe.sources.postPerWeek).toBe('stage')
    expect(recipe.sources.storyPerDay).toBe('stage')
  })

  it('keeps a client quota when paused and suggests the stage value', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: sig({ circuitBreakerTripped: true }),
        clientConfig: { quota: { reel_per_week: 3 } },
      }),
    )
    expect(recipe.quotas.reelPerWeek).toBe(3)
    expect(recipe.sources.reelPerWeek).toBe('client')
    const suggestion = recipe.suggestions.find(
      (s) => s.field === 'reelPerWeek',
    )
    expect(suggestion).toEqual({
      field: 'reelPerWeek',
      layer: 'stage',
      clientValue: 3,
      suggestedValue: 0,
    })
  })

  it('does not hold new drafts when not paused', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
      }),
    )
    expect(recipe.holdNewDrafts).toBe(false)
  })
})

describe('synthesizeWeeklyRecipe - no numeric social goals', () => {
  it('does not expose follower, reach, dm_count, impression or goal fields', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
      }),
    )
    expect(JSON.stringify(recipe)).not.toMatch(
      /follower|reach|dm_count|impression|goal/i,
    )
    expect(recipe.primarySignal).toBe('on_time_cadence')
  })
})

describe('synthesizeWeeklyRecipe - stage from signals only', () => {
  it('produces the same stage regardless of industry', () => {
    const travel = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
      }),
    )
    const logistics = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'logistics',
        stageSignals: growing,
      }),
    )
    const unknown = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'real_estate',
        stageSignals: growing,
      }),
    )
    expect(travel.stage).toBe('growing')
    expect(logistics.stage).toBe('growing')
    expect(unknown.stage).toBe('growing')
  })
})

describe('synthesizeWeeklyRecipe - hard rules', () => {
  it('exposes the facebook platform rules', () => {
    const recipe = ready(
      synthesizeWeeklyRecipe({
        platform: 'facebook',
        industryKey: 'travel',
        stageSignals: growing,
      }),
    )
    expect(recipe.hardRules).toEqual(platformRulesFor('facebook').rules)
  })
})
