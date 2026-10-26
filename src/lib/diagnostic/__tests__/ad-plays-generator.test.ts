/**
 * TDD: ad_plays wiring through generatePrescription + stripInvalidAdPlays
 *
 * NOTE: this file currently lives at src/lib/diagnostic/ad-plays-generator-draft.ts
 * and will be moved to src/lib/diagnostic/__tests__/ later. Imports are written
 * as if it already lives in __tests__/.
 *
 * Covers:
 * 1. System prompt contains adPlaysPromptSection() + adPlaysSchemaExample()
 *    + the "不要写账户、预算、人数、花费" rule.
 * 2. End-to-end: valid ad_plays survive (budget stripped), invalid plays are
 *    dropped, phases without ad_plays keep no key.
 * 3. stripInvalidAdPlays is defensive: bad shapes don't throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrescriptionContent, PrescriptionIntake } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// vi.hoisted: variables referenced inside vi.mock factories must be hoisted
// ---------------------------------------------------------------------------

const { mockMessagesCreate } = vi.hoisted(() => {
  const mockMessagesCreate = vi.fn()
  return { mockMessagesCreate }
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

import { generatePrescription, stripInvalidAdPlays } from '../prescription-generator'
import { adPlaysPromptSection, adPlaysSchemaExample } from '@/lib/ads-strategy/plan-seed/ad-plays-prompt'
import { PLAY_CATALOG } from '@/lib/ads-strategy/play-vocabulary'

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
]

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
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          in:     vi.fn().mockResolvedValue({ data: findings, error: null }),
        }
      }
      if (table === 'diagnostic_narratives') {
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

/** 造「形状不合法」的 LLM 输出：JSON 往返后再按处方类型使用（测试专用）。 */
function asContent(v: object): PrescriptionContent {
  return JSON.parse(JSON.stringify(v)) as PrescriptionContent
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

function makeClaudeResponse(content: PrescriptionContent): ReturnType<typeof makeMsgObj> {
  return makeMsgObj(JSON.stringify(content))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ad_plays wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  // =========================================================================
  // 1. System prompt includes the ad_plays section + schema example + rule
  // =========================================================================
  it('system prompt contains adPlaysPromptSection, adPlaysSchemaExample, and the no-budget rule', async () => {
    const content: PrescriptionContent = {
      summary: 'stub',
      phases: [],
      kpi_targets: [],
      budget_allocation: [],
    }
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({})
    await generatePrescription(supabase as never, RUN_ID, CLIENT_ID, INTAKE)

    const call = mockMessagesCreate.mock.calls[0][0] as { system: string }
    expect(call.system).toContain(adPlaysPromptSection())
    expect(call.system).toContain(adPlaysSchemaExample())
    expect(call.system).toContain('不要写账户、预算、人数、花费')
  })

  // =========================================================================
  // 2. End-to-end: valid ad_plays survive (budget stripped), invalid dropped,
  //    phases without ad_plays keep no key.
  // =========================================================================
  it('keeps valid ad_plays (stripping budget), drops invalid plays, omits key when absent', async () => {
    // Sanity: the "valid" play used below must actually exist in the catalog.
    expect(Object.keys(PLAY_CATALOG)).toContain('lead_form_harvest')

    const content = {
      summary: 'stub',
      phases: [
        {
          phase_number: 1,
          name: 'Phase 1',
          duration_weeks: 4,
          actions: [],
          initiative_seed: {
            ad_plays: [
              { step_key: 'phase1-lead', play: 'lead_form_harvest', budget: 999 },
            ],
          },
        },
        {
          phase_number: 2,
          name: 'Phase 2',
          duration_weeks: 4,
          actions: [],
          initiative_seed: {
            ad_plays: [{ step_key: 'phase2-x', play: 'nope' }],
          },
        },
        {
          phase_number: 3,
          name: 'Phase 3',
          duration_weeks: 4,
          actions: [],
        },
      ],
      kpi_targets: [],
      budget_allocation: [],
    } as PrescriptionContent

    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(content))

    const supabase = buildSupabaseMock({})
    const { content: result } = await generatePrescription(
      supabase as never,
      RUN_ID,
      CLIENT_ID,
      INTAKE,
    )

    expect(result.phases[0].initiative_seed?.ad_plays).toEqual([
      { step_key: 'phase1-lead', play: 'lead_form_harvest' },
    ])

    const phase2Seed = result.phases[1].initiative_seed
    expect(phase2Seed).toBeDefined()
    expect(phase2Seed && 'ad_plays' in phase2Seed).toBe(false)

    const phase3Seed = result.phases[2].initiative_seed
    expect(phase3Seed === undefined || !('ad_plays' in phase3Seed)).toBe(true)
  })

  // =========================================================================
  // 3. stripInvalidAdPlays is defensive
  // =========================================================================
  it('stripInvalidAdPlays deletes non-array ad_plays and never throws on bad shapes', () => {
    // (a) ad_plays = 'bad' -> key deleted
    const withBadAdPlays = asContent({
      summary: 'stub',
      phases: [
        {
          phase_number: 1,
          name: 'Phase 1',
          duration_weeks: 4,
          actions: [],
          initiative_seed: { ad_plays: 'bad' },
        },
      ],
      kpi_targets: [],
      budget_allocation: [],
    })

    stripInvalidAdPlays(withBadAdPlays)
    const seed = withBadAdPlays.phases[0].initiative_seed
    expect(seed).toBeDefined()
    expect(seed && 'ad_plays' in seed).toBe(false)

    // (b) phase without initiative_seed -> no throw
    const withoutSeed = {
      summary: 'stub',
      phases: [
        {
          phase_number: 1,
          name: 'Phase 1',
          duration_weeks: 4,
          actions: [],
        },
      ],
      kpi_targets: [],
      budget_allocation: [],
    } as PrescriptionContent

    expect(() => stripInvalidAdPlays(withoutSeed)).not.toThrow()

    // (c) content.phases not an array -> no throw
    const badPhases = asContent({
      summary: 'stub',
      phases: null,
      kpi_targets: [],
      budget_allocation: [],
    })

    expect(() => stripInvalidAdPlays(badPhases)).not.toThrow()
  })
})
