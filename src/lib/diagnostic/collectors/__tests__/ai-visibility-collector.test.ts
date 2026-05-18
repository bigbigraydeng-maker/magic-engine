import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { AiVisibilityCollector } from '../ai-visibility-collector'
import type { LiveProbe, LiveProbeResult } from '../../ai-visibility-live-probe'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-ai-test'
const DOMAIN = 'example.co.nz'
const KEYWORDS: string[] = []

// ---------------------------------------------------------------------------
// Supabase mock factory
// ---------------------------------------------------------------------------

interface SnapshotRow {
  avg_rank: number | null
  mentions_count: number
  total_runs: number
  week_of: string
}

function makeSupabase(
  opts: { snapshot?: SnapshotRow | null; brandName?: string | null } = {},
): SupabaseClient {
  const { snapshot = null, brandName = 'Test Brand' } = opts

  return {
    from: vi.fn((table: string) => {
      if (table === 'ai_visibility_snapshots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: snapshot ? [snapshot] : [],
                  error: null,
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
                data: brandName ? { name: brandName } : null,
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'master_briefs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }
      }
      return {}
    }),
  } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// LiveProbe mock factory
// ---------------------------------------------------------------------------

function makeProbe(result: Partial<LiveProbeResult>): LiveProbe {
  return {
    run: vi.fn().mockResolvedValue({
      runs: 0,
      mentions: 0,
      avg_rank: null,
      questions: [],
      latency_ms: 0,
      skipped: false,
      ...result,
    } as LiveProbeResult),
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Basic shape
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — basic shape', () => {
  it('returns { score, findings } with score in 0–100', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 8, total_runs: 10, week_of: '2026-05-12' },
    })
    const result = await new AiVisibilityCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(Array.isArray(result.findings)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// No snapshot data
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — no data', () => {
  it('returns score=null and ai_visibility_not_tracked when no snapshot exists', async () => {
    // P8.5.22: no snapshot = AI Tracker never ran for this client → score is unknowable
    const supabase = makeSupabase({ snapshot: null })
    const { score, findings } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeNull()
    const f = findings.find(x => x.finding_type === 'ai_visibility_not_tracked')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('critical')
  })

  it('returns score=0 and brand_not_mentioned when snapshot exists but mentions_count=0', async () => {
    // Snapshot exists with 0 mentions = real signal: brand IS invisible to AI
    const supabase = makeSupabase({
      snapshot: { avg_rank: null, mentions_count: 0, total_runs: 10, week_of: '2026-05-12' },
    })
    const { score, findings } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBe(0)
    expect(findings.find(x => x.finding_type === 'brand_not_mentioned')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Good visibility
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — good visibility', () => {
  it('returns score > 50 when avg_rank=2 and 80% mention rate', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 8, total_runs: 10, week_of: '2026-05-12' },
    })
    const { score } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeGreaterThan(50)
  })

  it('returns score=100 when avg_rank=1 and 100% mention rate', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 1, mentions_count: 10, total_runs: 10, week_of: '2026-05-12' },
    })
    const { score } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// low_ai_rank finding
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — low rank', () => {
  it('emits low_ai_rank (high) when avg_rank > 3', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 4, mentions_count: 5, total_runs: 10, week_of: '2026-05-12' },
    })
    const { findings } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    const f = findings.find(x => x.finding_type === 'low_ai_rank')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('does NOT emit low_ai_rank when avg_rank <= 2', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 6, total_runs: 10, week_of: '2026-05-12' },
    })
    const { findings } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(findings.find(x => x.finding_type === 'low_ai_rank')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Supabase failure — graceful degradation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// P8.10.S2.5 — Live probe layer
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — live probe (P8.10.S2.5)', () => {
  it('uses live probe when no snapshot exists and probe returns mentions', async () => {
    const supabase = makeSupabase({ snapshot: null })
    const probe = makeProbe({
      runs: 3,
      mentions: 3,
      avg_rank: 1,
      questions: [
        { question: 'q1', client_brand_rank: 1 },
        { question: 'q2', client_brand_rank: 1 },
        { question: 'q3', client_brand_rank: 1 },
      ],
    })
    const result = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(result.score).toBe(100)
    expect(result.findings).toHaveLength(0)
  })

  it('emits brand_not_mentioned (live) when no snapshot and probe finds 0 mentions', async () => {
    const supabase = makeSupabase({ snapshot: null })
    const probe = makeProbe({ runs: 3, mentions: 0, avg_rank: null })
    const { score, findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBe(0)
    const f = findings.find(x => x.finding_type === 'brand_not_mentioned')
    expect(f).toBeDefined()
    expect(f?.evidence).toMatchObject({ parsed: { live_probe: { runs: 3, mentions: 0 } } })
  })

  it('falls back to ai_visibility_not_tracked when probe is skipped and no snapshot', async () => {
    const supabase = makeSupabase({ snapshot: null })
    const probe = makeProbe({ skipped: true, skip_reason: 'no key' })
    const { score, findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeNull()
    expect(findings.find(x => x.finding_type === 'ai_visibility_not_tracked')).toBeDefined()
  })

  it('emits live_probe_no_mention when snapshot has mentions but live probe finds none', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 5, total_runs: 10, week_of: '2026-05-12' },
    })
    const probe = makeProbe({ runs: 3, mentions: 0, avg_rank: null })
    const { findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    const f = findings.find(x => x.finding_type === 'live_probe_no_mention')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('attaches live_probe evidence to low_ai_rank finding', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 4, mentions_count: 5, total_runs: 10, week_of: '2026-05-12' },
    })
    const probe = makeProbe({
      runs: 3,
      mentions: 2,
      avg_rank: 3.5,
      questions: [{ question: 'q1', client_brand_rank: 3 }],
    })
    const { findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    const f = findings.find(x => x.finding_type === 'low_ai_rank')
    expect(f?.evidence).toMatchObject({ parsed: { live_probe: { runs: 3, mentions: 2 } } })
  })

  it('does not crash when probe throws — falls back to snapshot-only', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 8, total_runs: 10, week_of: '2026-05-12' },
    })
    const probe: LiveProbe = { run: vi.fn().mockRejectedValue(new Error('boom')) }
    const { score } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeGreaterThan(50)
  })
})

describe('AiVisibilityCollector.collect() — DB failure', () => {
  it('returns degraded { score: null, findings: [] } when Supabase throws', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error('DB error')),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await new AiVisibilityCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(0)
  })
})
