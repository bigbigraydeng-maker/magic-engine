import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { auditSocialPost } from '../social-quality-audit'
import type { SocialAuditMetadata } from '../social-quality-audit'

vi.mock('@/lib/content/quality-rubric', () => ({
  evaluate: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}))

import { evaluate } from '@/lib/content/quality-rubric'
const mockEvaluate = vi.mocked(evaluate)

const PASSING_RESULT = {
  overallScore: 8,
  pass: true,
  dimensions: [
    { dimension: 'platform-fit', score: 9, pass: true, reason: 'Good length.', method: 'rule' as const },
    { dimension: 'cta',          score: 9, pass: true, reason: 'CTA found.',   method: 'rule' as const },
  ],
}

const FAILING_RESULT = {
  overallScore: 5,
  pass: false,
  dimensions: [
    { dimension: 'platform-fit', score: 4, pass: false, reason: 'Too short.',    method: 'rule' as const },
    { dimension: 'cta',          score: 4, pass: false, reason: 'No CTA found.', method: 'rule' as const },
  ],
}

const SAMPLE_METADATA: SocialAuditMetadata = {
  brand_name:       'CTS Tours',
  tone:             'professional',
  avoid_words:      ['cheap'],
  platforms:        ['facebook'],
  primary_audience: 'NZ travellers',
  campaign: {
    title:                  'Summer NZ Tours',
    offer:                  '10% off',
    primary_cta:            'Book now',
    campaign_angle:         'family adventure',
    target_audience_detail: 'families with children',
  },
}

describe('auditSocialPost', () => {
  const originalEnv = process.env.OPENAI_API_KEY

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.OPENAI_API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalEnv
  })

  it('returns null when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY
    const result = await auditSocialPost('Content', ['facebook'], 'social_a', SAMPLE_METADATA, 'NZ tours')
    expect(result).toBeNull()
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('returns rubricResult and contextSnapshot on success', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const result = await auditSocialPost(
      'Book now for the best NZ family tour experience!',
      ['facebook'],
      'social_a',
      SAMPLE_METADATA,
      'NZ family tours',
    )

    expect(result).not.toBeNull()
    expect(result!.rubricResult.pass).toBe(true)
    expect(result!.rubricResult.overallScore).toBe(8)
  })

  it('builds RubricContext with first platform from the array', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditSocialPost('Content', ['tiktok', 'instagram'], 'social_a', SAMPLE_METADATA)

    expect(mockEvaluate).toHaveBeenCalledOnce()
    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.platform).toBe('tiktok')
  })

  it('falls back to "facebook" when platforms array is empty', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditSocialPost('Content', [], 'social_c', SAMPLE_METADATA)

    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.platform).toBe('facebook')
  })

  it('sets contentType to social_a on Route A', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditSocialPost('Content', ['facebook'], 'social_a', SAMPLE_METADATA, 'keyword')

    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.contentType).toBe('social_a')
  })

  it('sets contentType to social_c on Route C', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditSocialPost('Content', ['instagram'], 'social_c', SAMPLE_METADATA)

    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.contentType).toBe('social_c')
  })

  it('passes primaryKeyword correctly for Route A', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditSocialPost('Content', ['facebook'], 'social_a', SAMPLE_METADATA, 'best NZ tours')

    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.primaryKeyword).toBe('best NZ tours')
  })

  it('passes null primaryKeyword for Route C', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditSocialPost('Content', ['facebook'], 'social_c', SAMPLE_METADATA)

    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.primaryKeyword).toBeNull()
  })

  it('includes quality dimensions in contextSnapshot', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const result = await auditSocialPost('Content', ['facebook'], 'social_a', SAMPLE_METADATA)
    const quality = result!.contextSnapshot.quality as Record<string, unknown>

    expect(quality.overallScore).toBe(8)
    expect(quality.pass).toBe(true)
    expect(Array.isArray(quality.dimensions)).toBe(true)
  })

  it('reflects pass=false in contextSnapshot for failing content', async () => {
    mockEvaluate.mockResolvedValueOnce(FAILING_RESULT)

    const result = await auditSocialPost('Short.', ['facebook'], 'social_a', SAMPLE_METADATA)
    const quality = result!.contextSnapshot.quality as Record<string, unknown>

    expect(quality.pass).toBe(false)
    expect(quality.overallScore).toBe(5)
  })

  it('handles null metadata fields gracefully', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const minimalMeta: SocialAuditMetadata = {}
    const result = await auditSocialPost('Content', ['facebook'], 'social_c', minimalMeta)

    expect(result).not.toBeNull()
    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.brief.brand_name).toBeNull()
    expect(ctx.campaign).toBeNull()
  })

  describe('Route B (social_b) — viral-structure-preservation', () => {
    it('sets contentType to social_b', async () => {
      mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

      await auditSocialPost('Content', ['tiktok'], 'social_b', SAMPLE_METADATA)

      const [, ctx] = mockEvaluate.mock.calls[0]
      expect(ctx.contentType).toBe('social_b')
    })

    it('injects viral-structure-preservation as an advisory routeDimension', async () => {
      mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

      await auditSocialPost('Content', ['tiktok'], 'social_b', SAMPLE_METADATA)

      const [, , options] = mockEvaluate.mock.calls[0]
      expect(options.routeDimensions).toHaveLength(1)
      expect(options.routeDimensions![0].id).toBe('viral-structure-preservation')
      expect(options.routeDimensions![0].advisory).toBe(true)
    })

    it('does NOT inject viral-structure-preservation for social_a', async () => {
      mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

      await auditSocialPost('Content', ['facebook'], 'social_a', SAMPLE_METADATA, 'NZ tours')

      const [, , options] = mockEvaluate.mock.calls[0]
      expect(options.routeDimensions ?? []).toHaveLength(0)
    })

    it('does NOT inject viral-structure-preservation for social_c', async () => {
      mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

      await auditSocialPost('Content', ['facebook'], 'social_c', SAMPLE_METADATA)

      const [, , options] = mockEvaluate.mock.calls[0]
      expect(options.routeDimensions ?? []).toHaveLength(0)
    })

    it('returns rubricResult and contextSnapshot for social_b', async () => {
      mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

      const result = await auditSocialPost(
        'Experience the magic of New Zealand — book your adventure today!',
        ['tiktok'],
        'social_b',
        SAMPLE_METADATA,
      )

      expect(result).not.toBeNull()
      expect(result!.rubricResult.overallScore).toBe(8)
      expect(result!.contextSnapshot.contentType).toBe('social_b')
    })

    it('viral-structure-preservation advisory dimension does not block pass', async () => {
      // pass=true even though viral-structure-preservation scored low (advisory)
      const resultWithAdvisoryFail = {
        overallScore: 7.5,
        pass: true,
        dimensions: [
          { dimension: 'platform-fit',                score: 9, pass: true,  reason: 'Good.', method: 'rule' as const },
          { dimension: 'viral-structure-preservation', score: 4, pass: true,  reason: 'Advisory only.', method: 'llm' as const },
        ],
      }
      mockEvaluate.mockResolvedValueOnce(resultWithAdvisoryFail)

      const result = await auditSocialPost('Content', ['tiktok'], 'social_b', SAMPLE_METADATA)

      expect(result!.rubricResult.pass).toBe(true)
    })
  })
})
