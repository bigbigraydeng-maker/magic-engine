import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { auditReelsDraft } from '../quality-audit'
import type { ReelsAuditMetadata } from '../quality-audit'

vi.mock('@/lib/content/quality-rubric', () => ({
  evaluate: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}))

import { evaluate } from '@/lib/content/quality-rubric'
const mockEvaluate = vi.mocked(evaluate)

const PASSING_RESULT = {
  overallScore: 8.2,
  pass: true,
  dimensions: [
    { dimension: 'platform-fit', score: 9, pass: true, reason: 'Good length.', method: 'rule' as const },
    { dimension: 'cta',          score: 9, pass: true, reason: 'CTA found.',   method: 'rule' as const },
    { dimension: 'brand-fit',    score: 8, pass: true, reason: 'Tone matches.', method: 'llm' as const },
  ],
}

const FAILING_RESULT = {
  overallScore: 4.5,
  pass: false,
  dimensions: [
    { dimension: 'platform-fit', score: 3, pass: false, reason: 'Too short.',    method: 'rule' as const },
    { dimension: 'cta',          score: 4, pass: false, reason: 'No CTA found.', method: 'rule' as const },
    { dimension: 'brand-fit',    score: 6, pass: false, reason: 'Tone mismatch.', method: 'llm' as const },
  ],
}

const SAMPLE_METADATA: ReelsAuditMetadata = {
  brand_name:       'CTS Tours',
  tone:             'adventurous',
  avoid_words:      ['cheap', 'discount'],
  platforms:        ['facebook'],
  primary_audience: 'NZ travellers',
  campaign: {
    title:                  'Summer NZ Adventure',
    offer:                  '15% off group bookings',
    primary_cta:            'Book now',
    campaign_angle:         'family adventure',
    target_audience_detail: 'families with children aged 5-15',
  },
}

const SAMPLE_CAPTION =
  'Explore the breathtaking landscapes of New Zealand with CTS Tours! ' +
  'Our family-friendly summer adventures include stunning fjords, geothermal wonders, ' +
  'and unforgettable wildlife encounters. Book your adventure today and save 15% on group bookings!'

describe('auditReelsDraft', () => {
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
    const result = await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)
    expect(result).toBeNull()
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('returns rubricResult and contextSnapshot on success', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const result = await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)

    expect(result).not.toBeNull()
    expect(result!.rubricResult.pass).toBe(true)
    expect(result!.rubricResult.overallScore).toBe(8.2)
  })

  it('sets platform to "reels" in RubricContext', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)

    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.platform).toBe('reels')
  })

  it('sets contentType to "reels" in RubricContext', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)

    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.contentType).toBe('reels')
  })

  it('passes brand context to RubricContext brief', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)

    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.brief.brand_name).toBe('CTS Tours')
    expect(ctx.brief.tone).toBe('adventurous')
    expect(ctx.brief.avoid_words).toEqual(['cheap', 'discount'])
    expect(ctx.brief.primary_audience).toBe('NZ travellers')
  })

  it('passes campaign context to RubricContext', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)

    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.campaign?.title).toBe('Summer NZ Adventure')
    expect(ctx.campaign?.offer).toBe('15% off group bookings')
    expect(ctx.campaign?.primary_cta).toBe('Book now')
  })

  it('passes the fb_caption string as content to evaluate', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)

    const [content] = mockEvaluate.mock.calls[0]
    expect(content).toBe(SAMPLE_CAPTION)
  })

  it('includes quality dimensions in contextSnapshot', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const result = await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)
    const quality = result!.contextSnapshot.quality as Record<string, unknown>

    expect(quality.overallScore).toBe(8.2)
    expect(quality.pass).toBe(true)
    expect(Array.isArray(quality.dimensions)).toBe(true)
  })

  it('reflects pass=false in contextSnapshot for failing content', async () => {
    mockEvaluate.mockResolvedValueOnce(FAILING_RESULT)

    const result = await auditReelsDraft('Short.', SAMPLE_METADATA)
    const quality = result!.contextSnapshot.quality as Record<string, unknown>

    expect(quality.pass).toBe(false)
    expect(quality.overallScore).toBe(4.5)
  })

  it('contextSnapshot includes platform and contentType fields', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const result = await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)

    expect(result!.contextSnapshot.platform).toBe('reels')
    expect(result!.contextSnapshot.contentType).toBe('reels')
  })

  it('contextSnapshot includes auditedAt timestamp', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const before = new Date().toISOString()
    const result = await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)
    const after = new Date().toISOString()

    const auditedAt = result!.contextSnapshot.auditedAt as string
    expect(auditedAt >= before).toBe(true)
    expect(auditedAt <= after).toBe(true)
  })

  it('handles null metadata fields gracefully', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const minimalMeta: ReelsAuditMetadata = {}
    const result = await auditReelsDraft(SAMPLE_CAPTION, minimalMeta)

    expect(result).not.toBeNull()
    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.brief.brand_name).toBeNull()
    expect(ctx.brief.tone).toBeNull()
    expect(ctx.campaign).toBeNull()
  })

  it('handles null campaign in metadata gracefully', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const metaNocamp: ReelsAuditMetadata = {
      brand_name: 'Oztop',
      tone: 'casual',
      campaign: null,
    }

    const result = await auditReelsDraft(SAMPLE_CAPTION, metaNocamp)

    expect(result).not.toBeNull()
    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.campaign).toBeNull()
    expect(result!.contextSnapshot.campaign).toBeNull()
  })

  it('does not inject any routeDimensions (pure coreDimensions)', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditReelsDraft(SAMPLE_CAPTION, SAMPLE_METADATA)

    const [, , options] = mockEvaluate.mock.calls[0]
    expect(options.routeDimensions ?? []).toHaveLength(0)
  })
})
