import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'claude-sonnet-4-6',
  callClaudeWithWebSearch: vi.fn(),
}))

import { callClaudeWithWebSearch } from '@/lib/anthropic/client'
import {
  gatherMarketContext,
  type MarketContextInput,
  type MarketContextResult,
} from '../market-context'

const mockedCall = vi.mocked(callClaudeWithWebSearch)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInput(overrides: Partial<MarketContextInput> = {}): MarketContextInput {
  return {
    clientBrandName: 'TestBrand',
    clientDomain: 'testbrand.com.au',
    industry: 'boutique tour operator',
    market: 'au',
    focusTopics: ['small-group tours', 'luxury food tours'],
    ...overrides,
  }
}

function buildValidResponse(): string {
  return JSON.stringify({
    industry_overview_md:
      'Boutique tour operators in Australia have rebounded from pandemic lows, with domestic demand up since 2024 driving a shift toward small-group, premium experiences anchored in regional food and wine.',
    key_trends: [
      { title: 'Small-group premium experiences', detail: 'Demand for sub-12-pax luxury tours grew through 2024 and 2025.' },
      { title: 'Food and wine anchor regional travel', detail: 'Regional food experiences are the strongest 2025 booking category.' },
      { title: 'Direct-booking share rising', detail: 'Operators report 2025 direct-channel share above 40%, up from 28% in 2022.' },
    ],
    category_benchmarks_md:
      'Strong AU boutique operators run direct-booking share above 35%, repeat-guest rates near 20%, and maintain at least one signature multi-day itinerary.',
    opportunities_md:
      'TestBrand can lean into small-group premium positioning, build a food-anchored signature itinerary, and invest in direct-channel SEO/AI visibility for regional Australia queries before larger OTAs crowd the space.',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedCall.mockResolvedValue({
    text: buildValidResponse(),
    citations: [
      { url: 'https://example.gov.au/tourism-2025', title: 'Tourism AU 2025' },
      { url: 'https://example.com/boutique-tours' },
    ],
    input_tokens: 1200,
    output_tokens: 600,
    cost_usd: 0.012,
    web_search_calls: 4,
  })
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('gatherMarketContext — happy path', () => {
  it('returns the four parsed sections plus citations', async () => {
    const result = await gatherMarketContext(buildInput())
    expect(result.industry_overview_md).toContain('Australia')
    expect(result.category_benchmarks_md).toContain('direct-booking')
    expect(result.opportunities_md).toContain('TestBrand')
    expect(result.key_trends).toHaveLength(3)
    expect(result.key_trends[0]).toEqual({
      title: 'Small-group premium experiences',
      detail: 'Demand for sub-12-pax luxury tours grew through 2024 and 2025.',
    })
  })

  it('forwards citations and web_search_calls from the helper', async () => {
    const result = await gatherMarketContext(buildInput())
    expect(result.citations).toHaveLength(2)
    expect(result.citations[0]).toEqual({
      url: 'https://example.gov.au/tourism-2025',
      title: 'Tourism AU 2025',
    })
    expect(result.web_search_calls).toBe(4)
  })

  it('attaches cost, model and generated_at metadata', async () => {
    const result = await gatherMarketContext(buildInput())
    expect(result.cost_usd).toBe(0.012)
    expect(result.model_used).toBe('claude-sonnet-4-6')
    expect(typeof result.generated_at).toBe('string')
  })

  it('routes AU market to country=AU + Australia/Sydney timezone', async () => {
    await gatherMarketContext(buildInput({ market: 'au' }))
    const call = mockedCall.mock.calls[0][0]
    expect(call.country).toBe('AU')
    expect(call.timezone).toBe('Australia/Sydney')
  })

  it('routes NZ market to country=NZ + Pacific/Auckland timezone', async () => {
    await gatherMarketContext(buildInput({ market: 'nz' }))
    const call = mockedCall.mock.calls[0][0]
    expect(call.country).toBe('NZ')
    expect(call.timezone).toBe('Pacific/Auckland')
  })

  it('uses default maxSearches of 5 when not provided', async () => {
    await gatherMarketContext(buildInput())
    expect(mockedCall.mock.calls[0][0].maxWebSearches).toBe(5)
  })

  it('honours custom maxSearches', async () => {
    await gatherMarketContext(buildInput({ maxSearches: 8 }))
    expect(mockedCall.mock.calls[0][0].maxWebSearches).toBe(8)
  })

  it('injects brand, industry, country label, and focus topics into the user prompt', async () => {
    await gatherMarketContext(buildInput())
    const msg = mockedCall.mock.calls[0][0].userMessage
    expect(msg).toContain('TestBrand')
    expect(msg).toContain('boutique tour operator')
    expect(msg).toContain('Australia')
    expect(msg).toContain('small-group tours')
    expect(msg).toContain('luxury food tours')
  })

  it('injects briefText excerpt when provided', async () => {
    await gatherMarketContext(buildInput({ briefText: 'Brand pillars: trust, regional expertise.' }))
    const msg = mockedCall.mock.calls[0][0].userMessage
    expect(msg).toContain('trust, regional expertise')
  })

  it('omits FOCUS TOPICS section when focusTopics is empty or undefined', async () => {
    await gatherMarketContext(buildInput({ focusTopics: undefined }))
    const msg = mockedCall.mock.calls[0][0].userMessage
    expect(msg).not.toContain('FOCUS TOPICS')
  })

  it('caps focus topics at 10 entries', async () => {
    const many = Array.from({ length: 15 }, (_, i) => `topic-${i}`)
    await gatherMarketContext(buildInput({ focusTopics: many }))
    const msg = mockedCall.mock.calls[0][0].userMessage
    expect(msg).toContain('topic-0')
    expect(msg).toContain('topic-9')
    expect(msg).not.toContain('topic-10')
  })

  it('tells the model to use web_search in the system prompt', async () => {
    await gatherMarketContext(buildInput())
    const sys = mockedCall.mock.calls[0][0].systemPrompt
    expect(sys.toLowerCase()).toContain('web_search')
  })
})

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

describe('gatherMarketContext — guard rails', () => {
  it('throws when clientBrandName is empty', async () => {
    await expect(
      gatherMarketContext(buildInput({ clientBrandName: '   ' })),
    ).rejects.toThrow(/clientBrandName/)
    expect(mockedCall).not.toHaveBeenCalled()
  })

  it('throws when industry is empty', async () => {
    await expect(
      gatherMarketContext(buildInput({ industry: '' })),
    ).rejects.toThrow(/industry/)
    expect(mockedCall).not.toHaveBeenCalled()
  })

  it('throws when market is not au or nz', async () => {
    await expect(
      // @ts-expect-error — testing runtime guard
      gatherMarketContext(buildInput({ market: 'us' })),
    ).rejects.toThrow(/market/)
    expect(mockedCall).not.toHaveBeenCalled()
  })

  it('throws when maxSearches is out of range', async () => {
    await expect(
      gatherMarketContext(buildInput({ maxSearches: 0 })),
    ).rejects.toThrow(/maxSearches/)
    await expect(
      gatherMarketContext(buildInput({ maxSearches: 50 })),
    ).rejects.toThrow(/maxSearches/)
  })
})

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

describe('gatherMarketContext — Claude output parsing', () => {
  it('strips markdown code fences before JSON.parse', async () => {
    mockedCall.mockResolvedValueOnce({
      text: '```json\n' + buildValidResponse() + '\n```',
      citations: [],
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
      web_search_calls: 0,
    })
    const result = await gatherMarketContext(buildInput())
    expect(result.key_trends).toHaveLength(3)
  })

  it('throws when Claude returns non-JSON output', async () => {
    mockedCall.mockResolvedValueOnce({
      text: 'not json at all',
      citations: [],
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
      web_search_calls: 0,
    })
    await expect(gatherMarketContext(buildInput())).rejects.toThrow(/JSON/i)
  })

  it('throws when industry_overview_md is missing', async () => {
    mockedCall.mockResolvedValueOnce({
      text: JSON.stringify({
        key_trends: [
          { title: 'a', detail: 'b' },
          { title: 'c', detail: 'd' },
          { title: 'e', detail: 'f' },
        ],
        category_benchmarks_md: 'b',
        opportunities_md: 'o',
      }),
      citations: [],
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
      web_search_calls: 0,
    })
    await expect(gatherMarketContext(buildInput())).rejects.toThrow(/industry_overview_md/)
  })

  it('throws when key_trends has fewer than 3 entries', async () => {
    mockedCall.mockResolvedValueOnce({
      text: JSON.stringify({
        industry_overview_md: 'o',
        key_trends: [{ title: 'a', detail: 'b' }],
        category_benchmarks_md: 'b',
        opportunities_md: 'o',
      }),
      citations: [],
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
      web_search_calls: 0,
    })
    await expect(gatherMarketContext(buildInput())).rejects.toThrow(/key_trends/)
  })

  it('throws when key_trends has more than 6 entries', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ title: `t${i}`, detail: `d${i}` }))
    mockedCall.mockResolvedValueOnce({
      text: JSON.stringify({
        industry_overview_md: 'o',
        key_trends: many,
        category_benchmarks_md: 'b',
        opportunities_md: 'o',
      }),
      citations: [],
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
      web_search_calls: 0,
    })
    await expect(gatherMarketContext(buildInput())).rejects.toThrow(/key_trends/)
  })

  it('throws when a trend entry is missing title or detail', async () => {
    mockedCall.mockResolvedValueOnce({
      text: JSON.stringify({
        industry_overview_md: 'o',
        key_trends: [
          { title: 'a', detail: 'b' },
          { title: 'c' },
          { title: 'e', detail: 'f' },
        ],
        category_benchmarks_md: 'b',
        opportunities_md: 'o',
      }),
      citations: [],
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
      web_search_calls: 0,
    })
    await expect(gatherMarketContext(buildInput())).rejects.toThrow(/key_trends/)
  })

  it('throws when category_benchmarks_md is empty', async () => {
    mockedCall.mockResolvedValueOnce({
      text: JSON.stringify({
        industry_overview_md: 'o',
        key_trends: [
          { title: 'a', detail: 'b' },
          { title: 'c', detail: 'd' },
          { title: 'e', detail: 'f' },
        ],
        category_benchmarks_md: '   ',
        opportunities_md: 'o',
      }),
      citations: [],
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
      web_search_calls: 0,
    })
    await expect(gatherMarketContext(buildInput())).rejects.toThrow(/category_benchmarks_md/)
  })
})

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe('gatherMarketContext — return shape', () => {
  it('result matches MarketContextResult', async () => {
    const result: MarketContextResult = await gatherMarketContext(buildInput())
    expect(Object.keys(result).sort()).toEqual(
      [
        'category_benchmarks_md',
        'citations',
        'cost_usd',
        'evidence_refs',
        'generated_at',
        'industry_overview_md',
        'key_trends',
        'model_used',
        'opportunities_md',
        'web_search_calls',
      ].sort(),
    )
  })
})
