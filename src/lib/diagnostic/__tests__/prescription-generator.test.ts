/**
 * TDD RED: prescription-generator tests
 *
 * Tests generatePrescription(supabase, runId, clientId, intake):
 * 1. Calls Claude Sonnet (not GPT) with system + user prompt
 * 2. Returns PrescriptionContent with phases[3] / kpi_targets / budget_allocation
 * 3. monthly_budget_aud = 3000 → budget_allocation total ≤ 3000
 * 4. phases[0].actions all have phase = 1
 * 5. Every action has fix_type (owner_type) field
 * 6. Claude API failure → throws meaningful error, not silent crash
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrescriptionContent, PrescriptionIntake } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// vi.hoisted: variables referenced inside vi.mock factories must be hoisted
// ---------------------------------------------------------------------------

const { mockMessagesCreate, mockSupabase } = vi.hoisted(() => {
  const mockMessagesCreate = vi.fn()

  const mockFrom = vi.fn()
  const mockSupabase = { from: mockFrom }

  return { mockMessagesCreate, mockSupabase }
})

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks are declared)
// ---------------------------------------------------------------------------

import { generatePrescription } from '../prescription-generator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN_ID    = 'run-abc'
const CLIENT_ID = 'client-xyz'

const INTAKE: PrescriptionIntake = {
  business_goal:      'Grow NZ customer base by 30% within 6 months',
  timeline_urgency:   'short_term',
  monthly_budget_aud: 3000,
  priority_dimensions: ['seo', 'ai_visibility'],
  notes: null,
}

const MOCK_RUN = {
  id: RUN_ID,
  overall_score: 52,
  dimension_scores: { seo: 48, ai_visibility: 35, social: 60 },
}

const MOCK_FINDINGS = [
  {
    id:              'f-1',
    run_id:          RUN_ID,
    client_id:       CLIENT_ID,
    dimension:       'seo',
    finding_type:    'missing_meta_title',
    severity:        'critical',
    title:           '缺少 meta title',
    description:     '23 pages missing meta title tags',
    evidence:        null,
    recommendation:  'Add keyword-rich meta titles to all pages',
    fix_type:        'me_auto',
    priority_score:  90,
    created_at:      '2026-05-13T00:00:00Z',
  },
  {
    id:              'f-2',
    run_id:          RUN_ID,
    client_id:       CLIENT_ID,
    dimension:       'ai_visibility',
    finding_type:    'brand_not_mentioned',
    severity:        'high',
    title:           'AI 未提及品牌',
    description:     'Brand not in top 5 AI responses',
    evidence:        null,
    recommendation:  'Deploy GEO directives',
    fix_type:        'me_auto',
    priority_score:  80,
    created_at:      '2026-05-13T00:00:00Z',
  },
]

/** A complete PrescriptionContent that satisfies all test assertions */
function makePrescriptionContent(budgetTotal = 2800): PrescriptionContent {
  return {
    summary: 'A 3-phase prescription to grow NZ customer base.',
    phases: [
      {
        phase_number: 1,
        name: '即时修复',
        duration_weeks: 4,
        actions: [
          {
            id:          'a-1',
            title:       '批量生成 meta title',
            description: '使用 SEO 内容引擎为 23 个页面生成 meta title',
            dimension:   'seo',
            fix_type:    'me_auto',
            phase:       1,
            effort:      'low',
            impact:      'high',
            finding_ids: ['f-1'],
          },
        ],
      },
      {
        phase_number: 2,
        name: '结构改善',
        duration_weeks: 6,
        actions: [
          {
            id:          'a-2',
            title:       '部署 GEO 指令',
            description: '在 GEO Composer 中创建并激活品牌 GEO 指令',
            dimension:   'ai_visibility',
            fix_type:    'me_auto',
            phase:       2,
            effort:      'medium',
            impact:      'high',
            finding_ids: ['f-2'],
          },
        ],
      },
      {
        phase_number: 3,
        name: '长期增长',
        duration_weeks: 8,
        actions: [
          {
            id:          'a-3',
            title:       '获取高质量反链',
            description: '联系行业媒体获取外链',
            dimension:   'seo',
            fix_type:    'third_party',
            phase:       3,
            effort:      'high',
            impact:      'high',
            finding_ids: [],
          },
        ],
      },
    ],
    kpi_targets: [
      {
        metric:        'Organic Traffic',
        current_value: 1200,
        target_value:  2000,
        unit:          'visits/month',
        dimension:     'seo',
      },
    ],
    budget_allocation: [
      { dimension: 'seo',           amount_aud: Math.round(budgetTotal * 0.5),  percentage: 50 },
      { dimension: 'ai_visibility', amount_aud: Math.round(budgetTotal * 0.35), percentage: 35 },
      { dimension: 'social',        amount_aud: Math.round(budgetTotal * 0.15), percentage: 15 },
    ],
  }
}

/** Build a Supabase mock with predefined query results */
function buildSupabaseMock(opts: {
  run?: unknown
  findings?: unknown[]
  insertedId?: string
  narratives?: unknown[]
}) {
  const {
    run = MOCK_RUN,
    findings = MOCK_FINDINGS,
    insertedId = 'presc-001',
    narratives = [],
  } = opts

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'diagnostic_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: run, error: null }),
        }
      }
      if (table === 'diagnostic_findings') {
        // Query chain ends with .in() — must resolve as a thenable
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          in:     vi.fn().mockResolvedValue({ data: findings, error: null }),
        }
      }
      if (table === 'diagnostic_narratives') {
        // Chain: .select().eq().order().order() — last .order resolves
        const finalOrder = vi.fn().mockResolvedValue({ data: narratives, error: null })
        const firstOrder = vi.fn().mockReturnValue({ order: finalOrder })
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnValue({ order: firstOrder }),
        }
      }
      if (table === 'prescriptions') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: insertedId }, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        in:     vi.fn().mockResolvedValue({ data: [], error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }),
  }
}

/** Wrap PrescriptionContent as Claude API response text */
function makeClaudeResponse(content: PrescriptionContent): ReturnType<typeof makeMsgObj> {
  return makeMsgObj(JSON.stringify(content))
}

function makeMsgObj(text: string) {
  return {
    id: 'msg-test',
    type: 'message' as const,
    role: 'assistant' as const,
    model: 'claude-sonnet-4-5-20250929',
    content: [{ type: 'text' as const, text }],
    stop_reason: 'end_turn' as const,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 200 },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generatePrescription()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  // =========================================================================
  // 1. Calls Claude Sonnet (not GPT)
  // =========================================================================
  it('calls Claude Sonnet API with a system prompt and user message', async () => {
    const content = makePrescriptionContent()
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({})
    await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    expect(mockMessagesCreate).toHaveBeenCalledOnce()
    const call = mockMessagesCreate.mock.calls[0][0] as {
      model: string
      system: string
      messages: Array<{ role: string; content: string }>
    }
    expect(call.model).toContain('claude')
    expect(call.system).toBeTruthy()
    expect(call.messages[0].role).toBe('user')
    expect(call.messages[0].content).toContain('3000')  // budget in prompt
  })

  // =========================================================================
  // 2. Returns PrescriptionContent with phases[3] / kpi_targets / budget_allocation
  // =========================================================================
  it('returns a PrescriptionContent with exactly 3 phases, kpi_targets, and budget_allocation', async () => {
    const content = makePrescriptionContent()
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({})
    const { content: result } = await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    expect(result.phases).toHaveLength(3)
    expect(result.kpi_targets.length).toBeGreaterThan(0)
    expect(result.budget_allocation.length).toBeGreaterThan(0)
    expect(result.summary).toBeTruthy()
  })

  // =========================================================================
  // 3. budget_allocation total ≤ monthly_budget_aud (3000)
  // =========================================================================
  it('budget_allocation sum does not exceed monthly_budget_aud', async () => {
    const content = makePrescriptionContent(2800)
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({})
    const { content: result } = await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    const total = result.budget_allocation.reduce((sum, b) => sum + b.amount_aud, 0)
    expect(total).toBeLessThanOrEqual(INTAKE.monthly_budget_aud)
  })

  // =========================================================================
  // 4. phases[0].actions all have phase = 1
  // =========================================================================
  it('all actions in phases[0] have phase field equal to 1', async () => {
    const content = makePrescriptionContent()
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({})
    const { content: result } = await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    const phase1Actions = result.phases[0].actions
    expect(phase1Actions.length).toBeGreaterThan(0)
    for (const action of phase1Actions) {
      expect(action.phase).toBe(1)
    }
  })

  // =========================================================================
  // 5. Every action has fix_type (owner_type) field
  // =========================================================================
  it('every action across all phases has a valid fix_type', async () => {
    const content = makePrescriptionContent()
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({})
    const { content: result } = await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    const validFixTypes = new Set(['me_auto', 'fde_manual', 'third_party'])
    for (const phase of result.phases) {
      for (const action of phase.actions) {
        expect(validFixTypes.has(action.fix_type)).toBe(true)
      }
    }
  })

  // =========================================================================
  // 6. Saves prescription to DB and returns prescriptionId
  // =========================================================================
  it('inserts a prescription record and returns its id', async () => {
    const content = makePrescriptionContent()
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({ insertedId: 'presc-saved' })
    const { prescriptionId } = await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    expect(prescriptionId).toBe('presc-saved')
  })

  // =========================================================================
  // 7. Claude API failure → throws meaningful error, does not crash silently
  // =========================================================================
  it('throws a meaningful error when Claude API fails', async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error('Claude rate limit exceeded'))

    const supabase = buildSupabaseMock({})
    await expect(
      generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)
    ).rejects.toThrow('Claude rate limit exceeded')
  })

  // =========================================================================
  // 9. P8.10.S3.6 — Synthesis narratives are injected into the prompt
  // =========================================================================
  it('injects Synthesis narratives into the prompt when present', async () => {
    const content = makePrescriptionContent()
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const NARRATIVES = [
      {
        id: 'n-1',
        run_id: RUN_ID,
        client_id: CLIENT_ID,
        kind: 'market_context',
        dimension: null,
        narrative_md: 'NZ tourism market is rebounding 18% YoY in 2026.',
        metadata: null,
        model: 'claude-sonnet-4-5',
        cost_usd: 0.04,
        generated_at: '2026-05-18T00:00:00Z',
        created_at:   '2026-05-18T00:00:00Z',
      },
      {
        id: 'n-2',
        run_id: RUN_ID,
        client_id: CLIENT_ID,
        kind: 'competitor_market_structure',
        dimension: 'competitor',
        narrative_md: 'Three premium incumbents dominate the SERP top 10.',
        metadata: null,
        model: 'claude-sonnet-4-5',
        cost_usd: 0.02,
        generated_at: '2026-05-18T00:00:00Z',
        created_at:   '2026-05-18T00:00:00Z',
      },
      {
        id: 'n-3',
        run_id: RUN_ID,
        client_id: CLIENT_ID,
        kind: 'dimension_narrative',
        dimension: 'seo',
        narrative_md: 'SEO is bottlenecked by thin product pages and weak internal links.',
        metadata: null,
        model: 'claude-sonnet-4-5',
        cost_usd: 0.01,
        generated_at: '2026-05-18T00:00:00Z',
        created_at:   '2026-05-18T00:00:00Z',
      },
      {
        id: 'n-4',
        run_id: RUN_ID,
        client_id: CLIENT_ID,
        kind: 'score_explanation',
        dimension: 'ai_visibility',
        narrative_md: 'AI visibility is 35/100 because the brand appears in 1/15 questions.',
        metadata: { score: 35 },
        model: 'claude-sonnet-4-5',
        cost_usd: 0,
        generated_at: '2026-05-18T00:00:00Z',
        created_at:   '2026-05-18T00:00:00Z',
      },
    ]

    const supabase = buildSupabaseMock({ narratives: NARRATIVES })
    await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    const call = mockMessagesCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
    const prompt = call.messages[0].content

    expect(prompt).toContain('Synthesis Insights')
    expect(prompt).toContain('NZ tourism market is rebounding')
    expect(prompt).toContain('Three premium incumbents')
    expect(prompt).toContain('thin product pages')
    expect(prompt).toContain('1/15 questions')
  })

  // =========================================================================
  // 10. P8.10.S3.6 — Missing narratives is non-fatal
  // =========================================================================
  it('omits the Synthesis Insights section when no narratives exist', async () => {
    const content = makePrescriptionContent()
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({ narratives: [] })
    await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    const call = mockMessagesCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
    const prompt = call.messages[0].content
    expect(prompt).not.toContain('Synthesis Insights')
  })

  // =========================================================================
  // 8. Prompt includes intake fields (business_goal, timeline_urgency, budget)
  // =========================================================================
  it('includes intake fields in the prompt sent to Claude', async () => {
    const content = makePrescriptionContent()
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({})
    await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    const call = mockMessagesCreate.mock.calls[0][0] as {
      messages: Array<{ content: string }>
    }
    const prompt = call.messages[0].content
    expect(prompt).toContain(INTAKE.business_goal)
    expect(prompt).toContain(INTAKE.timeline_urgency)
    expect(prompt).toContain(String(INTAKE.monthly_budget_aud))
  })
})
