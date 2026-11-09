/**
 * Plan approval still flips one draft with a compare-and-swap.
 * Approving a second draft for the same goal archives the earlier approved plan.
 * A failed save puts that plan back. Calling approve on a plan that is already
 * approved does not archive its siblings.
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
  function valueOf(row: Record<string, unknown>, col: string): unknown {
    if (col === 'generation_meta->superseded_by->>plan_id') {
      const meta = row.generation_meta as { superseded_by?: { plan_id?: unknown } } | null
      return meta?.superseded_by?.plan_id
    }
    return row[col]
  }
  return {
    supabaseAdmin: {
      from(table: string) {
        const filters: { col: string; val: unknown }[] = []
        let patch: Record<string, unknown> | null = null
        const api = {
          select: () => api,
          eq(col: string, val: unknown) { filters.push({ col, val }); return api },
          update(next: Record<string, unknown>) { patch = next; return api },
          maybeSingle: () => Promise.resolve(finish(true)),
          single: () => Promise.resolve(finish(true)),
          then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
            Promise.resolve(finish(false)).then(resolve, reject),
        }
        function matches(row: Record<string, unknown>): boolean {
          return filters.every((filter) => valueOf(row, filter.col) === filter.val)
        }
        function finish(one: boolean) {
          if (table === 'execution_items') return { data: null, error: null, count: 0 }
          if (table !== 'marketing_plans') return { data: null, error: { message: 'unexpected table' } }
          const hits = h.rows.filter(matches)
          if (patch) {
            const hit = hits[0]
            if (!hit) return { data: null, error: null }
            const id = String(hit.id ?? '')
            h.writes.push({ id, patch })
            if (h.failId === id) return { data: null, error: { message: 'save failed' } }
            Object.assign(hit, patch)
            return { data: { ...hit }, error: null }
          }
          if (one) return { data: hits[0] ? { ...hits[0] } : null, error: null }
          return { data: hits.map((row) => ({ ...row })), error: null }
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
  it('archives the earlier plan for the same goal and leaves another goal approved', async () => {
    h.rows = [row('plan-a', 'draft'), row('plan-b', 'draft'), row('plan-c', 'approved', 'goal-2')]
    const first = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
    const second = await approvePlan({ clientId: 'client-1', planId: 'plan-b', approvedBy: 'ray@example.com' })
    expect(first.kind).toBe('approved')
    expect(second.kind).toBe('approved')
    expect(h.rows.find((item) => item.id === 'plan-a')?.status).toBe('archived')
    expect(h.rows.find((item) => item.id === 'plan-b')?.status).toBe('approved')
    expect(h.rows.find((item) => item.id === 'plan-c')?.status).toBe('approved')
    expect(vi.mocked(revokePlanTasks)).not.toHaveBeenCalled()
  })

  it('puts the older plan back when the approval save fails', async () => {
    h.rows = [row('plan-a', 'draft'), row('plan-b', 'approved')]
    h.failId = 'plan-a'
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('conflict')
    expect(h.rows.map((item) => item.status)).toEqual(['draft', 'approved'])
    expect(h.writes.some((item) => item.id === 'plan-a' && item.patch.status === 'approved')).toBe(true)
    const older = h.rows.find((item) => item.id === 'plan-b')
    expect(older?.generation_meta).toEqual({ model: 'x' })
    expect(vi.mocked(revokePlanTasks)).toHaveBeenCalledTimes(1)
  })

  it('a second click does not approve again and does not write again', async () => {
    h.rows = [row('plan-a', 'draft'), row('plan-b', 'approved')]
    const first = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
    const writesAfterFirst = h.writes.length
    const second = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
    expect(first.kind).toBe('approved')
    expect(second.kind).toBe('already_approved')
    expect(h.writes).toHaveLength(writesAfterFirst)
    expect(h.rows.find((item) => item.id === 'plan-b')?.status).toBe('archived')
  })

  it('does not archive siblings when the plan is already approved', async () => {
    h.rows = [row('plan-a', 'approved'), row('plan-b', 'approved')]
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('already_approved')
    expect(h.writes).toHaveLength(0)
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
