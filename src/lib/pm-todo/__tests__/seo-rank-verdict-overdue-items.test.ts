import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  VERDICT_OVERDUE_DAYS,
  RANK_BASELINE_SINCE,
  classifyRankVerdictGap,
  buildRankVerdictGapItems,
  pushRankVerdictGapItems,
  type MetaLogRowLite,
} from '../seo-rank-verdict-overdue-items'

const NOW = new Date('2026-11-01T00:00:00.000Z')

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function row(overrides: Partial<MetaLogRowLite> = {}): MetaLogRowLite {
  return {
    client_id: 'c1',
    page_slug: 'home',
    page_url: 'https://example.com/',
    optimised_at: daysBefore(NOW, 40),
    pr_url: 'https://github.com/x/y/pull/1',
    reverted_at: null,
    baseline_rank_status: 'captured',
    rank_verdict: null,
    ...overrides,
  }
}

describe('classifyRankVerdictGap', () => {
  it('flags overdue at 36 days', () => {
    expect(classifyRankVerdictGap(row({ optimised_at: daysBefore(NOW, 36) }), NOW)).toBe('overdue')
  })

  it('does not flag at 34 days', () => {
    expect(classifyRankVerdictGap(row({ optimised_at: daysBefore(NOW, 34) }), NOW)).toBeNull()
  })

  it('does not flag when a verdict exists', () => {
    expect(
      classifyRankVerdictGap(row({ optimised_at: daysBefore(NOW, 40), rank_verdict: 'improved' }), NOW),
    ).toBeNull()
  })

  it('does not flag when reverted', () => {
    expect(
      classifyRankVerdictGap(row({ optimised_at: daysBefore(NOW, 40), reverted_at: '2026-10-20T00:00:00Z' }), NOW),
    ).toBeNull()
  })

  it('does not flag when pr_url is null', () => {
    expect(classifyRankVerdictGap(row({ pr_url: null }), NOW)).toBeNull()
  })

  it('does not flag a missing baseline before RANK_BASELINE_SINCE', () => {
    const before = new Date(Date.parse(RANK_BASELINE_SINCE) - 24 * 60 * 60 * 1000).toISOString()
    expect(
      classifyRankVerdictGap(row({ baseline_rank_status: null, optimised_at: before }), NOW),
    ).toBeNull()
  })

  it('flags no_baseline after RANK_BASELINE_SINCE', () => {
    const after = new Date(Date.parse(RANK_BASELINE_SINCE) + 24 * 60 * 60 * 1000).toISOString()
    expect(
      classifyRankVerdictGap(row({ baseline_rank_status: null, optimised_at: after }), NOW),
    ).toBe('no_baseline')
  })

  it('does not flag no_baseline when a verdict somehow exists', () => {
    const after = new Date(Date.parse(RANK_BASELINE_SINCE) + 24 * 60 * 60 * 1000).toISOString()
    expect(
      classifyRankVerdictGap(
        row({ baseline_rank_status: null, optimised_at: after, rank_verdict: 'improved' }),
        NOW,
      ),
    ).toBeNull()
  })
})

describe('buildRankVerdictGapItems', () => {
  const nameOf = (id: string): string => (id === 'c1' ? 'Acme' : id === 'c2' ? 'Beta' : id)

  it('groups per client and kind with counts and at most 3 slugs', () => {
    const rows: MetaLogRowLite[] = [
      row({ client_id: 'c1', page_slug: 'a', optimised_at: daysBefore(NOW, 40) }),
      row({ client_id: 'c1', page_slug: 'b', optimised_at: daysBefore(NOW, 40) }),
      row({ client_id: 'c1', page_slug: 'c', optimised_at: daysBefore(NOW, 40) }),
      row({ client_id: 'c1', page_slug: 'd', optimised_at: daysBefore(NOW, 40) }),
      row({
        client_id: 'c1',
        page_slug: 'e',
        baseline_rank_status: null,
        optimised_at: new Date(Date.parse(RANK_BASELINE_SINCE) + 24 * 60 * 60 * 1000).toISOString(),
      }),
      row({ client_id: 'c2', page_slug: 'x', optimised_at: daysBefore(NOW, 40) }),
    ]
    const items = buildRankVerdictGapItems(rows, NOW, nameOf)

    expect(items).toHaveLength(3)

    const overdueC1 = items.find((i) => i.client_id === 'c1' && i.kind === 'seo_rank_verdict_overdue')
    expect(overdueC1).toBeDefined()
    expect(overdueC1!.what).toContain('Acme')
    expect(overdueC1!.what).toContain('4 条')
    expect(overdueC1!.what).toContain('a、b、c')
    expect(overdueC1!.what).not.toContain('d')
    expect(overdueC1!.what).toContain(String(VERDICT_OVERDUE_DAYS))
    expect(overdueC1!.how).toContain('欠账')
    expect(overdueC1!.href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/seo-intelligence')

    const noBaselineC1 = items.find((i) => i.client_id === 'c1' && i.kind === 'seo_rank_baseline_missing')
    expect(noBaselineC1).toBeDefined()
    expect(noBaselineC1!.what).toContain('1 条')
    expect(noBaselineC1!.what).toContain('永远判不了效果')

    const overdueC2 = items.find((i) => i.client_id === 'c2' && i.kind === 'seo_rank_verdict_overdue')
    expect(overdueC2).toBeDefined()
    expect(overdueC2!.what).toContain('Beta')
  })

  it('produces nothing for rows that are not gaps', () => {
    const rows: MetaLogRowLite[] = [
      row({ optimised_at: daysBefore(NOW, 10) }),
      row({ optimised_at: daysBefore(NOW, 40), rank_verdict: 'improved' }),
      row({ optimised_at: daysBefore(NOW, 40), reverted_at: '2026-10-20T00:00:00Z' }),
      row({ pr_url: null }),
    ]
    expect(buildRankVerdictGapItems(rows, NOW, nameOf)).toEqual([])
  })
})

describe('pushRankVerdictGapItems', () => {
  function fakeSupabase(result: { data: unknown; error: { message: string } | null }) {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const chain = {
      select: (...args: unknown[]) => (calls.push({ method: 'select', args }), chain),
      not: (...args: unknown[]) => (calls.push({ method: 'not', args }), chain),
      is: (...args: unknown[]) => (calls.push({ method: 'is', args }), chain),
      order: (...args: unknown[]) => (calls.push({ method: 'order', args }), chain),
      limit: (...args: unknown[]) => (calls.push({ method: 'limit', args }), chain),
      then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    const supabase = { from: (table: string) => (calls.push({ method: 'from', args: [table] }), chain) }
    return { supabase: supabase as unknown as SupabaseClient, calls }
  }

  const nameOf = (id: string): string => id

  it('queries seo_meta_log with the expected filters and pushes items', async () => {
    const { supabase, calls } = fakeSupabase({
      data: [row({ client_id: 'c1', page_slug: 'home', optimised_at: daysBefore(NOW, 40) })],
      error: null,
    })
    const items: unknown[] = []
    await pushRankVerdictGapItems(supabase, items as never, NOW, nameOf)

    expect(calls[0]).toEqual({ method: 'from', args: ['seo_meta_log'] })
    expect(calls.find((c) => c.method === 'not')).toEqual({ method: 'not', args: ['pr_url', 'is', null] })
    const isCalls = calls.filter((c) => c.method === 'is')
    expect(isCalls).toEqual([
      { method: 'is', args: ['reverted_at', null] },
      { method: 'is', args: ['rank_verdict', null] },
    ])
    expect(calls.find((c) => c.method === 'order')).toEqual({
      method: 'order',
      args: ['optimised_at', { ascending: true }],
    })
    expect(calls.find((c) => c.method === 'limit')).toEqual({ method: 'limit', args: [500] })

    expect(items).toHaveLength(1)
    const item = items[0] as { kind: string; client_id: string }
    expect(item.kind).toBe('seo_rank_verdict_overdue')
    expect(item.client_id).toBe('c1')
  })

  it('throws when the query errors', async () => {
    const { supabase } = fakeSupabase({ data: null, error: { message: 'boom' } })
    const items: unknown[] = []
    await expect(pushRankVerdictGapItems(supabase, items as never, NOW, nameOf)).rejects.toThrow(
      'seo_meta_log query failed: boom',
    )
    expect(items).toEqual([])
  })
})
