import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { auditBlogPost } from '../quality-audit'
import type { BlogAuditMetadata } from '../quality-audit'

// Mock quality-rubric evaluate()
vi.mock('@/lib/content/quality-rubric', () => ({
  evaluate: vi.fn(),
}))

// Mock OpenAI constructor (prevent real network calls)
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
    { dimension: 'platform-fit', score: 4, pass: false, reason: 'Too short.',   method: 'rule' as const },
    { dimension: 'cta',          score: 4, pass: false, reason: 'No CTA found.', method: 'rule' as const },
  ],
}

const SAMPLE_METADATA: BlogAuditMetadata = {
  brand_name:       'CTS Tours',
  tone:             'professional',
  avoid_words:      ['cheap'],
  platforms:        ['blog'],
  primary_audience: 'NZ travellers',
  campaign: {
    title:                  'Summer NZ Tours',
    offer:                  '10% off',
    primary_cta:            'Book now',
    campaign_angle:         'family adventure',
    target_audience_detail: 'families with children',
  },
  primaryKeyword: 'best NZ tours',
}

describe('auditBlogPost', () => {
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
    const result = await auditBlogPost('Some content', 'geo_only', SAMPLE_METADATA)
    expect(result).toBeNull()
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('returns rubric result and context snapshot on success', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const result = await auditBlogPost('Great blog content here.', 'geo_only', SAMPLE_METADATA)

    expect(result).not.toBeNull()
    expect(result!.rubricResult.pass).toBe(true)
    expect(result!.rubricResult.overallScore).toBe(8)
  })

  it('builds correct RubricContext for blog platform', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    await auditBlogPost('Blog content.', 'unified', SAMPLE_METADATA)

    expect(mockEvaluate).toHaveBeenCalledOnce()
    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.platform).toBe('blog')
    expect(ctx.contentType).toBe('blog')
    expect(ctx.brief.brand_name).toBe('CTS Tours')
    expect(ctx.primaryKeyword).toBe('best NZ tours')
    expect(ctx.campaign?.title).toBe('Summer NZ Tours')
  })

  it('includes mode in contextSnapshot', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const result = await auditBlogPost('Content.', 'seo_only', SAMPLE_METADATA)

    expect(result!.contextSnapshot.mode).toBe('seo_only')
    expect(result!.contextSnapshot.platform).toBe('blog')
  })

  it('embeds quality dimensions in contextSnapshot', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const result = await auditBlogPost('Content.', 'geo_only', SAMPLE_METADATA)
    const quality = result!.contextSnapshot.quality as Record<string, unknown>

    expect(quality.overallScore).toBe(8)
    expect(quality.pass).toBe(true)
    expect(Array.isArray(quality.dimensions)).toBe(true)
  })

  it('sets pass=false in contextSnapshot for failing content', async () => {
    mockEvaluate.mockResolvedValueOnce(FAILING_RESULT)

    const result = await auditBlogPost('Short.', 'geo_only', SAMPLE_METADATA)
    const quality = result!.contextSnapshot.quality as Record<string, unknown>

    expect(quality.pass).toBe(false)
    expect(quality.overallScore).toBe(5)
  })

  it('handles null metadata fields gracefully', async () => {
    mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)

    const minimalMeta: BlogAuditMetadata = {}
    const result = await auditBlogPost('Content.', 'geo_only', minimalMeta)

    expect(result).not.toBeNull()
    const [, ctx] = mockEvaluate.mock.calls[0]
    expect(ctx.brief.brand_name).toBeNull()
    expect(ctx.campaign).toBeNull()
    expect(ctx.primaryKeyword).toBeNull()
  })
})
