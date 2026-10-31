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

// ── runStep2CandidatesReady cooldown — post-revert reselect-loop fix ──────────
// Real fixture: CTS (client c0000000-0000-0000-0000-000000000000) reverted 3
// pages after the 2026-09-19 incident — liziba-station-chongqing-guide,
// beijing-to-xian-high-speed-train, how-many-days-in-chongqing — and a
// same-day dry run re-picked all 3 as fresh candidates because the old query
// excluded every reverted row from the cooldown set unconditionally.

interface FakeLogRow {
  page_slug: string
  reverted_at: string | null
  optimised_at: string
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeQueryChain(result: { data: unknown; error: null }): any {
  const chain = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result,
    then: (resolve: (value: typeof result) => void) => resolve(result),
  }
  return chain
}

const CTS_SLUGS = ['liziba-station-chongqing-guide', 'beijing-to-xian-high-speed-train', 'how-many-days-in-chongqing']

function gscPageFor(slug: string) {
  return { page: `https://cts.co.nz/${slug}`, impressions: 80, position: 9, ctr: 0.03 }
}

function fakeSupabaseForStep2(recentRows: FakeLogRow[], gscSlugs: string[]) {
  return {
    from: (table: string) => {
      if (table === 'seo_meta_log') return fakeQueryChain({ data: recentRows, error: null })
      if (table === 'gsc_performance_snapshots') return fakeQueryChain({ data: { top_pages: gscSlugs.map(gscPageFor) }, error: null })
      throw new Error(`unexpected table ${table}`)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('runStep2CandidatesReady — cooldown excludes reverted rows from the standing 30-day lock but still applies a short post-revert cooldown', () => {
  it('does NOT immediately re-open the 3 real CTS pages reverted today (fixed bug: same-day dry run re-picked all 3 as fresh candidates)', async () => {
    const { runStep2CandidatesReady } = await import('../runner')
    const revertedToday: FakeLogRow[] = CTS_SLUGS.map((slug) => ({ page_slug: slug, reverted_at: daysAgoIso(0), optimised_at: daysAgoIso(0) }))
    const supabase = fakeSupabaseForStep2(revertedToday, CTS_SLUGS)

    const { candidates } = await runStep2CandidatesReady(supabase, CONFIG)

    expect(candidates.map((c) => c.slug)).toEqual([])
  })

  it('still excludes a reverted slug 2 days later (inside the 7-day post-revert cooldown), even though its optimised_at is also inside the 30-day standing cooldown', async () => {
    const { runStep2CandidatesReady } = await import('../runner')
    const rows: FakeLogRow[] = [{ page_slug: 'liziba-station-chongqing-guide', reverted_at: daysAgoIso(2), optimised_at: daysAgoIso(2) }]
    const supabase = fakeSupabaseForStep2(rows, ['liziba-station-chongqing-guide'])

    const { candidates } = await runStep2CandidatesReady(supabase, CONFIG)

    expect(candidates.map((c) => c.slug)).toEqual([])
  })

  it('makes a slug eligible again once its revert is older than 7 days, WITHOUT waiting out the full 30-day standing cooldown (revert must not become a permanent lock either)', async () => {
    const { runStep2CandidatesReady } = await import('../runner')
    // Reverted AND originally optimised 10 days ago — outside the 7-day
    // post-revert cooldown, but still inside the 30-day standing cooldown a
    // never-reverted row would be held to. A revert must not extend the lock.
    const rows: FakeLogRow[] = [{ page_slug: 'how-many-days-in-chongqing', reverted_at: daysAgoIso(10), optimised_at: daysAgoIso(10) }]
    const supabase = fakeSupabaseForStep2(rows, ['how-many-days-in-chongqing'])

    const { candidates } = await runStep2CandidatesReady(supabase, CONFIG)

    expect(candidates.map((c) => c.slug)).toContain('how-many-days-in-chongqing')
  })

  it('still applies the full 30-day cooldown to a slug that was applied but never reverted (unchanged standing-cooldown behaviour)', async () => {
    const { runStep2CandidatesReady } = await import('../runner')
    const rows: FakeLogRow[] = [{ page_slug: 'forbidden-city-travel-guide', reverted_at: null, optimised_at: daysAgoIso(10) }]
    const supabase = fakeSupabaseForStep2(rows, ['forbidden-city-travel-guide'])

    const { candidates } = await runStep2CandidatesReady(supabase, CONFIG)

    expect(candidates.map((c) => c.slug)).toEqual([])
  })
})

describe('runStep4Applied — baseline_ctr reaches the seo_meta_log insert (fixed bug: it was never populated, permanently breaking the Check step)', () => {
  it('writes candidate.ctr into the insert row as baseline_ctr, not null', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'no contradiction' })
    const captured: InsertedRow[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase((row) => { captured.push(row) }) as any
    const adapter = fakeAdapter({ applied: true })
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    await runStep4Applied(supabase, adapter, CONFIG, '2026-W38', [{ candidate: candidate({ ctr: 0.034 }), evidence: EVIDENCE }], generateMeta, false)

    expect(captured).toHaveLength(1)
    expect(captured[0].baseline_ctr).toBe(0.034)
  })

  it('does NOT write a seo_meta_log row at all when the PR opened but did not merge (fixed bug: this used to be logged as applied)', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'no contradiction' })
    let insertCalled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => { insertCalled = true }) as any
    const adapter = fakeAdapter({ applied: false, skipReason: 'pr_opened_but_not_merged' })
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W38', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, false)

    expect(insertCalled).toBe(false)
    expect(result.applied).toHaveLength(0)
    expect(result.routedManual).toBe(1)
  })

  it('skips (no write, manual action) when the fact-check judge finds a contradiction — never applies a factually inconsistent change', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: false, reason: 'original says visa-free, new text says application required' })
    let insertCalled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => { insertCalled = true }) as any
    const adapter = fakeAdapter({ applied: true })
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W38', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, false)

    expect(insertCalled).toBe(false)
    expect(result.applied).toHaveLength(0)
    expect(result.routedManual).toBe(1)
    expect(result.proposals[0].skipReason).toBe('fact_contradiction_detected')
  })

  it('dry run: produces a proposal but never calls apply with dryRun:false, never writes seo_meta_log', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    let insertCalled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => { insertCalled = true }) as any
    const applySpy = vi.fn(async ({ dryRun, newTitle, newDesc }: { dryRun: boolean; newTitle: string; newDesc: string }) => ({
      applied: false, newTitle, newDesc, oldTitle: 'Old Title', oldDesc: 'Old desc', skipReason: 'dry_run',
    }))
    const adapter: ApplyAdapter = { channel: 'pr', canEditSlug: async () => true, apply: applySpy }
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W38', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, true)

    expect(insertCalled).toBe(false)
    expect(result.applied).toHaveLength(0)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].newTitle).toBe('New Title')
    // 2026-10-28: a read of the current text before generating + the preview after — both dry runs;
    // a dry run must never call apply for real.
    expect(applySpy).toHaveBeenCalledTimes(2)
    expect(applySpy.mock.calls.every(([arg]) => arg.dryRun === true)).toBe(true)
  })
})

// ── Rank-verification baseline (2026-10-04) ───────────────────────────────────
// The T+14 page-CTR check was replaced by a target-keyword rank check. Its baseline can
// only be recorded at apply time, so this is where it must reach seo_meta_log.

describe('runStep4Applied — target-keyword rank baseline', () => {
  it('records the baseline rank, status, depth and fetch time on the seo_meta_log insert, taken with the page\'s own keyword/domain/country', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    mockFetchRank.mockClear()
    const captured: InsertedRow[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase((row) => { captured.push(row) }) as any
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    const result = await runStep4Applied(supabase, fakeAdapter({ applied: true }), CONFIG, '2026-W41', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, false)

    expect(captured[0]).toMatchObject({ baseline_rank_group: 8, baseline_rank_status: 'ranked', baseline_serp_depth: 30, baseline_serp_fetched_at: '2026-10-05T05:31:00.000Z' })
    expect(mockFetchRank).toHaveBeenCalledWith({ keyword: 'foo keyword', countryCode: 'nz', domain: 'example.com', targetUrl: 'https://example.com/foo' })
    expect(result.proposals[0]).toMatchObject({ baselineRankStatus: 'ranked', baselineRankGroup: 8 })
  })

  it('a failed baseline read does not block the change — it is stored as fetch_failed with a NULL rank (never 0 / 101)', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    mockFetchRank.mockResolvedValueOnce({ ...BASELINE_READING, status: 'fetch_failed' as never, rankGroup: null as never, url: null as never })
    const captured: InsertedRow[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase((row) => { captured.push(row) }) as any
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    const result = await runStep4Applied(supabase, fakeAdapter({ applied: true }), CONFIG, '2026-W41', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, false)

    expect(result.applied).toHaveLength(1)
    expect(captured[0].baseline_rank_status).toBe('fetch_failed')
    expect(captured[0].baseline_rank_group).toBeNull()
  })

  it('spends nothing on a dry run, and nothing when the fact check already blocked the change', async () => {
    const { runStep4Applied } = await import('../runner')
    mockFetchRank.mockClear()
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => undefined) as any

    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    await runStep4Applied(supabase, fakeAdapter({ applied: false, skipReason: 'dry_run' }), CONFIG, '2026-W41', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, true)
    mockCheckFactPreservation.mockResolvedValue({ consistent: false, reason: 'contradiction' })
    await runStep4Applied(supabase, fakeAdapter({ applied: true }), CONFIG, '2026-W41', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, false)

    expect(mockFetchRank).not.toHaveBeenCalled()
  })

  it('a change that went live but could not be logged is reported loudly, not as a clean apply (the cooldown and verification would silently lose it)', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'ok' })
    const supabase = {
      from: () => ({ insert: async () => ({ error: { message: 'column "baseline_rank_status" does not exist' } }) }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    const result = await runStep4Applied(supabase, fakeAdapter({ applied: true }), CONFIG, '2026-W41', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, false)

    expect(result.proposals[0].skipReason).toBe('applied_but_log_insert_failed')
    expect(result.routedManual).toBe(1)
  })
})

describe('runStep1CheckDue — legacy page-CTR check is OFF by default during the rank shadow period', () => {
  const adapter = fakeAdapter({ applied: true })

  it('does not even query seo_meta_log, writes no checked_at/outcome, and raises no Revert card', async () => {
    const { runStep1CheckDue } = await import('../runner')
    const supabase = { from: () => { throw new Error('step 1 must not touch the database while the legacy check is off') } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runStep1CheckDue(supabase as any, adapter, CONFIG, '2026-W41', false)
    expect(result).toEqual({ checked: 0, improved: 0, flat: 0, insufficientData: 0, regressed: 0, routedToManual: 0 })
  })

  it('can still be switched on deliberately', async () => {
    const { runStep1CheckDue } = await import('../runner')
    const query = vi.fn()
    const chain = { select: () => chain, eq: () => chain, is: () => chain, lte: () => chain, order: () => chain, limit: () => { query(); return Promise.resolve({ data: [], error: null }) } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runStep1CheckDue({ from: () => chain } as any, adapter, CONFIG, '2026-W41', false, new Date(), { legacyCtrCheck: true })
    expect(query).toHaveBeenCalledTimes(1)
  })
})

// ── Hard, non-AI fact-preservation rule (PM 2026-09-23 incident follow-up) ──
// Real incident this covers: 2026-09-23 CTS dry run, /china-tours — Jev
// scored the rewrite "no contradiction" (0.17) even though the new copy
// silently dropped the departure city Christchurch, the price $6,188, the
// date 22 Dec 2026, and the TAANZ accreditation. The hard rule must catch
// this on its own, WITHOUT depending on the AI judge agreeing, and it must
// not fire on an ordinary reword that keeps every concrete fact.

describe('runStep4Applied — hard fact-preservation rule runs before the AI judge', () => {
  it('blocks and never calls the AI judge when the new copy drops the old copy\'s price/date/city/accreditation (the real /china-tours incident shape)', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockClear() // earlier tests in this file call it too; only THIS test's calls matter here
    let seoMetaLogInsertCount = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => { seoMetaLogInsertCount += 1 }) as any
    const adapter = fakeAdapter(
      { applied: true },
      { title: 'China Tours from New Zealand | CTS', desc: 'Auckland & Christchurch departures, from $6,188pp, 22 Dec 2026. TAANZ accredited, backed by our 1928 parent company.' },
    )
    const generateMeta = vi.fn().mockResolvedValue({
      title: 'China Tours from Auckland | CTS',
      desc: 'Discover authentic China tours with expert local guides. Book your trip with CTS today.',
    })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W39', [{ candidate: candidate({ slug: 'china-tours' }), evidence: EVIDENCE }], generateMeta, false)

    expect(mockCheckFactPreservation).not.toHaveBeenCalled()
    expect(seoMetaLogInsertCount).toBe(0) // never written as a live change
    expect(result.applied).toHaveLength(0)
    expect(result.routedManual).toBe(1)
    expect(result.proposals[0].skipReason).toBe('fact_contradiction_detected')
    expect(result.proposals[0].factCheckReason).toContain('hard rule')
    expect(result.proposals[0].factCheckReason).toContain('Christchurch')
    expect(result.proposals[0].factCheckReason).toContain('$6,188')
    expect(result.proposals[0].factCheckReason).toContain('TAANZ')
  })

  it('passes a benign reword that keeps every price/date/city/accreditation and still reaches the AI judge', async () => {
    const { runStep4Applied } = await import('../runner')
    mockCheckFactPreservation.mockReset()
    mockCheckFactPreservation.mockResolvedValue({ consistent: true, reason: 'no contradiction (score 0.10)' })
    const captured: InsertedRow[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase((row) => { captured.push(row) }) as any
    const adapter = fakeAdapter(
      { applied: true },
      { title: 'Leshan Giant Buddha Day Trip Guide', desc: 'Everything you need to know about visiting the Leshan Giant Buddha near Chengdu.' },
    )
    const generateMeta = vi.fn().mockResolvedValue({
      title: 'Leshan Giant Buddha Day Trip: Complete 2026 Guide',
      desc: 'Plan your Leshan Giant Buddha visit near Chengdu with this complete guide.',
    })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W39', [{ candidate: candidate({ slug: 'leshan-giant-buddha-guide' }), evidence: EVIDENCE }], generateMeta, false)

    expect(mockCheckFactPreservation).toHaveBeenCalledTimes(1)
    expect(result.applied).toHaveLength(1)
    expect(captured).toHaveLength(1)
  })
})
