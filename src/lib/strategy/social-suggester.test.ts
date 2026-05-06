/**
 * Tests for social-suggester.ts (Phase 8.D.2.4)
 *
 * Given a blog post (title / body / keyword), produce 3 social
 * topic recommendations (one per platform: Facebook / Instagram /
 * LinkedIn) so the team can amplify approved content.
 *
 * Each recommendation is then persisted as a content_strategy_items
 * row with action_type='social_content' linked to the blog post.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createMock } },
  })),
}))
vi.mock('@/lib/db/strategy-items', () => ({
  insertStrategyItems: vi.fn(),
}))

import {
  generateSocialSuggestions,
  parseSuggestions,
} from './social-suggester'
import { insertStrategyItems } from '@/lib/db/strategy-items'

const blog = {
  client_id: 'c1',
  blog_post_id: 'b1',
  title: 'How NZ Travellers Get a China Visa',
  html_body: '<h1>Visa</h1><p>You can apply visa-free now.</p>',
  primary_keyword: 'china visa nz',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OPENAI_API_KEY = 'sk-test'
})

describe('parseSuggestions (pure)', () => {
  it('extracts and clamps to 3 platforms', () => {
    const out = parseSuggestions({
      suggestions: [
        { platform: 'facebook', headline: 'A', body: 'aa' },
        { platform: 'instagram', headline: 'B', body: 'bb' },
        { platform: 'linkedin', headline: 'C', body: 'cc' },
        { platform: 'twitter', headline: 'D', body: 'dd' },
      ],
    })
    expect(out.length).toBe(3)
    expect(out.map((s) => s.platform)).toEqual([
      'facebook',
      'instagram',
      'linkedin',
    ])
  })

  it('drops invalid entries', () => {
    const out = parseSuggestions({
      suggestions: [
        { platform: 'facebook', headline: '', body: 'x' },
        { platform: 'instagram', headline: 'B', body: 'bb' },
      ],
    })
    expect(out.length).toBe(1)
    expect(out[0].platform).toBe('instagram')
  })

  it('returns empty when payload malformed', () => {
    expect(parseSuggestions(null as any)).toEqual([])
    expect(parseSuggestions({} as any)).toEqual([])
  })
})

describe('generateSocialSuggestions', () => {
  it('persists each suggestion as a strategy_item row', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestions: [
                {
                  platform: 'facebook',
                  headline: 'NZ → China visa-free!',
                  body: '...',
                },
                {
                  platform: 'instagram',
                  headline: 'Pack your bags.',
                  body: '...',
                },
                {
                  platform: 'linkedin',
                  headline: 'B2B deep dive on visa policy.',
                  body: '...',
                },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 200, completion_tokens: 200 },
    })
    vi.mocked(insertStrategyItems).mockResolvedValue([] as any)

    const result = await generateSocialSuggestions(blog)

    expect(result.suggestions.length).toBe(3)
    expect(insertStrategyItems).toHaveBeenCalledTimes(1)
    const rows = vi.mocked(insertStrategyItems).mock.calls[0][0]
    expect(rows.length).toBe(3)
    rows.forEach((r) => {
      expect(r.client_id).toBe('c1')
      expect(r.action_type).toBe('social_content')
      expect(r.content_mode).toBe('seo_only') // social riffs aren't GEO-targeted
      expect(r.linked_blog_post_id).toBe('b1')
      expect(r.proposed_title).toBeTruthy()
    })
  })

  it('throws when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY
    await expect(generateSocialSuggestions(blog)).rejects.toThrow(/OPENAI_API_KEY/)
  })

  it('returns empty result without DB call when GPT returns nothing', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
      usage: { prompt_tokens: 50, completion_tokens: 0 },
    })

    const result = await generateSocialSuggestions(blog)
    expect(result.suggestions).toEqual([])
    expect(insertStrategyItems).not.toHaveBeenCalled()
  })
})
