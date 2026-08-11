/**
 * Which outcome the execution board shows for an action — Issue #859, round 26.
 *
 * The board used to take the first row by `computed_at` desc. That was never a
 * real choice: the three `seo.gsc.*` rows land in one upsert and share a
 * timestamp, so it picked among them by row order. Once
 * ATTRIBUTION_DUAL_WINDOW_ENABLED is on it gets actively wrong — the bridge
 * writes the cadence window first and the handoff window second, so the board
 * would show whichever window was written last rather than the action's answer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

let rows: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.in = () => q
      q.order = () => q
      // 分页读全之后 .range() 才是终点；停在 .order() 的桩会让分页修复测不出来。
      q.range = async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null })
      return q
    },
  },
}))

import { fetchLatestOutcomesByAction } from '../execution-outcomes'

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: 'a1',
    metric_key: 'seo.gsc.clicks',
    window_days: 28,
    delta: 10,
    delta_pct: 10,
    confidence: 0.5,
    verdict: 'confirmed',
    computed_at: '2026-08-01T00:00:00.000Z',
    flywheel_actions: { expected_metric: 'seo.gsc.clicks' },
    ...over,
  }
}

beforeEach(() => {
  rows = []
})

describe('fetchLatestOutcomesByAction', () => {
  it('returns nothing for no actions, without querying', async () => {
    expect(await fetchLatestOutcomesByAction([])).toEqual({})
  })

  it('shows the metric the action actually promised, not whichever row came back first', async () => {
    // All three share a computed_at, because they land in one upsert.
    rows = [
      row({ metric_key: 'seo.gsc.avg_position', verdict: 'reversed' }),
      row({ metric_key: 'seo.gsc.impressions', verdict: 'reversed' }),
      row({ metric_key: 'seo.gsc.clicks', verdict: 'confirmed' }),
    ]

    const byAction = await fetchLatestOutcomesByAction(['a1'])

    expect(byAction.a1.metric_key).toBe('seo.gsc.clicks')
    expect(byAction.a1.verdict).toBe('confirmed')
  })

  it('shows the mature window, not the one written last', async () => {
    // What dual-window produces: cadence window written first, handoff second.
    // Taking the last row would report the 14-day answer as the action's.
    rows = [
      row({ window_days: 28, verdict: 'confirmed', computed_at: '2026-08-01T00:00:00.000Z' }),
      row({ window_days: 14, verdict: 'reversed', computed_at: '2026-08-01T00:00:01.000Z' }),
    ]

    const byAction = await fetchLatestOutcomesByAction(['a1'])

    expect(byAction.a1.verdict).toBe('confirmed')
  })

  it('gives each action its own row', async () => {
    rows = [
      row({ action_id: 'a1', verdict: 'confirmed' }),
      row({ action_id: 'a2', verdict: 'reversed' }),
    ]

    const byAction = await fetchLatestOutcomesByAction(['a1', 'a2'])

    expect(byAction.a1.verdict).toBe('confirmed')
    expect(byAction.a2.verdict).toBe('reversed')
  })

  it('still answers when the action promised a metric nobody produced', async () => {
    // No row matches expected_metric — the fold falls back to the most mature
    // window rather than dropping the action off the board entirely.
    rows = [
      row({ metric_key: 'seo.gsc.impressions', window_days: 14, verdict: 'reversed' }),
      row({ metric_key: 'seo.gsc.impressions', window_days: 28, verdict: 'confirmed' }),
    ]
    rows = rows.map(r => ({ ...r, flywheel_actions: { expected_metric: 'seo.gsc.page_clicks' } }))

    const byAction = await fetchLatestOutcomesByAction(['a1'])

    expect(byAction.a1).toBeDefined()
    expect(byAction.a1.verdict).toBe('confirmed')
  })

  it('still answers for an action whose rows sit past the 1000-row cap', async () => {
    // Newest-first ordering meant the OLDEST actions were the ones truncated
    // away, and the board showed them as never attributed at all.
    // (Codex P2, round 29.)
    rows = [
      ...Array.from({ length: 1000 }, (_, i) => row({ action_id: `n${i}` })),
      row({ action_id: 'old', verdict: 'reversed' }),
    ]

    const byAction = await fetchLatestOutcomesByAction(['old'])

    expect(byAction.old).toBeDefined()
    expect(byAction.old.verdict).toBe('reversed')
  })
})
