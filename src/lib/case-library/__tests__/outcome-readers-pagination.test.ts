/**
 * The outcome readers must read EVERY row before they fold — Issue #859, r28.
 *
 * Folding per action fixed the counting; it did not fix the reading. PostgREST
 * caps a response at 1000 rows and reports no error, and truncation here is
 * worse than an undercount: `keepOneCasePerAction` picks a representative from
 * whatever it was handed, so if the row carrying the action's `expected_metric`
 * is the one dropped, the fold reports a DIFFERENT verdict for that action.
 * One action already yields three rows; dual-window doubles that.
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchClientOutcomeHistory,
  fetchOutcomeConfidenceMap,
  fetchSeoBlogConfidenceByMode,
} from '../outcome-confidence'

const PAGE = 1000

/** Range-aware fake: a stub that ignores `.range()` cannot see a paging bug. */
function pagedSupabase(rows: unknown[], seen: Array<[number, number]> = []) {
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.eq = () => q
  q.in = () => q
  q.not = () => q
  q.gte = () => q
  q.order = () => q
  q.range = async (from: number, to: number) => {
    seen.push([from, to])
    return { data: rows.slice(from, to + 1), error: null }
  }
  return { supabase: { from: () => q } as unknown as SupabaseClient, seen }
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'x',
    action_id: 'filler',
    metric_key: 'seo.gsc.clicks',
    window_days: 28,
    verdict: 'confirmed',
    flywheel_actions: { action_type: 'noise.action', expected_metric: 'seo.gsc.clicks' },
    ...over,
  }
}

describe('fetchOutcomeConfidenceMap reads every page', () => {
  it('counts an action whose only rows sit past the first page', async () => {
    const rows = [
      ...Array.from({ length: PAGE }, (_, i) => row({ id: `n${i}`, action_id: `n${i}` })),
      row({
        id: 'late', action_id: 'late',
        verdict: 'reversed',
        flywheel_actions: { action_type: 'late.action', expected_metric: 'seo.gsc.clicks' },
      }),
    ]
    const { supabase, seen } = pagedSupabase(rows)

    const map = await fetchOutcomeConfidenceMap(supabase)

    expect(seen.length).toBeGreaterThan(1)         // asked for a second page
    expect(map['late.action']).toBeDefined()       // and did not lose the action
  })

  it('picks the promised metric even when it is on a later page', async () => {
    // The nastier failure: the action IS counted, but with the wrong verdict,
    // because the row naming its expected_metric was the one truncated away.
    const rows = [
      ...Array.from({ length: PAGE - 1 }, (_, i) => row({ id: `n${i}`, action_id: `n${i}` })),
      // Same action, two metrics; the promised one is last.
      row({
        id: 'a-imp', action_id: 'a1', metric_key: 'seo.gsc.impressions', verdict: 'reversed',
        flywheel_actions: { action_type: 'seo.publish_blog', expected_metric: 'seo.gsc.clicks' },
      }),
      row({
        id: 'a-clicks', action_id: 'a1', metric_key: 'seo.gsc.clicks', verdict: 'confirmed',
        flywheel_actions: { action_type: 'seo.publish_blog', expected_metric: 'seo.gsc.clicks' },
      }),
    ]
    const { supabase } = pagedSupabase(rows)

    const map = await fetchOutcomeConfidenceMap(supabase)

    // Truncated at 1000, only the `impressions` row survives and the action
    // reads as reversed. Read whole, the promised metric wins.
    expect(map['seo.publish_blog']?.successRate).toBe(1)
  })
})

describe('the per-client readers page too', () => {
  it('fetchClientOutcomeHistory keeps an action from page two', async () => {
    const rows = [
      ...Array.from({ length: PAGE }, (_, i) => row({ id: `n${i}`, action_id: `n${i}` })),
      row({
        id: 'late', action_id: 'late', verdict: 'reversed',
        flywheel_actions: { action_type: 'late.action', expected_metric: 'seo.gsc.clicks' },
      }),
    ]
    const { supabase } = pagedSupabase(rows)

    const map = await fetchClientOutcomeHistory(supabase, 'c1')

    expect(map['late.action']).toBeDefined()
  })

  it('fetchSeoBlogConfidenceByMode keeps an action from page two', async () => {
    const blog = (over: Record<string, unknown>) => row({
      flywheel_actions: { action_type: 'seo.publish_blog', payload: { mode: 'unified' }, expected_metric: 'seo.gsc.clicks' },
      ...over,
    })
    const rows = [
      ...Array.from({ length: PAGE }, (_, i) => blog({ id: `n${i}`, action_id: `n${i}` })),
      blog({ id: 'late', action_id: 'late' }),
    ]
    const { supabase } = pagedSupabase(rows)

    const byMode = await fetchSeoBlogConfidenceByMode(supabase, 'c1')

    expect(byMode.unified.sampleSize).toBe(PAGE + 1)
  })
})
