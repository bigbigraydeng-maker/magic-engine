/**
 * TDD: RED phase — tests written before implementation.
 *
 * upgrade-generator.ts provides:
 *   generatePageUpgrade(req) — fetches original page via Jina, then calls
 *   Claude to produce a SEO+GEO enhanced version with a changes summary.
 *
 * Phase 8.2.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}))

vi.mock('@/lib/content/brief-injector', () => ({
  getActiveBrief: vi.fn().mockResolvedValue(null),
  formatBriefForPrompt: vi.fn().mockReturnValue('Brand: Test Co'),
}))

import { generatePageUpgrade } from '../upgrade-generator'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import Anthropic from '@anthropic-ai/sdk'

const mockFetchUrl = vi.mocked(fetchUrlAsMarkdown)
const MockAnthropic = vi.mocked(Anthropic)

const VALID_REQUEST = {
  client_id: 'client-abc',
  page_id: 'page-xyz',
  page_url: 'https://example.com/china-tours',
  page_title: 'China Tours NZ',
  page_type: 'service',
  word_count: 400,
  has_geo_block: false,
  topic: 'China tours New Zealand',
  mode: 'unified' as const,
}

const JINA_RESULT = {
  url: 'https://example.com/china-tours',
  title: 'China Tours NZ',
  markdown: '# China Tours NZ\n\nWe offer tours to China.\n\nContact us today.',
  chars: 60,
}

const CLAUDE_RESPONSE = {
  id: 'msg-123',
  type: 'message' as const,
  role: 'assistant' as const,
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        enhanced_title: 'Best China Tours from New Zealand — Expert Guided Packages',
        enhanced_meta_title: 'China Tours NZ | Expert-Led Packages',
        enhanced_meta_description: 'Discover China with expert guides. Trusted NZ tour operator.',
        enhanced_html_body: '<h1>Best China Tours from New Zealand</h1><p>Content here...</p>',
        word_count: 1200,
        changes_summary: 'Added H1 with keyword, expanded content from 50 to 1200 words, added GEO block.',
        geo_block_html: '<div class="geo-signals">Content</div>',
      }),
    },
  ],
  model: 'claude-sonnet-4-6',
  stop_reason: 'end_turn' as const,
  stop_sequence: null,
  usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generatePageUpgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'

    MockAnthropic.mockImplementation(() => ({
      messages: { create: vi.fn().mockResolvedValue(CLAUDE_RESPONSE) },
    }) as unknown as InstanceType<typeof Anthropic>)
  })

  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY
    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    await expect(generatePageUpgrade(VALID_REQUEST)).rejects.toThrow('ANTHROPIC_API_KEY')
  })

  // Jina failure is intentionally non-fatal (c02c0dae): future campaign pages
  // may not be live yet, so we fall back to a title/URL stub and still upgrade.
  it('falls back to stub content when Jina fetch fails', async () => {
    mockFetchUrl.mockRejectedValue(new Error('Jina timeout'))
    const result = await generatePageUpgrade(VALID_REQUEST)
    expect(result.original_excerpt).toContain('Content could not be fetched')
    expect(result.original_excerpt).toContain(VALID_REQUEST.page_url)
    expect(result.enhanced_title).toBe('Best China Tours from New Zealand — Expert Guided Packages')
  })

  it('calls fetchUrlAsMarkdown with the page URL', async () => {
    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    await generatePageUpgrade(VALID_REQUEST)
    expect(mockFetchUrl).toHaveBeenCalledWith('https://example.com/china-tours')
  })

  it('returns enhanced content fields', async () => {
    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    const result = await generatePageUpgrade(VALID_REQUEST)
    expect(result.enhanced_title).toBe('Best China Tours from New Zealand — Expert Guided Packages')
    expect(result.enhanced_html_body).toContain('<h1>')
    expect(result.word_count).toBe(1200)
  })

  it('returns original_excerpt from Jina markdown (first 500 chars)', async () => {
    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    const result = await generatePageUpgrade(VALID_REQUEST)
    expect(result.original_excerpt).toContain('China Tours NZ')
    expect(result.original_excerpt.length).toBeLessThanOrEqual(500)
  })

  it('returns changes_summary', async () => {
    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    const result = await generatePageUpgrade(VALID_REQUEST)
    expect(result.changes_summary).toBeTruthy()
    expect(result.changes_summary).toContain('GEO')
  })

  it('returns cost_usd computed from Claude token usage', async () => {
    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    const result = await generatePageUpgrade(VALID_REQUEST)
    expect(typeof result.cost_usd).toBe('number')
    expect(result.cost_usd).toBeGreaterThan(0)
  })

  it('returns model_used', async () => {
    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    const result = await generatePageUpgrade(VALID_REQUEST)
    expect(result.model_used).toMatch(/claude/)
  })

  it('returns source_page_url matching the request URL', async () => {
    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    const result = await generatePageUpgrade(VALID_REQUEST)
    expect(result.source_page_url).toBe('https://example.com/china-tours')
  })

  it('returns geo_block_html when Claude includes it', async () => {
    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    const result = await generatePageUpgrade(VALID_REQUEST)
    expect(result.geo_block_html).toBeTruthy()
  })

  it('handles Claude returning invalid JSON gracefully', async () => {
    MockAnthropic.mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          ...CLAUDE_RESPONSE,
          content: [{ type: 'text', text: 'not valid json {{{' }],
        }),
      },
    }) as unknown as InstanceType<typeof Anthropic>)

    mockFetchUrl.mockResolvedValue(JINA_RESULT)
    // JSON parse failure is intentionally non-fatal (c02c0dae): the caller gets
    // fallback fields (original title, empty summary) instead of a hard error.
    const result = await generatePageUpgrade(VALID_REQUEST)
    expect(result.enhanced_title).toBe('China Tours NZ')
    expect(result.enhanced_html_body).toBe('<h1>China Tours NZ</h1>')
    expect(result.word_count).toBe(0)
    expect(result.changes_summary).toBe('')
    expect(result.geo_block_html).toBeNull()
  })
})
