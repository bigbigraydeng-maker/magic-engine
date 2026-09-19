import { describe, expect, it, vi } from 'vitest'
import type { ApplyAdapter, ApplyAdapterResult, MetaCycleCandidate, MetaCycleClientConfig, MetaCycleGateEvidence } from '../types'

const mockCheckFactPreservation = vi.fn()
vi.mock('../fact-check', () => ({
  checkFactPreservation: (...args: unknown[]) => mockCheckFactPreservation(...args),
}))

const CONFIG: MetaCycleClientConfig = {
  clientId: 'client-1',
  domain: 'example.com',
  semrushDb: 'nz',
  maxPagesPerRun: 3,
  cooldownDays: 30,
  brandVoice: 'factual AU/NZ English',
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
  competitorTitles: ['Competitor A'],
  ctsRankingUrl: 'https://example.com/foo',
  chosenReason: 'test evidence',
}

interface InsertedRow {
  baseline_ctr: number | null
  baseline_position: number | null
  baseline_impressions: number | null
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
function fakeAdapter(realApplyResult: { applied: boolean; skipReason?: string }): ApplyAdapter {
  return {
    channel: 'pr',
    apply: async ({ dryRun, newTitle, newDesc }): Promise<ApplyAdapterResult> => {
      if (dryRun) {
        return { applied: false, newTitle, newDesc, oldTitle: 'Old Title', oldDesc: 'Old desc', skipReason: 'dry_run' }
      }
      return {
        applied: realApplyResult.applied,
        prUrl: 'https://github.com/x/y/pull/1',
        prNumber: 1,
        branch: 'feat/x',
        newTitle, newDesc, oldTitle: 'Old Title', oldDesc: 'Old desc',
        skipReason: realApplyResult.skipReason,
      }
    },
  }
}

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
    const adapter: ApplyAdapter = { channel: 'pr', apply: applySpy }
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W38', [{ candidate: candidate(), evidence: EVIDENCE }], generateMeta, true)

    expect(insertCalled).toBe(false)
    expect(result.applied).toHaveLength(0)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].newTitle).toBe('New Title')
    expect(applySpy).toHaveBeenCalledTimes(1) // only the preview call — dry run never calls apply again for real
  })
})
