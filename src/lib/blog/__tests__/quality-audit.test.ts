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

// Jev judgement (cliché check) — never hit the network in tests
vi.mock('@/lib/jev/client', () => ({
  callJev: vi.fn(),
}))

import { evaluate } from '@/lib/content/quality-rubric'
import { callJev } from '@/lib/jev/client'
const mockJudge = vi.mocked(callJev)
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
    mockJudge.mockResolvedValue({ answers: { cliche: { noul: 0.1 } } })
  })

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalEnv
  })

  it('still runs the content guard when OPENAI_API_KEY is not set (fail-closed)', async () => {
    delete process.env.OPENAI_API_KEY
    const result = await auditBlogPost('Some content', 'geo_only', SAMPLE_METADATA)
    expect(result.contextSnapshot.rubric_skipped).toBe(true)
    expect(result.contentGuard.status).toBe('pass')
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

  describe('content guard (mixed language / cliché)', () => {
    const NAL_TITLE = 'Unlock the Power of 一件代发物流支持 with NAL Express!'

    it('fails and flags human review for mixed-language copy even when the rubric passes', async () => {
      mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)
      const result = await auditBlogPost(NAL_TITLE, 'geo_only', SAMPLE_METADATA)
      expect(result.rubricResult.pass).toBe(false)
      expect(result.contentGuard.needsHumanReview).toBe(true)
      expect(result.retryable).toBe(true)
      const guard = result.contextSnapshot.content_guard as Record<string, unknown>
      expect(guard.needs_human_review).toBe(true)
      expect(guard.status).toBe('fail')
    })

    it('treats a judgement error as needs-review, not pass, and not retryable', async () => {
      mockEvaluate.mockResolvedValueOnce(PASSING_RESULT)
      mockJudge.mockRejectedValueOnce(new Error('HTTP 503'))
      const result = await auditBlogPost('Book the 12-day Golden China tour from Auckland today.', 'geo_only', SAMPLE_METADATA)
      expect(result.rubricResult.pass).toBe(false)
      expect(result.contentGuard.status).toBe('unavailable')
      expect(result.retryable).toBe(false)
    })
  })
})
