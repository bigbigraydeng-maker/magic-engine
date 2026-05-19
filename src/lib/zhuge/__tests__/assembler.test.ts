import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock getLatestDiscovery before importing the assembler
vi.mock('@/lib/zhangqian/persistor', () => ({
  getLatestDiscovery: vi.fn(),
}))

import { assembleZhugeInput } from '../assembler'
import * as persistor from '@/lib/zhangqian/persistor'
import type { ClientDiscoveryRow } from '@/lib/zhangqian/types'
import type { DiagnosticRun, DiagnosticFinding } from '@/types/diagnostic'

const mockGetLatestDiscovery = vi.mocked(persistor.getLatestDiscovery)

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeDiscoveryRow(overrides?: Partial<ClientDiscoveryRow>): ClientDiscoveryRow {
  return {
    id: 'discovery-1',
    client_id: 'client-1',
    domain: 'ctstours.co.nz',
    payload: {
      schema_version: 1,
      domain: 'ctstours.co.nz',
      business: {
        name: 'CTS Tours',
        industry: ['travel'],
        location: { city: 'Auckland', region: 'Auckland', country: 'NZ' },
        description: 'NZ tour operator',
        target_audience: ['travellers'],
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
      semrush_snapshot: { monthly_traffic: 1200, trust_score: 28, keyword_count: 45, top_keywords: [] },
      meta: { model: 'claude-sonnet-4-6', tool_calls: 5, cost_usd: 0.02, duration_ms: 4000, truncated: false },
    },
    cost_usd: 0.02,
    model: 'claude-sonnet-4-6',
    tool_calls: 5,
    generated_at: '2025-01-01T00:00:00Z',
    expires_at: '2025-04-01T00:00:00Z',
    confirmed_at: null,
    confirmed_by: null,
    ...overrides,
  }
}

function makeDiagnosticRun(overrides?: Partial<DiagnosticRun>): DiagnosticRun {
  return {
    id: 'run-1',
    client_id: 'client-1',
    triggered_by: 'user',
    status: 'completed',
    dimensions_requested: ['seo', 'ai_visibility', 'social'],
    dimensions_skipped: [],
    overall_score: 48,
    dimension_scores: { seo: 42, ai_visibility: 18, social: 55 },
    findings_count: 3,
    critical_count: 1,
    high_count: 1,
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    error_message: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeFinding(): DiagnosticFinding {
  return {
    id: 'finding-1',
    run_id: 'run-1',
    client_id: 'client-1',
    dimension: 'seo',
    finding_type: 'missing_meta_title',
    severity: 'critical',
    title: 'Missing meta titles on 8 pages',
    description: 'Missing meta titles',
    evidence: null,
    recommendation: 'Add meta titles',
    fix_type: 'me_auto',
    priority_score: 90,
    created_at: '2025-01-01T00:00:00Z',
  }
}

// ── Mock Supabase builder ──────────────────────────────────────────────────────

/**
 * Creates a chainable mock Supabase that returns different responses
 * based on the table name queried via from().
 */
function makeSupabase(tableData: Record<string, unknown[]>) {
  const makeChain = (rows: unknown[]) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
  })

  return {
    from: vi.fn((table: string) => makeChain(tableData[table] ?? [])),
  }
}

const CLIENT_ROW = {
  id: 'client-1',
  name: 'CTS Tours',
  domain: 'ctstours.co.nz',
  semrush_db: 'nz',
  plan_tier: 'growth',
  monthly_quota: 20,
  created_at: '2025-01-01T00:00:00Z',
}

beforeEach(() => vi.resetAllMocks())

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('assembleZhugeInput()', () => {
  it('assembles a full ZhugeInput from all available data', async () => {
    mockGetLatestDiscovery.mockResolvedValueOnce(makeDiscoveryRow())
    const supabase = makeSupabase({
      clients: [CLIENT_ROW],
      diagnostic_runs: [makeDiagnosticRun()],
      diagnostic_findings: [makeFinding()],
      prescriptions: [{ intake: { business_goal: 'grow organic', monthly_budget_aud: 2000 } }],
    })

    const ctx = await assembleZhugeInput(supabase as never, 'client-1')

    expect(ctx.input.client.name).toBe('CTS Tours')
    expect(ctx.input.discoveryEvidence.domain).toBe('ctstours.co.nz')
    expect(ctx.input.diagnosticScores.seo).toBe(42)
    expect(ctx.input.findings).toHaveLength(1)
    expect(ctx.input.businessContext.market).toBe('NZ')
    expect(ctx.input.businessContext.monthly_budget_aud).toBe(2000)
    expect(ctx.input.businessContext.primary_goal).toBe('grow organic')
    expect(ctx.input.availableLubanTools.length).toBeGreaterThan(0)
    expect(ctx.discovery_id).toBe('discovery-1')
    expect(ctx.diagnostic_run_id).toBe('run-1')
    expect(ctx.findings_count).toBe(1)
  })

  it('throws CLIENT_NOT_FOUND when client row is missing', async () => {
    mockGetLatestDiscovery.mockResolvedValueOnce(null)
    const supabase = makeSupabase({ clients: [] })

    await expect(assembleZhugeInput(supabase as never, 'missing-client')).rejects.toThrow(
      'CLIENT_NOT_FOUND',
    )
  })

  it('throws NO_DISCOVERY when no discovery exists', async () => {
    mockGetLatestDiscovery.mockResolvedValueOnce(null)
    const supabase = makeSupabase({ clients: [CLIENT_ROW] })

    await expect(assembleZhugeInput(supabase as never, 'client-1')).rejects.toThrow('NO_DISCOVERY')
  })

  it('works with no completed diagnostic run (empty scores and findings)', async () => {
    mockGetLatestDiscovery.mockResolvedValueOnce(makeDiscoveryRow())
    const supabase = makeSupabase({
      clients: [CLIENT_ROW],
      diagnostic_runs: [],     // no completed run
      diagnostic_findings: [], // no findings
      prescriptions: [],
    })

    const ctx = await assembleZhugeInput(supabase as never, 'client-1')

    expect(ctx.input.diagnosticScores).toEqual({})
    expect(ctx.input.findings).toEqual([])
    expect(ctx.diagnostic_run_id).toBeNull()
    expect(ctx.findings_count).toBe(0)
  })

  it('derives AU market from semrush_db=au', async () => {
    mockGetLatestDiscovery.mockResolvedValueOnce(makeDiscoveryRow())
    const supabase = makeSupabase({
      clients: [{ ...CLIENT_ROW, semrush_db: 'au' }],
      diagnostic_runs: [],
      prescriptions: [],
    })

    const ctx = await assembleZhugeInput(supabase as never, 'client-1')
    expect(ctx.input.businessContext.market).toBe('AU')
  })

  it('derives AU/NZ market from unknown semrush_db', async () => {
    mockGetLatestDiscovery.mockResolvedValueOnce(makeDiscoveryRow())
    const supabase = makeSupabase({
      clients: [{ ...CLIENT_ROW, semrush_db: 'uk' }],
      diagnostic_runs: [],
      prescriptions: [],
    })

    const ctx = await assembleZhugeInput(supabase as never, 'client-1')
    expect(ctx.input.businessContext.market).toBe('AU/NZ')
  })

  it('applies businessContextOverride on top of DB values', async () => {
    mockGetLatestDiscovery.mockResolvedValueOnce(makeDiscoveryRow())
    const supabase = makeSupabase({
      clients: [CLIENT_ROW],
      diagnostic_runs: [],
      prescriptions: [{ intake: { business_goal: 'original goal', monthly_budget_aud: 1000 } }],
    })

    const ctx = await assembleZhugeInput(supabase as never, 'client-1', {
      primary_goal: 'override goal',
      has_fde: true,
      blockers: ['no google ads account'],
    })

    expect(ctx.input.businessContext.primary_goal).toBe('override goal')
    expect(ctx.input.businessContext.has_fde).toBe(true)
    expect(ctx.input.businessContext.blockers).toEqual(['no google ads account'])
    // Budget should still come from the DB prescription
    expect(ctx.input.businessContext.monthly_budget_aud).toBe(1000)
  })

  it('handles no prescription gracefully (null budget and goal)', async () => {
    mockGetLatestDiscovery.mockResolvedValueOnce(makeDiscoveryRow())
    const supabase = makeSupabase({
      clients: [CLIENT_ROW],
      diagnostic_runs: [],
      prescriptions: [],
    })

    const ctx = await assembleZhugeInput(supabase as never, 'client-1')

    expect(ctx.input.businessContext.monthly_budget_aud).toBeNull()
    expect(ctx.input.businessContext.primary_goal).toBeNull()
  })
})
