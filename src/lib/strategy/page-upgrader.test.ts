/**
 * Tests for page-upgrader.ts (Phase 8.D.2.2)
 *
 * upgradePage:
 *   1. Loads the SitePage record by id
 *   2. Re-fetches the page via Jina to get fresh markdown
 *   3. Loads active GEO directive HTML
 *   4. Calls GPT-4o (JSON mode) for an UpgradeRecommendation
 *   5. Returns structured JSON; does NOT persist (team applies manually)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createMock } },
  })),
}))
vi.mock('@/lib/db/site-pages', () => ({
  getSitePageByUrl: vi.fn(),
  listSitePages: vi.fn(),
}))
vi.mock('@/lib/brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
}))
vi.mock('@/lib/geo/html-generator', () => ({
  getActiveGeoHtml: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { upgradePage } from './page-upgrader'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { getActiveGeoHtml } from '@/lib/geo/html-generator'
import { supabaseAdmin } from '@/lib/supabase'

const PAGE_ID = 'page-1'
const CLIENT_ID = 'client-1'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OPENAI_API_KEY = 'sk-test'
})

function mockSitePageLookup(payload: any) {
  const single = vi.fn().mockResolvedValue({ data: payload, error: null })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as any)
}

describe('upgradePage', () => {
  it('returns a structured recommendation from GPT', async () => {
    mockSitePageLookup({
      id: PAGE_ID,
      client_id: CLIENT_ID,
      url: 'https://example.com/services',
      title: 'Our Services',
      word_count: 600,
      has_geo_block: false,
      topics: ['services'],
      primary_keyword: 'services nz',
    })
    vi.mocked(fetchUrlAsMarkdown).mockResolvedValue({
      url: 'https://example.com/services',
      title: 'Our Services',
      markdown: '# Our Services\n\nSome content.',
      chars: 30,
    })
    vi.mocked(getActiveGeoHtml).mockResolvedValue({
      directiveId: 'geo-v1',
      html: '<div aria-hidden="true">geo</div>',
    } as any)

    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              what_to_add: ['FAQ section', 'Customer testimonials'],
              what_to_strengthen: ['Hero paragraph'],
              meta_title_suggestion: 'Our NZ Services — Tailored',
              meta_description_suggestion: 'A great description.',
              upgraded_html_preview: '<h1>Our Services</h1><p>Better.</p>',
              rationale: 'Added entity signals and depth.',
            }),
          },
        },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    })

    const rec = await upgradePage(CLIENT_ID, PAGE_ID)

    expect(rec.page_id).toBe(PAGE_ID)
    expect(rec.what_to_add).toContain('FAQ section')
    expect(rec.upgraded_html_preview).toMatch(/<h1>/)
    expect(rec.cost_usd).toBeGreaterThan(0)
    expect(rec.current_has_geo_block).toBe(false)
    // GPT was given the GEO directive context
    const messages = createMock.mock.calls[0][0].messages
    const userMsg = messages.find((m: any) => m.role === 'user')
    expect(userMsg.content).toContain('geo-v1')
    expect(userMsg.content).toContain('Our Services')
  })

  it('throws when the page is not found', async () => {
    mockSitePageLookup(null)
    await expect(upgradePage(CLIENT_ID, 'missing')).rejects.toThrow(/not found/i)
  })

  it('throws when page belongs to a different client', async () => {
    mockSitePageLookup({
      id: PAGE_ID,
      client_id: 'other-client',
      url: 'https://example.com/x',
      title: 'X',
      word_count: 600,
      has_geo_block: false,
      topics: [],
      primary_keyword: null,
    })
    await expect(upgradePage(CLIENT_ID, PAGE_ID)).rejects.toThrow(/client/i)
  })

  it('continues when Jina re-fetch fails (uses content_summary fallback)', async () => {
    mockSitePageLookup({
      id: PAGE_ID,
      client_id: CLIENT_ID,
      url: 'https://example.com/x',
      title: 'X',
      word_count: 400,
      content_summary: 'Cached summary text here.',
      has_geo_block: false,
      topics: [],
      primary_keyword: null,
    })
    vi.mocked(fetchUrlAsMarkdown).mockRejectedValue(new Error('jina down'))
    vi.mocked(getActiveGeoHtml).mockResolvedValue(null as any)
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              what_to_add: ['Add content'],
              what_to_strengthen: [],
              meta_title_suggestion: null,
              meta_description_suggestion: null,
              upgraded_html_preview: '<h1>X</h1>',
              rationale: 'r',
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    })

    const rec = await upgradePage(CLIENT_ID, PAGE_ID)
    expect(rec.upgraded_html_preview).toMatch(/<h1>/)
    // user message should reflect the cached summary, not crash
    const messages = createMock.mock.calls[0][0].messages
    const userMsg = messages.find((m: any) => m.role === 'user')
    expect(userMsg.content).toContain('Cached summary text here.')
  })

  it('throws when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY
    mockSitePageLookup({
      id: PAGE_ID,
      client_id: CLIENT_ID,
      url: 'u',
      title: 't',
      word_count: 0,
      has_geo_block: false,
      topics: [],
      primary_keyword: null,
    })
    await expect(upgradePage(CLIENT_ID, PAGE_ID)).rejects.toThrow(/OPENAI_API_KEY/)
  })
})
