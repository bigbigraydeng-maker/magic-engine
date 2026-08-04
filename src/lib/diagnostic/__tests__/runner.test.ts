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
const mockAdsCollect = vi.fn()
const mockRunSynthesis = vi.fn()

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

vi.mock('../collectors/ads-collector', () => ({
  AdsCollector: vi.fn(() => ({ collect: mockAdsCollect })),
}))

// Synthesis is LLM-backed and hits the network. The runner deliberately treats
// it as fire-and-forget (failures must never fail the run), so unit tests stub
// it out and only assert whether it was invoked.
// NOTE: the factory is hoisted above the `const` declarations, so it must
// reference mockRunSynthesis lazily — binding it directly throws a TDZ error.
vi.mock('../synthesis-orchestrator', () => ({
  runSynthesis: (...args: unknown[]) => mockRunSynthesis(...args),
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
  /** 客户的主关键词（真实来源：clients.primary_keywords）。 */
  keywords?: string[]
  /** Search queries inside the `client_discovery` GSC payload. */
  gscQueries?: string[]
  insertError?: { message: string } | null
  updateError?: { message: string } | null
}

function makeSupabase(opts: MockOptions = {}): SupabaseClient {
  const {
    runId = 'run-test-123',
    clientDomain = 'test.co.nz',
    keywords = ['tour packages'],
    gscQueries = ['china tours nz'],
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
                data: {
                  domain: clientDomain,
                  name: 'Test Co',
                  city: 'Auckland',
                  country: 'NZ',
                  industry: 'travel',
                  semrush_db: 'nz',
                  // 🔴 关键词的真实来源就是这一列（客户设置页写的就是它）。
                  //    原来假件给一张叫 `keywords` 的表建了模型 —— 而那张表
                  //    **在生产库里根本不存在**，查询报错被 `?? []` 吞掉，
                  //    于是 SEO 采集器每次都拿到空数组、整柱天天被判「跳过」，
                  //    测试却因为假件"配合"而一直是绿的（2026-08-05 用生产库证实）。
                  primary_keywords: keywords,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'client_discovery') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  payload: {
                    advanced: { gsc_data: { rows: gscQueries.map(query => ({ query })) } },
                  },
                },
                error: null,
              }),
            }),
          }),
        }
      }
      // Every table the runner touches must be modelled above. The previous
      // catch-all returned a half-built stub, so when the runner started
      // reading `client_discovery` the chain blew up on undefined, the error
      // was swallowed by executeDiagnosticRun's catch, and every run silently
      // came back `failed` — 12 tests red with no hint at the cause.
      throw new Error(`[test mock] unmodelled supabase table: ${table}`)
    }),
  }

  return mock as unknown as SupabaseClient
}

/**
 * Pulls the terminal `completed` update out of the mock, and — when the run
 * failed instead — surfaces the real error_message rather than an opaque
 * "expected undefined to be 80".
 */
function completedUpdate(supabase: SupabaseClient): Record<string, unknown> {
  const updates = (supabase as unknown as { _updates: unknown[] })._updates
  const isUpdate = (u: unknown): u is Record<string, unknown> =>
    typeof u === 'object' && u !== null
  const done = updates.filter(isUpdate).find(u => u.status === 'completed')
  if (!done) {
    const failed = updates.filter(isUpdate).find(u => u.status === 'failed')
    throw new Error(
      `run never completed. failure: ${String(failed?.error_message ?? '(no failed update either)')}`,
    )
  }
  return done
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
  mockAdsCollect.mockResolvedValue({ score: 90, findings: [], meta_ads: null, google_ads: null })
  mockRunSynthesis.mockResolvedValue({
    ran: false,
    skipped_reason: 'stubbed_in_test',
    modules: {},
    total_cost_usd: 0,
  })
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
    expect(mockAdsCollect).not.toHaveBeenCalled()
  })

  // Guards the fetchClientData → collector contract. When the runner started
  // reading GSC queries out of client_discovery, nothing asserted the plumbing,
  // so the mock could fall out of date unnoticed.
  it('passes domain, approved keywords, GSC queries and market to the collector', async () => {
    const supabase = makeSupabase({
      clientDomain: 'cts.co.nz',
      keywords: ['china tours', 'guilin tour'],
      gscQueries: ['great wall trip'],
    })
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    expect(mockSeoCollect).toHaveBeenCalledWith(
      'client-1',
      'cts.co.nz',
      ['china tours', 'guilin tour'],
      ['great wall trip'],
      'nz',
    )
  })

  it('overall_score equals seo score when only seo runs (re-normalised weight)', async () => {
    mockSeoCollect.mockResolvedValue({ score: 80, findings: [] })
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    expect(completedUpdate(supabase).overall_score).toBe(80)
  })

  it('does not run synthesis for a single-dimension run', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')
    expect(mockRunSynthesis).not.toHaveBeenCalled()
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
  it('runs all six collectors concurrently', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'full')
    expect(mockSeoCollect).toHaveBeenCalledOnce()
    expect(mockSocialCollect).toHaveBeenCalledOnce()
    expect(mockReputationCollect).toHaveBeenCalledOnce()
    expect(mockCompetitorCollect).toHaveBeenCalledOnce()
    expect(mockAiVisibilityCollect).toHaveBeenCalledOnce()
    expect(mockAdsCollect).toHaveBeenCalledOnce()
  })

  it('overall_score is weighted average of all six dimensions', async () => {
    mockSeoCollect.mockResolvedValue({ score: 80, findings: [] })
    mockSocialCollect.mockResolvedValue({ score: 60, findings: [] })
    mockReputationCollect.mockResolvedValue({ score: 40, findings: [] })
    mockCompetitorCollect.mockResolvedValue({ score: 70, findings: [], competitorList: [] })
    mockAiVisibilityCollect.mockResolvedValue({ score: 50, findings: [] })
    mockAdsCollect.mockResolvedValue({ score: 90, findings: [], meta_ads: null, google_ads: null })

    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'full')

    // seo=80(0.25), ai_visibility=50(0.20), ads=90(0.20),
    // social=60(0.15), reputation=40(0.10), competitor=70(0.10) — weights sum to 1.00
    // 20 + 10 + 18 + 9 + 4 + 7 = 68
    expect(completedUpdate(supabase).overall_score).toBe(68)
  })

  it('re-normalises weights when one dimension has no data', async () => {
    mockSeoCollect.mockResolvedValue({ score: 80, findings: [] })
    mockSocialCollect.mockResolvedValue({ score: 60, findings: [] })
    mockReputationCollect.mockResolvedValue({ score: 40, findings: [] })
    mockCompetitorCollect.mockResolvedValue({ score: 70, findings: [], competitorList: [] })
    mockAiVisibilityCollect.mockResolvedValue({ score: 50, findings: [] })
    // Client runs no ads at all — score null means "unknowable", not "zero".
    mockAdsCollect.mockResolvedValue({ score: null, findings: [], meta_ads: null, google_ads: null })

    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'full')

    const update = completedUpdate(supabase)
    // remaining weight = 0.80 → (20 + 9 + 4 + 7 + 10) / 0.80 = 62.5 → 63
    expect(update.overall_score).toBe(63)
    expect(update.dimensions_skipped).toEqual(['ads'])
  })

  it('dimension_scores contains all six dimensions', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'full')

    const scores = completedUpdate(supabase).dimension_scores as Record<string, number>
    expect(scores).toHaveProperty('seo')
    expect(scores).toHaveProperty('social')
    expect(scores).toHaveProperty('reputation')
    expect(scores).toHaveProperty('competitor')
    expect(scores).toHaveProperty('ai_visibility')
    expect(scores).toHaveProperty('ads')
  })

  it('hands the persisted result to synthesis', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'full')

    expect(mockRunSynthesis).toHaveBeenCalledOnce()
    const input = mockRunSynthesis.mock.calls[0][1] as Record<string, unknown>
    expect(input.runId).toBe('run-test-123')
    expect(input.clientId).toBe('client-1')
    expect(typeof input.overallScore).toBe('number')
  })

  it('still completes when synthesis throws (never blocks the run)', async () => {
    mockRunSynthesis.mockRejectedValue(new Error('LLM down'))
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'full')

    const updates = (supabase as unknown as { _updates: unknown[] })._updates
    expect(completedUpdate(supabase)).toBeDefined()
    expect(updates.some(u => (u as Record<string, unknown>)?.status === 'failed')).toBe(false)
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
    expect(mockAdsCollect).not.toHaveBeenCalled()
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
    expect(mockAdsCollect).not.toHaveBeenCalled()
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
    expect(mockAdsCollect).not.toHaveBeenCalled()
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
    expect(mockAdsCollect).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — ads module
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — ads module', () => {
  it('only calls AdsCollector', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'ads')
    expect(mockAdsCollect).toHaveBeenCalledOnce()
    expect(mockSeoCollect).not.toHaveBeenCalled()
    expect(mockSocialCollect).not.toHaveBeenCalled()
    expect(mockReputationCollect).not.toHaveBeenCalled()
    expect(mockCompetitorCollect).not.toHaveBeenCalled()
    expect(mockAiVisibilityCollect).not.toHaveBeenCalled()
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

    const update = completedUpdate(supabase)
    expect(update.overall_score).toBe(0)
    // BUG-FMT-S14: a rejected collector is UNKNOWABLE, not a zero. The dimension
    // score must be null and the dimension listed as skipped, so the UI can say
    // "not measured" rather than showing a fabricated 0.
    expect((update.dimension_scores as Record<string, unknown>).seo).toBeNull()
    expect(update.dimensions_skipped).toEqual(['seo'])
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
