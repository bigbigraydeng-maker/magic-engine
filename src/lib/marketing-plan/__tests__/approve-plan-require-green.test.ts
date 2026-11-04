/**
 * Agree-path approval only flips plan status when every applicable check is green.
 * The plan-page route leaves requireAllGreen off, so a hard yellow still approves.
 * Promo plans do not dispatch legacy to-dos and do not write a budget or a Meta draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateApproval, type GateFacts } from '@/lib/marketing-plan/promo/gates'
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

/** Phase 1 is social only and due. Phase 2 has ads and starts after the freshness window. */
function laterAdsSpec(): PromoSpec {
  const spec = baseSpec()
  spec.phases[0].steps = spec.phases[0].steps.filter(step => step.kind === 'social_cadence')
  spec.phases[1] = {
    id: 'p2', name: '阶段 2', start_date: '2026-12-01', end_date: '2026-12-31',
    steps: [{
      id: 'p2-ads', kind: 'ads_campaign', settings: {
        ad_account_id: 'act_1', daily_budget_cents: 5000, audience_ref: 'aud-1',
        creative_refs: ['vid-1'], placements: [], paused_ranges: [],
      },
    }],
  }
  return spec
}

function laterPhaseVerified(spec: PromoSpec): GateFacts {
  const contentHash = promoContentHash(spec)
  return goodFacts({
    manual_checks: (['landing.item_live', 'content.wording_permission'] as const).map(check_key => ({
      phase_id: 'p2', check_key, verified_by: 'ray@example.com',
      verified_at: '2026-10-28T00:00:00Z', note: '', content_hash: contentHash,
    })),
  })
}

beforeEach(() => {
  h.updates = []
  h.dispatch.mockReset()
  h.gate = goodFacts()
  h.plan = null
})

describe('approvePlan requireAllGreen', () => {
  it('refuses an old card when the displayed plan dates changed but the promo hash did not', async () => {
    const promo = draft(socialSpec())
    const args = {
      clientId: 'client-1', planId: 'plan-1', approvedBy: 'ray@example.com',
      expectedContentHash: promoContentHash(promo),
      expectedPlanStart: '2026-11-01', expectedPlanEnd: '2026-11-30',
    }
    expect((await approvePlan({ ...args, commit: false })).kind).toBe('ready')
    h.plan!.start_date = '2026-11-02'
    expect((await approvePlan(args)).kind).toBe('stale')
    expect(h.updates).toHaveLength(0)
  })

  it('approves a draft whose applicable checks are all green, and only writes plan status', async () => {
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

  it('does not co-approve when a later phase budget gate is yellow', async () => {
    const promo = draft(laterAdsSpec())
    h.gate = laterPhaseVerified(promo)
    const verdict = evaluateApproval(promo, h.gate)
    const budget = verdict.results.find(result => result.key === 'ads.budget_within_caps' && result.phase_id === 'p2')
    expect(verdict.can_approve).toBe(true)
    expect(verdict.per_phase.find(phase => phase.phase_id === 'p2')?.due).toBe(false)
    expect(budget?.light).toBe('yellow')
    expect(verdict.deferred_blockers).toEqual([])
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-1', approvedBy: 'ray@example.com', requireAllGreen: true })
    expect(result.kind).toBe('needs_confirmation')
    if (result.kind === 'needs_confirmation') {
      expect(result.checks.map(check => ({ key: check.key, light: check.light, phase_id: check.phase_id }))).toEqual([
        { key: 'ads.budget_within_caps', light: 'yellow', phase_id: 'p2' },
      ])
      expect(result.contentHash).toBe(promoContentHash(promo))
    }
    expect(h.updates).toHaveLength(0)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('does not co-approve a social-only plan when the cadence check is gray', async () => {
    const promo = draft(socialSpec())
    h.gate = goodFacts({ daily_plan_coverage_days: null })
    const verdict = evaluateApproval(promo, h.gate)
    expect(verdict.can_approve).toBe(true)
    expect(verdict.results.find(result => result.key === 'social.cadence_scheduled')).toMatchObject({ light: 'gray', hard: false })
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-1', approvedBy: 'ray@example.com', requireAllGreen: true })
    expect(result.kind).toBe('needs_confirmation')
    if (result.kind === 'needs_confirmation') {
      expect(result.checks.map(check => check.key)).toEqual(['social.cadence_scheduled'])
    }
    expect(h.updates).toHaveLength(0)
    expect(h.dispatch).not.toHaveBeenCalled()
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

  it('approves a yellow draft from the plan card when the content stamp matches', async () => {
    const promo = draft(baseSpec())
    h.gate = landingVerified(promo)
    const result = await approvePlan({
      clientId: 'client-1',
      planId: 'plan-1',
      approvedBy: 'ray@example.com',
      requireAllGreen: false,
      expectedContentHash: promoContentHash(promo),
    })
    expect(result.kind).toBe('approved')
    expect(h.updates).toHaveLength(1)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('a preview does not write the approval', async () => {
    const promo = draft(baseSpec())
    h.gate = landingVerified(promo)
    const result = await approvePlan({
      clientId: 'client-1',
      planId: 'plan-1',
      approvedBy: 'ray@example.com',
      commit: false,
      expectedContentHash: promoContentHash(promo),
    })
    expect(result.kind).toBe('ready')
    expect(h.updates).toHaveLength(0)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('does not approve a card whose plan content changed', async () => {
    draft(socialSpec())
    const result = await approvePlan({
      clientId: 'client-1',
      planId: 'plan-1',
      approvedBy: 'ray@example.com',
      expectedContentHash: '0000000000000000',
    })
    expect(result.kind).toBe('stale')
    expect(h.updates).toHaveLength(0)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('does not treat an already-approved plan as the card when the content changed', async () => {
    const promo = draft(socialSpec(), 'approved')
    const result = await approvePlan({
      clientId: 'client-1',
      planId: 'plan-1',
      approvedBy: 'ray@example.com',
      expectedContentHash: '0000000000000000',
    })
    expect(result.kind).toBe('stale')
    expect(promoContentHash(promo)).not.toBe('0000000000000000')
    expect(h.updates).toHaveLength(0)
  })

  it('does not approve a plan that is already approved', async () => {
    draft(socialSpec(), 'approved')
    const result = await approvePlan({ clientId: 'client-1', planId: 'plan-1', approvedBy: 'ray@example.com', requireAllGreen: true })
    expect(result.kind).toBe('already_approved')
    expect(h.updates).toHaveLength(0)
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
