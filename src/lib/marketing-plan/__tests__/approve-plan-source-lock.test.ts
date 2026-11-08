/**
 * Plan approval stays a single-row compare-and-swap.
 * Two drafts for one goal can both become approved. This file does not
 * archive the loser or write a row back: that would pretend the pair was atomic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { baseSpec, goodFacts } from '@/lib/marketing-plan/promo/__tests__/fixtures'
import { parsePromoSpec, type PromoSpec } from '@/lib/marketing-plan/promo/spec'

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  writes: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  failId: null as string | null,
}))

vi.mock('@/lib/supabase', () => {
  function match(filters: Array<[string, unknown]>) {
    return h.rows.filter((row) => filters.every(([column, value]) => row[column] === value))
  }
  return {
    supabaseAdmin: {
      from(table: string) {
        const filters: Array<[string, unknown]> = []
        if (table === 'execution_items') {
          const count = { select: () => count, eq: () => count, then: (done: (value: unknown) => unknown) => done({ count: 0, error: null }) }
          return count
        }
        const api = {
          select: () => api,
          eq(column: string, value: unknown) { filters.push([column, value]); return api },
          single: async () => {
            const row = match(filters)[0] ?? null
            return { data: row, error: null }
          },
          update(patch: Record<string, unknown>) {
            const written: Array<[string, unknown]> = []
            const chain = {
              eq(column: string, value: unknown) { written.push([column, value]); return chain },
              select() { return chain },
              maybeSingle: async () => {
                const id = String(written.find(([column]) => column === 'id')?.[1] ?? '')
                h.writes.push({ id, patch })
                if (h.failId === id) return { data: null, error: { message: 'save failed' } }
                const row = match(written)[0]
                if (!row) return { data: null, error: null }
                Object.assign(row, patch)
                return { data: row, error: null }
              },
            }
            return chain
          },
        }
        return api
      },
    },
  }
})

vi.mock('@/lib/marketing-plan/task-dispatcher', () => ({
  dispatchPlanTasks: vi.fn(),
  revokePlanTasks: vi.fn(async () => undefined),
}))

vi.mock('@/lib/marketing-plan/promo/facts', () => ({
  loadPromoFacts: async () => ({ gate: goodFacts() }),
}))

import { approvePlan } from '@/lib/marketing-plan/approve-plan'
import { revokePlanTasks } from '@/lib/marketing-plan/task-dispatcher'

function socialSpec(): PromoSpec {
  const spec = baseSpec({ goal_id: 'goal-1' })
  spec.phases = [{
    ...spec.phases[0],
    steps: spec.phases[0].steps.filter((step) => step.kind === 'social_cadence'),
  }]
  const parsed = parsePromoSpec(spec)
  if (!parsed.ok) throw new Error('fixture spec did not parse')
  return parsed.spec
}

function row(id: string, status: string, goalId = 'goal-1') {
  const promo = socialSpec()
  promo.goal_id = goalId
  return {
    id,
    client_id: 'client-1',
    status,
    updated_at: '2026-11-01T00:00:00.000Z',
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    generation_meta: { model: 'x' },
    plan_data: { promo },
  }
}

beforeEach(() => {
  h.rows = []
  h.writes = []
  h.failId = null
  vi.mocked(revokePlanTasks).mockClear()
})

describe('approvePlan source lock', () => {
  it('lets two drafts for one goal both succeed, and does not write either back', async () => {
    h.rows = [row('plan-a', 'draft'), row('plan-b', 'draft'), row('plan-c', 'approved', 'goal-2')]
    const [left, right] = await Promise.all([
      approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' }),
      approvePlan({ clientId: 'client-1', planId: 'plan-b', approvedBy: 'ray@example.com' }),
    ])
    expect(left.kind).toBe('approved')
    expect(right.kind).toBe('approved')
    expect(h.rows.map((item) => item.status)).toEqual(['approved', 'approved', 'approved'])
    expect(h.writes.map((item) => item.id).sort()).toEqual(['plan-a', 'plan-b'])
    expect(h.writes.every((item) => item.patch.status === 'approved')).toBe(true)
    expect(vi.mocked(revokePlanTasks)).not.toHaveBeenCalled()
  })

  it('leaves every plan untouched when the approval save fails', async () => {
    h.rows = [row('plan-a', 'draft'), row('plan-b', 'approved')]
    h.failId = 'plan-a'
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('conflict')
    expect(h.rows.map((item) => item.status)).toEqual(['draft', 'approved'])
    expect(h.writes).toEqual([{ id: 'plan-a', patch: expect.objectContaining({ status: 'approved' }) }])
    expect(vi.mocked(revokePlanTasks)).toHaveBeenCalledTimes(1)
  })

  it('a second click does not approve again and does not touch the other plan', async () => {
    h.rows = [row('plan-a', 'draft'), row('plan-b', 'approved')]
    const first = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
    const second = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
    expect(first.kind).toBe('approved')
    expect(second.kind).toBe('already_approved')
    expect(h.writes).toHaveLength(1)
    expect(h.rows.find((item) => item.id === 'plan-b')?.status).toBe('approved')
  })

  it('does not write a plan that belongs to another client', async () => {
    h.rows = [{ ...row('plan-a', 'draft'), client_id: 'client-2' }]
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('not_found')
    expect(h.writes).toHaveLength(0)
    expect(h.rows[0].status).toBe('draft')
  })
})
