import { describe, expect, it, vi } from 'vitest'
import type { ApplyAdapter, ApplyAdapterResult, MetaCycleCandidate, MetaCycleClientConfig, MetaCycleGateEvidence } from '../types'

const mockCheckFactPreservation = vi.fn()
vi.mock('../fact-check', () => ({
  checkFactPreservation: (...args: unknown[]) => mockCheckFactPreservation(...args),
}))

const BASELINE_READING = {
  status: 'ranked' as const, rankGroup: 8, url: 'https://example.com/foo', depth: 30,
  fetchedAt: '2026-10-05T05:31:00.000Z', duplicateUrl: false, cost: 0.01,
}
const mockFetchRank = vi.fn(async (_input: unknown) => ({ ...BASELINE_READING }))
vi.mock('../rank-check', () => ({
  fetchTargetRank: (input: unknown) => mockFetchRank(input),
}))

const CONFIG: MetaCycleClientConfig = {
  clientId: 'client-1',
  domain: 'example.com',
  semrushDb: 'nz',
  maxPagesPerRun: 3,
  cooldownDays: 30,
  brandVoice: 'factual AU/NZ English',
  keywordFallbackLocations: [],
  protectedSlugs: [],
}

function candidate(overrides: Partial<MetaCycleCandidate> = {}): MetaCycleCandidate {
  return {
    pageUrl: 'https://example.com/foo',
    slug: 'foo',
    keyword: 'foo keyword',
    source: 'gsc',
    position: 8,
    impressions: 200,
    ctr: 0.034,
    searchVolume: 500,
    keywordDifficulty: 30,
    ...overrides,
  }
}

const EVIDENCE: MetaCycleGateEvidence = {
  keyword: 'foo keyword',
  searchVolume: 500,
  keywordDifficulty: 30,
  snapshotDate: '2026-09-10',
  keywordDataSource: 'dataforseo_primary',
  keywordDataLocation: 2554,
  keywordDataNote: '搜索量/难度来自 NZ 市场的 DataForSEO 数据',
  competitorTitles: ['Competitor A'],
  ctsRankingUrl: 'https://example.com/foo',
  chosenReason: 'test evidence',
}

interface InsertedRow {
  baseline_ctr: number | null
  baseline_position: number | null
  baseline_impressions: number | null
  baseline_rank_group?: number | null
  baseline_rank_status?: string
  baseline_serp_depth?: number
  baseline_serp_fetched_at?: string
}

function fakeSupabase(insertSpy: (row: InsertedRow) => void) {
  return {
    from: () => ({
      insert: async (row: InsertedRow) => {
        insertSpy(row)
        return { error: null }
      },
    }),
  }
}

/** Honors the real adapter's contract: dryRun:true is always a preview (applied:false, skipReason:'dry_run'); dryRun:false returns the configured outcome. */
function fakeAdapter(realApplyResult: { applied: boolean; skipReason?: string }, old: { title: string; desc: string } = { title: 'Old Title', desc: 'Old desc' }): ApplyAdapter {
  return {
    channel: 'pr',
    canEditSlug: async () => true,
    apply: async ({ dryRun, newTitle, newDesc }): Promise<ApplyAdapterResult> => {
      if (dryRun) {
        return { applied: false, newTitle, newDesc, oldTitle: old.title, oldDesc: old.desc, skipReason: 'dry_run' }
      }
      return {
        applied: realApplyResult.applied,
        prUrl: 'https://github.com/x/y/pull/1',
        prNumber: 1,
        branch: 'feat/x',
        newTitle, newDesc, oldTitle: old.title, oldDesc: old.desc,
        skipReason: realApplyResult.skipReason,
      }
    },
  }
}

// ── listHardFacts (2026-10-28 fact-aware generation) ──────────────────────────
// The generator is fed the facts the hard check will require to survive, so it
// stops writing generic copy that drops the page's concrete facts.

describe('listHardFacts', () => {
  it('returns the price, a date, an AU/NZ place name and a "5 days" style quantity from title+desc, de-duplicated', async () => {
    const { listHardFacts } = await import('../hard-fact-check')
    const facts = listHardFacts('Beijing tour from $6,188', 'Departs 22 Dec 2026 from Christchurch, 12 days')

    expect(facts).toContain('$6,188')
    expect(facts).toContain('22 Dec 2026')
    expect(facts).toContain('Christchurch')
    expect(facts).toContain('12 days')
    // De-duplicated: no fact appears twice even though the extractors overlap.
    expect(new Set(facts).size).toBe(facts.length)
  })

  it('returns [] for plain text with no such facts', async () => {
    const { listHardFacts } = await import('../hard-fact-check')
    expect(listHardFacts('A simple guide', 'Everything you need to know about visiting.')).toEqual([])
  })
})

// ── runStep4Applied — fact-aware generation (2026-10-28) ──────────────────────
// Every CTS proposal had been blocked since 09-28 because the generator ran
// before the current text was read, so it wrote generic copy that dropped the
// page's concrete facts. Now the generator sees the current text + the facts
// the hard check requires, and gets exactly ONE retry with the hard check's
// reason as feedback.

describe('runStep4Applied — fact-aware generation', () => {
  it('reads the current text BEFORE generating and passes it + factsToKeep to the generator', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => undefined) as any
    const order: string[] = []
    const adapter: ApplyAdapter = {
      channel: 'pr',
      canEditSlug: async () => true,
      apply: async ({ dryRun, newTitle, newDesc }): Promise<ApplyAdapterResult> => {
        order.push('apply')
        return {
          applied: false, newTitle, newDesc,
          oldTitle: 'Liziba Station Chongqing',
          oldDesc: 'Trains pass the 6th floor of a 19-storey building in Chongqing, New Zealand travellers',
          skipReason: 'dry_run',
        }
      },
    }
    const generateMeta = vi.fn(async (_input: unknown) => {
      order.push('generate')
      return { title: 'Liziba Station Chongqing', desc: 'Trains pass a building in Chongqing — guide for New Zealand travellers.' }
    })

    await runStep4Applied(supabase, adapter, CONFIG, '2026-W44', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, true)

    expect(order.slice(0, 2)).toEqual(['apply', 'generate'])
    const firstArg = generateMeta.mock.calls[0][0] as { currentTitle: string; currentDesc: string; factsToKeep: string[] }
    expect(firstArg.currentTitle).toBe('Liziba Station Chongqing')
    expect(firstArg.currentDesc).toBe('Trains pass the 6th floor of a 19-storey building in Chongqing, New Zealand travellers')
    expect(firstArg.factsToKeep).toContain('New Zealand')
  })

  it('retries exactly once with the hard-check reason when the first attempt drops a fact', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => undefined) as any
    const adapter = fakeAdapter(
      { applied: true },
      { title: 'Liziba Station Chongqing', desc: 'Trains pass the 6th floor of a 19-storey building in Chongqing, New Zealand travellers' },
    )
    const generateMeta = vi.fn()
      .mockResolvedValueOnce({ title: 'Liziba Station guide', desc: 'Visit this unique station today.' })
      .mockResolvedValueOnce({ title: 'Liziba Station Chongqing', desc: 'Trains pass a building in Chongqing — guide for New Zealand travellers.' })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W44', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, true)

    expect(generateMeta).toHaveBeenCalledTimes(2)
    const secondArg = generateMeta.mock.calls[1][0] as { retryFeedback?: string }
    expect(typeof secondArg.retryFeedback).toBe('string')
    expect(secondArg.retryFeedback).toContain('New Zealand')
    expect(result.proposals[0].newDesc).toBe('Trains pass a building in Chongqing — guide for New Zealand travellers.')
  })

  it('does not retry when the first attempt keeps every fact', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => undefined) as any
    const adapter = fakeAdapter(
      { applied: true },
      { title: 'Liziba Station Chongqing', desc: 'Trains pass the 6th floor of a 19-storey building in Chongqing, New Zealand travellers' },
    )
    const generateMeta = vi.fn().mockResolvedValue({
      title: 'Liziba Station Chongqing',
      desc: 'Trains pass a building in Chongqing — guide for New Zealand travellers.',
    })

    await runStep4Applied(supabase, adapter, CONFIG, '2026-W44', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, true)

    expect(generateMeta).toHaveBeenCalledTimes(1)
  })

  it('never retries more than once even if the retry still drops a fact', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => undefined) as any
    const adapter = fakeAdapter(
      { applied: true },
      { title: 'Liziba Station Chongqing', desc: 'Trains pass the 6th floor of a 19-storey building in Chongqing, New Zealand travellers' },
    )
    const generateMeta = vi.fn()
      .mockResolvedValueOnce({ title: 'Liziba Station guide', desc: 'Visit this unique station today.' })
      .mockResolvedValueOnce({ title: 'Liziba Station guide', desc: 'Visit this unique station today.' })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W44', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, true)

    expect(generateMeta).toHaveBeenCalledTimes(2)
    expect(result.proposals[0].skipReason).toBe('fact_contradiction_detected')
  })

  it('stops before generating when the current text cannot be read', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => undefined) as any
    const adapter: ApplyAdapter = {
      channel: 'pr',
      canEditSlug: async () => true,
      apply: async ({ newTitle, newDesc }): Promise<ApplyAdapterResult> => ({
        applied: false, newTitle, newDesc, oldTitle: '', oldDesc: '', skipReason: 'slug_not_in_any_data_file',
      }),
    }
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W44', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, true)

    expect(generateMeta).not.toHaveBeenCalled()
    expect(result.proposals[0].skipReason).toBe('slug_not_in_any_data_file')
  })
})

describe('brand terms are not page facts (2026-10-28: every proposal blocked for "dropping CTS")', () => {
  it('dropping the client brand acronym fails without ignoreTerms and passes with it', async () => {
    const { checkHardFactsPreserved } = await import('../hard-fact-check')
    const oldTitle = 'Best Time to Visit China | NZ Seasonal Guide | ACME Tours'
    const oldDesc = 'Season guide covering weather and crowds.'
    const newTitle = 'Best Time to Visit China: NZ Seasonal Guide'
    const newDesc = 'Season guide covering weather and crowds for NZ travellers.'
    expect(checkHardFactsPreserved(oldTitle, oldDesc, newTitle, newDesc).consistent).toBe(false)
    expect(checkHardFactsPreserved(oldTitle, oldDesc, newTitle, newDesc, { ignoreTerms: ['acme'] }).consistent).toBe(true)
  })

  it('ignoreTerms never excuses a real dropped fact (place name)', async () => {
    const { checkHardFactsPreserved } = await import('../hard-fact-check')
    const r = checkHardFactsPreserved(
      'Liziba Station | ACME', 'A tour from New Zealand.',
      'Liziba Station', 'A tour.',
      { ignoreTerms: ['acme'] },
    )
    expect(r.consistent).toBe(false)
    expect(r.droppedFacts).toContain('New Zealand')
  })

  it('listHardFacts leaves brand terms out of the facts the generator must keep', async () => {
    const { listHardFacts } = await import('../hard-fact-check')
    expect(listHardFacts('Guide | ACME Tours', 'From Auckland.', { ignoreTerms: ['ACME'] })).not.toContain('ACME')
    expect(listHardFacts('Guide | ACME Tours', 'From Auckland.')).toContain('ACME')
  })
})

describe('roster reads brand terms from seo_config.brand_terms', () => {
  function fakeClients(seoConfig: unknown) {
    const row = { id: 'client-x', domain: 'example.co.nz', semrush_db: 'nz', seo_config: seoConfig }
    const chain = {
      select: () => chain, eq: () => chain, not: () => chain,
      maybeSingle: async () => ({ data: row, error: null }),
    }
    return { from: () => chain } as unknown as import('@supabase/supabase-js').SupabaseClient
  }

  it('keeps non-empty strings, trims them, drops junk; missing = []', async () => {
    const { loadMetaCycleClientConfigForDryRun, toClientConfig } = await import('../roster')
    const entry = await loadMetaCycleClientConfigForDryRun(fakeClients({ brand_terms: [' acme ', '', 3, 'acmetours'] }), 'client-x')
    expect(entry?.brandTerms).toEqual(['acme', 'acmetours'])
    expect(entry && toClientConfig(entry).brandTerms).toEqual(['acme', 'acmetours'])
    const none = await loadMetaCycleClientConfigForDryRun(fakeClients({}), 'client-x')
    expect(none?.brandTerms).toEqual([])
  })
})
