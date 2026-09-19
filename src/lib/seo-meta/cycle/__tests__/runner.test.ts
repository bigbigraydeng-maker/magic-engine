import { describe, expect, it, vi } from 'vitest'
import { runStep4Applied } from '../runner'
import type { ApplyAdapter, MetaCyclePrescription } from '../types'
import type { MetaCycleClientConfig } from '../types'

const CONFIG: MetaCycleClientConfig = {
  clientId: 'client-1',
  domain: 'example.com',
  semrushDb: 'nz',
  maxPagesPerRun: 3,
  cooldownDays: 30,
  brandVoice: 'factual AU/NZ English',
}

function prescription(overrides: Partial<MetaCyclePrescription['candidate']> = {}): MetaCyclePrescription {
  return {
    candidate: {
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
    },
    actionType: 'title_rewrite',
    auto: true,
    reason: 'test',
  }
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

function fakeAdapter(applied: boolean): ApplyAdapter {
  return {
    channel: 'pr',
    apply: async () => ({
      applied,
      prUrl: 'https://github.com/x/y/pull/1',
      prNumber: 1,
      branch: 'feat/x',
      newTitle: 'New Title',
      newDesc: 'New desc',
      oldTitle: 'Old Title',
      oldDesc: 'Old desc',
      skipReason: applied ? undefined : 'pr_opened_but_not_merged',
    }),
  }
}

describe('runStep4Applied — baseline_ctr reaches the seo_meta_log insert (fixed bug: it was never populated, permanently breaking the Check step)', () => {
  it('writes candidate.ctr into the insert row as baseline_ctr, not null', async () => {
    const captured: InsertedRow[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase((row) => { captured.push(row) }) as any
    const adapter = fakeAdapter(true)
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    await runStep4Applied(supabase, adapter, CONFIG, '2026-W38', [prescription({ ctr: 0.034 })], generateMeta, 2554, false)

    expect(captured).toHaveLength(1)
    expect(captured[0].baseline_ctr).toBe(0.034)
  })

  it('does NOT write a seo_meta_log row at all when the PR opened but did not merge (fixed bug: this used to be logged as applied)', async () => {
    let insertCalled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = fakeSupabase(() => { insertCalled = true }) as any
    const adapter = fakeAdapter(false)
    const generateMeta = vi.fn().mockResolvedValue({ title: 'New Title', desc: 'New desc' })

    const result = await runStep4Applied(supabase, adapter, CONFIG, '2026-W38', [prescription()], generateMeta, 2554, false)

    expect(insertCalled).toBe(false)
    expect(result.applied).toHaveLength(0)
    expect(result.routedManual).toBe(1)
  })
})
