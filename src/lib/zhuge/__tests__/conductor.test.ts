import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/anthropic/client', () => ({
  callClaudeChat: vi.fn(),
}))

import { callClaudeChat } from '@/lib/anthropic/client'
import {
  conductPriorityActions,
  buildUserPrompt,
  parseOutput,
  validateAction,
  MAX_ACTIONS,
} from '../conductor'
import type { ZhugeInput, PriorityAction } from '../types'
import type { DiagnosticFinding } from '@/types/diagnostic'

const mockCallClaude = vi.mocked(callClaudeChat)

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ZhugeInput> = {}): ZhugeInput {
  return {
    client: {
      id: 'client-1',
      name: 'CTS Tours',
      domain: 'ctstours.co.nz',
      semrush_db: 'nz',
      monthly_quota: 20,
      plan_tier: 'growth',
      created_at: '2025-01-01T00:00:00Z',
    },
    discoveryEvidence: {
      schema_version: 1,
      domain: 'ctstours.co.nz',
      business: {
        name: 'CTS Tours',
        industry: ['travel', 'tourism'],
        location: { city: 'Auckland', region: 'Auckland', country: 'NZ' },
        description: 'New Zealand tour operator.',
        target_audience: ['NZ travellers'],
        unique_selling_points: ['direct pricing'],
        confidence: 0.9,
      },
      social_profiles: [],
      gbp: null,
      review_platforms: [],
      seed_keywords: [],
      competitors: [],
      ai_tracker_questions: [],
      notes: '',
      semrush_snapshot: {
        monthly_traffic: 1200,
        trust_score: 28,
        keyword_count: 45,
        top_keywords: [
          { keyword: 'china tours nz', position: 12, volume: 260 },
        ],
      },
      ai_visibility_results: [
        { question: 'best china tours from nz', top_brands: ['other-brand'], client_mentioned: false },
      ],
      meta: { model: 'claude-sonnet-4-6', tool_calls: 5, cost_usd: 0.02, duration_ms: 4000, truncated: false },
    },
    diagnosticScores: {
      seo: 42,
      ai_visibility: 18,
      ads: null,
      social: 55,
      reputation: 60,
      competitor: 40,
    },
    findings: [
      makeFinding('seo', 'missing_meta_title', 'critical', 'Missing meta titles on 8 pages'),
      makeFinding('ai_visibility', 'no_geo_directive', 'high', 'No GEO directive published'),
      makeFinding('social', 'low_posting_frequency', 'medium', 'Posting less than 1x/week'),
    ],
    availableLubanTools: [
      {
        name: 'luban.generate_blog_post',
        description: 'Generates and saves an SEO blog post draft',
        flywheel: 'seo',
        execution_mode: 'in_house',
      },
      {
        name: 'luban.deploy_geo_directive',
        description: 'Publishes a GEO directive for AI search visibility',
        flywheel: 'geo',
        execution_mode: 'in_house',
      },
    ],
    businessContext: {
      monthly_budget_aud: 2000,
      primary_goal: 'increase organic traffic',
      blockers: [],
      has_fde: true,
      market: 'NZ',
    },
    ...overrides,
  }
}

function makeFinding(
  dimension: DiagnosticFinding['dimension'],
  finding_type: DiagnosticFinding['finding_type'],
  severity: DiagnosticFinding['severity'],
  title: string,
): DiagnosticFinding {
  return {
    id: `finding-${finding_type}`,
    run_id: 'run-1',
    client_id: 'client-1',
    dimension,
    finding_type,
    severity,
    title,
    description: title,
    evidence: null,
    recommendation: 'Fix it',
    fix_type: 'me_auto',
    priority_score: 80,
    created_at: '2025-01-01T00:00:00Z',
    execution_target: null,
  }
}

const SAMPLE_ACTION: PriorityAction = {
  rank: 1,
  dimension: 'seo',
  action_type: 'fix_meta_titles',
  why_now: 'Missing meta titles on 8 pages are hurting click-through rates.',
  evidence_refs: ['seo/missing_meta_title', 'SEMrush trust_score=28'],
  expected_impact: 'high',
  effort: 'low',
  execution_mode: 'in_house',
  executable_by: 'luban.generate_blog_post',
}

function makeClaudeResponse(actions: PriorityAction[] = [SAMPLE_ACTION]) {
  return {
    text: JSON.stringify({ top_actions: actions }),
    input_tokens: 500,
    output_tokens: 300,
    cost_usd: 0.006,
  }
}

beforeEach(() => vi.clearAllMocks())

// ── buildUserPrompt ───────────────────────────────────────────────────────────

describe('buildUserPrompt()', () => {
  it('includes client name and domain', () => {
    const prompt = buildUserPrompt(makeInput())
    expect(prompt).toContain('CTS Tours')
    expect(prompt).toContain('ctstours.co.nz')
  })

  it('includes market context', () => {
    const prompt = buildUserPrompt(makeInput())
    expect(prompt).toContain('NZ')
  })

  it('includes dimension scores', () => {
    const prompt = buildUserPrompt(makeInput())
    expect(prompt).toContain('seo: 42/100')
    expect(prompt).toContain('ai_visibility: 18/100')
    expect(prompt).toContain('ads: null (skipped)')
  })

  it('includes finding severities', () => {
    const prompt = buildUserPrompt(makeInput())
    expect(prompt).toContain('[CRITICAL]')
    expect(prompt).toContain('[HIGH]')
    expect(prompt).toContain('missing_meta_title')
  })

  it('includes luban tool names', () => {
    const prompt = buildUserPrompt(makeInput())
    expect(prompt).toContain('luban.generate_blog_post')
    expect(prompt).toContain('luban.deploy_geo_directive')
  })

  it('includes SEMrush evidence', () => {
    const prompt = buildUserPrompt(makeInput())
    expect(prompt).toContain('traffic=1200')
    expect(prompt).toContain('trust_score=28')
  })

  it('shows AI visibility miss', () => {
    const prompt = buildUserPrompt(makeInput())
    expect(prompt).toContain('NOT mentioned')
  })

  it('shows "(none)" when no luban tools available', () => {
    const prompt = buildUserPrompt(makeInput({ availableLubanTools: [] }))
    expect(prompt).toContain('(none')
  })

  it('handles null budget gracefully', () => {
    const input = makeInput({
      businessContext: {
        monthly_budget_aud: null,
        primary_goal: null,
        blockers: [],
        has_fde: false,
        market: 'AU',
      },
    })
    expect(() => buildUserPrompt(input)).not.toThrow()
  })
})

// ── parseOutput ───────────────────────────────────────────────────────────────

describe('parseOutput()', () => {
  it('parses a valid JSON response', () => {
    const raw = JSON.stringify({ top_actions: [SAMPLE_ACTION] })
    const result = parseOutput(raw)
    expect(result).toHaveLength(1)
    expect(result[0].rank).toBe(1)
    expect(result[0].action_type).toBe('fix_meta_titles')
  })

  it('throws when top_actions is missing', () => {
    expect(() => parseOutput(JSON.stringify({ wrong_key: [] }))).toThrow()
  })

  it('repairs slightly malformed JSON (trailing comma)', () => {
    const raw = `{"top_actions": [${JSON.stringify(SAMPLE_ACTION)},]}`
    const result = parseOutput(raw)
    expect(result).toHaveLength(1)
  })

  it('parses multiple actions preserving order', () => {
    const a2 = { ...SAMPLE_ACTION, rank: 2, action_type: 'deploy_geo_directive' }
    const raw = JSON.stringify({ top_actions: [SAMPLE_ACTION, a2] })
    const result = parseOutput(raw)
    expect(result[0].rank).toBe(1)
    expect(result[1].rank).toBe(2)
  })
})

// ── validateAction ────────────────────────────────────────────────────────────

describe('validateAction()', () => {
  it('passes through a well-formed action', () => {
    const result = validateAction(SAMPLE_ACTION, 1)
    expect(result.dimension).toBe('seo')
    expect(result.expected_impact).toBe('high')
    expect(result.executable_by).toBe('luban.generate_blog_post')
  })

  it('defaults invalid dimension to "seo"', () => {
    const result = validateAction({ ...SAMPLE_ACTION, dimension: 'unknown' }, 1)
    expect(result.dimension).toBe('seo')
  })

  it('defaults invalid expected_impact to "medium"', () => {
    const result = validateAction({ ...SAMPLE_ACTION, expected_impact: 'extreme' }, 1)
    expect(result.expected_impact).toBe('medium')
  })

  it('sets executable_by to null when missing', () => {
    const { executable_by: _, ...rest } = SAMPLE_ACTION
    const result = validateAction(rest, 1)
    expect(result.executable_by).toBeNull()
  })

  it('sets evidence_refs to empty array when missing', () => {
    const result = validateAction({ ...SAMPLE_ACTION, evidence_refs: undefined }, 1)
    expect(result.evidence_refs).toEqual([])
  })

  it('throws on non-object input', () => {
    expect(() => validateAction('not-an-object', 1)).toThrow()
  })
})

// ── conductPriorityActions ────────────────────────────────────────────────────

describe('conductPriorityActions()', () => {
  it('returns a ZhugeOutput with top_actions', async () => {
    mockCallClaude.mockResolvedValueOnce(makeClaudeResponse())
    const output = await conductPriorityActions(makeInput())
    expect(output.top_actions).toHaveLength(1)
    expect(output.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(output.cost_usd).toBe(0.006)
  })

  it(`caps results at MAX_ACTIONS (${MAX_ACTIONS})`, async () => {
    const manyActions = Array.from({ length: 10 }, (_, i) => ({
      ...SAMPLE_ACTION,
      rank: i + 1,
      action_type: `action_${i}`,
    }))
    mockCallClaude.mockResolvedValueOnce(makeClaudeResponse(manyActions))
    const output = await conductPriorityActions(makeInput())
    expect(output.top_actions.length).toBeLessThanOrEqual(MAX_ACTIONS)
  })

  it('passes systemPrompt and user message to Claude', async () => {
    mockCallClaude.mockResolvedValueOnce(makeClaudeResponse())
    await conductPriorityActions(makeInput())
    const call = mockCallClaude.mock.calls[0][0]
    expect(call.systemPrompt).toContain('诸葛亮')
    expect(call.messages[0].role).toBe('user')
    expect(call.messages[0].content).toContain('CTS Tours')
  })

  it('propagates Claude errors', async () => {
    mockCallClaude.mockRejectedValueOnce(new Error('API timeout'))
    await expect(conductPriorityActions(makeInput())).rejects.toThrow('API timeout')
  })

  it('throws on unparseable Claude response', async () => {
    mockCallClaude.mockResolvedValueOnce({
      text: 'Sorry, I cannot help with that.',
      input_tokens: 100,
      output_tokens: 20,
      cost_usd: 0.001,
    })
    await expect(conductPriorityActions(makeInput())).rejects.toThrow()
  })

  it('works with zero findings', async () => {
    mockCallClaude.mockResolvedValueOnce(makeClaudeResponse())
    const output = await conductPriorityActions(makeInput({ findings: [] }))
    expect(output.top_actions).toHaveLength(1)
  })

  it('works with all-null diagnostic scores', async () => {
    mockCallClaude.mockResolvedValueOnce(makeClaudeResponse())
    const output = await conductPriorityActions(
      makeInput({ diagnosticScores: { seo: null, ai_visibility: null, ads: null, social: null } })
    )
    expect(output.top_actions).toHaveLength(1)
  })
})
