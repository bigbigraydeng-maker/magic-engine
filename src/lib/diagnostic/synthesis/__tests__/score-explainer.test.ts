import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'claude-sonnet-4-6',
  callClaudeWithDocs: vi.fn(),
}))

import { callClaudeWithDocs } from '@/lib/anthropic/client'
import {
  explainScores,
  type ScoreExplainerInput,
  type ScoreExplainerResult,
  type ScoreDimensionInput,
} from '../score-explainer'
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
    title: 'Thin homepage content',
    description: 'Homepage has fewer than 300 words.',
    evidence: null,
    recommendation: 'Expand homepage copy.',
    fix_type: 'me_auto',
    priority_score: 70,
    ...overrides,
  }
}

function makeDim(overrides: Partial<ScoreDimensionInput> = {}): ScoreDimensionInput {
  return {
    dimension: 'seo',
    score: 42,
    weight: 0.25,
    findings: [makeFinding()],
    ...overrides,
  }
}

function buildInput(overrides: Partial<ScoreExplainerInput> = {}): ScoreExplainerInput {
  return {
    clientBrandName: 'TestBrand',
    clientDomain: 'testbrand.com',
    overallScore: 55,
    dimensions: [
      makeDim({ dimension: 'seo', score: 42, weight: 0.25 }),
      makeDim({
        dimension: 'social',
        score: 68,
        weight: 0.15,
        findings: [makeFinding({ dimension: 'social', finding_type: 'low_engagement_rate' })],
      }),
    ],
    ...overrides,
  }
}

function buildValidResponse(targets: Array<'overall' | DiagnosticDimension> = ['overall', 'seo', 'social']): string {
  return JSON.stringify({
    explanations: targets.map(target => ({
      target,
      explanation_md:
        target === 'overall'
          ? 'The 55/100 overall reflects SEO dragging the weighted average down (42/100, 25% weight) while social cushions it (68/100, 15%).'
          : `The ${target === 'seo' ? 42 : 68}/100 score reflects ${target === 'seo' ? 'thin content' : 'low engagement'} — drag-down ~10 pts.`,
    })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedCallClaude.mockResolvedValue({
    text: buildValidResponse(),
    input_tokens: 600,
    output_tokens: 300,
    cost_usd: 0.006,
  })
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('explainScores — happy path', () => {
  it('returns one explanation per dimension plus an overall explanation', async () => {
    const result = await explainScores(buildInput())
    expect(result.explanations).toHaveLength(3)
    const targets = result.explanations.map(e => e.target).sort()
    expect(targets).toEqual(['overall', 'seo', 'social'])
  })

  it('attaches the input score onto each explanation entry', async () => {
    const result = await explainScores(buildInput())
    const seo = result.explanations.find(e => e.target === 'seo')
    const social = result.explanations.find(e => e.target === 'social')
    const overall = result.explanations.find(e => e.target === 'overall')
    expect(seo?.score).toBe(42)
    expect(social?.score).toBe(68)
    expect(overall?.score).toBe(55)
  })

  it('attaches cost, model and generated_at metadata', async () => {
    const result = await explainScores(buildInput())
    expect(result.cost_usd).toBe(0.006)
    expect(result.model_used).toBe('claude-sonnet-4-6')
    expect(typeof result.generated_at).toBe('string')
  })

  it('injects brand, overall score, dimension scores, weights and findings into the prompt', async () => {
    await explainScores(buildInput())
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.userMessage).toContain('TestBrand')
    expect(call.userMessage).toContain('55')
    expect(call.userMessage).toContain('42')
    expect(call.userMessage).toContain('68')
    expect(call.userMessage).toContain('0.25')
    expect(call.userMessage).toContain('thin_content')
    expect(call.userMessage).toContain('low_engagement_rate')
  })

  it('tells Claude the per-explanation word budget is short (≤120 words)', async () => {
    await explainScores(buildInput())
    const call = mockedCallClaude.mock.calls[0][0]
    // Budget is intentionally small — these are caption-style explanations, not narratives.
    expect(call.systemPrompt).toMatch(/120|100/)
  })

  it('requests an "overall" explanation in addition to per-dimension ones', async () => {
    await explainScores(buildInput())
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.systemPrompt.toLowerCase()).toContain('overall')
  })
})

// ---------------------------------------------------------------------------
// Null scores (dimension not configured)
// ---------------------------------------------------------------------------

describe('explainScores — null dimension scores', () => {
  it('still produces an explanation for a not-configured dimension', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: buildValidResponse(['overall', 'seo', 'ai_visibility']),
      input_tokens: 600,
      output_tokens: 300,
      cost_usd: 0.006,
    })
    const result = await explainScores(
      buildInput({
        dimensions: [
          makeDim({ dimension: 'seo', score: 42, weight: 0.25 }),
          makeDim({
            dimension: 'ai_visibility',
            score: null,
            weight: 0.2,
            findings: [
              makeFinding({
                dimension: 'ai_visibility',
                finding_type: 'ai_visibility_not_tracked',
                severity: 'info',
                title: 'AI Tracker not configured',
                description: 'No tracker questions configured.',
              }),
            ],
          }),
        ],
      }),
    )
    const ai = result.explanations.find(e => e.target === 'ai_visibility')
    expect(ai).toBeDefined()
    expect(ai?.score).toBeNull()
  })

  it('communicates "not configured" in the prompt for null-score dimensions', async () => {
    await explainScores(
      buildInput({
        dimensions: [
          makeDim({ dimension: 'ads', score: null, weight: 0.2, findings: [makeFinding({ dimension: 'ads' })] }),
        ],
      }),
    )
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.userMessage.toLowerCase()).toContain('not configured')
  })
})

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

describe('explainScores — guard rails', () => {
  it('throws when dimensions array is empty', async () => {
    await expect(
      explainScores(buildInput({ dimensions: [] })),
    ).rejects.toThrow(/dimension/i)
    expect(mockedCallClaude).not.toHaveBeenCalled()
  })

  it('throws when overallScore is outside 0–100', async () => {
    await expect(
      explainScores(buildInput({ overallScore: 150 })),
    ).rejects.toThrow(/overall/i)
    await expect(
      explainScores(buildInput({ overallScore: -1 })),
    ).rejects.toThrow(/overall/i)
    expect(mockedCallClaude).not.toHaveBeenCalled()
  })

  it('throws when a dimension has an out-of-range numeric score', async () => {
    await expect(
      explainScores(
        buildInput({
          dimensions: [makeDim({ score: 101 })],
        }),
      ),
    ).rejects.toThrow(/score/i)
  })
})

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

describe('explainScores — Claude output parsing', () => {
  it('strips markdown code fences before JSON.parse', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: '```json\n' + buildValidResponse() + '\n```',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    const result = await explainScores(buildInput())
    expect(result.explanations).toHaveLength(3)
  })

  it('throws when Claude returns non-JSON output', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: 'not json at all',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(explainScores(buildInput())).rejects.toThrow(/JSON/i)
  })

  it('throws when explanations array is missing', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: JSON.stringify({ something_else: 'foo' }),
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(explainScores(buildInput())).rejects.toThrow(/explanations/i)
  })

  it('throws when explanations array is empty', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: JSON.stringify({ explanations: [] }),
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(explainScores(buildInput())).rejects.toThrow(/explanations/i)
  })

  it('throws when the overall explanation is missing from Claude output', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: JSON.stringify({
        explanations: [
          { target: 'seo', explanation_md: 'seo blurb' },
          { target: 'social', explanation_md: 'social blurb' },
        ],
      }),
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(explainScores(buildInput())).rejects.toThrow(/overall/i)
  })

  it('skips entries whose target is not requested rather than crashing', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: JSON.stringify({
        explanations: [
          { target: 'overall', explanation_md: 'overall blurb' },
          { target: 'seo', explanation_md: 'seo blurb' },
          { target: 'social', explanation_md: 'social blurb' },
          { target: 'reputation', explanation_md: 'unsolicited extra' },
        ],
      }),
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    const result = await explainScores(buildInput())
    const targets = result.explanations.map(e => e.target).sort()
    expect(targets).toEqual(['overall', 'seo', 'social'])
  })

  it('throws when an explanation entry has empty explanation_md', async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: JSON.stringify({
        explanations: [
          { target: 'overall', explanation_md: 'ok' },
          { target: 'seo', explanation_md: '   ' },
          { target: 'social', explanation_md: 'ok' },
        ],
      }),
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
    })
    await expect(explainScores(buildInput())).rejects.toThrow(/explanation_md/i)
  })
})

// ---------------------------------------------------------------------------
// Optional brief context
// ---------------------------------------------------------------------------

describe('explainScores — brief context', () => {
  it('injects briefText into the user message when provided', async () => {
    await explainScores(
      buildInput({ briefText: 'Brand pillars: trust, expertise.' }),
    )
    const call = mockedCallClaude.mock.calls[0][0]
    expect(call.userMessage).toContain('trust, expertise')
  })

  it('works without briefText (graceful)', async () => {
    const result = await explainScores(buildInput({ briefText: undefined }))
    expect(result.explanations).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe('explainScores — return shape', () => {
  it('result matches ScoreExplainerResult', async () => {
    const result: ScoreExplainerResult = await explainScores(buildInput())
    expect(Object.keys(result).sort()).toEqual(
      ['cost_usd', 'explanations', 'generated_at', 'model_used'].sort(),
    )
    for (const e of result.explanations) {
      expect(Object.keys(e).sort()).toEqual(
        ['evidence_refs', 'explanation_md', 'score', 'target'].sort(),
      )
    }
  })
})
