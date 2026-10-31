/**
 * Approving a plan archives the other approved plan for the same client and goal.
 * A failed save puts that plan back. Approving the same plan again does not archive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GateFacts } from '@/lib/marketing-plan/promo/gates'
import { baseSpec } from '@/lib/marketing-plan/promo/__tests__/fixtures'
import type { PromoSpec } from '@/lib/marketing-plan/promo/spec'
import {
  keptApprovedPlanId,
  planStatusLabel,
  priorApprovedSameGoal,
  supersededReplacementText,
  type PriorApprovedRow,
} from '@/lib/marketing-plan/promo/supersede-prior-approved'

interface Row {
  id: string
  client_id: string
  status: string
  updated_at: string
  plan_data: unknown
  generation_meta: Record<string, unknown> | null
  title: string
  start_date: string | null
  end_date: string | null
  approved_at: string | null
}

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  failApprove: null as null | 'error' | 'winner',
  failArchiveIds: new Set<string>(),
  afterFirstArchive: null as null | (() => Promise<void>),
  dispatch: vi.fn(),
  revoke: vi.fn(),
  gate: null as GateFacts | null,
}))

vi.mock('@/lib/supabase', () => {
  function valueOf(row: Row, col: string): unknown {
    if (col === 'generation_meta->superseded_by->>plan_id') {
      const stamp = row.generation_meta?.superseded_by as { plan_id?: unknown } | undefined
      return stamp?.plan_id
    }
    return (row as unknown as Record<string, unknown>)[col]
  }
  function from(table: string) {
    const filters: { op: 'eq' | 'neq'; col: string; val: unknown }[] = []
    let patch: Record<string, unknown> | null = null
    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => { filters.push({ op: 'eq', col, val }); return api },
      neq: (col: string, val: unknown) => { filters.push({ op: 'neq', col, val }); return api },
      update: (row: Record<string, unknown>) => { patch = row; return api },
      maybeSingle: () => Promise.resolve(finish(true)),
      single: () => Promise.resolve(finish(true)),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(finish(false)).then(resolve, reject),
    }
    function matches(row: Row): boolean {
      return filters.every(filter => {
        const actual = valueOf(row, filter.col)
        return filter.op === 'eq' ? actual === filter.val : actual !== filter.val
      })
    }
    function refusal(hit: Row): { data: null; error: { message: string } | null } | null {
      if (!patch) return null
      if (patch.status === 'archived' && h.failArchiveIds.has(hit.id)) {
        return { data: null, error: { message: 'archive failed' } }
      }
      if (patch.approved_at && h.failApprove === 'error') {
        return { data: null, error: { message: 'approve failed' } }
      }
      if (patch.approved_at && h.failApprove === 'winner') {
        hit.status = 'approved'
        return { data: null, error: null }
      }
      return null
    }
    function finish(one: boolean) {
      if (table === 'execution_items') return { data: null, error: null, count: 0 }
      if (table !== 'marketing_plans') return { data: null, error: { message: 'unexpected table' } }
      const hits = h.rows.filter(matches)
      if (patch) {
        const hit = hits[0]
        if (!hit) return { data: null, error: null }
        const refused = refusal(hit)
        if (refused) return refused
        Object.assign(hit, { ...hit, ...patch, updated_at: `bumped-${hit.id}` })
        const saved = { data: { ...hit }, error: null }
        if (patch.status === 'archived' && h.afterFirstArchive) {
          const hook = h.afterFirstArchive
          h.afterFirstArchive = null
          return Promise.resolve().then(() => hook()).then(() => saved)
        }
        return saved
      }
      if (one) {
        const row = hits[0]
        return row ? { data: { ...row }, error: null } : { data: null, error: { message: 'missing' } }
      }
      return {
        data: hits.map(row => ({
          ...row,
          generation_meta: row.generation_meta ? { ...row.generation_meta } : null,
        })),
        error: null,
      }
    }
    return api
  }
  return { supabaseAdmin: { from } }
})

vi.mock('@/lib/marketing-plan/task-dispatcher', () => ({
  dispatchPlanTasks: (...args: unknown[]) => h.dispatch(...args),
  revokePlanTasks: (...args: unknown[]) => h.revoke(...args),
}))

vi.mock('@/lib/marketing-plan/promo/facts', () => ({
  loadPromoFacts: async () => ({ gate: h.gate }),
}))

import { approvePlan } from '@/lib/marketing-plan/approve-plan'
import { reconcileSameGoalApprovedPlans } from '@/lib/marketing-plan/promo/supersede-prior-approved-write'
import { goodFacts } from '@/lib/marketing-plan/promo/__tests__/fixtures'

function socialPromo(goalId: string): PromoSpec {
  const spec = baseSpec({ goal_id: goalId })
  spec.phases = [{
    id: 'p1', name: '阶段 1', start_date: '2026-11-01', end_date: '2026-11-14',
    steps: [{ id: 's-soc', kind: 'social_cadence', settings: { posts_per_week: 3, stories_per_week: 2, reels_per_month: 0 } }],
  }]
  return spec
}

function planRow(args: {
  id: string
  status?: string
  goalId?: string | null
  clientId?: string
  meta?: Record<string, unknown> | null
}): Row {
  const goalId = args.goalId === undefined ? 'goal-a' : args.goalId
  return {
    id: args.id,
    client_id: args.clientId ?? 'client-1',
    status: args.status ?? 'approved',
    updated_at: '2026-10-01T00:00:00.000Z',
    plan_data: goalId === null ? { tasks: [] } : { promo: socialPromo(goalId), tasks: [] },
    generation_meta: args.meta === undefined ? { model: 'keep' } : args.meta,
    title: args.id,
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    approved_at: args.status === 'draft' ? null : '2026-10-01T00:00:00.000Z',
  }
}

function byId(id: string): Row {
  const row = h.rows.find(item => item.id === id)
  if (!row) throw new Error(`missing ${id}`)
  return row
}

function stampOf(id: string): { plan_id?: string; at?: string } | undefined {
  return byId(id).generation_meta?.superseded_by as { plan_id?: string; at?: string } | undefined
}

beforeEach(() => {
  h.rows = []
  h.failApprove = null
  h.failArchiveIds = new Set()
  h.afterFirstArchive = null
  h.dispatch.mockReset()
  h.dispatch.mockResolvedValue({
    marketing_plan_id: 'plan-new', tasks_created: 1, tasks_skipped: 0,
    task_ids: ['t1'], packages_created: 0, package_ids: [],
  })
  h.revoke.mockReset()
  h.revoke.mockResolvedValue({ revoked: 0 })
  h.gate = goodFacts()
})

describe('approvePlan archives the previous approved plan for the same goal', () => {
  it('archives the old approved plan and records which plan replaced it', async () => {
    h.rows = [
      planRow({ id: 'plan-new', status: 'draft' }),
      planRow({ id: 'plan-old', status: 'approved' }),
    ]
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-new', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('approved')
    expect(byId('plan-new').status).toBe('approved')
    expect(byId('plan-old').status).toBe('archived')
    expect(byId('plan-old').generation_meta?.model).toBe('keep')
    expect(stampOf('plan-old')?.plan_id).toBe('plan-new')
    if (result.kind === 'approved') expect(stampOf('plan-old')?.at).toBe(result.receipt.approved_at)
    expect(h.revoke).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('leaves a different goal, a draft, a completed plan, and another client alone', async () => {
    h.rows = [
      planRow({ id: 'plan-new', status: 'draft', goalId: 'goal-a' }),
      planRow({ id: 'plan-old', status: 'approved', goalId: 'goal-a' }),
      planRow({ id: 'plan-other-goal', status: 'approved', goalId: 'goal-b' }),
      planRow({ id: 'plan-draft', status: 'draft', goalId: 'goal-a' }),
      planRow({ id: 'plan-done', status: 'completed', goalId: 'goal-a' }),
      planRow({ id: 'plan-other-client', status: 'approved', goalId: 'goal-a', clientId: 'client-2' }),
    ]
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-new', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('approved')
    expect(byId('plan-old').status).toBe('archived')
    expect(byId('plan-other-goal').status).toBe('approved')
    expect(stampOf('plan-other-goal')).toBeUndefined()
    expect(byId('plan-draft').status).toBe('draft')
    expect(byId('plan-done').status).toBe('completed')
    expect(byId('plan-other-client').status).toBe('approved')
    expect(stampOf('plan-other-client')).toBeUndefined()
  })

  it('puts the old plan back to approved when the new approval does not save', async () => {
    h.failApprove = 'error'
    h.rows = [
      planRow({ id: 'plan-new', status: 'draft' }),
      planRow({ id: 'plan-old', status: 'approved' }),
    ]
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-new', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('conflict')
    expect(byId('plan-new').status).toBe('draft')
    expect(byId('plan-old').status).toBe('approved')
    expect(stampOf('plan-old')).toBeUndefined()
    expect(byId('plan-old').generation_meta).toEqual({ model: 'keep' })
    expect(h.revoke).toHaveBeenCalledWith('plan-new', 'client-1')
  })

  it('puts the first old plan back when a later one cannot be archived', async () => {
    h.failArchiveIds = new Set(['plan-old-b'])
    h.rows = [
      planRow({ id: 'plan-new', status: 'draft' }),
      planRow({ id: 'plan-old-a', status: 'approved' }),
      planRow({ id: 'plan-old-b', status: 'approved' }),
    ]
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-new', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('conflict')
    expect(byId('plan-new').status).toBe('draft')
    expect(byId('plan-old-a').status).toBe('approved')
    expect(byId('plan-old-b').status).toBe('approved')
    expect(stampOf('plan-old-a')).toBeUndefined()
    expect(stampOf('plan-old-b')).toBeUndefined()
  })

  it('does not archive anything when the same plan is approved again', async () => {
    h.rows = [
      planRow({ id: 'plan-new', status: 'approved' }),
      planRow({ id: 'plan-old', status: 'approved' }),
    ]
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-new', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('already_approved')
    expect(byId('plan-new').status).toBe('approved')
    expect(byId('plan-old').status).toBe('approved')
    expect(stampOf('plan-old')).toBeUndefined()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.revoke).not.toHaveBeenCalled()
  })

  it('does not archive other plans when the new plan has no goal', async () => {
    h.rows = [
      planRow({ id: 'plan-new', status: 'draft', goalId: null, meta: null }),
      planRow({ id: 'plan-old', status: 'approved' }),
    ]
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-new', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('approved')
    expect(byId('plan-old').status).toBe('approved')
    expect(stampOf('plan-old')).toBeUndefined()
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('keeps the archive when another request already approved this same plan', async () => {
    h.failApprove = 'winner'
    h.rows = [
      planRow({ id: 'plan-new', status: 'draft' }),
      planRow({ id: 'plan-old', status: 'approved' }),
    ]
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-new', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('conflict')
    expect(byId('plan-new').status).toBe('approved')
    expect(byId('plan-old').status).toBe('archived')
    expect(stampOf('plan-old')?.plan_id).toBe('plan-new')
    expect(h.revoke).not.toHaveBeenCalled()
  })

  it('keeps only the later approval when two drafts for the same goal overlap', async () => {
    let tick = 0
    const clock = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
      tick += 1
      return `2026-10-31T01:00:${String(tick).padStart(2, '0')}.000Z`
    })
    h.rows = [
      planRow({ id: 'plan-a', status: 'draft' }),
      planRow({ id: 'plan-b', status: 'draft' }),
      planRow({ id: 'plan-old', status: 'approved' }),
    ]
    h.afterFirstArchive = async () => {
      const second = await approvePlan({ clientId: 'client-1', planId: 'plan-b', approvedBy: 'ray@example.com' })
      expect(second.kind).toBe('approved')
    }
    try {
      const first = await approvePlan({ clientId: 'client-1', planId: 'plan-a', approvedBy: 'ray@example.com' })
      expect(first.kind).toBe('conflict')
      if (first.kind === 'conflict') expect(first.error).toContain('已收起')
      expect(byId('plan-b').status).toBe('approved')
      expect(byId('plan-a').status).toBe('archived')
      expect(byId('plan-old').status).toBe('archived')
      expect(stampOf('plan-a')?.plan_id).toBe('plan-b')
    } finally {
      clock.mockRestore()
    }
  })

  it('keeps the same plan when two reconciles both see two approvals', async () => {
    h.rows = [
      planRow({ id: 'plan-a', status: 'approved' }),
      planRow({ id: 'plan-b', status: 'approved' }),
    ]
    byId('plan-a').approved_at = '2026-10-31T01:00:01.000Z'
    byId('plan-b').approved_at = '2026-10-31T01:00:02.000Z'
    const [left, right] = await Promise.all([
      reconcileSameGoalApprovedPlans({ clientId: 'client-1', approving: byId('plan-a') }),
      reconcileSameGoalApprovedPlans({ clientId: 'client-1', approving: byId('plan-b') }),
    ])
    expect(left).toEqual({ ok: true, keptId: 'plan-b' })
    expect(right).toEqual({ ok: true, keptId: 'plan-b' })
    expect(byId('plan-b').status).toBe('approved')
    expect(byId('plan-a').status).toBe('archived')
    expect(stampOf('plan-a')?.plan_id).toBe('plan-b')
    const again = await reconcileSameGoalApprovedPlans({ clientId: 'client-1', approving: byId('plan-b') })
    expect(again).toEqual({ ok: true, keptId: 'plan-b' })
    expect(byId('plan-a').status).toBe('archived')
    expect(byId('plan-b').status).toBe('approved')
  })
})

describe('replaced plans are described in plain language', () => {
  it('says which day the new plan took over, in New Zealand, and not as raw JSON', () => {
    const meta = { superseded_by: { plan_id: 'plan-new', at: '2026-10-31T13:40:00.000Z' } }
    const text = supersededReplacementText(meta)
    expect(text).toBe('已被新计划替换（2026-11-01）')
    expect(text).not.toContain('plan-new')
    expect(text).not.toMatch(/[{}[\]]/)
    expect(planStatusLabel('archived', meta)).toBe('已被新计划替换（2026-11-01）')
    expect(planStatusLabel('archived', { model: 'keep' })).toBe('已归档')
    expect(planStatusLabel('draft', meta)).toBe('草稿')
  })

  it('still says the plan was replaced when the time cannot be read', () => {
    expect(supersededReplacementText({ superseded_by: { plan_id: 'plan-new', at: 'not-a-date' } })).toBe('已被新计划替换')
    expect(supersededReplacementText(null)).toBeNull()
    expect(supersededReplacementText({})).toBeNull()
  })
})

describe('priorApprovedSameGoal', () => {
  const approving = { id: 'plan-new', plan_data: { promo: socialPromo('goal-a') }, generation_meta: null }

  function row(over: Partial<PriorApprovedRow> & Pick<PriorApprovedRow, 'id' | 'status'>): PriorApprovedRow {
    return {
      client_id: 'client-1',
      updated_at: '2026-10-01T00:00:00.000Z',
      approved_at: '2026-10-01T00:00:00.000Z',
      plan_data: { promo: socialPromo('goal-a') },
      generation_meta: null,
      ...over,
    }
  }

  it('keeps only approved plans for the same client and goal', () => {
    const picked = priorApprovedSameGoal(approving, 'client-1', [
      row({ id: 'plan-old', status: 'approved' }),
      row({ id: 'plan-new', status: 'approved' }),
      row({ id: 'plan-draft', status: 'draft' }),
      row({ id: 'plan-done', status: 'completed' }),
      row({ id: 'plan-b', status: 'approved', plan_data: { promo: socialPromo('goal-b') } }),
      row({ id: 'plan-c2', status: 'approved', client_id: 'client-2' }),
    ])
    expect(picked.map(item => item.id)).toEqual(['plan-old'])
  })

  it('archives nothing when the plan being approved has no goal', () => {
    const bare = { id: 'plan-new', plan_data: { tasks: [] }, generation_meta: null }
    expect(priorApprovedSameGoal(bare, 'client-1', [row({ id: 'plan-old', status: 'approved' })])).toEqual([])
  })
})

describe('keptApprovedPlanId', () => {
  it('keeps the later approval, and the higher id when the time matches', () => {
    const earlier = { id: 'plan-a', approved_at: '2026-10-31T01:00:01.000Z' }
    const later = { id: 'plan-b', approved_at: '2026-10-31T01:00:02.000Z' }
    expect(keptApprovedPlanId([earlier, later])).toBe('plan-b')
    expect(keptApprovedPlanId([later, earlier])).toBe('plan-b')
    expect(keptApprovedPlanId([
      { id: 'plan-a', approved_at: '2026-10-31T01:00:02.000Z' },
      { id: 'plan-b', approved_at: '2026-10-31T01:00:02.000Z' },
    ])).toBe('plan-b')
    expect(keptApprovedPlanId([])).toBeNull()
  })
})
