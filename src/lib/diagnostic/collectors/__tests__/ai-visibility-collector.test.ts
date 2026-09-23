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

/**
 * Defaults describe a probe where every attempted question was measured
 * successfully — i.e. a zero here is a REAL zero. Tests that need a failed
 * measurement must set `failed_runs` (and `measured_runs`) explicitly.
 */
function makeProbe(result: Partial<LiveProbeResult>): LiveProbe {
  const runs = result.runs ?? 0
  return {
    run: vi.fn().mockResolvedValue({
      runs,
      measured_runs: runs,
      failed_runs: 0,
      mentions: 0,
      avg_rank: null,
      questions: [],
      latency_ms: 0,
      skipped: false,
      ...result,
    } as LiveProbeResult),
  }
}

/** A probe where every question's engine call failed (e.g. OpenAI 429). */
function makeFailedProbe(runs = 3): LiveProbe {
  return makeProbe({
    runs,
    measured_runs: 0,
    failed_runs: runs,
    mentions: 0,
    avg_rank: null,
    questions: Array.from({ length: runs }, (_, i) => ({
      question: `q${i + 1}`,
      client_brand_rank: null,
      error: '429 Rate limit reached',
    })),
  })
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
        { question: 'q1', client_brand_rank: 1, error: null },
        { question: 'q2', client_brand_rank: 1, error: null },
        { question: 'q3', client_brand_rank: 1, error: null },
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
    const probe = makeProbe({ skipped: true, skip_reason: 'no key', skip_kind: 'not_configured' })
    const { score, findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeNull()
    expect(findings.find(x => x.finding_type === 'ai_visibility_not_tracked')).toBeDefined()
  })

  // Regression: a live probe that TRIED (outer 45s timeout fired, or
  // `probe.run()` rejected) must not be reported as "tracking never
  // enabled" — the client already configured it, the attempt just broke.
  it('emits ai_visibility_probe_failed (not ai_visibility_not_tracked) when probe is skipped with skip_kind=attempt_failed', async () => {
    const supabase = makeSupabase({ snapshot: null })
    const probe = makeProbe({
      skipped: true,
      skip_reason: 'live probe exceeded 45000ms',
      skip_kind: 'attempt_failed',
    })
    const { score, findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeNull()
    expect(findings.find(x => x.finding_type === 'ai_visibility_probe_failed')).toBeDefined()
    expect(findings.find(x => x.finding_type === 'ai_visibility_not_tracked')).toBeUndefined()
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
      questions: [{ question: 'q1', client_brand_rank: 3, error: null }],
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

// ---------------------------------------------------------------------------
// Regression: a FAILED probe must never be reported as a measured zero.
//
// 2026-09-21: the shared OpenAI account hit its spend cap and every probe call
// returned 429. The probe still reported runs=3 / mentions=0, and 5 clients got
// AI-visibility findings — one of them a `critical` "Brand Not Mentioned by AI"
// — that were never measured at all. See CLAUDE.md 铁律 8.
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector — failed probe is "not measured", not "zero"', () => {
  it('does NOT emit brand_not_mentioned when every probe question failed and no snapshot exists', async () => {
    const supabase = makeSupabase({ snapshot: null })
    const { score, findings } = await new AiVisibilityCollector(
      supabase,
      makeFailedProbe(),
    ).collect(CLIENT_ID, DOMAIN, KEYWORDS)

    expect(findings.find(x => x.finding_type === 'brand_not_mentioned')).toBeUndefined()
    // A probe that ran but failed (429 etc.) is a transient measurement
    // failure — emits probe_failed finding (not "not tracked").
    expect(score).toBeNull()
    expect(findings.find(x => x.finding_type === 'ai_visibility_probe_failed')).toBeDefined()
    expect(findings.find(x => x.finding_type === 'ai_visibility_not_tracked')).toBeUndefined()
  })

  it('does NOT emit live_probe_no_mention when every probe question failed', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 95, total_runs: 120, week_of: '2026-09-14' },
    })
    const { findings } = await new AiVisibilityCollector(supabase, makeFailedProbe()).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(findings.find(x => x.finding_type === 'live_probe_no_mention')).toBeUndefined()
  })

  it('does NOT attach failed-probe counts as evidence on snapshot-derived findings', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 4.5, mentions_count: 4, total_runs: 40, week_of: '2026-09-14' },
    })
    const { findings } = await new AiVisibilityCollector(supabase, makeFailedProbe()).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    const lowRank = findings.find(x => x.finding_type === 'low_ai_rank')
    expect(lowRank).toBeDefined()
    expect(
      (lowRank?.evidence as { parsed?: Record<string, unknown> } | null)?.parsed?.live_probe,
    ).toBeNull()
  })

  it('treats a PARTIALLY failed probe as inconclusive (fail-closed on a 3-question sample)', async () => {
    const supabase = makeSupabase({ snapshot: null })
    const probe = makeProbe({
      runs: 3,
      measured_runs: 2,
      failed_runs: 1,
      mentions: 0,
      questions: [
        { question: 'q1', client_brand_rank: null, error: null },
        { question: 'q2', client_brand_rank: null, error: null },
        { question: 'q3', client_brand_rank: null, error: '429 Rate limit reached' },
      ],
    })
    const { score, findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(findings.find(x => x.finding_type === 'brand_not_mentioned')).toBeUndefined()
    expect(score).toBeNull()
  })

  it('STILL reports a genuine zero — all questions measured, brand absent', async () => {
    // Guard against over-correcting: a real zero must remain a critical finding.
    const supabase = makeSupabase({ snapshot: null })
    const probe = makeProbe({
      runs: 3,
      measured_runs: 3,
      failed_runs: 0,
      mentions: 0,
      questions: [
        { question: 'q1', client_brand_rank: null, error: null },
        { question: 'q2', client_brand_rank: null, error: null },
        { question: 'q3', client_brand_rank: null, error: null },
      ],
    })
    const { score, findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    const f = findings.find(x => x.finding_type === 'brand_not_mentioned')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('critical')
    expect(score).toBe(0)
    expect(f?.evidence).toMatchObject({
      parsed: { live_probe: { measured_runs: 3, failed_runs: 0, mentions: 0 } },
    })
  })

  it('STILL reports a genuine live-probe regression against a healthy snapshot', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 95, total_runs: 120, week_of: '2026-09-14' },
    })
    const probe = makeProbe({ runs: 3, measured_runs: 3, failed_runs: 0, mentions: 0 })
    const { findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    const f = findings.find(x => x.finding_type === 'live_probe_no_mention')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('partial failure with brand mentioned is STILL inconclusive (known trade-off: drops real evidence)', async () => {
    // 2/3 questions measured, brand found in both — but 1 failed, so
    // isProbeConclusive returns false. This loses genuine evidence; we accept
    // that at n=3 because asserting absence from a 2-question sample is worse.
    const supabase = makeSupabase({ snapshot: null })
    const probe = makeProbe({
      runs: 3,
      measured_runs: 2,
      failed_runs: 1,
      mentions: 2,
      avg_rank: 1,
      questions: [
        { question: 'q1', client_brand_rank: 1, error: null },
        { question: 'q2', client_brand_rank: 1, error: null },
        { question: 'q3', client_brand_rank: null, error: '429 Rate limit reached' },
      ],
    })
    const { score, findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    // Probe dropped — no brand_not_mentioned, no false positive either.
    expect(score).toBeNull()
    expect(findings.find(x => x.finding_type === 'brand_not_mentioned')).toBeUndefined()
    expect(findings.find(x => x.finding_type === 'ai_visibility_probe_failed')).toBeDefined()
  })

  it('emits ai_visibility_probe_failed with error details when probe calls all failed', async () => {
    const supabase = makeSupabase({ snapshot: null })
    const { findings } = await new AiVisibilityCollector(
      supabase,
      makeFailedProbe(3),
    ).collect(CLIENT_ID, DOMAIN, KEYWORDS)

    const f = findings.find(x => x.finding_type === 'ai_visibility_probe_failed')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
    expect(f?.fix_type).toBe('fde_manual')
    const parsed = (f?.evidence as { parsed?: Record<string, unknown> } | null)?.parsed
    expect(parsed).toMatchObject({ attempted: 3, measured: 0, failed: 3 })
    expect((parsed as { errors?: unknown[] })?.errors).toHaveLength(3)
  })
})
