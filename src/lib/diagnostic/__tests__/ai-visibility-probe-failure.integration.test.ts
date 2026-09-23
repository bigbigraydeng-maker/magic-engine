/**
 * Integration guard for the 2026-09-21 fabricated-finding incident.
 *
 * Unlike ai-visibility-collector.test.ts — which hand-builds probe results —
 * this exercises the REAL `createDefaultLiveProbe` implementation with the
 * engine failing the way it actually failed (OpenAI 429, spend cap reached),
 * then feeds its output to the REAL collector. It is the end-to-end assertion
 * that a rate-limited engine produces "not measured", never a client-facing
 * "your brand is never mentioned by AI".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const runOpenAI = vi.fn()
vi.mock('@/lib/ai-tracker/runners/openai', () => ({
  runOpenAI: (...args: unknown[]) => runOpenAI(...args),
}))

const parseRanking = vi.fn()
vi.mock('@/lib/ai-tracker/parser', () => ({
  parseRanking: (...args: unknown[]) => parseRanking(...args),
}))

import { createDefaultLiveProbe, isProbeConclusive } from '../ai-visibility-live-probe'
import { AiVisibilityCollector } from '../collectors/ai-visibility-collector'

const CLIENT_ID = 'client-429-test'

const QUESTIONS = [
  { id: 'q1', question: 'Best China tour companies for New Zealand travellers?', market_tag: 'au-nz', enabled: true },
  { id: 'q2', question: 'Which China tour operator is most authentic for Kiwis?', market_tag: 'au-nz', enabled: true },
  { id: 'q3', question: 'How do I plan my first trip to China from New Zealand?', market_tag: 'au-nz', enabled: true },
]

/** Supabase double covering every table the probe + collector read. */
function makeSupabase(snapshot: Record<string, unknown> | null): SupabaseClient {
  return {
    from: vi.fn((table: string) => {
      if (table === 'ai_visibility_snapshots') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: snapshot ? [snapshot] : [], error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'ai_visibility_queries') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: QUESTIONS, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'clients') {
        return {
          select: (cols: string) => ({
            eq: () =>
              cols.includes('domain')
                ? {
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { domain: 'ctstours.co.nz', brand_aliases: [], brand_geo_anchors: [] },
                        error: null,
                      }),
                  }
                : { single: () => Promise.resolve({ data: { name: 'Test Brand' }, error: null }) },
          }),
        }
      }
      if (table === 'master_briefs') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          }),
        }
      }
      return {}
    }),
  } as unknown as SupabaseClient
}

/** What runOpenAI actually returns once the account is over its spend cap. */
function rateLimited() {
  return {
    ai_engine: 'openai',
    ai_model: 'gpt-5-search-api',
    raw_response: '',
    citations: [],
    tokens_used: null,
    cost_usd: null,
    latency_ms: 12,
    error_message: '429 Rate limit reached for gpt-5-search-api',
  }
}

function answered(text: string) {
  return {
    ai_engine: 'openai',
    ai_model: 'gpt-5-search-api',
    raw_response: text,
    citations: [],
    tokens_used: 100,
    cost_usd: 0.001,
    latency_ms: 9000,
    error_message: null,
  }
}

function shortRefusal() {
  return {
    ai_engine: 'openai',
    ai_model: 'gpt-5-search-api',
    raw_response: 'I cannot answer that.',
    citations: [],
    tokens_used: 5,
    cost_usd: 0.0001,
    latency_ms: 300,
    error_message: null,
  }
}

// Shape mirrors makeSupabase (line 36) — verified by 5 existing tests in this file
function makeQueryErrorSupabase(): SupabaseClient {
  return makeSupabaseWith({ queriesError: true })
}

function makeSupabaseWith(opts: { queriesError?: boolean } = {}): SupabaseClient {
  const sb = makeSupabase(null)
  if (opts.queriesError) {
    const origFrom = sb.from as ReturnType<typeof vi.fn>
    sb.from = vi.fn((table: string) => {
      if (table === 'ai_visibility_queries') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }),
                }),
              }),
            }),
          }),
        }
      }
      return origFrom(table)
    }) as typeof sb.from
  }
  return sb
}

beforeEach(() => {
  // mockReset, not clearAllMocks: the latter clears call history but KEEPS the
  // implementation, so a `mockResolvedValue` from an earlier test would silently
  // become the fallback once this test's `*Once` queue drains.
  runOpenAI.mockReset()
  parseRanking.mockReset()
  process.env.OPENAI_API_KEY = 'sk-test'
})

describe('live probe under OpenAI 429 — the 2026-09-21 incident', () => {
  it('marks every question as failed rather than as an absent brand', async () => {
    runOpenAI.mockResolvedValue(rateLimited())

    const probe = createDefaultLiveProbe(makeSupabase(null))
    const result = await probe.run({ clientId: CLIENT_ID, brandName: 'Test Brand' })

    expect(result.runs).toBe(3)
    expect(result.failed_runs).toBe(3)
    expect(result.measured_runs).toBe(0)
    expect(result.mentions).toBe(0)
    // Every question carries the reason it is blank — the field that makes
    // "not measured" distinguishable from "measured, absent".
    expect(result.questions.every(q => q.error !== null)).toBe(true)
    expect(isProbeConclusive(result)).toBe(false)
  })

  it('produces NO client-facing finding and a null score for a client with no snapshot', async () => {
    runOpenAI.mockResolvedValue(rateLimited())

    const supabase = makeSupabase(null)
    const { score, findings } = await new AiVisibilityCollector(
      supabase,
      createDefaultLiveProbe(supabase),
    ).collect(CLIENT_ID, 'ctstours.co.nz', [])

    // This is the exact finding East International received on 2026-09-21.
    expect(findings.find(f => f.finding_type === 'brand_not_mentioned')).toBeUndefined()
    expect(findings.some(f => f.severity === 'critical' && f.finding_type !== 'ai_visibility_not_tracked')).toBe(false)
    expect(score).toBeNull()
  })

  it('does not raise a fake regression against a healthy snapshot (the CTS "95 → 0" alert)', async () => {
    runOpenAI.mockResolvedValue(rateLimited())

    const supabase = makeSupabase({
      avg_rank: 2, mentions_count: 95, total_runs: 120, week_of: '2026-09-14',
    })
    const { findings } = await new AiVisibilityCollector(
      supabase,
      createDefaultLiveProbe(supabase),
    ).collect(CLIENT_ID, 'ctstours.co.nz', [])

    expect(findings.find(f => f.finding_type === 'live_probe_no_mention')).toBeUndefined()
  })

  it('still reports a genuine zero when the engine answers and omits the brand', async () => {
    // Guard against over-correction: engine healthy, brand simply absent.
    runOpenAI.mockResolvedValue(answered('Try Intrepid Travel, Wendy Wu Tours or G Adventures.'))
    parseRanking.mockResolvedValue({ client_brand_rank: null })

    const supabase = makeSupabase(null)
    const probe = createDefaultLiveProbe(supabase)
    const result = await probe.run({ clientId: CLIENT_ID, brandName: 'Test Brand' })

    expect(result.failed_runs).toBe(0)
    expect(result.measured_runs).toBe(3)
    expect(isProbeConclusive(result)).toBe(true)

    const { score, findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, 'ctstours.co.nz', [],
    )
    const f = findings.find(x => x.finding_type === 'brand_not_mentioned')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('critical')
    expect(score).toBe(0)
  })

  it('counts engine short-refusal (<30 chars) as a failed run, not a measured zero', async () => {
    runOpenAI.mockResolvedValue(shortRefusal())

    const supabase = makeSupabase(null)
    const probe = createDefaultLiveProbe(supabase)
    const result = await probe.run({ clientId: CLIENT_ID, brandName: 'Test Brand' })

    expect(result.runs).toBe(3)
    expect(result.failed_runs).toBe(3)
    expect(result.measured_runs).toBe(0)
    expect(result.questions.every(q => q.error !== null)).toBe(true)
    expect(result.questions[0].error).toContain('too short')
    expect(isProbeConclusive(result)).toBe(false)
  })

  it('reports probe_failed (not not_tracked) when DB query for questions fails', async () => {
    const supabase = makeQueryErrorSupabase()
    const { score, findings } = await new AiVisibilityCollector(
      supabase,
      createDefaultLiveProbe(supabase),
    ).collect(CLIENT_ID, 'test.co.nz', [])

    expect(score).toBeNull()
    expect(findings.find(f => f.finding_type === 'ai_visibility_not_tracked')).toBeUndefined()
    expect(findings.find(f => f.finding_type === 'ai_visibility_probe_failed')).toBeDefined()
  })

  it('treats a single 429 among three questions as inconclusive', async () => {
    // The probe runs TWICE below — once directly (to assert its shape) and once
    // inside the collector — so queue two identical rounds of three answers.
    for (let round = 0; round < 2; round++) {
      runOpenAI
        .mockResolvedValueOnce(answered('Intrepid Travel and Wendy Wu Tours.'))
        .mockResolvedValueOnce(answered('G Adventures is a popular choice for budget-conscious travellers.'))
        .mockResolvedValueOnce(rateLimited())
    }
    parseRanking.mockResolvedValue({ client_brand_rank: null })

    const supabase = makeSupabase(null)
    const probe = createDefaultLiveProbe(supabase)
    const result = await probe.run({ clientId: CLIENT_ID, brandName: 'Test Brand' })

    expect(result.measured_runs).toBe(2)
    expect(result.failed_runs).toBe(1)
    expect(isProbeConclusive(result)).toBe(false)

    const { score, findings } = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, 'ctstours.co.nz', [],
    )
    expect(findings.find(x => x.finding_type === 'brand_not_mentioned')).toBeUndefined()
    expect(score).toBeNull()
  })
})
