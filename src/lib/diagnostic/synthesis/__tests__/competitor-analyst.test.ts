import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock callClaudeWithDocs BEFORE importing the analyst
vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'claude-sonnet-4-6',
  callClaudeWithDocs: vi.fn(),
}))

import { callClaudeWithDocs } from '@/lib/anthropic/client'
import {
  analyzeCompetitorLandscape,
  type CompetitorAnalystInput,
  type CompetitorAnalystResult,
} from '../competitor-analyst'
import type { CompetitorEntry } from '@/lib/diagnostic/collectors/competitor-collector'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedCallClaude = vi.mocked(callClaudeWithDocs)

function makeCompetitor(overrides: Partial<CompetitorEntry> = {}): CompetitorEntry {
  return {
    domain: 'competitor.com',
    overlap_score: 0.5,
    organic_traffic: 10_000,
    authority_score: 40,
    ...overrides,
  }
}

function buildInput(overrides: Partial<CompetitorAnalystInput> = {}): CompetitorAnalystInput {
  return {
    clientBrandName: 'TestBrand',
    clientDomain: 'testbrand.com',
    clientTraffic: 2_000,
    clientAuthority: 25,
    competitors: [
      makeCompetitor({ domain: 'leader.com', organic_traffic: 100_000, authority_score: 70 }),
      makeCompetitor({ domain: 'rival.com', organic_traffic: 50_000, authority_score: 55 }),
      makeCompetitor({ domain: 'niche.com', organic_traffic: 8_000, authority_score: 30 }),
    ],
    ...overrides,
  }
}

function buildValidClaudeResponse(): string {
  return JSON.stringify({
    market_structure_md: '## Market Structure\n\nThe NZ market is led by **leader.com**...',
    benchmarking_path_md: '## Benchmarking Path\n\n1. Match leader.com page depth...',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedCallClaude.mockResolvedValue({
    text: buildValidClaudeResponse(),
    input_tokens: 1500,
    output_tokens: 600,
    cost_usd: 0.012,
  })
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('analyzeCompetitorLandscape — happy path', () => {
  it('returns both market_structure_md and benchmarking_path_md', async () => {
    const result = await analyzeCompetitorLandscape(buildInput())
    expect(result.market_structure_md).toContain('Market Structure')
    expect(result.benchmarking_path_md).toContain('Benchmarking Path')
  })

  it('attaches cost_usd and model_used metadata', async () => {
    const result = await analyzeCompetitorLandscape(buildInput())
    expect(result.cost_usd).toBe(0.012)
    expect(result.model_used).toBe('claude-sonnet-4-6')
    expect(typeof result.generated_at).toBe('string')
  })

  it('passes brand + competitor data into the user message', async () => {
    await analyzeCompetitorLandscape(buildInput())
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.userMessage).toContain('TestBrand')
    expect(call.userMessage).toContain('leader.com')
    expect(call.userMessage).toContain('rival.com')
  })

  it('uses MODEL_SONNET via the standard client', async () => {
    await analyzeCompetitorLandscape(buildInput())
    expect(mockedCallClaude).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Empty / insufficient input
// ---------------------------------------------------------------------------

describe('analyzeCompetitorLandscape — guard rails', () => {
  it('throws when competitorList is empty (cannot synthesize a landscape)', async () => {
    await expect(
      analyzeCompetitorLandscape(buildInput({ competitors: [] })),
    ).rejects.toThrow(/competitor/i)
    expect(mockedCallClaude).not.toHaveBeenCalled()
  })

  it('throws when fewer than 2 competitors supplied (not enough signal)', async () => {
    await expect(
      analyzeCompetitorLandscape(buildInput({ competitors: [makeCompetitor()] })),
    ).rejects.toThrow(/at least 2/i)
  })
})

// ---------------------------------------------------------------------------
// Claude output handling
// ---------------------------------------------------------------------------

describe('analyzeCompetitorLandscape — Claude output parsing', () => {
  it('strips a markdown code-fence wrapper before JSON.parse', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: '```json\n' + buildValidClaudeResponse() + '\n```',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    const result = await analyzeCompetitorLandscape(buildInput())
    expect(result.market_structure_md).toContain('Market Structure')
  })

  it('throws a descriptive error when Claude returns invalid JSON', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: 'not json at all',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(analyzeCompetitorLandscape(buildInput())).rejects.toThrow(/JSON/i)
  })

  it('throws when required sections are missing from Claude response', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: JSON.stringify({ market_structure_md: 'only one section' }),
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(analyzeCompetitorLandscape(buildInput())).rejects.toThrow(/benchmarking_path_md/i)
  })
})

// ---------------------------------------------------------------------------
// Optional brief context
// ---------------------------------------------------------------------------

describe('analyzeCompetitorLandscape — brief context', () => {
  it('injects formatted brief text into the user message when provided', async () => {
    await analyzeCompetitorLandscape(
      buildInput({ briefText: 'Brand voice: warm, expert. Pillars: travel, food.' }),
    )
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.userMessage).toContain('Brand voice: warm, expert')
  })

  it('works without brief context (graceful fallback)', async () => {
    const result = await analyzeCompetitorLandscape(buildInput({ briefText: undefined }))
    expect(result.market_structure_md).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Type sanity
// ---------------------------------------------------------------------------

describe('analyzeCompetitorLandscape — return shape', () => {
  it('result shape matches CompetitorAnalystResult', async () => {
    const result: CompetitorAnalystResult = await analyzeCompetitorLandscape(buildInput())
    expect(Object.keys(result).sort()).toEqual(
      ['benchmarking_path_md', 'cost_usd', 'evidence_refs', 'generated_at', 'market_structure_md', 'model_used'].sort(),
    )
  })
})
