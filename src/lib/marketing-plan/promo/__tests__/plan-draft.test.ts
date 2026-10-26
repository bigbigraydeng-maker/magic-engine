import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parsePromoSpec } from '../spec'
import { planDraftId, uuidV5 } from '../plan-draft-id'
import {
  delayBeforePlanDraftAttempt,
  AccountReadError,
  planDraftFailureDisposition,
} from '../plan-draft-retry'
import { planDraftCardLine, PLAN_DRAFT_OVERLAP_NOTE } from '../plan-draft-card'
import { attemptPlanDraft } from '../plan-draft-attempt'
import type { DraftPrescriptionRow, PlanDraftDeps, PlanDraftInsert } from '../plan-draft-types'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'
import { countryFromSemrushDb } from '../plan-draft-deps'

const PERIOD = { start_date: '2026-11-01', end_date: '2026-11-30' }

function field<T>(value: T) {
  return {
    ok: true as const,
    value,
    basis: [{ label: 'test', value: String(value), source: 'test', as_of: null }],
    notes: [] as string[],
  }
}

function emptyField(why: string) {
  return { ok: false as const, why_empty: why, notes: [] as string[] }
}

function seed(steps: PlanSeed['ad_steps'], notes: string[] = []): PlanSeed {
  return {
    schema_version: 1,
    produced_by: 'ads-agent',
    facts_as_of: '2026-10-26T00:00:00.000Z',
    currency: 'AUD',
    period: PERIOD,
    captured_at: {},
    ad_steps: steps,
    skipped: [],
    notes,
  }
}

function draft(over: Partial<DraftPrescriptionRow> = {}): DraftPrescriptionRow {
  return {
    id: 'rx-1',
    client_id: 'client-1',
    status: 'draft',
    version: 3,
    goal_id: 'goal-1',
    content: { phases: [] },
    generation_meta: {},
    updated_at: '2026-10-26T00:00:00.000Z',
    ...over,
  }
}

function deps(over: Partial<PlanDraftDeps> = {}): PlanDraftDeps {
  return {
    now: () => new Date('2026-10-26T01:00:00.000Z'),
    enabledClientIds: () => ['client-1'],
    loadPrescription: async () => draft(),
    readPlays: () => [{ step_key: 'play-1', play: 'lead_form_harvest' }],
    loadPeriod: async () => PERIOD,
    loadGoalTitle: async () => '十月推广',
    loadCountry: async () => 'AU',
    loadAccounts: async () => [{
      ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 100000, owned_by_client: true,
    }],
    loadClientCapCents: async () => 200000,
    buildSeed: async () => seed([{
      step_key: 'play-1',
      play: 'lead_form_harvest',
      page_id: field('page-1'),
      ad_account_id: field('act_1'),
      daily_budget_cents: field(5000),
    }]),
    hasApprovedPlan: async () => false,
    insertPlan: vi.fn(async () => 'created' as const),
    writeReceipt: vi.fn(async () => undefined),
    recordRun: vi.fn(async () => undefined),
    scheduleRetry: vi.fn(async () => undefined),
    ...over,
  }
}

function request(over: Partial<Parameters<typeof attemptPlanDraft>[0]> = {}) {
  return {
    clientId: 'client-1',
    prescriptionId: 'rx-1',
    version: 3,
    attempt: 1,
    requestId: 'req-1',
    ...over,
  }
}

describe('plan draft id', () => {
  it('matches the RFC 4122 DNS test vector and changes with the version', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'))
      .toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
    const first = planDraftId('rx-1', 3)
    const second = planDraftId('rx-1', 4)
    expect(first).not.toBe(second)
    expect(first[14]).toBe('5')
    expect(planDraftId('rx-1', 3)).toBe(first)
  })
})

describe('plan draft retry', () => {
  it('waits 30 minutes then 2 hours, and the third failure escalates', () => {
    expect(delayBeforePlanDraftAttempt(1)).toBeNull()
    expect(delayBeforePlanDraftAttempt(2)).toBe(30 * 60 * 1000)
    expect(delayBeforePlanDraftAttempt(3)).toBe(2 * 60 * 60 * 1000)
    expect(delayBeforePlanDraftAttempt(4)).toBeNull()
    expect(planDraftFailureDisposition(1, new Error('socket hang up')).retryable).toBe(true)
    expect(planDraftFailureDisposition(2, new Error('ECONNRESET')).retryable).toBe(true)
    const third = planDraftFailureDisposition(3, new AccountReadError())
    expect(third).toEqual({ retryable: false, escalated: true })
    expect(planDraftFailureDisposition(1, new Error('budget over')).retryable).toBe(false)
  })
})

describe('attemptPlanDraft', () => {
  it('creates one unapproved draft from an owned account, budget, and configured country', async () => {
    const used = deps()
    const outcome = await attemptPlanDraft(request(), used)
    expect(outcome.receipt?.status).toBe('created')
    expect(outcome.receipt?.reason_text).toContain('未批准')
    expect(outcome.receipt?.no_publish).toBe(true)
    expect(outcome.receipt?.authorization).toBe('none')
    const row = vi.mocked(used.insertPlan).mock.calls[0][0] as PlanDraftInsert
    expect(row.status).toBe('draft')
    expect(row.approved_at).toBeNull()
    expect(row.id).toBe(planDraftId('rx-1', 3))
    expect(row.plan_data.promo.checks).toEqual([])
    expect(row.plan_data.promo.gate_snapshot).toBeUndefined()
    expect(row.generation_meta).not.toHaveProperty('approval_receipt')
    expect(row.generation_meta).not.toHaveProperty('promo_checks')
    expect(row.generation_meta.from_prescription).toEqual({
      prescription_id: 'rx-1', version: 3, facts_as_of: '2026-10-26T00:00:00.000Z',
    })
    const step = row.plan_data.promo.phases[0].steps[0]
    if (step.kind !== 'ads_campaign') throw new Error('expected an ads step')
    expect(step.settings.audience_ref).toBe('')
    expect(step.settings.targeting?.countries).toEqual(['AU'])
    expect(parsePromoSpec(row.plan_data.promo).ok).toBe(true)
    expect(used.scheduleRetry).not.toHaveBeenCalled()
  })

  it('does not insert a plan when the prescription has no ad plays', async () => {
    const used = deps({ readPlays: () => [] })
    const outcome = await attemptPlanDraft(request(), used)
    expect(outcome.receipt?.status).toBe('skipped')
    expect(outcome.receipt?.reason_code).toBe('missing_ad_plays')
    expect(outcome.receipt?.reason_text).toContain('没有广告打法')
    expect(used.insertPlan).not.toHaveBeenCalled()
    expect(used.scheduleRetry).not.toHaveBeenCalled()
  })

  it('does not invent numbers or a country when every read is empty', async () => {
    const used = deps({
      loadCountry: async () => null,
      loadAccounts: async () => [],
      buildSeed: async () => seed([{
        step_key: 'play-1',
        play: 'lead_form_harvest',
        page_id: emptyField('读不到'),
        ad_account_id: emptyField('读不到'),
        daily_budget_cents: emptyField('读不到'),
      }]),
    })
    await attemptPlanDraft(request(), used)
    expect(used.insertPlan).not.toHaveBeenCalled()
  })

  it('treats a repeated key as already existing, including after archive', async () => {
    const used = deps({ insertPlan: vi.fn(async () => 'already_exists' as const) })
    const outcome = await attemptPlanDraft(request(), used)
    expect(outcome.receipt?.status).toBe('already_exists')
    expect(outcome.receipt?.plan_id).toBe(planDraftId('rx-1', 3))
    expect(outcome.receipt?.reason_text).toContain('没有再生成第二份')
    expect(used.insertPlan).toHaveBeenCalledTimes(1)
  })

  it('schedules a retry for a network failure and escalates the third one', async () => {
    const first = deps({ buildSeed: async () => { throw new Error('fetch failed') } })
    const again = await attemptPlanDraft(request(), first)
    expect(again.retryable).toBe(true)
    expect(again.receipt?.reason_text).toContain('已自动重试')
    expect(first.scheduleRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2 }))
    expect(first.insertPlan).not.toHaveBeenCalled()

    const third = deps({ buildSeed: async () => { throw new Error('503') } })
    const done = await attemptPlanDraft(request({ attempt: 3 }), third)
    expect(done.retryable).toBe(false)
    expect(done.receipt?.escalated).toBe(true)
    expect(done.receipt?.reason_text).toContain('今日待办')
    expect(third.scheduleRetry).not.toHaveBeenCalled()
    expect(third.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', needsHuman: true,
    }))
  })

  it('does not retry a budget that is definitely over the cap', async () => {
    const used = deps({
      loadAccounts: async () => [{
        ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 100, owned_by_client: true,
      }],
    })
    const outcome = await attemptPlanDraft(request(), used)
    expect(outcome.receipt?.reason_code).toBe('budget_over')
    expect(outcome.retryable).toBe(false)
    expect(used.insertPlan).not.toHaveBeenCalled()
    expect(used.scheduleRetry).not.toHaveBeenCalled()
  })

  it('retries when the account list cannot be read, and drops an unowned account', async () => {
    const unread = deps({ loadAccounts: async () => { throw new AccountReadError() } })
    const retried = await attemptPlanDraft(request(), unread)
    expect(retried.retryable).toBe(true)
    expect(unread.insertPlan).not.toHaveBeenCalled()

    const foreign = deps({ loadAccounts: async () => [] })
    const dropped = await attemptPlanDraft(request(), foreign)
    expect(dropped.retryable).toBe(false)
    expect(dropped.receipt?.reason_text).toContain('不属于这个客户')
    expect(foreign.insertPlan).not.toHaveBeenCalled()
  })

  it('writes nothing in dry run', async () => {
    const used = deps()
    const outcome = await attemptPlanDraft(request({ dryRun: true }), used)
    expect(outcome.wrote).toBe(false)
    expect(outcome.receipt?.status).toBe('dry_run')
    expect(used.insertPlan).not.toHaveBeenCalled()
    expect(used.writeReceipt).not.toHaveBeenCalled()
    expect(used.recordRun).not.toHaveBeenCalled()
    expect(used.scheduleRetry).not.toHaveBeenCalled()
  })

  it('skips a client that is not on the whitelist', async () => {
    const buildSeed = vi.fn(async () => seed([]))
    const used = deps({ enabledClientIds: () => [], buildSeed })
    const outcome = await attemptPlanDraft(request(), used)
    expect(outcome.receipt?.reason_code).toBe('not_enabled')
    expect(used.insertPlan).not.toHaveBeenCalled()
    expect(buildSeed).not.toHaveBeenCalled()
  })

  it('does not write when the prescription is already approved', async () => {
    const used = deps({ loadPrescription: async () => draft({ status: 'approved' }) })
    const outcome = await attemptPlanDraft(request(), used)
    expect(outcome.wrote).toBe(false)
    expect(outcome.receipt).toBeNull()
    expect(used.insertPlan).not.toHaveBeenCalled()
    expect(used.writeReceipt).not.toHaveBeenCalled()
    expect(used.recordRun).not.toHaveBeenCalled()
  })

  it('says the goal has no period instead of guessing dates', async () => {
    const used = deps({ loadPeriod: async () => null })
    const outcome = await attemptPlanDraft(request(), used)
    expect(outcome.receipt?.reason_text).toBe('目标没有推广周期。')
    expect(used.insertPlan).not.toHaveBeenCalled()
  })

  it('adds the overlap note when an approved plan is already on the goal', async () => {
    const used = deps({ hasApprovedPlan: async () => true })
    const outcome = await attemptPlanDraft(request(), used)
    expect(outcome.receipt?.reason_text).toContain(PLAN_DRAFT_OVERLAP_NOTE)
    expect(outcome.receipt?.overlap_note).toBe(PLAN_DRAFT_OVERLAP_NOTE)
  })

  it('records a succeeded run when the draft is created', async () => {
    const used = deps()
    await attemptPlanDraft(request(), used)
    expect(used.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded',
      needsHuman: false,
      goalId: 'goal-1',
    }))
  })
})

describe('card line and country', () => {
  it('shows the receipt text, or says there is no record yet', () => {
    expect(planDraftCardLine(null)).toBe('计划草稿还没有生成记录。')
    expect(planDraftCardLine({ plan_draft: { reason_text: '已起草' } })).toBe('已起草')
  })

  it('reads only au and nz from client config', () => {
    expect(countryFromSemrushDb('au')).toBe('AU')
    expect(countryFromSemrushDb('NZ')).toBe('NZ')
    expect(countryFromSemrushDb('us')).toBeNull()
    expect(countryFromSemrushDb(null)).toBeNull()
  })
})

describe('plan draft boundaries', () => {
  const files = [
    'src/lib/marketing-plan/promo/plan-draft-id.ts',
    'src/lib/marketing-plan/promo/plan-draft-retry.ts',
    'src/lib/marketing-plan/promo/plan-draft-card.ts',
    'src/lib/marketing-plan/promo/plan-draft-map.ts',
    'src/lib/marketing-plan/promo/plan-draft-build.ts',
    'src/lib/marketing-plan/promo/plan-draft-attempt.ts',
    'src/lib/marketing-plan/promo/plan-draft-kernel.ts',
    'src/lib/marketing-plan/promo/plan-draft-receipt.ts',
    'src/lib/marketing-plan/promo/plan-draft-schedule.ts',
    'src/lib/marketing-plan/promo/plan-draft-deps.ts',
    'src/lib/marketing-plan/promo/plan-draft-hook.ts',
    'src/lib/marketing-plan/promo/plan-draft-types.ts',
    'src/lib/inngest/functions/plan-draft-from-prescription.ts',
    'src/lib/pm-todo/plan-draft-failure-items.ts',
  ]

  it('does not reference a Meta write module', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toContain('ad-publisher')
      expect(source).not.toContain('meta-ads/execute')
      expect(source).not.toContain('updateCampaignBudget')
    }
  })

  it('does not draft a plan from the approve route', () => {
    const source = readFileSync('src/app/api/clients/[id]/prescription/[pId]/route.ts', 'utf8')
    const patch = source.slice(source.indexOf('export async function PATCH'))
    expect(patch).not.toContain('afterPrescriptionDraftSaved')
    expect(patch).not.toContain('attemptPlanDraft')
    expect(patch).not.toContain('schedulePlanDraftRetry')
    expect(source).toContain('plan_draft_line')
  })
})
