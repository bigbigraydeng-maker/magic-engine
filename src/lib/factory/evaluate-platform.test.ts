/**
 * evaluateSignal 的平台接线测试(只测 persistDecision 里 stampPlatformAndTags 那一段):
 * 缺 request.platform → 工单照建、brief.platform 补 facebook、记一条警告;
 * 写了认不得的平台 → 信号 rejected(platform_required),不建工单。
 * 闸门裁决(decideSignal)被替身顶掉,其余数据库查询返回空。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  signalRequest: {} as Record<string, unknown>,
  inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}))

vi.mock('@/lib/supabase', () => {
  const SIGNAL = () => ({
    id: 'sig-1',
    client_id: 'client-1',
    source: 'external-caller',
    evidence: {},
    request: h.signalRequest,
  })
  return {
    supabaseAdmin: {
      rpc: async () => ({ data: 100, error: null }),
      from: (table: string) => {
        let mode: 'select' | 'insert' | 'update' = 'select'
        let payload: Record<string, unknown> = {}
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'gte', 'or', 'order', 'limit']) b[m] = () => b
        b.insert = (p: Record<string, unknown>) => {
          mode = 'insert'
          payload = p
          h.inserts.push({ table, payload: p })
          return b
        }
        b.update = (p: Record<string, unknown>) => {
          mode = 'update'
          payload = p
          h.updates.push({ table, payload: p })
          return b
        }
        b.single = async () => {
          if (table === 'content_demand_signals') return { data: SIGNAL(), error: null }
          if (table === 'content_work_orders' && mode === 'insert') {
            return { data: { id: 'wo-1' }, error: null }
          }
          return { data: null, error: null }
        }
        b.maybeSingle = async () => ({ data: null, error: null })
        b.then = (res: (v: unknown) => unknown) => res({ data: [], error: null })
        void payload
        return b
      },
    },
  }
})
vi.mock('./strategist', () => ({
  goalForSignal: () => null,
  decideSignal: () => ({
    outcome: 'accepted',
    workOrder: {
      client_id: 'client-1',
      signal_id: 'sig-1',
      goal_id: 'goal-1',
      master_brief_id: 'mb-1',
      winner_structure_id: null,
      order_type: 'new_campaign',
      angle: 'autumn push',
      angle_source: 'brief',
      rationale_one_liner: 'test',
      brief: {
        segments: [],
        max_new_clips: 0,
        clip_generation_plan: [],
        aspect_ratio: '9:16',
        notes: '',
      },
      budget_cap_usd: 1,
      source_ad_id: null,
      clip_links: [],
    },
  }),
}))
vi.mock('./viral-structure', () => ({ loadViralStructure: async () => null }))
vi.mock('./client-asset-pool', () => ({ loadClientAssetPool: async () => [] }))
vi.mock('./copy-generator', () => ({ generateAdCopy: async () => undefined }))
vi.mock('@/lib/reels/viral-style-advisor', () => ({
  detectContentGoal: () => 'awareness',
  getViralClipDirective: async () => null,
  getViralVisualPlan: async () => null,
}))

import { evaluateSignal } from './evaluate'

function insertedOrderBrief(): Record<string, unknown> | undefined {
  return h.inserts.find((i) => i.table === 'content_work_orders')?.payload.brief as
    | Record<string, unknown>
    | undefined
}

beforeEach(() => {
  h.inserts.length = 0
  h.updates.length = 0
  vi.restoreAllMocks()
})

describe('evaluateSignal — request.platform 接线', () => {
  it('missing platform: order is still created with facebook and a warning is logged', async () => {
    h.signalRequest = { notes: 'no platform here' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await evaluateSignal('sig-1')

    expect(result).toEqual({ outcome: 'accepted', work_order_id: 'wo-1' })
    expect(insertedOrderBrief()?.platform).toBe('facebook')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('sig-1')
    expect(String(warn.mock.calls[0][0])).toContain('defaulted to facebook')
  })

  it('explicit platform: kept as sent, no warning', async () => {
    h.signalRequest = { platform: 'instagram' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await evaluateSignal('sig-1')

    expect(result.outcome).toBe('accepted')
    expect(insertedOrderBrief()?.platform).toBe('instagram')
    expect(warn).not.toHaveBeenCalled()
  })

  it('unrecognised platform: signal rejected as platform_required and no order is created', async () => {
    h.signalRequest = { platform: 'myspace' }
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await evaluateSignal('sig-1')

    expect(result.outcome).toBe('rejected')
    expect(result.reject_reason).toContain('platform_required')
    expect(h.inserts.find((i) => i.table === 'content_work_orders')).toBeUndefined()
  })
})
