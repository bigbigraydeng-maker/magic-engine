import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Mocks — before imports (hoisting)
// ---------------------------------------------------------------------------

const mockSeoCollect = vi.fn()
const mockSocialCollect = vi.fn()
const mockReputationCollect = vi.fn()
const mockCompetitorCollect = vi.fn()
const mockAiVisibilityCollect = vi.fn()

vi.mock('../collectors/seo-collector', () => ({
  SeoCollector: vi.fn(() => ({ collect: mockSeoCollect })),
}))

vi.mock('../collectors/social-collector', () => ({
  SocialCollector: vi.fn(() => ({ collect: mockSocialCollect })),
}))

vi.mock('../collectors/reputation-collector', () => ({
  ReputationCollector: vi.fn(() => ({ collect: mockReputationCollect })),
}))

vi.mock('../collectors/competitor-collector', () => ({
  CompetitorCollector: vi.fn(() => ({ collect: mockCompetitorCollect })),
}))

vi.mock('../collectors/ai-visibility-collector', () => ({
  AiVisibilityCollector: vi.fn(() => ({ collect: mockAiVisibilityCollect })),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { runDiagnostic, createDiagnosticRun, executeDiagnosticRun, isValidModule } from '../runner'

// ---------------------------------------------------------------------------
// Supabase mock factory
// ---------------------------------------------------------------------------

interface MockOptions {
  runId?: string
  clientDomain?: string
  insertError?: { message: string } | null
  updateError?: { message: string } | null
}

function makeSupabase(opts: MockOptions = {}): SupabaseClient {
  const {
    runId = 'run-test-123',
    clientDomain = 'test.co.nz',
    insertError = null,
    updateError = null,
  } = opts

  const capturedUpdates: unknown[] = []

  const mock = {
    _updates: capturedUpdates,
    from: vi.fn((table: string) => {
      if (table === 'diagnostic_runs') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(
                insertError
                  ? { data: null, error: insertError }
                  : { data: { id: runId }, error: null },
              ),
            }),
          }),
          update: vi.fn().mockImplementation((data: unknown) => {
            capturedUpdates.push(data)
            return {
              eq: vi.fn().mockResolvedValue(
                updateError ? { error: updateError } : { error: null },
              ),
            }
          }),
        }
      }
      if (table === 'diagnostic_findings') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { domain: clientDomain, instagram_handle: null },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'keywords') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }
      }
      return { insert: vi.fn(), select: vi.fn(), update: vi.fn() }
    }),
  }

  return mock as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockSeoCollect.mockResolvedValue({ score: 75, findings: [] })
  mockSocialCollect.mockResolvedValue({ score: 60, findings: [] })
  mockReputationCollect.mockResolvedValue({ score: 80, findings: [] })
  mockCompetitorCollect.mockResolvedValue({ score: 70, findings: [], competitorList: [] })
  mockAiVisibilityCollect.mockResolvedValue({ score: 50, findings: [] })
})

// ---------------------------------------------------------------------------
// isValidModule
// ---------------------------------------------------------------------------

describe('isValidModule()', () => {
  it('returns true for "seo"', () => expect(isValidModule('seo')).toBe(true))
  it('returns true for "social"', () => expect(isValidModule('social')).toBe(true))
  it('returns true for "reputation"', () => expect(isValidModule('reputation')).toBe(true))
  it('returns true for "competitor"', () => expect(isValidModule('competitor')).toBe(true))
  it('returns true for "ai_visibility"', () => expect(isValidModule('ai_visibility')).toBe(true))
  it('returns true for "ads"', () => expect(isValidModule('ads')).toBe(true))
  it('returns true for "full"', () => expect(isValidModule('full')).toBe(true))
  it('returns false for unknown modules', () => {
    expect(isValidModule('')).toBe(false)
    expect(isValidModule('SEO')).toBe(false)
    expect(isValidModule('unknown')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createDiagnosticRun
// ---------------------------------------------------------------------------

describe('createDiagnosticRun()', () => {
  it('inserts a pending run and returns run_id', async () => {
    const supabase = makeSupabase({ runId: 'run-999' })
    const id = await createDiagnosticRun(supabase, 'client-1', 'seo')
    expect(id).toBe('run-999')
    expect(supabase.from).toHaveBeenCalledWith('diagnostic_runs')
  })

  it('throws when insert fails', async () => {
    const supabase = makeSupabase({ insertError: { message: 'DB down' } })
    await expect(createDiagnosticRun(supabase, 'client-1', 'seo')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — seo module
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — seo module', () => {
  it('transitions run from pending → running → completed', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    const updates = (supabase as unknown as { _updates: unknown[] })._updates
    expect(updates.length).toBeGreaterThanOrEqual(2)
    expect(updates[0]).toMatchObject({ status: 'running' })
    expect(updates[updates.length - 1]).toMatchObject({ status: 'completed' })
  })

  it('calls SeoCollector.collect()', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')
    expect(mockSeoCollect).toHaveBeenCalledOnce()
    expect(mockSocialCollect).not.toHaveBeenCalled()
    expect(mockReputationCollect).not.toHaveBeenCalled()
    expect(mockCompetitorCollect).not.toHaveBeenCalled()
    expect(mockAiVisibilityCollect).not.toHaveBeenCalled()
  })

  it('overall_score equals seo score when only seo runs (re-normalised weight)', async () => {
    mockSeoCollect.mockResolvedValue({ score: 80, findings: [] })
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    const updates = (supabase as unknown as { _updates: unknown[] })._updates
    const completedUpdate = updates.find(
      (u): u is Record<string, unknown> =>
        typeof u === 'object' && u !== null && (u as Record<string, unknown>).status === 'completed',
    )
    expect(completedUpdate?.overall_score).toBe(80)
  })

  it('writes findings to diagnostic_findings table', async () => {
    const finding = {
      client_id: 'client-1', dimension: 'seo' as const,
      finding_type: 'low_domain_rank' as const, severity: 'high' as const,
      title: 'Low DA', description: 'test', evidence: null,
      recommendation: 'fix it', fix_type: 'fde_manual' as const, priority_score: 75,
    }
    mockSeoCollect.mockResolvedValue({ score: 40, findings: [finding] })

    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    expect(supabase.from).toHaveBeenCalledWith('diagnostic_findings')
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — full module
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — full module', () => {
  it('runs all five collectors concurrently', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'full')
    expect(mockSeoCollect).toHaveBeenCalledOnce()
    expect(mockSocialCollect).toHaveBeenCalledOnce()
    expect(mockReputationCollect).toHaveBeenCalledOnce()
    expect(mockCompetitorCollect).toHaveBeenCalledOnce()
    expect(mockAiVisibilityCollect).toHaveBeenCalledOnce()
  })

  it('overall_score is weighted average of all five dimensions', async () => {
    mockSeoCollect.mockResolvedValue({ score: 80, findings: [] })
    mockSocialCollect.mockResolvedValue({ score: 60, findings: [] })
    mockReputationCollect.mockResolvedValue({ score: 40, findings: [] })
    mockCompetitorCollect.mockResolvedValue({ score: 70, findings: [], competitorList: [] })
    mockAiVisibilityCollect.mockResolvedValue({ score: 50, findings: [] })

    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'full')

    const updates = (supabase as unknown as { _updates: unknown[] })._updates
    const completedUpdate = updates.find(
      (u): u is Record<string, unknown> =>
        typeof u === 'object' && u !== null && (u as Record<string, unknown>).status === 'completed',
    )
    // seo=80(0.25), social=60(0.15), reputation=40(0.10), competitor=70(0.10), ai_visibility=50(0.20)
    // total weight = 0.80
    // (80*0.25 + 60*0.15 + 40*0.10 + 70*0.10 + 50*0.20) / 0.80
    // = (20 + 9 + 4 + 7 + 10) / 0.80 = 50 / 0.80 = 62.5 → 63
    expect(completedUpdate?.overall_score).toBe(63)
  })

  it('dimension_scores contains all five dimensions', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'full')

    const updates = (supabase as unknown as { _updates: unknown[] })._updates
    const completedUpdate = updates.find(
      (u): u is Record<string, unknown> =>
        typeof u === 'object' && u !== null && (u as Record<string, unknown>).status === 'completed',
    )
    const scores = completedUpdate?.dimension_scores as Record<string, number>
    expect(scores).toHaveProperty('seo')
    expect(scores).toHaveProperty('social')
    expect(scores).toHaveProperty('reputation')
    expect(scores).toHaveProperty('competitor')
    expect(scores).toHaveProperty('ai_visibility')
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — social module
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — social module', () => {
  it('only calls SocialCollector', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'social')
    expect(mockSocialCollect).toHaveBeenCalledOnce()
    expect(mockSeoCollect).not.toHaveBeenCalled()
    expect(mockReputationCollect).not.toHaveBeenCalled()
    expect(mockCompetitorCollect).not.toHaveBeenCalled()
    expect(mockAiVisibilityCollect).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — reputation module
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — reputation module', () => {
  it('only calls ReputationCollector', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'reputation')
    expect(mockReputationCollect).toHaveBeenCalledOnce()
    expect(mockSeoCollect).not.toHaveBeenCalled()
    expect(mockSocialCollect).not.toHaveBeenCalled()
    expect(mockCompetitorCollect).not.toHaveBeenCalled()
    expect(mockAiVisibilityCollect).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — competitor module
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — competitor module', () => {
  it('only calls CompetitorCollector', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'competitor')
    expect(mockCompetitorCollect).toHaveBeenCalledOnce()
    expect(mockSeoCollect).not.toHaveBeenCalled()
    expect(mockSocialCollect).not.toHaveBeenCalled()
    expect(mockReputationCollect).not.toHaveBeenCalled()
    expect(mockAiVisibilityCollect).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — ai_visibility module
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — ai_visibility module', () => {
  it('only calls AiVisibilityCollector', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'ai_visibility')
    expect(mockAiVisibilityCollect).toHaveBeenCalledOnce()
    expect(mockSeoCollect).not.toHaveBeenCalled()
    expect(mockSocialCollect).not.toHaveBeenCalled()
    expect(mockReputationCollect).not.toHaveBeenCalled()
    expect(mockCompetitorCollect).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — collector failure (graceful degradation)
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — collector failure', () => {
  it('completes with score=0 when a collector throws (Promise.allSettled graceful degradation)', async () => {
    mockSeoCollect.mockRejectedValue(new Error('collector exploded'))
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    const updates = (supabase as unknown as { _updates: unknown[] })._updates
    const completedUpdate = updates.find(
      (u): u is Record<string, unknown> =>
        typeof u === 'object' && u !== null && (u as Record<string, unknown>).status === 'completed',
    )
    expect(completedUpdate).toBeDefined()
    expect(completedUpdate?.overall_score).toBe(0)
  })

  it('marks run as failed when fetchClientData throws (DB failure)', async () => {
    // Simulate DB failure by making clients table throw
    const capturedUpdates: unknown[] = []
    const supabase = {
      _updates: capturedUpdates,
      from: vi.fn((table: string) => {
        if (table === 'diagnostic_runs') {
          return {
            update: vi.fn().mockImplementation((data: unknown) => {
              capturedUpdates.push(data)
              return { eq: vi.fn().mockResolvedValue({ error: null }) }
            }),
          }
        }
        // clients table throws
        if (table === 'clients') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockRejectedValue(new Error('DB connection lost')),
              }),
            }),
          }
        }
        return {}
      }),
    } as unknown as SupabaseClient

    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    const failedUpdate = capturedUpdates.find(
      (u): u is Record<string, unknown> =>
        typeof u === 'object' && u !== null && (u as Record<string, unknown>).status === 'failed',
    )
    expect(failedUpdate).toBeDefined()
    expect(typeof failedUpdate?.error_message).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// runDiagnostic — convenience wrapper
// ---------------------------------------------------------------------------

describe('runDiagnostic()', () => {
  it('creates a run and returns its id', async () => {
    const supabase = makeSupabase({ runId: 'run-xyz' })
    const id = await runDiagnostic(supabase, 'client-1', 'seo')
    expect(id).toBe('run-xyz')
  })

  it('completes without throwing on success', async () => {
    const supabase = makeSupabase()
    await expect(runDiagnostic(supabase, 'client-1', 'seo')).resolves.not.toThrow()
  })
})
