/**
 * Agree-path approval only flips plan status when every hard check is green.
 * The plan-page route leaves requireAllGreen off, so a hard yellow still approves.
 * Promo plans do not dispatch legacy to-dos and do not write a budget or a Meta draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GateFacts } from '@/lib/marketing-plan/promo/gates'
import { promoContentHash } from '@/lib/marketing-plan/promo/content-hash'
import { parsePromoSpec, type PromoSpec } from '@/lib/marketing-plan/promo/spec'
import { baseSpec, goodFacts } from '@/lib/marketing-plan/promo/__tests__/fixtures'

const h = vi.hoisted(() => ({
  plan: null as Record<string, unknown> | null,
  gate: null as GateFacts | null,
  updates: [] as Record<string, unknown>[],
  dispatch: vi.fn(),
}))

vi.mock('@/lib/supabase', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = () => c
    c.single = async () => ({ data: h.plan, error: h.plan ? null : { message: 'missing' } })
    c.maybeSingle = async () => ({ data: h.plan, error: null })
    c.update = (row: Record<string, unknown>) => {
      h.updates.push(row)
      return c
    }
    return c
  }
  return { supabaseAdmin: { from: () => chain() } }
})

vi.mock('@/lib/marketing-plan/task-dispatcher', () => ({
  dispatchPlanTasks: (...args: unknown[]) => h.dispatch(...args),
  revokePlanTasks: vi.fn(),
}))

vi.mock('@/lib/marketing-plan/promo/facts', () => ({
  loadPromoFacts: async () => ({ gate: h.gate }),
}))

import { approvePlan } from '@/lib/marketing-plan/approve-plan'

function hashed(spec: PromoSpec): PromoSpec {
  const parsed = parsePromoSpec(spec)
  if (!parsed.ok) throw new Error('fixture spec did not parse')
  return parsed.spec
}

function draft(spec: PromoSpec, status = 'draft') {
  const promo = hashed(spec)
  h.plan = {
    id: 'plan-1', client_id: 'client-1', status, updated_at: '2026-10-01T00:00:00Z',
    start_date: '2026-11-01', end_date: '2026-11-30',
    generation_meta: { model: 'x' },
    plan_data: { promo },
  }
  return promo
}

function socialSpec(): PromoSpec {
  return baseSpec({
    phases: [{
      id: 'p1', name: '阶段 1', start_date: '2026-11-01', end_date: '2026-11-14',
      steps: [{ id: 's-soc', kind: 'social_cadence', settings: { posts_per_week: 3, stories_per_week: 2, reels_per_month: 0 } }],
    }],
  })
}

function landingVerified(spec: PromoSpec): GateFacts {
  return goodFacts({
    manual_checks: [{
      phase_id: 'p1', check_key: 'landing.item_live', verified_by: 'ray@example.com',
      verified_at: '2026-10-28T00:00:00Z', note: '', content_hash: promoContentHash(spec),
    }],
  })
}

beforeEach(() => {
  h.updates = []
  h.dispatch.mockReset()
  h.gate = goodFacts()
  h.plan = null
})

describe('approvePlan requireAllGreen', () => {
  it('approves a draft whose hard checks are all green, and only writes plan status', async () => {
    draft(socialSpec())
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-1', approvedBy: 'ray@example.com', requireAllGreen: true })
    expect(result.kind).toBe('approved')
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.updates).toHaveLength(1)
    expect(Object.keys(h.updates[0]).sort()).toEqual(['approved_at', 'generation_meta', 'status'])
    expect(h.updates[0]).toMatchObject({ status: 'approved' })
    const meta = h.updates[0].generation_meta as { model: string; approval_receipt: { content_hash: string } }
    expect(meta.model).toBe('x')
    expect(meta.approval_receipt.content_hash).toEqual(expect.any(String))
  })

  it('does not approve when a hard check is yellow', async () => {
    const promo = draft(baseSpec())
    h.gate = landingVerified(promo)
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-1', approvedBy: 'ray@example.com', requireAllGreen: true })
    expect(result.kind).toBe('needs_confirmation')
    if (result.kind === 'needs_confirmation') {
      expect(result.checks.map(check => check.key)).toContain('ads.budget_within_caps')
    }
    expect(h.updates).toHaveLength(0)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('does not approve when a hard check is red', async () => {
    draft(baseSpec())
    h.gate = goodFacts({ snapshots: { act_1: { account_status: 2, captured_at: '2026-10-29T00:00:00Z' } } })
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-1', approvedBy: 'ray@example.com', requireAllGreen: true })
    expect(result.kind).toBe('blocked')
    expect(h.updates).toHaveLength(0)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('still approves a hard yellow from the plan page, without dispatching promo to-dos', async () => {
    const promo = draft(baseSpec())
    h.gate = landingVerified(promo)
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-1', approvedBy: 'ray@example.com' })
    expect(result.kind).toBe('approved')
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.updates[0]).toMatchObject({ status: 'approved' })
  })

  it('does not approve a plan that is already approved', async () => {
    draft(socialSpec(), 'approved')
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-1', approvedBy: 'ray@example.com', requireAllGreen: true })
    expect(result.kind).toBe('already_approved')
    expect(h.updates).toHaveLength(0)
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
