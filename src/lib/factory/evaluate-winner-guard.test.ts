/**
 * 从 evaluateSignal → loadContext 一路走过来的护栏 7 测试：
 * 夹具里放一条「status=active 但没人认」的赢家，断言它的题材仍然挡住同题材的新角度，
 * 而它自己不会被拿去当出片骨架。直接改 loadContext 里 winnerThemeGuards 的来源会让这里变红。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GateContext } from './types'

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  captured: null as unknown,
  decision: null as unknown,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    rpc: async () => ({ data: 20, error: null }),
    from: (table: string) => {
      const rows = () => h.tables[table] ?? []
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'gte', 'or', 'order', 'limit', 'update', 'insert']) b[m] = () => b
      b.single = async () => ({ data: rows()[0] ?? null, error: null })
      b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
      b.then = (res: (v: unknown) => unknown) => res({ data: rows(), error: null })
      return b
    },
  },
}))
vi.mock('./viral-structure', () => ({ loadViralStructure: async () => null }))
vi.mock('./client-asset-pool', () => ({ loadClientAssetPool: async () => [] }))
vi.mock('./copy-generator', () => ({ generateAdCopy: async () => undefined }))
vi.mock('@/lib/reels/viral-style-advisor', () => ({
  detectContentGoal: () => 'awareness',
  getViralClipDirective: async () => null,
  getViralVisualPlan: async () => null,
}))
vi.mock('./strategist', async (importOriginal) => {
  const real = await importOriginal<typeof import('./strategist')>()
  return {
    ...real,
    decideSignal: (ctx: GateContext) => {
      h.captured = ctx
      h.decision = real.decideSignal(ctx)
      return h.decision
    },
  }
})

import { evaluateSignal } from './evaluate'

const THEME = 'Best of China group tours'
const angleOf = (d: unknown): string | null => {
  const r = d as { outcome: string; workOrder?: { angle: string } }
  return r.outcome === 'accepted' && r.workOrder ? r.workOrder.angle : null
}
const CLIENT = 'c1'

beforeEach(() => {
  h.captured = null
  h.decision = null
  h.tables = {
    content_demand_signals: [
      {
        id: 'sig-1', client_id: CLIENT, signal_type: 'creative_fatigue', source: 'test', dedupe_key: 'k',
        confidence: 0.9, evidence: {}, request: { platform: 'facebook' }, status: 'received',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: new Date().toISOString(),
      },
    ],
    content_work_orders: [],
    master_briefs: [
      { id: 'mb-1', core_proposition: 'Trusted China tours for Kiwis', content_pillars: [THEME], keyword_seeds: [], excluded_topics: [] },
    ],
    clients: [{ id: CLIENT, brand_redline_phrases: [], factory_config: {}, industry: 'travel' }],
    goals: [{ id: 'g1', title: 'Leads', primary_metric_key: 'leads_count' }],
    factory_angle_blocklist: [],
    video_clips: [],
    client_portal_users: [],
    winner_structures: [
      {
        id: 'w-unconfirmed', client_id: CLIENT, status: 'active',
        hook_segment: { description: THEME }, middle_segment: {}, cta_segment: {},
        win_reason_tags: [], cost_per_thruplay: null, current_frequency: 1.2,
        updated_at: '2026-11-05T00:00:00.000Z',
        performance: { program_check: { state: 'passed', at: '2026-11-05T00:00:00.000Z' }, cost_per_result: 4.57, result_type: 'lead' },
      },
    ],
  }
})

describe('evaluateSignal 一路走过来：没认的 active 赢家', () => {
  it('不会被拿去出片，但它的题材仍进护栏列表', async () => {
    await evaluateSignal('sig-1')
    const ctx = h.captured as GateContext
    expect(ctx.activeWinners).toEqual([])
    expect(ctx.winnerThemeGuards.map((g) => g.hook_segment.description)).toEqual([THEME])
  })

  it('同题材的新角度被避开：落到别的角度，不是它的题材', async () => {
    await evaluateSignal('sig-1')
    expect(angleOf(h.decision)).toBe('Trusted China tours for Kiwis')
  })

  it('反例：赢家已退役（status≠active）→ 护栏不再挡，角度可用', async () => {
    h.tables.winner_structures[0].status = 'retired'
    await evaluateSignal('sig-1')
    expect((h.captured as GateContext).winnerThemeGuards).toEqual([])
    expect(angleOf(h.decision)).toBe(THEME)
  })
})
