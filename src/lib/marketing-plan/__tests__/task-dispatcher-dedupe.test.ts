/**
 * dispatchPlanTasks 去重：批准重试 / 并发点两次时，已经派过的任务不再重复插入。
 * 用假的 supabaseAdmin，只验证「插了哪些行」，不碰真实数据库。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  existing: [] as { title: string; due_date: string | null; steps_json?: Record<string, unknown> }[],
  existingError: null as { message: string } | null,
  inserted: [] as Record<string, unknown>[][],
  packageInserts: [] as Record<string, unknown>[][],
}))

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    if (table === 'execution_items') {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: state.existing, error: state.existingError }),
          }),
        }),
        insert: (rows: Record<string, unknown>[]) => {
          state.inserted.push(rows)
          return { select: async () => ({ data: rows.map((_, i) => ({ id: `new-${state.inserted.length}-${i}` })), error: null }) }
        },
      }
    }
    if (table === 'production_packages') {
      return {
        insert: (rows: Record<string, unknown>[]) => {
          state.packageInserts.push(rows)
          return { select: async () => ({ data: rows.map((_, i) => ({ id: `pkg-${i}` })), error: null }) }
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  }
  return { supabaseAdmin: { from } }
})

import { dispatchPlanTasks } from '../task-dispatcher'
import type { MarketingPlan, PlanTask } from '../types'

const task = (title: string, due: string, kind: PlanTask['kind'] = 'blog_article'): PlanTask => ({
  kind, title, description: 'desc', due_date: due,
})

function plan(tasks: PlanTask[]): MarketingPlan {
  return {
    id: 'plan-1', client_id: 'client-1', campaign_id: null, master_brief_id: 'mb-1',
    title: 'P', status: 'draft', start_date: null, end_date: null,
    plan_data: { social: {}, blog: { monthly_count: 0, topics: [] }, kpis: {}, tasks },
    generation_meta: null, approved_at: null, created_at: '', updated_at: '',
  }
}

describe('dispatchPlanTasks — 去重', () => {
  beforeEach(() => {
    state.existing = []
    state.existingError = null
    state.inserted = []
    state.packageInserts = []
  })

  it('第一次批准：全部派发', async () => {
    const res = await dispatchPlanTasks(plan([task('A', '2026-10-20'), task('B', '2026-10-21')]))
    expect(res.tasks_created).toBe(2)
    expect(res.tasks_skipped).toBe(0)
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0].map(r => r.title)).toEqual(['A', 'B'])
  })

  it('重试：已经派过的跳过，只补缺的，sort_order 保持原下标', async () => {
    state.existing = [{ title: 'A', due_date: '2026-10-20', steps_json: { kind: 'blog_article' } }]
    const res = await dispatchPlanTasks(plan([task('A', '2026-10-20'), task('B', '2026-10-21')]))
    expect(res.tasks_created).toBe(1)
    expect(res.tasks_skipped).toBe(1)
    expect(state.inserted[0].map(r => r.title)).toEqual(['B'])
    expect(state.inserted[0][0].sort_order).toBe(1)
  })

  it('全部派过：不插入、不建生产包', async () => {
    state.existing = [{ title: 'A', due_date: '2026-10-20', steps_json: { kind: 'blog_article' } }]
    const res = await dispatchPlanTasks(plan([task('A', '2026-10-20')]))
    expect(res.tasks_created).toBe(0)
    expect(res.tasks_skipped).toBe(1)
    expect(state.inserted).toHaveLength(0)
    expect(state.packageInserts).toHaveLength(0)
  })

  it('生产包只为新派发的任务建', async () => {
    state.existing = [{ title: 'A', due_date: '2026-10-20', steps_json: { kind: 'blog_article' } }]
    const res = await dispatchPlanTasks(plan([task('A', '2026-10-20'), task('B', '2026-10-21')]))
    expect(res.packages_created).toBe(1)
    const ids = (state.packageInserts[0][0].source_payload as { execution_item_ids: string[] }).execution_item_ids
    expect(ids).toHaveLength(1)
  })

  it('读不到已有任务 → 抛错，不往下插（不冒充"没有已派发的"）', async () => {
    state.existingError = { message: 'boom' }
    await expect(dispatchPlanTasks(plan([task('A', '2026-10-20')]))).rejects.toThrow(/read existing/)
    expect(state.inserted).toHaveLength(0)
  })

  it('计划里没有任务 → 直接返回，不读库', async () => {
    const res = await dispatchPlanTasks(plan([]))
    expect(res.tasks_created).toBe(0)
    expect(state.inserted).toHaveLength(0)
  })
})
