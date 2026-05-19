import { describe, it, expect } from 'vitest'
import { evaluate } from '../quality-rubric'
import type { RubricContext, LLMClient } from '../quality-rubric'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseCtx: RubricContext = {
  brief: {
    brand_name: 'CTS Tours',
    tone: 'friendly and adventurous',
    avoid_words: ['cheap', 'budget'],
    primary_audience: 'NZ travellers',
  },
  campaign: {
    title: 'China Adventure 2026',
    offer: '10% early-bird discount',
    primary_cta: 'Book now',
    campaign_angle: 'bucket-list experiences',
  },
  platform: 'facebook',
  contentType: 'social_a',
  primaryKeyword: 'China Adventure 2026',
}

const SHORT_FACEBOOK = 'Nice trip.' // < 60 words
const GOOD_FACEBOOK = `Discover China Adventure 2026 — CTS Tours' most iconic bucket-list experience!
From the Great Wall to ancient water towns, every moment is unforgettable.
Early birds save 10%. Limited seats available.
Book now and secure your place before it's gone.
Visit ctstours.co.nz to learn more.`.repeat(3) // ~150+ words

/** Minimal mock that returns preset scores for every dimension */
function makeMockLLM(score = 8): LLMClient {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                scores: {
                  'brand-fit':    { score, reason: 'Mock reason.' },
                  'campaign-fit': { score, reason: 'Mock reason.' },
                  'specificity':  { score, reason: 'Mock reason.' },
                },
              }),
            },
          }],
        }),
      },
    },
  }
}

// ─── platform-fit ─────────────────────────────────────────────────────────────

describe('platform-fit rule', () => {
  it('fails when content is too short for platform', async () => {
    const result = await evaluate(SHORT_FACEBOOK, baseCtx, {
      coreDimensions: ['platform-fit'],
      llmClient: makeMockLLM(),
    })
    const dim = result.dimensions.find(d => d.dimension === 'platform-fit')!
    expect(dim.pass).toBe(false)
    expect(dim.score).toBeLessThan(7)
    expect(dim.method).toBe('rule')
  })

  it('passes when content is within range', async () => {
    const result = await evaluate(GOOD_FACEBOOK, baseCtx, {
      coreDimensions: ['platform-fit'],
      llmClient: makeMockLLM(),
    })
    const dim = result.dimensions.find(d => d.dimension === 'platform-fit')!
    expect(dim.pass).toBe(true)
    expect(dim.score).toBeGreaterThanOrEqual(7)
  })

  it('skips check gracefully for unknown platform', async () => {
    const ctx = { ...baseCtx, platform: 'pinterest' }
    const result = await evaluate(SHORT_FACEBOOK, ctx, {
      coreDimensions: ['platform-fit'],
      llmClient: makeMockLLM(),
    })
    const dim = result.dimensions.find(d => d.dimension === 'platform-fit')!
    expect(dim.pass).toBe(true)
    expect(dim.score).toBeGreaterThanOrEqual(7)
  })
})

// ─── cta ──────────────────────────────────────────────────────────────────────

describe('cta rule', () => {
  it('detects "Book now" as a CTA', async () => {
    const result = await evaluate('Book now to secure your spot!', baseCtx, {
      coreDimensions: ['cta'],
      llmClient: makeMockLLM(),
    })
    expect(result.dimensions[0].pass).toBe(true)
  })

  it('fails when no CTA is present', async () => {
    const result = await evaluate('This is a nice tour in China.', baseCtx, {
      coreDimensions: ['cta'],
      llmClient: makeMockLLM(),
    })
    expect(result.dimensions[0].pass).toBe(false)
  })

  it('detects Chinese CTA signals', async () => {
    const result = await evaluate('名额有限，立即报名！', baseCtx, {
      coreDimensions: ['cta'],
      llmClient: makeMockLLM(),
    })
    expect(result.dimensions[0].pass).toBe(true)
  })
})

// ─── dimension-goal ───────────────────────────────────────────────────────────

describe('dimension-goal rule', () => {
  it('passes when exact keyword is present', async () => {
    const result = await evaluate(
      'Join us for China Adventure 2026 — the trip of a lifetime.',
      baseCtx,
      { coreDimensions: ['dimension-goal'], llmClient: makeMockLLM() },
    )
    expect(result.dimensions[0].pass).toBe(true)
    expect(result.dimensions[0].score).toBe(9)
  })

  it('fails when keyword is absent', async () => {
    const result = await evaluate(
      'Visit beautiful destinations with our team.',
      baseCtx,
      { coreDimensions: ['dimension-goal'], llmClient: makeMockLLM() },
    )
    expect(result.dimensions[0].pass).toBe(false)
    expect(result.dimensions[0].score).toBeLessThan(7)
  })

  it('gives partial pass when all significant words appear (not exact phrase)', async () => {
    const result = await evaluate(
      'Book your 2026 China adventure today!',
      baseCtx,
      { coreDimensions: ['dimension-goal'], llmClient: makeMockLLM() },
    )
    const dim = result.dimensions[0]
    // "China" + "Adventure" + "2026" all present, but not as exact phrase
    expect(dim.pass).toBe(true)
    expect(dim.score).toBe(7)
  })

  it('skips check when no keyword provided', async () => {
    const ctx: RubricContext = {
      ...baseCtx,
      primaryKeyword: null,
      campaign: null,
    }
    const result = await evaluate(
      'Generic content with no keyword.',
      ctx,
      { coreDimensions: ['dimension-goal'], llmClient: makeMockLLM() },
    )
    expect(result.dimensions[0].pass).toBe(true)
    expect(result.dimensions[0].score).toBe(7)
  })
})

// ─── Full evaluate() integration ─────────────────────────────────────────────

describe('evaluate() — full 6-dimension run', () => {
  it('returns overallScore and 6 dimensions', async () => {
    const result = await evaluate(GOOD_FACEBOOK, baseCtx, {
      llmClient: makeMockLLM(8),
    })
    expect(result.dimensions).toHaveLength(6)
    expect(result.overallScore).toBeGreaterThan(0)
    expect(result.overallScore).toBeLessThanOrEqual(10)
  })

  it('pass=false when a non-advisory dimension fails', async () => {
    // CTA fails — content has no action language
    const result = await evaluate(
      'China is a fascinating country with ancient history and stunning landscapes.',
      { ...baseCtx, primaryKeyword: null, campaign: null },
      { llmClient: makeMockLLM(8) },
    )
    const ctaDim = result.dimensions.find(d => d.dimension === 'cta')!
    expect(ctaDim.pass).toBe(false)
    expect(result.pass).toBe(false)
  })

  it('advisory route dimensions do not affect pass verdict', async () => {
    const mockLLM: LLMClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  scores: {
                    'brand-fit':                    { score: 8, reason: 'ok' },
                    'campaign-fit':                 { score: 8, reason: 'ok' },
                    'specificity':                  { score: 8, reason: 'ok' },
                    'viral-structure-preservation': { score: 2, reason: 'poor structure' },
                  },
                }),
              },
            }],
          }),
        },
      },
    }

    const result = await evaluate(GOOD_FACEBOOK, baseCtx, {
      routeDimensions: [{
        id: 'viral-structure-preservation',
        description: 'Does the content preserve the viral video structure?',
        advisory: true,
      }],
      llmClient: mockLLM,
    })

    const viral = result.dimensions.find(d => d.dimension === 'viral-structure-preservation')!
    expect(viral.score).toBe(2)
    expect(viral.pass).toBe(true)  // advisory → always pass
    expect(result.pass).toBe(true) // advisory dim not counted
  })
})

// ─── overallScore calculation ──────────────────────────────────────────────────

describe('overallScore', () => {
  it('is a number between 0 and 10', async () => {
    const result = await evaluate(GOOD_FACEBOOK, baseCtx, {
      llmClient: makeMockLLM(9),
    })
    expect(result.overallScore).toBeGreaterThanOrEqual(0)
    expect(result.overallScore).toBeLessThanOrEqual(10)
  })
})
