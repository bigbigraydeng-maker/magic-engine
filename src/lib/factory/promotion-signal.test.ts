import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FACTORY_ORDER_BUDGET_CAP_USD } from './constants'

const state = vi.hoisted(() => ({
  insertResult: { data: { id: 'sig-1' } as { id?: string } | null, error: null as { code?: string; message?: string } | null },
  duplicate: { data: null as { id?: string; status?: string; reject_reason?: string | null; work_order_id?: string | null } | null, error: null as { message?: string } | null },
  inserted: [] as unknown[],
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (row: unknown) => {
        state.inserted.push(row)
        return { select: () => ({ single: async () => state.insertResult }) }
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => state.duplicate }),
      }),
    }),
  },
}))

const evaluateSignal = vi.hoisted(() => vi.fn())
vi.mock('./evaluate', () => ({ evaluateSignal }))

import {
  buildPromotionSignalRow,
  campaignNameFromContent,
  emitPromotionSignal,
  promotionDedupeKey,
  PROMOTION_SIGNAL_SOURCE,
} from './promotion-signal'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const PRESC = '22222222-2222-4222-8222-222222222222'
const GOAL = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  state.insertResult = { data: { id: 'sig-1' }, error: null }
  state.duplicate = { data: null, error: null }
  state.inserted.length = 0
  evaluateSignal.mockReset()
  evaluateSignal.mockResolvedValue({ outcome: 'accepted', work_order_id: 'wo-1' })
})

describe('promotion signal row', () => {
  it('uses the existing new_campaign path, the shared budget cap, and no client name', () => {
    const row = buildPromotionSignalRow({
      clientId: CLIENT,
      prescriptionId: PRESC,
      goalId: GOAL,
      content: { summary: '  Autumn push\nsecond line  ' },
    })
    expect(row).toMatchObject({
      client_id: CLIENT,
      signal_type: 'new_campaign',
      source: PROMOTION_SIGNAL_SOURCE,
      dedupe_key: promotionDedupeKey(PRESC),
      evidence: {
        campaign_name: 'Autumn push second line',
        goal_id: GOAL,
        budget_cap_usd: FACTORY_ORDER_BUDGET_CAP_USD,
        deliverable: 'asset_only',
      },
      request: { notes: 'Autumn push second line', deliverable: 'asset_only', platform: 'facebook' },
    })
    expect(JSON.stringify(row)).not.toMatch(/CTS|Facebook|act_/)
  })

  it('falls back to a fixed event name when the summary is missing', () => {
    expect(campaignNameFromContent(null)).toBe('处方已同意')
    expect(campaignNameFromContent({ summary: '   ' })).toBe('处方已同意')
    expect(campaignNameFromContent({ summary: 'x'.repeat(90) })).toHaveLength(80)
  })
})

describe('emitPromotionSignal', () => {
  it('does not insert when the goal or prescription id cannot be read', async () => {
    expect((await emitPromotionSignal({ clientId: CLIENT, prescriptionId: PRESC, goalId: null, content: null })).reason).toBe('goal_unreadable')
    expect((await emitPromotionSignal({ clientId: CLIENT, prescriptionId: 'nope', goalId: GOAL, content: null })).reason).toBe('prescription_id_unreadable')
    expect(state.inserted).toEqual([])
    expect(evaluateSignal).not.toHaveBeenCalled()
  })

  it('accepts only when evaluation returns a work order', async () => {
    const ok = await emitPromotionSignal({ clientId: CLIENT, prescriptionId: PRESC, goalId: GOAL, content: null })
    expect(ok).toMatchObject({ ok: true, signal_id: 'sig-1', work_order_id: 'wo-1', outcome: 'accepted' })
    expect(evaluateSignal).toHaveBeenCalledWith('sig-1')
  })

  it('does not treat a rejected evaluation as success', async () => {
    evaluateSignal.mockResolvedValue({ outcome: 'rejected', reject_reason: 'balance_low' })
    const result = await emitPromotionSignal({ clientId: CLIENT, prescriptionId: PRESC, goalId: GOAL, content: null })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('balance_low')
  })

  it('does not treat a missing work order id as success', async () => {
    evaluateSignal.mockResolvedValue({ outcome: 'accepted' })
    const result = await emitPromotionSignal({ clientId: CLIENT, prescriptionId: PRESC, goalId: GOAL, content: null })
    expect(result).toMatchObject({ ok: false, reason: '读不到' })
  })

  it('a duplicate whose existing row cannot be read is not success', async () => {
    state.insertResult = { data: null, error: { code: '23505', message: 'duplicate' } }
    state.duplicate = { data: null, error: null }
    const result = await emitPromotionSignal({ clientId: CLIENT, prescriptionId: PRESC, goalId: GOAL, content: null })
    expect(result).toMatchObject({ ok: false, deduped: true, reason: '读不到' })
    expect(evaluateSignal).not.toHaveBeenCalled()
  })
})
