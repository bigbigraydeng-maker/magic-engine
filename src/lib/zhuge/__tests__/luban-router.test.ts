import { describe, it, expect, vi } from 'vitest'
import { getLubanRoute, recommendActionsForDimension } from '../luban-router'
import type { IndustryBenchmarkSummary } from '../types'

const CLIENT_ID = 'client-abc-123'

describe('getLubanRoute()', () => {
  it('routes generate_blog_post to blog page', () => {
    const r = getLubanRoute('luban.generate_blog_post', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/clients/${CLIENT_ID}/blog`)
      expect(r.label).toBeTruthy()
    }
  })

  it('routes generate_geo_directive to geo composer', () => {
    const r = getLubanRoute('luban.generate_geo_directive', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/geo-composer/${CLIENT_ID}`)
      expect(r.label).toBeTruthy()
    }
  })

  it('routes publish_geo_snippet to geo composer (same as generate_geo_directive)', () => {
    const r = getLubanRoute('luban.publish_geo_snippet', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/geo-composer/${CLIENT_ID}`)
    }
  })

  it('routes generate_social_campaign to client page', () => {
    const r = getLubanRoute('luban.generate_social_campaign', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/clients/${CLIENT_ID}`)
    }
  })

  it('routes generate_social_post to client page (same as campaign)', () => {
    const r = getLubanRoute('luban.generate_social_post', CLIENT_ID)
    expect(r.kind).toBe('navigate')
    if (r.kind === 'navigate') {
      expect(r.href).toBe(`/dashboard/clients/${CLIENT_ID}`)
    }
  })

  it('returns none for null tool (FDE or external action)', () => {
    const r = getLubanRoute(null, CLIENT_ID)
    expect(r.kind).toBe('none')
    if (r.kind === 'none') {
      expect(r.reason).toBeTruthy()
    }
  })

  it('returns none for unrecognised tool name', () => {
    const r = getLubanRoute('luban.unknown_future_tool', CLIENT_ID)
    expect(r.kind).toBe('none')
    if (r.kind === 'none') {
      expect(r.reason).toContain('luban.unknown_future_tool')
    }
  })

  it('embeds clientId correctly in all navigate hrefs', () => {
    const tools = [
      'luban.generate_blog_post',
      'luban.generate_geo_directive',
      'luban.publish_geo_snippet',
      'luban.generate_social_campaign',
      'luban.generate_social_post',
    ]
    for (const tool of tools) {
      const r = getLubanRoute(tool, CLIENT_ID)
      expect(r.kind).toBe('navigate')
      if (r.kind === 'navigate') {
        expect(r.href).toContain(CLIENT_ID)
      }
    }
  })
})

// ── DAPE W2 — recommendActionsForDimension ───────────────────────────────────

const stubSupabase = {} as Parameters<typeof recommendActionsForDimension>[0]

function makeIndustrySummary(overrides: Partial<IndustryBenchmarkSummary> = {}): IndustryBenchmarkSummary {
  return {
    sub_industry: 'inbound_tour_operator',
    has_content: true,
    dimensions: [
      { dimension: 'seo',           score_p50: 30, score_p75: 50, score_p90: 70, typical_monthly_budget_aud: 1200, confidence: 0.8, source: 'live' },
      { dimension: 'social',        score_p50: 20, score_p75: 35, score_p90: 60, typical_monthly_budget_aud: 800,  confidence: 0.7, source: 'cache' },
      { dimension: 'reputation',    score_p50: 50, score_p75: 70, score_p90: 85, typical_monthly_budget_aud: null, confidence: 0.6, source: 'cache' },
      { dimension: 'ai_visibility', score_p50: 10, score_p75: 25, score_p90: 50, typical_monthly_budget_aud: null, confidence: 0.5, source: 'cache' },
    ],
    ...overrides,
  }
}

describe('recommendActionsForDimension()', () => {
  it('returns empty list when no industry memory available', async () => {
    const summary = makeIndustrySummary({ has_content: false, dimensions: [] })
    const recs = await recommendActionsForDimension(stubSupabase, CLIENT_ID, {
      industryBenchmarkSummary: summary,
    })
    expect(recs).toEqual([])
  })

  it('long mode targets P90 for each dimension', async () => {
    const recs = await recommendActionsForDimension(stubSupabase, CLIENT_ID, {
      mode: 'long',
      industryBenchmarkSummary: makeIndustrySummary(),
    })
    expect(recs.length).toBeGreaterThan(0)
    for (const r of recs) {
      expect(r.target_percentile).toBe('p90')
    }
    const seo = recs.find((r) => r.dimension === 'seo')
    expect(seo?.target_value).toBe(70)
  })

  it('short mode targets P75 and skips reputation + caps at 2', async () => {
    const recs = await recommendActionsForDimension(stubSupabase, CLIENT_ID, {
      mode: 'short',
      industryBenchmarkSummary: makeIndustrySummary(),
    })
    expect(recs.length).toBeLessThanOrEqual(2)
    for (const r of recs) {
      expect(r.target_percentile).toBe('p75')
      expect(r.dimension).not.toBe('reputation')
    }
  })

  it('uses default tool per dimension', async () => {
    const recs = await recommendActionsForDimension(stubSupabase, CLIENT_ID, {
      mode: 'long',
      industryBenchmarkSummary: makeIndustrySummary(),
    })
    expect(recs.find((r) => r.dimension === 'seo')?.tool).toBe('luban.generate_blog_post')
    expect(recs.find((r) => r.dimension === 'ai_visibility')?.tool).toBe('luban.generate_geo_directive')
    expect(recs.find((r) => r.dimension === 'social')?.tool).toBe('luban.generate_social_post')
    expect(recs.find((r) => r.dimension === 'reputation')?.tool).toBeNull()
  })

  it('falls back to P75 when P90 is missing in long mode', async () => {
    const summary = makeIndustrySummary({
      dimensions: [
        { dimension: 'seo', score_p50: 30, score_p75: 50, score_p90: null, typical_monthly_budget_aud: 1200, confidence: 0.8, source: 'live' },
      ],
    })
    const recs = await recommendActionsForDimension(stubSupabase, CLIENT_ID, {
      mode: 'long',
      industryBenchmarkSummary: summary,
    })
    expect(recs[0].target_value).toBe(50)
  })

  it('skips dimensions where all percentiles are null', async () => {
    const summary = makeIndustrySummary({
      dimensions: [
        { dimension: 'seo', score_p50: null, score_p75: null, score_p90: null, typical_monthly_budget_aud: null, confidence: 0, source: null },
      ],
    })
    const recs = await recommendActionsForDimension(stubSupabase, CLIENT_ID, {
      mode: 'long',
      industryBenchmarkSummary: summary,
    })
    expect(recs).toHaveLength(0)
  })

  it('logs memory hit metrics', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await recommendActionsForDimension(stubSupabase, CLIENT_ID, {
      mode: 'long',
      industryBenchmarkSummary: makeIndustrySummary(),
    })
    const logged = logSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('[zhuge/luban-router] memory hits')
    )
    expect(logged).toBeDefined()
    const payload = JSON.parse(logged![1] as string)
    expect(payload.industry_memory).toBe(true)
    expect(payload.sub_industry).toBe('inbound_tour_operator')
    logSpy.mockRestore()
  })
})
