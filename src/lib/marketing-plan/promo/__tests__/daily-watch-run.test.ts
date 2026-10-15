/**
 * 「推广计划每日检查」的只读测试。
 *
 * 覆盖两件事：
 *  1. runPromoPlanWatch（daily-watch-run.ts）—— 读计划列表、跑检查、出回执；
 *  2. pushPromoPlanWatchItems（promo-plan-watch-items.ts）—— 把回执翻译成待办。
 *
 * 🔴 本文件的核心断言之一是「只读」：假 supabase 会记录任何 insert/update/upsert/delete
 *    调用，每个用例末尾都断言 m.writes 为空。一旦被测代码偷偷写库，测试立刻红。
 * 🔴 buildPromoBoard 被 mock 掉：这里只测「编排」，不测看板本身。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { PromoBoard } from '../board'

// vi.hoisted：mock 工厂和测试体共用同一份可变状态。
const m = vi.hoisted(() => {
  return {
    /** 假 supabase 的查询结果。 */
    plans: [] as unknown[],
    queryError: null as { message: string } | null,
    /** buildPromoBoard 的实现，用例里按需替换。 */
    buildPromoBoard: vi.fn(),
    /** 任何写库调用的记录；只读证明。 */
    writes: [] as string[],
  }
})

vi.mock('../board', () => ({
  buildPromoBoard: m.buildPromoBoard,
}))

// 被测模块必须在 vi.mock 之后 import。
import { runPromoPlanWatch } from '../daily-watch-run'

/** 造一份最小可用的 MarketingPlan。 */
function makePlan(over: Partial<MarketingPlan> & Pick<MarketingPlan, 'id' | 'client_id' | 'title'>): MarketingPlan {
  return {
    id: over.id,
    client_id: over.client_id,
    title: over.title,
    status: over.status ?? 'draft',
    plan_data: over.plan_data ?? { promo: {} },
    generation_meta: over.generation_meta ?? null,
    updated_at: over.updated_at ?? '2024-01-01T00:00:00.000Z',
    created_at: over.created_at ?? '2024-01-01T00:00:00.000Z',
  } as MarketingPlan
}

/** 造一份最小可用的 PromoBoard。 */
function makeBoard(over: Partial<PromoBoard> & Pick<PromoBoard, 'plan_id' | 'plan_status'>): PromoBoard {
  return {
    plan_id: over.plan_id,
    plan_status: over.plan_status,
    updated_at: over.updated_at ?? '2024-01-01T00:00:00.000Z',
    has_promo: over.has_promo ?? true,
    spec_valid: over.spec_valid ?? true,
    issues: over.issues ?? [],
    today: over.today ?? '2024-01-01',
    timezone_known: over.timezone_known ?? true,
    playbook: over.playbook ?? null,
    approval: over.approval ?? null,
    next_phase: over.next_phase ?? null,
    reconcile: over.reconcile ?? null,
    reviewed_this_window: over.reviewed_this_window ?? false,
    content_changed: over.content_changed ?? false,
  }
}

/**
 * 假 supabase：from() 返回一条链 select → in → not，
 * 链对象自身可 await（有 then），await 后得到 { data, error }。
 * 任何写方法被调用都记进 m.writes。
 */
function makeSupabase(): SupabaseClient {
  const result = () => ({ data: m.plans, error: m.queryError })

  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  chain.select = passthrough
  chain.in = passthrough
  chain.not = passthrough
  // 让链对象可 await。
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result())

  const write = (name: string) => () => {
    m.writes.push(name)
    return chain
  }
  chain.insert = write('insert')
  chain.update = write('update')
  chain.upsert = write('upsert')
  chain.delete = write('delete')

  const client = {
    from: () => chain,
  }
  return client as unknown as SupabaseClient
}

/** 造一个 nameOf：把 client_id 原样返回，方便断言。 */
function nameOf(id: string): string {
  return `客户-${id}`
}

beforeEach(() => {
  m.plans = []
  m.queryError = null
  m.writes = []
  m.buildPromoBoard.mockReset()
})

describe('runPromoPlanWatch', () => {
  it('读计划列表失败：回执 read_failed、不抛错、plans/sources 为空', async () => {
    m.queryError = { message: '数据库连不上' }

    const { receipt, sources, failures } = await runPromoPlanWatch(makeSupabase())

    expect(receipt.status).toBe('read_failed')
    expect(receipt.error).toBeTruthy()
    expect(receipt.error).toContain('数据库连不上')
    expect(receipt.plans).toEqual([])
    expect(receipt.plans_checked).toBe(0)
    expect(receipt.plans_with_findings).toBe(0)
    expect(receipt.no_publish).toBe(true)
    expect(sources).toEqual([])
    expect(failures).toEqual([])
    expect(m.writes).toHaveLength(0)
  })

  it('一份草稿 + can_approve：出一条 draft_ready_to_approve，回执 ok', async () => {
    const plan = makePlan({ id: 'p1', client_id: 'c1', title: '春季推广', status: 'draft' })
    m.plans = [plan]
    m.buildPromoBoard.mockResolvedValue(
      makeBoard({
        plan_id: 'p1',
        plan_status: 'draft',
        approval: {
          can_approve: true,
          blockers: [],
          unverified: [],
          results: [],
          per_phase: [],
          deferred_blockers: [],
          note: null,
        },
      }),
    )

    const { receipt, sources, failures } = await runPromoPlanWatch(makeSupabase())

    expect(receipt.status).toBe('ok')
    expect(receipt.no_publish).toBe(true)
    expect(receipt.request_id).toBeTruthy()
    expect(receipt.plans_checked).toBe(1)
    expect(receipt.plans_with_findings).toBe(1)
    expect(failures).toEqual([])
    expect(sources).toHaveLength(1)
    expect(sources[0].finding.code).toBe('draft_ready_to_approve')
    expect(sources[0].client_id).toBe('c1')
    expect(sources[0].plan_id).toBe('p1')
    expect(m.writes).toHaveLength(0)
  })

  it('一份计划算失败：回执 partial、该计划 error 有内容、failures 一条；另一份正常不受影响', async () => {
    const bad = makePlan({ id: 'bad', client_id: 'c1', title: '坏计划', status: 'draft' })
    const good = makePlan({ id: 'good', client_id: 'c2', title: '好计划', status: 'draft' })
    m.plans = [bad, good]

    m.buildPromoBoard.mockImplementation((plan: MarketingPlan) => {
      if (plan.id === 'bad') {
        return Promise.reject(new Error('看板算不出来'))
      }
      return Promise.resolve(
        makeBoard({
          plan_id: 'good',
          plan_status: 'draft',
          approval: {
            can_approve: true,
            blockers: [],
            unverified: [],
            results: [],
            per_phase: [],
            deferred_blockers: [],
            note: null,
          },
        }),
      )
    })

    const { receipt, sources, failures } = await runPromoPlanWatch(makeSupabase())

    expect(receipt.status).toBe('partial')
    expect(receipt.plans_checked).toBe(2)
    expect(failures).toHaveLength(1)
    expect(failures[0].plan_id).toBe('bad')
    expect(failures[0].error).toContain('看板算不出来')

    const badReceipt = receipt.plans.find(p => p.plan_id === 'bad')
    expect(badReceipt).toBeDefined()
    expect(badReceipt?.error).toBeTruthy()

    // 另一份正常计划照常出 finding。
    expect(sources).toHaveLength(1)
    expect(sources[0].plan_id).toBe('good')
    expect(m.writes).toHaveLength(0)
  })

  it('一份已批准且一切正常：0 条待办（没事不出声）', async () => {
    const plan = makePlan({ id: 'p1', client_id: 'c1', title: '已批准计划', status: 'approved' })
    m.plans = [plan]
    m.buildPromoBoard.mockResolvedValue(
      makeBoard({
        plan_id: 'p1',
        plan_status: 'approved',
        approval: {
          can_approve: false,
          blockers: [],
          unverified: [],
          results: [],
          per_phase: [],
          deferred_blockers: [],
          note: null,
        },
      }),
    )

    const { receipt, sources, failures } = await runPromoPlanWatch(makeSupabase())
    expect(receipt.status).toBe('ok')
    expect(sources).toEqual([])
    expect(failures).toEqual([])

    expect(receipt.items).toEqual([])
    expect(m.writes).toHaveLength(0)
  })

  it('超过 50 份计划：只检查 50 份，回执 partial，error 含「没检查」', async () => {
    const plans: MarketingPlan[] = []
    for (let i = 0; i < 55; i++) {
      plans.push(makePlan({ id: `p${i}`, client_id: `c${i}`, title: `计划${i}`, status: 'draft' }))
    }
    m.plans = plans
    m.buildPromoBoard.mockImplementation((plan: MarketingPlan) =>
      Promise.resolve(
        makeBoard({
          plan_id: plan.id,
          plan_status: 'draft',
          approval: {
            can_approve: false,
            blockers: [],
            unverified: [],
            results: [],
            per_phase: [],
            deferred_blockers: [],
            note: null,
          },
        }),
      ),
    )

    const { receipt } = await runPromoPlanWatch(makeSupabase())

    expect(receipt.plans_checked).toBe(50)
    expect(receipt.status).toBe('partial')
    expect(receipt.error).toBeTruthy()
    expect(receipt.error).toContain('没检查')
    expect(m.writes).toHaveLength(0)
  })
})
