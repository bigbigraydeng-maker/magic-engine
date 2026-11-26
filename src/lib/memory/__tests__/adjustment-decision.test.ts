import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PromoAdjustmentRecord } from '@/lib/marketing-plan/types'
import {
  recheckResultToVerdict,
  recordAdjustmentOutcome,
  saveAdjustmentDecision,
} from '../adjustment-decision'
import { makeFakeSupabase, type FakeDb } from './fake-supabase'

const CLIENT = 'client-a'
const PLAN = 'plan-p'

function record(overrides: Partial<PromoAdjustmentRecord> = {}): PromoAdjustmentRecord {
  return {
    id: 'adj-1',
    v: 1,
    window: { start: '2026-11-02', end: '2026-11-08' },
    goal_id: 'goal-1',
    trigger: {
      watch_codes: ['reconcile_deviation'],
      rows: [{ key: 'results_goal', status: 'behind', planned: 6, actual: 2, unit: '', reason: 'x', as_of: null }],
      check_evidence: null,
      experiment_hit: null,
    },
    suggested_decision: 'revise_prescription',
    suggestion_reasons: ['数据齐全'],
    decision: 'revise_prescription',
    override_reason: null,
    note: '',
    status: 'confirmed',
    proposed_by: 'system:promo-adjust',
    proposed_at: '2026-11-09T19:00:00Z',
    confirmed_by: 'fde@example.com',
    confirmed_at: '2026-11-09T21:10:00Z',
    recheck_due: '2026-11-15',
    recheck: null,
    ...overrides,
  }
}

const emptyDb = (): FakeDb => ({ client_decision_history: [] })

describe('saveAdjustmentDecision', () => {
  it('writes one row carrying the source pointer and the other three decisions as rejected', async () => {
    const db = emptyDb()
    const row = await saveAdjustmentDecision(makeFakeSupabase(db), CLIENT, record(), PLAN)

    expect(db.client_decision_history).toHaveLength(1)
    expect(row?.source_kind).toBe('promo_adjustment')
    expect(row?.source_ref).toEqual({
      plan_id: PLAN, adjustment_id: 'adj-1', goal_id: 'goal-1', window_start: '2026-11-02',
    })
    expect(row?.chosen_action).toBe('改处方')
    expect(row?.alternatives_rejected).toEqual(['补数据', '补执行', '继续'])
  })

  it('T17: writing the same adjustment twice leaves one row', async () => {
    const db = emptyDb()
    const supabase = makeFakeSupabase(db)
    const first = await saveAdjustmentDecision(supabase, CLIENT, record(), PLAN)
    const second = await saveAdjustmentDecision(supabase, CLIENT, record(), PLAN)

    expect(db.client_decision_history).toHaveLength(1)
    expect(second?.id).toBe(first?.id)
  })

  it('T17: a unique-index collision (23505) reads back the existing row', async () => {
    const existing = {
      id: 'dh-1', client_id: CLIENT, source_kind: 'promo_adjustment', goal_id: 'goal-1',
      source_ref: { adjustment_id: 'adj-1' },
    }
    let selects = 0
    const supabase = {
      from: () => {
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq']) b[m] = () => b
        b.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'dup' } }) }) })
        b.then = (resolve: (r: unknown) => void) => {
          selects++
          // 1st read (pre-check) misses, the read after the collision hits.
          resolve({ data: selects === 1 ? [] : [existing], error: null })
        }
        return b
      },
    } as unknown as SupabaseClient

    const row = await saveAdjustmentDecision(supabase, CLIENT, record(), PLAN)
    expect(row?.id).toBe('dh-1')
  })

  it('does not write for an unconfirmed record', async () => {
    const db = emptyDb()
    const row = await saveAdjustmentDecision(makeFakeSupabase(db), CLIENT, record({ decision: null, status: 'proposed' }), PLAN)

    expect(row).toBeNull()
    expect(db.client_decision_history).toHaveLength(0)
  })

  it('records the override reason in the reasoning', async () => {
    const row = await saveAdjustmentDecision(
      makeFakeSupabase(emptyDb()), CLIENT,
      record({ decision: 'continue', override_reason: '本周有节假日' }), PLAN,
    )
    expect(row?.reasoning).toContain('人工改判：本周有节假日')
  })

  it('a different adjustment on the same goal gets its own row', async () => {
    const db = emptyDb()
    const supabase = makeFakeSupabase(db)
    await saveAdjustmentDecision(supabase, CLIENT, record(), PLAN)
    await saveAdjustmentDecision(supabase, CLIENT, record({ id: 'adj-2' }), PLAN)

    expect(db.client_decision_history).toHaveLength(2)
  })
})

describe('recheck outcome mapping', () => {
  it('T18: improved→success, worse→failure, no_change/unknown→inconclusive', () => {
    expect(recheckResultToVerdict('improved')).toBe('success')
    expect(recheckResultToVerdict('worse')).toBe('failure')
    expect(recheckResultToVerdict('no_change')).toBe('inconclusive')
    expect(recheckResultToVerdict('unknown')).toBe('inconclusive')
  })

  it('T18: writes the verdict and a note onto the memory row', async () => {
    const db = emptyDb()
    const supabase = makeFakeSupabase(db)
    const row = await saveAdjustmentDecision(supabase, CLIENT, record(), PLAN)

    const verdict = await recordAdjustmentOutcome(supabase, row!.id, {
      at: '2026-11-16T01:00:00Z', result: 'worse', rows: record().trigger.rows,
    })

    expect(verdict).toBe('failure')
    expect(db.client_decision_history[0].outcome_verdict).toBe('failure')
    expect(String(db.client_decision_history[0].outcome_notes)).toContain('2026-11-16')
  })
})

describe('T19: client-private only', () => {
  it('never touches global_learned_lessons', async () => {
    const db: FakeDb = { client_decision_history: [], global_learned_lessons: [] }
    const supabase = makeFakeSupabase(db)
    const spy = vi.spyOn(supabase, 'from')

    const row = await saveAdjustmentDecision(supabase, CLIENT, record(), PLAN)
    await recordAdjustmentOutcome(supabase, row!.id, { at: '2026-11-16T01:00:00Z', result: 'improved', rows: [] })

    expect(spy.mock.calls.every(([t]) => t === 'client_decision_history')).toBe(true)
    expect(db.global_learned_lessons).toHaveLength(0)
  })
})
