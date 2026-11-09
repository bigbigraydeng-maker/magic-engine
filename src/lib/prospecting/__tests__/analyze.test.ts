import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/brief/jina', () => ({ fetchUrlAsMarkdown: vi.fn() }))
vi.mock('@/lib/ai-tracker/runners/openai', () => ({ runOpenAI: vi.fn() }))
vi.mock('@/lib/apify/social-scraper', () => ({
  scrapeFacebookPage: vi.fn(),
  scrapeInstagramProfile: vi.fn(),
}))
vi.mock('@/lib/anthropic/client', () => ({
  callClaudeChat: vi.fn(),
  parseJsonResponse: (text: string) => JSON.parse(text),
}))

import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { runOpenAI } from '@/lib/ai-tracker/runners/openai'
import { callClaudeChat } from '@/lib/anthropic/client'
import { brandMentioned, validateSynthesis, analyzeProspect, type ProspectAnalysisInput } from '../analyze'

const mockJina   = vi.mocked(fetchUrlAsMarkdown)
const mockOpenAI = vi.mocked(runOpenAI)
const mockClaude = vi.mocked(callClaudeChat)

const GOOD_SYNTHESIS = {
  owner_name: 'Mark',
  top_problems: ['No Google Analytics installed', 'Facebook inactive for 14 months', 'Homepage has no meta description'],
  email_hook: 'Your 120 five-star reviews say a lot about your workmanship.',
  competitors_mentioned: ['FloorFlow'],
  pillars: {
    seo:    { score: 40, summary: 'Basics missing' },
    geo:    { score: 20, summary: 'Absent from AI answers' },
    social: { score: 30, summary: 'Dormant Facebook' },
    gbp:    { score: 85, summary: 'Strong reviews' },
  },
}

function input(overrides: Partial<ProspectAnalysisInput> = {}): ProspectAnalysisInput {
  return {
    business_name: 'Oz Flooring Co', industry: 'flooring', city: 'brisbane', country: 'AU',
    website_url: 'https://ozflooring.com.au', domain: 'ozflooring.com.au',
    facebook_url: null, instagram_url: null,
    rating: 4.7, review_count: 120,
    score_breakdown: [{ signal: 'no_ga4', points: 10, kind: 'weakness' }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OPENAI_API_KEY = 'test'
  mockJina.mockResolvedValue({ url: 'x', title: 'x', markdown: 'About us: founded by Mark.', chars: 26 })
  mockOpenAI.mockResolvedValue({
    ai_engine: 'openai', ai_model: 'x', raw_response: 'Top picks: FloorFlow and Brisbane Timber Floors.',
    citations: [], tokens_used: null, cost_usd: null, latency_ms: 1, error_message: null,
  })
  mockClaude.mockResolvedValue({ text: JSON.stringify(GOOD_SYNTHESIS), input_tokens: 1, output_tokens: 1, cost_usd: 0 })
})

describe('brandMentioned', () => {
  it('matches an exact brand mention case-insensitively', () => {
    expect(brandMentioned('I recommend Oz Flooring Co for timber floors.', 'Oz Flooring Co')).toBe(true)
  })

  it('matches when the answer drops the legal suffix', () => {
    expect(brandMentioned('Oz Flooring is highly rated in Brisbane.', 'Oz Flooring Pty Ltd')).toBe(true)
  })

  it('does not match a different business', () => {
    expect(brandMentioned('Top picks: Brisbane Timber Floors and FloorFlow.', 'Oz Flooring Co')).toBe(false)
  })

  it('does not false-positive on city+industry brand names (weizheng FP1)', () => {
    expect(brandMentioned(
      'The best flooring stores in Brisbane. Flooring Xtra tops the list.',
      'Brisbane Flooring Pty Ltd',
      ['brisbane', 'flooring store'],
    )).toBe(false)
  })

  it('does not false-positive on multi-word city + industry names (weizheng FP2)', () => {
    expect(brandMentioned(
      'For solar in Gold Coast, Solar Hub is a favourite.',
      'Gold Coast Solar Pty Ltd',
      ['gold coast', 'solar installer'],
    )).toBe(false)
  })

  it('still matches a generic-named brand on the exact full name', () => {
    expect(brandMentioned(
      'Brisbane Flooring Pty Ltd is a top choice.',
      'Brisbane Flooring Pty Ltd',
      ['brisbane', 'flooring store'],
    )).toBe(true)
  })

  it('handles punctuation and ampersands in names', () => {
    expect(brandMentioned('Smith & Jones Plumbing is a great choice.', 'Smith & Jones Plumbing')).toBe(true)
  })

  it('never matches on an empty name', () => {
    expect(brandMentioned('any answer', '')).toBe(false)
  })
})

describe('validateSynthesis', () => {
  it('accepts a well-formed payload and clamps scores', () => {
    const parsed = validateSynthesis({ ...GOOD_SYNTHESIS, pillars: { ...GOOD_SYNTHESIS.pillars, seo: { score: 150, summary: 'x' } } })
    expect(parsed.pillars.seo.score).toBe(100)
  })

  it('rejects missing pillars', () => {
    expect(() => validateSynthesis({ ...GOOD_SYNTHESIS, pillars: undefined })).toThrow(/pillars/)
  })

  it('rejects a malformed pillar', () => {
    expect(() => validateSynthesis({
      ...GOOD_SYNTHESIS,
      pillars: { ...GOOD_SYNTHESIS.pillars, social: { score: 'high', summary: 'x' } },
    })).toThrow(/social/)
  })

  it('rejects top_problems returned as a string (would crash the UI)', () => {
    expect(() => validateSynthesis({ ...GOOD_SYNTHESIS, top_problems: 'No GA4 installed' })).toThrow(/top_problems/)
  })

  it('normalises empty owner_name to null', () => {
    expect(validateSynthesis({ ...GOOD_SYNTHESIS, owner_name: '  ' }).owner_name).toBeNull()
  })
})

describe('analyzeProspect', () => {
  it('produces a full analysis with pillars, hook and segment', async () => {
    const a = await analyzeProspect(input())
    expect(a.error).toBeUndefined()
    expect(a.owner_name).toBe('Mark')
    expect(a.pillars.gbp.score).toBe(85)
    expect(a.geo_probe?.mentioned).toBe(false)
    expect(a.geo_probe?.competitors_mentioned).toEqual(['FloorFlow'])
    expect(a.segment).toBeDefined()
  })

  it('never throws when every collector fails', async () => {
    mockJina.mockRejectedValue(new Error('jina down'))
    mockOpenAI.mockRejectedValue(new Error('openai down'))
    const a = await analyzeProspect(input())
    expect(a.skips).toContain('homepage_unavailable')
    expect(a.skips).toContain('geo_probe_skipped')
    expect(a.error).toBeUndefined()   // synthesis still ran on partial evidence
  })

  it('returns a neutral error fallback when synthesis JSON is malformed', async () => {
    mockClaude.mockResolvedValue({ text: '{"pillars": "nope"}', input_tokens: 1, output_tokens: 1, cost_usd: 0 })
    const a = await analyzeProspect(input())
    expect(a.error).toBe('AI 返回格式异常')
    expect(a.pillars.seo.summary).toBe('analysis failed')
  })

  it('neutralises vendor-revealing errors before they reach the UI', async () => {
    mockClaude.mockRejectedValue(new Error('ANTHROPIC_API_KEY environment variable is not set'))
    const a = await analyzeProspect(input())
    expect(a.error).toBe('AI 引擎未配置')
    expect(a.error).not.toMatch(/anthropic/i)
  })
})
