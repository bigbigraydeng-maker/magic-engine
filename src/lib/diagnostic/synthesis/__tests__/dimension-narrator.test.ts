import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'claude-sonnet-4-6',
  callClaudeWithDocs: vi.fn(),
}))

import { callClaudeWithDocs } from '@/lib/anthropic/client'
import {
  narrateDimension,
  narrateAllDimensions,
  type DimensionNarratorInput,
  type DimensionNarrativeResult,
} from '../dimension-narrator'
import type { NewFinding } from '@/lib/diagnostic/types'
import type { DiagnosticDimension } from '@/types/diagnostic'

const mockedCallClaude = vi.mocked(callClaudeWithDocs)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<NewFinding> = {}): NewFinding {
  return {
    client_id: 'client-1',
    dimension: 'seo',
    finding_type: 'thin_content',
    severity: 'high',
    title: 'Thin content on homepage',
    description: 'Homepage has fewer than 300 words.',
    evidence: null,
    recommendation: 'Expand homepage copy.',
    fix_type: 'me_auto',
    priority_score: 70,
    ...overrides,
  }
}

function buildInput(overrides: Partial<DimensionNarratorInput> = {}): DimensionNarratorInput {
  return {
    clientBrandName: 'TestBrand',
    clientDomain: 'testbrand.com',
    dimension: 'seo',
    score: 42,
    findings: [
      makeFinding({ finding_type: 'thin_content', severity: 'high' }),
      makeFinding({ finding_type: 'missing_schema_markup', severity: 'medium' }),
    ],
    ...overrides,
  }
}

function buildValidResponse(): string {
  return JSON.stringify({
    narrative_md:
      '## SEO\n\n**Current state.** TestBrand sits at 42/100...\n\n**Root cause.** Two findings...\n\n**Opportunities.** Expand copy and add schema...',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedCallClaude.mockResolvedValue({
    text: buildValidResponse(),
    input_tokens: 800,
    output_tokens: 400,
    cost_usd: 0.008,
  })
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('narrateDimension — happy path', () => {
  it('returns a narrative_md string', async () => {
    const result = await narrateDimension(buildInput())
    expect(result.narrative_md).toContain('Current state')
    expect(result.narrative_md).toContain('Root cause')
    expect(result.narrative_md).toContain('Opportunities')
  })

  it('attaches dimension, cost, model and generated_at metadata', async () => {
    const result = await narrateDimension(buildInput())
    expect(result.dimension).toBe('seo')
    expect(result.cost_usd).toBe(0.008)
    expect(result.model_used).toBe('claude-sonnet-4-6')
    expect(typeof result.generated_at).toBe('string')
  })

  it('injects brand, dimension, score and findings into the prompt', async () => {
    await narrateDimension(buildInput())
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.userMessage).toContain('TestBrand')
    expect(call.userMessage).toContain('testbrand.com')
    expect(call.userMessage).toContain('seo')
    expect(call.userMessage).toContain('42')
    expect(call.userMessage).toContain('thin_content')
    expect(call.userMessage).toContain('missing_schema_markup')
  })

  it('tells Claude the per-dimension word budget (200–400 words)', async () => {
    await narrateDimension(buildInput())
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.systemPrompt).toMatch(/200/)
    expect(call.systemPrompt).toMatch(/400/)
  })
})

// ---------------------------------------------------------------------------
// Score = null (dimension not configured)
// ---------------------------------------------------------------------------

describe('narrateDimension — null score (not configured)', () => {
  it('still produces a narrative explaining the configuration gap', async () => {
    const result = await narrateDimension(
      buildInput({
        score: null,
        findings: [
          makeFinding({
            finding_type: 'keywords_not_configured',
            severity: 'info',
            title: 'No target keywords configured',
            description: 'Client has no keywords set up; SEO cannot be measured.',
          }),
        ],
      }),
    )
    expect(result.narrative_md).toBeTruthy()
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.userMessage.toLowerCase()).toContain('not configured')
  })
})

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

describe('narrateDimension — guard rails', () => {
  it('throws when findings array is empty', async () => {
    await expect(
      narrateDimension(buildInput({ findings: [] })),
    ).rejects.toThrow(/finding/i)
    expect(mockedCallClaude).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

describe('narrateDimension — Claude output parsing', () => {
  it('strips markdown code fences before JSON.parse', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: '```json\n' + buildValidResponse() + '\n```',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    const result = await narrateDimension(buildInput())
    expect(result.narrative_md).toContain('Current state')
  })

  it('throws when Claude returns non-JSON output', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: 'not json',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(narrateDimension(buildInput())).rejects.toThrow(/JSON/i)
  })

  it('throws when narrative_md is missing from the response', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: JSON.stringify({ something_else: 'foo' }),
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(narrateDimension(buildInput())).rejects.toThrow(/narrative_md/i)
  })

  it('throws when narrative_md is an empty string', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: JSON.stringify({ narrative_md: '   ' }),
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(narrateDimension(buildInput())).rejects.toThrow(/narrative_md/i)
  })
})

// ---------------------------------------------------------------------------
// Optional brief context
// ---------------------------------------------------------------------------

describe('narrateDimension — brief context', () => {
  it('injects briefText into the user message when provided', async () => {
    await narrateDimension(
      buildInput({ briefText: 'Brand pillars: trust, expertise.' }),
    )
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.userMessage).toContain('trust, expertise')
  })

  it('works without briefText (graceful)', async () => {
    const result = await narrateDimension(buildInput({ briefText: undefined }))
    expect(result.narrative_md).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// narrateAllDimensions — batch helper
// ---------------------------------------------------------------------------

describe('narrateAllDimensions', () => {
  it('produces one narrative per dimension passed in', async () => {
    const inputs: DimensionNarratorInput[] = [
      buildInput({ dimension: 'seo' }),
      buildInput({
        dimension: 'social',
        findings: [makeFinding({ dimension: 'social', finding_type: 'low_engagement_rate' })],
      }),
    ]
    const results = await narrateAllDimensions(inputs)
    expect(results).toHaveLength(2)
    expect(results.map(r => r.dimension).sort()).toEqual(['seo', 'social'])
  })

  it('skips dimensions whose findings array is empty rather than throwing', async () => {
    const inputs: DimensionNarratorInput[] = [
      buildInput({ dimension: 'seo' }),
      buildInput({ dimension: 'ads', findings: [] }),
    ]
    const results = await narrateAllDimensions(inputs)
    expect(results).toHaveLength(1)
    expect(results[0].dimension).toBe('seo')
  })
})

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe('narrateDimension — return shape', () => {
  it('result matches DimensionNarrativeResult', async () => {
    const result: DimensionNarrativeResult = await narrateDimension(buildInput())
    const dim: DiagnosticDimension = result.dimension
    expect(dim).toBe('seo')
    expect(Object.keys(result).sort()).toEqual(
      ['cost_usd', 'dimension', 'evidence_refs', 'generated_at', 'model_used', 'narrative_md'].sort(),
    )
  })
})
