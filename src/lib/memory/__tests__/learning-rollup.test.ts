/**
 * Unit tests for DAPE W3 weekly learning rollup.
 *
 * We use an in-memory Supabase mock that supports the chained methods the
 * rollup actually calls: from(...).select(...).gte(...).lt(...).eq(...).limit(...)
 * + insert(...).select(...).single().
 *
 * The mock returns canned datasets for each table; we only model the columns
 * the SUT touches, not the full schema.
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeWeekWindow,
  formatIsoWeek,
  runWeeklyLearningRollup,
} from '../learning-rollup'

// ─── Mock Supabase ──────────────────────────────────────────────────────────

interface MockState {
  outcomes: Array<{
    client_id: string
    verdict: string
    computed_at: string
    // 折叠用的自然键 —— 省略时该行按孤儿处理（各算一个案例），
    // 保留旧用例原本的行为。
    action_id?: string
    metric_key?: string
    window_days?: number
    flywheel_actions?: { expected_metric?: string | null } | null
  }>
  feedback: Array<{ client_id: string; feedback_state: string; created_at: string }>
  existingPreferences: Array<{
    client_id: string
    source: string
    extracted_from_table: string
    extracted_from_id: string
  }>
  insertedPreferences: Array<Record<string, unknown>>
}

function makeMockSupabase(state: MockState): SupabaseClient {
  function makeQuery(table: string) {
    const filters: Record<string, unknown> = {}
    const rangeFilters: Array<{ op: 'gte' | 'lt'; col: string; val: unknown }> = []

    const builder: Record<string, unknown> = {
      select() { return builder },
      eq(col: string, val: unknown) { filters[col] = val; return builder },
      gte(col: string, val: unknown) { rangeFilters.push({ op: 'gte', col, val }); return builder },
      lt(col: string, val: unknown) { rangeFilters.push({ op: 'lt', col, val }); return builder },
      limit() { return builder },
      then(resolve: (r: { data: unknown[]; error: null }) => void) {
        const rows = pickRows(table, state, filters, rangeFilters)
        resolve({ data: rows, error: null })
      },
    }
    return builder
  }

  return {
    from(table: string) {
      // Insert path (for savePreference)
      return {
        ...makeQuery(table),
        insert(payload: Record<string, unknown>) {
          state.insertedPreferences.push({ table, payload })
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: { id: `mock-${state.insertedPreferences.length}`, ...payload },
                    error: null,
                  })
                },
              }
            },
          }
        },
      }
    },
  } as unknown as SupabaseClient
}

function pickRows(
  table: string,
  state: MockState,
  eqFilters: Record<string, unknown>,
  rangeFilters: Array<{ op: 'gte' | 'lt'; col: string; val: unknown }>,
): unknown[] {
  let rows: Array<Record<string, unknown>> = []
  if (table === 'flywheel_outcomes') rows = state.outcomes as unknown as Array<Record<string, unknown>>
  else if (table === 'zhuge_feedback_events') rows = state.feedback as unknown as Array<Record<string, unknown>>
  else if (table === 'client_learned_preferences') rows = state.existingPreferences as unknown as Array<Record<string, unknown>>

  for (const [col, val] of Object.entries(eqFilters)) {
    rows = rows.filter(r => r[col] === val)
  }
  for (const f of rangeFilters) {
    rows = rows.filter(r => {
      const v = r[f.col] as string | undefined
      if (typeof v !== 'string') return false
      if (f.op === 'gte') return v >= (f.val as string)
      return v < (f.val as string)
    })
  }
  return rows
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('formatIsoWeek', () => {
  it('returns YYYY-Www for a known Monday in mid-year', () => {
    // 2026-06-01 is a Monday → ISO week 23
    expect(formatIsoWeek(new Date('2026-06-01T00:00:00Z'))).toBe('2026-W23')
  })

  it('handles year boundary (Jan 1 = same as previous year ISO week)', () => {
    // 2027-01-01 is a Friday → ISO week 53 of 2026
    expect(formatIsoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53')
  })
})

describe('computeWeekWindow', () => {
  it('window is exactly 7 days', () => {
    const { weekStart, weekEnd } = computeWeekWindow(new Date('2026-06-08T07:00:00Z'))
    const diffMs = weekEnd.getTime() - weekStart.getTime()
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('weekEnd is a Monday 00:00 UTC', () => {
    const { weekEnd } = computeWeekWindow(new Date('2026-06-08T07:00:00Z'))
    expect(weekEnd.getUTCDay()).toBe(1) // Mon=1
    expect(weekEnd.getUTCHours()).toBe(0)
  })

  it('weekStart is the Monday one week before weekEnd', () => {
    const { weekStart, weekEnd } = computeWeekWindow(new Date('2026-06-08T07:00:00Z'))
    expect(weekStart.getUTCDay()).toBe(1)
    expect(weekEnd.getUTCDate() - weekStart.getUTCDate()).toBe(7)
  })

  it('isoWeek matches weekStart year-week', () => {
    // 2026-06-08 is Mon W24; previous Mon is 2026-06-01 → W23
    const { isoWeek } = computeWeekWindow(new Date('2026-06-08T07:00:00Z'))
    expect(isoWeek).toBe('2026-W23')
  })
})

describe('runWeeklyLearningRollup', () => {
  const now = new Date('2026-06-08T07:00:00Z') // Mon W24 → summarises W23

  it('writes one preference per client with signal', async () => {
    const state: MockState = {
      outcomes: [
        // client A: 2 confirmed in window
        { client_id: 'client-a', verdict: 'confirmed', computed_at: '2026-06-02T00:00:00Z' },
        { client_id: 'client-a', verdict: 'confirmed', computed_at: '2026-06-03T00:00:00Z' },
        // client B: 1 reversed in window
        { client_id: 'client-b', verdict: 'reversed',  computed_at: '2026-06-04T00:00:00Z' },
      ],
      feedback: [
        { client_id: 'client-a', feedback_state: 'done', created_at: '2026-06-05T00:00:00Z' },
      ],
      existingPreferences: [],
      insertedPreferences: [],
    }

    const supabase = makeMockSupabase(state)
    const result = await runWeeklyLearningRollup(supabase, { now })

    expect(result.iso_week).toBe('2026-W23')
    expect(result.clients_processed).toBe(2)
    expect(result.preferences_inserted).toBe(2)
    expect(result.errors).toBe(0)

    // Check the actual saved preference rows
    const inserts = state.insertedPreferences
    expect(inserts).toHaveLength(2)
    for (const i of inserts) {
      const payload = i.payload as Record<string, unknown>
      expect(payload.source).toBe('auto_extracted')
      expect(payload.extracted_from_table).toBe('learning_rollup_weekly')
      expect(payload.preference_type).toBe('other')
      expect(typeof payload.content).toBe('string')
      expect((payload.content as string).startsWith('[2026-W23]')).toBe(true)
    }
  })

  it('is idempotent — a second run for the same week inserts nothing', async () => {
    const state: MockState = {
      outcomes: [
        { client_id: 'client-a', verdict: 'confirmed', computed_at: '2026-06-02T00:00:00Z' },
      ],
      feedback: [],
      existingPreferences: [
        {
          client_id: 'client-a',
          source: 'auto_extracted',
          extracted_from_table: 'learning_rollup_weekly',
          extracted_from_id: '2026-W23::client-a',
        },
      ],
      insertedPreferences: [],
    }

    const supabase = makeMockSupabase(state)
    const result = await runWeeklyLearningRollup(supabase, { now })

    expect(result.clients_processed).toBe(1)
    expect(result.preferences_inserted).toBe(0)
    expect(state.insertedPreferences).toHaveLength(0)
  })

  it('excludes outcomes outside the ISO-week window', async () => {
    const state: MockState = {
      outcomes: [
        // Inside the window (W23: Mon 2026-06-01 → Mon 2026-06-08)
        { client_id: 'client-a', verdict: 'confirmed', computed_at: '2026-06-02T12:00:00Z' },
        // Outside: too old
        { client_id: 'client-a', verdict: 'confirmed', computed_at: '2026-05-15T00:00:00Z' },
        // Outside: at weekEnd boundary (exclusive)
        { client_id: 'client-a', verdict: 'confirmed', computed_at: '2026-06-08T00:00:00Z' },
      ],
      feedback: [],
      existingPreferences: [],
      insertedPreferences: [],
    }

    const supabase = makeMockSupabase(state)
    const result = await runWeeklyLearningRollup(supabase, { now })

    expect(result.results).toHaveLength(1)
    expect(result.results[0].outcomes_confirmed).toBe(1)
  })

  it('emits no preference when both outcomes and feedback are empty', async () => {
    const state: MockState = {
      outcomes: [],
      feedback: [],
      existingPreferences: [],
      insertedPreferences: [],
    }

    const supabase = makeMockSupabase(state)
    const result = await runWeeklyLearningRollup(supabase, { now })

    expect(result.clients_processed).toBe(0)
    expect(result.preferences_inserted).toBe(0)
    expect(state.insertedPreferences).toHaveLength(0)
  })

  it('produces a summary content line that mentions key signal counts', async () => {
    const state: MockState = {
      outcomes: [
        { client_id: 'c1', verdict: 'confirmed', computed_at: '2026-06-02T00:00:00Z' },
        { client_id: 'c1', verdict: 'reversed',  computed_at: '2026-06-03T00:00:00Z' },
        { client_id: 'c1', verdict: 'reversed',  computed_at: '2026-06-04T00:00:00Z' },
      ],
      feedback: [
        { client_id: 'c1', feedback_state: 'dismissed', created_at: '2026-06-02T00:00:00Z' },
        { client_id: 'c1', feedback_state: 'dismissed', created_at: '2026-06-03T00:00:00Z' },
        { client_id: 'c1', feedback_state: 'irrelevant', created_at: '2026-06-04T00:00:00Z' },
      ],
      existingPreferences: [],
      insertedPreferences: [],
    }

    const supabase = makeMockSupabase(state)
    await runWeeklyLearningRollup(supabase, { now })

    expect(state.insertedPreferences).toHaveLength(1)
    const content = (state.insertedPreferences[0].payload as Record<string, unknown>).content as string

    expect(content).toContain('2026-W23')
    expect(content).toContain('confirmed=1')
    expect(content).toContain('reversed=2')
    expect(content).toContain('dismissed=2')
    expect(content).toContain('irrelevant=1')
    expect(content).toContain('FDE 标记 3 条无效建议')
  })
})

describe('周报摘要按动作计数，不按 outcome 行数', () => {
  const now = new Date('2026-06-08T07:00:00Z') // Mon W24 → summarises W23

  /** 一个 GSC 动作一次快照产出的三行 outcome —— 三个读数，一个事件。 */
  function threeReadingsOf(actionId: string, verdict: string) {
    return ['seo.gsc.clicks', 'seo.gsc.impressions', 'seo.gsc.avg_position'].map(metric_key => ({
      client_id: 'c1',
      verdict,
      computed_at: '2026-06-03T00:00:00Z',
      action_id: actionId,
      metric_key,
      window_days: 28,
      flywheel_actions: { expected_metric: 'seo.gsc.clicks' },
    }))
  }

  it('两个动作 × 三行 = confirmed 2，不是 6', async () => {
    const state: MockState = {
      outcomes: [
        ...threeReadingsOf('act-1', 'confirmed'),
        ...threeReadingsOf('act-2', 'confirmed'),
      ],
      feedback: [],
      existingPreferences: [],
      insertedPreferences: [],
    }

    await runWeeklyLearningRollup(makeMockSupabase(state), { now })

    const content = (state.insertedPreferences[0].payload as Record<string, unknown>).content as string
    // 这段摘要下一轮会原样喂给 agent。写成 confirmed=6，等于凭两个动作报出
    // 六次成功 —— 双窗口打开后还会再翻一倍。
    expect(content).toContain('confirmed=2')
    expect(content).not.toContain('confirmed=6')
  })

  it('同一动作既有 confirmed 又有 reversed 时，按它承诺的指标定调', async () => {
    const state: MockState = {
      outcomes: [
        // 承诺的是 clicks —— clicks 跑赢了，只是排名滑了
        { client_id: 'c1', verdict: 'confirmed', computed_at: '2026-06-03T00:00:00Z', action_id: 'act-1', metric_key: 'seo.gsc.clicks',       window_days: 28, flywheel_actions: { expected_metric: 'seo.gsc.clicks' } },
        { client_id: 'c1', verdict: 'reversed',  computed_at: '2026-06-03T00:00:00Z', action_id: 'act-1', metric_key: 'seo.gsc.avg_position', window_days: 28, flywheel_actions: { expected_metric: 'seo.gsc.clicks' } },
      ],
      feedback: [],
      existingPreferences: [],
      insertedPreferences: [],
    }

    await runWeeklyLearningRollup(makeMockSupabase(state), { now })

    const content = (state.insertedPreferences[0].payload as Record<string, unknown>).content as string
    expect(content).toContain('confirmed=1')
    expect(content).toContain('reversed=0')
  })
})
