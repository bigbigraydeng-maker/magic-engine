import { describe, expect, it } from 'vitest'
import type { CampaignNarrative } from '@/lib/ads-strategy/evaluate'
import type { PrescriptionContent } from '@/types/diagnostic'
import { baseSpec } from './fixtures'
import type { PromoSpec } from '../spec'
import {
  budgetOccupies,
  claimFromAdsDaily,
  claimFromDiagnosticPrescription,
  claimFromMarketingPlan,
  judgeExclusiveClaim,
  type BudgetHold,
  type DiagnosticClaimInput,
  type ExclusiveClaim,
  type MarketingPlanClaimInput,
  type PrescriptionSource,
} from '../exclusive-claim'

const GOAL = 'goal-1'
const PERIOD = { period_start: '2026-11-01', period_end: '2026-11-30' }

function money(partial: {
  source?: PrescriptionSource
  id: string
  goal_id?: string | null
  approved?: boolean
  start?: string | null
  end?: string | null
  amount_cents?: number | null
  currency?: string | null
  segment_key?: string
  sale_ids?: readonly string[]
  budget?: BudgetHold
}): ExclusiveClaim {
  const budget = partial.budget ?? {
    kind: 'amount' as const,
    amount_cents: partial.amount_cents ?? 1000,
    currency: partial.currency ?? null,
    evidence: 'test',
  }
  return {
    source: partial.source ?? 'marketing_plan',
    id: partial.id,
    goal_id: partial.goal_id === undefined ? GOAL : partial.goal_id,
    approved: partial.approved ?? true,
    sale_ids: partial.sale_ids ?? [],
    segments: [{
      segment_key: partial.segment_key ?? 'segment',
      window: {
      start_date: 'start' in partial ? (partial.start ?? null) : '2026-11-01',
      end_date: 'end' in partial ? (partial.end ?? null) : '2026-11-30',
    },
      budget,
    }],
  }
}

function content(allocation: PrescriptionContent['budget_allocation'], phases: PrescriptionContent['phases'] = []): PrescriptionContent {
  return { summary: 'test', phases, kpi_targets: [], budget_allocation: allocation }
}

function diagnostic(partial: Partial<DiagnosticClaimInput> & Pick<DiagnosticClaimInput, 'id'>): DiagnosticClaimInput {
  return {
    id: partial.id,
    status: partial.status ?? 'approved',
    goal_id: partial.goal_id === undefined ? GOAL : partial.goal_id,
    content: partial.content === undefined ? content([{ dimension: 'ads', amount_aud: 10, percentage: 100 }]) : partial.content,
  }
}

function plan(partial: Partial<MarketingPlanClaimInput> & Pick<MarketingPlanClaimInput, 'id'>): MarketingPlanClaimInput {
  return {
    id: partial.id,
    status: partial.status ?? 'approved',
    start_date: partial.start_date === undefined ? '2026-11-01' : partial.start_date,
    end_date: partial.end_date === undefined ? '2026-11-30' : partial.end_date,
    plan_data: partial.plan_data === undefined ? { promo: baseSpec() } : partial.plan_data,
  }
}

function promo(phases: PromoSpec['phases'], goalId = GOAL): PromoSpec {
  return { ...baseSpec(), goal_id: goalId, phases }
}

function heldTwoPhase(): ExclusiveClaim {
  return claimFromMarketingPlan(plan({
    id: 'plan-a',
    plan_data: {
      promo: promo([
        {
          id: 'warm', name: '预热', start_date: '2026-11-01', end_date: '2026-11-14',
          steps: [adsStep('a1', 4000), adsStep('a2', 1000)],
        },
        {
          id: 'content', name: '内容', start_date: '2026-11-15', end_date: '2026-11-30',
          steps: [{ id: 'soc', kind: 'social_cadence', settings: { posts_per_week: 2, stories_per_week: 0, reels_per_month: 0 } }],
        },
      ]),
    },
  }))
}

function adsStep(id: string, cents: number, paused: { from: string; to: string }[] = []) {
  return {
    id,
    kind: 'ads_campaign' as const,
    settings: {
      ad_account_id: 'act_1',
      daily_budget_cents: cents,
      audience_ref: 'aud-1',
      creative_refs: [],
      placements: [],
      paused_ranges: paused,
    },
  }
}

describe('budgetOccupies', () => {
  it('显式 0 不占；缺失和读不到的金额占着，不当成 0', () => {
    expect(budgetOccupies({ kind: 'amount', amount_cents: 0, currency: 'AUD', evidence: 'zero' })).toBe(false)
    expect(budgetOccupies({ kind: 'none', evidence: 'no field' })).toBe(false)
    expect(budgetOccupies({ kind: 'unknown', evidence: 'missing' })).toBe(true)
    expect(budgetOccupies({ kind: 'amount', amount_cents: null, currency: null, evidence: 'unreadable' })).toBe(true)
    expect(budgetOccupies({ kind: 'amount', amount_cents: -5, currency: 'AUD', evidence: 'bad' })).toBe(true)
  })
})

describe('judgeExclusiveClaim', () => {
  it('没有已占用的处方时，可以认领', () => {
    const result = judgeExclusiveClaim([], money({ id: 'plan-b' }))
    expect(result.allowed).toBe(true)
    expect(result.conflicts).toEqual([])
  })

  it('同一目标、日期重叠的第二份已批准计划不能再占这段预算', () => {
    const held = money({ id: 'plan-a', start: '2026-11-01', end: '2026-11-20', amount_cents: 5000 })
    const next = money({ id: 'plan-b', start: '2026-11-10', end: '2026-11-30', amount_cents: 2000, approved: false })
    const result = judgeExclusiveClaim([held], next)
    expect(result.allowed).toBe(false)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({
      kind: 'budget_overlap',
      goal_id: GOAL,
      overlap: { start_date: '2026-11-10', end_date: '2026-11-20' },
      holder: { source: 'marketing_plan', id: 'plan-a', segment_key: 'segment' },
      candidate: { source: 'marketing_plan', id: 'plan-b', segment_key: 'segment' },
      sale_id: null,
    })
    expect(result.conflicts[0].reason).toContain('2026-11-10 至 2026-11-20')
    expect(result.conflicts[0].reason).toContain('不能再占这段预算')
    expect(JSON.stringify(result.conflicts)).not.toContain('7000')
  })

  it('日期只相接、不重叠时可以认领', () => {
    const held = money({ id: 'plan-a', start: '2026-11-01', end: '2026-11-14' })
    const next = money({ id: 'plan-b', start: '2026-11-15', end: '2026-11-30' })
    expect(judgeExclusiveClaim([held], next).allowed).toBe(true)
  })

  it('重叠的那一天（含两端）也算占了', () => {
    const held = money({ id: 'plan-a', end: '2026-11-14' })
    const next = money({ id: 'plan-b', start: '2026-11-14', end: '2026-11-14' })
    const result = judgeExclusiveClaim([held], next)
    expect(result.allowed).toBe(false)
    expect(result.conflicts[0].overlap).toEqual({ start_date: '2026-11-14', end_date: '2026-11-14' })
  })

  it('另一份目标上的已批准计划不挡这一份', () => {
    const held = money({ id: 'plan-a', goal_id: 'goal-other' })
    expect(judgeExclusiveClaim([held], money({ id: 'plan-b' })).allowed).toBe(true)
  })

  it('未批准的持有者不占预算', () => {
    expect(judgeExclusiveClaim([money({ id: 'plan-a', approved: false })], money({ id: 'plan-b' })).allowed).toBe(true)
  })

  it('跟自己比不算第二份', () => {
    const held = money({ id: 'plan-a' })
    expect(judgeExclusiveClaim([held], { ...held }).allowed).toBe(true)
  })

  it('来源不同、编号碰巧一样，仍是两份', () => {
    const held = money({ source: 'diagnostic_prescription', id: 'same' })
    const next = money({ source: 'marketing_plan', id: 'same' })
    expect(judgeExclusiveClaim([held], next).allowed).toBe(false)
  })

  it('目标编号对不上、日期又重叠时，不能当成不同目标放行', () => {
    const held = money({ id: 'plan-a', goal_id: null })
    const result = judgeExclusiveClaim([held], money({ id: 'plan-b' }))
    expect(result.allowed).toBe(false)
    expect(result.conflicts[0].kind).toBe('unknown_facts')
    expect(result.conflicts[0].reason).toContain('目标编号未知')
    expect(result.conflicts[0].goal_id).toBeNull()
  })

  it('日期读不到时不能当成错开', () => {
    const held = money({ id: 'plan-a', start: null, end: null })
    const result = judgeExclusiveClaim([held], money({ id: 'plan-b' }))
    expect(result.conflicts[0].kind).toBe('unknown_facts')
    expect(result.conflicts[0].reason).toContain('日期未知')
    expect(result.conflicts[0].overlap).toBeNull()
  })

  it('日期格式不对，跟没读到一样', () => {
    const held = money({ id: 'plan-a', start: '2026/11/01', end: '2026-11-30' })
    expect(judgeExclusiveClaim([held], money({ id: 'plan-b' })).conflicts[0].kind).toBe('unknown_facts')
  })

  it('结束日早于开始日，不能当成一段有效预算', () => {
    const held = money({ id: 'plan-a', start: '2026-11-20', end: '2026-11-01' })
    expect(judgeExclusiveClaim([held], money({ id: 'plan-b' })).conflicts[0].reason).toContain('日期未知')
  })

  it('金额未知仍占日期，原因里写明没有按 0', () => {
    const held = money({
      id: 'plan-a',
      budget: { kind: 'unknown', evidence: 'missing' },
    })
    const result = judgeExclusiveClaim([held], money({ id: 'plan-b' }))
    expect(result.allowed).toBe(false)
    expect(result.conflicts[0].reason).toContain('没有按 0 处理')
  })

  it('显式 0 的已批准计划不挡另一份占预算', () => {
    const held = money({ id: 'plan-a', amount_cents: 0 })
    expect(judgeExclusiveClaim([held], money({ id: 'plan-b' })).allowed).toBe(true)
  })

  it('币种不同也不相加、也不当成两段互不影响的预算', () => {
    const held = money({ id: 'plan-a', currency: 'AUD', amount_cents: 100, end: '2026-11-10' })
    const next = money({ id: 'plan-b', currency: 'NZD', amount_cents: 100, start: '2026-11-05' })
    const result = judgeExclusiveClaim([held], next)
    expect(result.allowed).toBe(false)
    expect(result.conflicts[0].kind).toBe('budget_overlap')
    expect(JSON.stringify(result)).not.toContain('200')
  })

  it('同一笔成交不能计入两份处方，即使日期错开、目标不同', () => {
    const held = money({
      source: 'diagnostic_prescription',
      id: 'dx-1',
      goal_id: 'goal-other',
      start: '2026-10-01',
      end: '2026-10-31',
      sale_ids: ['sale-9'],
    })
    const next = money({
      id: 'plan-b',
      start: '2026-12-01',
      end: '2026-12-31',
      sale_ids: [' sale-9 '],
    })
    const result = judgeExclusiveClaim([held], next)
    expect(result.allowed).toBe(false)
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'outcome_double_count',
        sale_id: 'sale-9',
        holder: { source: 'diagnostic_prescription', id: 'dx-1', segment_key: null },
        candidate: { source: 'marketing_plan', id: 'plan-b', segment_key: null },
      }),
    ])
    expect(result.conflicts[0].reason).toContain('成交 sale-9')
  })

  it('同一份处方再次带上同一笔成交，不算重复计入', () => {
    const held = money({ id: 'plan-a', sale_ids: ['sale-9'] })
    expect(judgeExclusiveClaim([held], { ...held, sale_ids: ['sale-9'] }).allowed).toBe(true)
  })

  it('成交编号是空的，不能计入', () => {
    const result = judgeExclusiveClaim([], money({ id: 'plan-b', sale_ids: ['  '] }))
    expect(result.allowed).toBe(false)
    expect(result.conflicts[0]).toMatchObject({ kind: 'unknown_facts', holder: null, sale_id: null })
    expect(result.conflicts[0].reason).toContain('成交编号未知')
  })

  it('预算重叠和成交重复一起返回', () => {
    const held = money({ id: 'plan-a', sale_ids: ['sale-1'] })
    const result = judgeExclusiveClaim([held], money({ id: 'plan-b', sale_ids: ['sale-1'] }))
    expect(result.conflicts.map(c => c.kind)).toEqual(['budget_overlap', 'outcome_double_count'])
  })

  it('未批准的持有者不锁成交', () => {
    const held = money({ id: 'plan-a', approved: false, sale_ids: ['sale-1'] })
    expect(judgeExclusiveClaim([held], money({ id: 'plan-b', sale_ids: ['sale-1'] })).allowed).toBe(true)
  })
})

describe('claim readers', () => {
  it('诊断处方只读已有字段：澳元明细换成分，日期用目标周期', () => {
    const claim = claimFromDiagnosticPrescription(
      diagnostic({
        id: 'dx-1',
        content: content([
          { dimension: 'ads', amount_aud: 1.5, percentage: 60 },
          { dimension: 'seo', amount_aud: 2.25, percentage: 40 },
        ]),
      }),
      PERIOD,
    )
    expect(claim).toMatchObject({
      source: 'diagnostic_prescription',
      id: 'dx-1',
      goal_id: GOAL,
      approved: true,
      sale_ids: [],
    })
    expect(claim.segments[0].budget).toMatchObject({ kind: 'amount', amount_cents: 375, currency: 'AUD' })
    expect(claim.segments[0].window).toEqual({ start_date: PERIOD.period_start, end_date: PERIOD.period_end })
  })

  it('诊断处方没有正文、或明细是空的，金额是未知不是 0', () => {
    expect(claimFromDiagnosticPrescription(diagnostic({ id: 'dx-1', content: null }), PERIOD).segments[0].budget.kind).toBe('unknown')
    const empty = claimFromDiagnosticPrescription(diagnostic({ id: 'dx-2', content: content([]) }), null)
    expect(empty.segments[0].budget).toEqual({
      kind: 'unknown',
      evidence: '诊断处方的预算明细是空的，缺失记为未知，不是 0',
    })
    expect(empty.segments[0].window).toEqual({ start_date: null, end_date: null })
    const blocked = judgeExclusiveClaim(
      [empty],
      money({ id: 'plan-b', goal_id: GOAL }),
    )
    expect(blocked.allowed).toBe(false)
    expect(blocked.conflicts[0].reason).toContain('未知')
  })

  it('诊断处方预算明细写了 0，不挡另一份占预算', () => {
    const claim = claimFromDiagnosticPrescription(
      diagnostic({ id: 'dx-0', content: content([{ dimension: 'ads', amount_aud: 0, percentage: 0 }]) }),
      PERIOD,
    )
    expect(claim.segments[0].budget).toMatchObject({ kind: 'amount', amount_cents: 0, currency: 'AUD' })
    expect(judgeExclusiveClaim([claim], money({ id: 'plan-b' })).allowed).toBe(true)
  })

  it('诊断处方只有占比、没有金额，按未知占住目标周期', () => {
    const claim = claimFromDiagnosticPrescription(
      diagnostic({
        id: 'dx-pct',
        content: content([], [{
          phase_number: 1,
          name: '阶段',
          duration_weeks: 4,
          actions: [],
          initiative_seed: {
            initiative_type: 'demand_generation',
            title: '阶段',
            budget_percent: 40,
          },
        }]),
      }),
      PERIOD,
    )
    expect(claim.segments[0].budget.kind).toBe('unknown')
    expect(claim.segments[0].budget.evidence).toContain('占比')
    expect(judgeExclusiveClaim([claim], money({ id: 'plan-b' })).allowed).toBe(false)
  })

  it('未批准或已替代的诊断处方不占', () => {
    const draft = claimFromDiagnosticPrescription(diagnostic({ id: 'dx-1', status: 'draft' }), PERIOD)
    const old = claimFromDiagnosticPrescription(diagnostic({ id: 'dx-0', status: 'superseded' }), PERIOD)
    expect(judgeExclusiveClaim([draft, old], money({ id: 'plan-b' })).allowed).toBe(true)
  })

  it('推广计划把同一阶段里的广告日预算加在一起，没有广告步骤的阶段不占', () => {
    const held = heldTwoPhase()
    expect(held.goal_id).toBe(GOAL)
    expect(held.segments[0].budget).toMatchObject({ kind: 'amount', amount_cents: 5000, currency: null })
    expect(held.segments[1].budget.kind).toBe('none')
  })

  it('只跟占了预算的阶段重叠才拒绝；跟不占预算的阶段重叠可以认领', () => {
    const held = heldTwoPhase()
    const overlapAds = claimFromMarketingPlan(plan({
      id: 'plan-b',
      plan_data: {
        promo: promo([{
          id: 'push', name: '投放', start_date: '2026-11-10', end_date: '2026-11-12',
          steps: [adsStep('b1', 3000)],
        }]),
      },
    }))
    const blocked = judgeExclusiveClaim([held], overlapAds)
    expect(blocked.allowed).toBe(false)
    expect(blocked.conflicts).toHaveLength(1)
    expect(blocked.conflicts[0].overlap).toEqual({ start_date: '2026-11-10', end_date: '2026-11-12' })
    expect(blocked.conflicts[0].holder).toMatchObject({ segment_key: 'phase:warm' })

    const overlapQuiet = claimFromMarketingPlan(plan({
      id: 'plan-c',
      plan_data: {
        promo: promo([{
          id: 'later', name: '后段', start_date: '2026-11-20', end_date: '2026-11-25',
          steps: [adsStep('c1', 3000)],
        }]),
      },
    }))
    expect(judgeExclusiveClaim([held], overlapQuiet).allowed).toBe(true)
  })

  it('暂停日仍属于已批准阶段，不能被另一份再占', () => {
    const held = claimFromMarketingPlan(plan({
      id: 'plan-a',
      plan_data: {
        promo: promo([{
          id: 'warm',
          name: '预热',
          start_date: '2026-11-01',
          end_date: '2026-11-14',
          steps: [adsStep('a1', 4000, [{ from: '2026-11-10', to: '2026-11-12' }])],
        }]),
      },
    }))
    const next = claimFromMarketingPlan(plan({
      id: 'plan-b',
      plan_data: {
        promo: promo([{
          id: 'gap',
          name: '暂停那几天',
          start_date: '2026-11-10',
          end_date: '2026-11-12',
          steps: [adsStep('b1', 1000)],
        }]),
      },
    }))
    expect(judgeExclusiveClaim([held], next).allowed).toBe(false)
  })

  it('推广结构读不出来时，用计划起止日期，预算记为未知', () => {
    const held = claimFromMarketingPlan(plan({
      id: 'plan-a',
      plan_data: { promo: { schema: 'nope' } },
      start_date: '2026-11-01',
      end_date: '2026-11-20',
    }))
    expect(held.goal_id).toBeNull()
    expect(held.segments[0].budget.kind).toBe('unknown')
    expect(held.segments[0].budget.evidence).toContain('不是 0')
    const next = claimFromMarketingPlan(plan({ id: 'plan-b' }))
    const result = judgeExclusiveClaim([held], next)
    expect(result.allowed).toBe(false)
    expect(result.conflicts[0].reason).toContain('目标编号未知')
  })

  it('已完成的推广计划不占；只有已批准才占', () => {
    const done = claimFromMarketingPlan(plan({ id: 'plan-a', status: 'completed' }))
    const archived = claimFromMarketingPlan(plan({ id: 'plan-old', status: 'archived' }))
    expect(judgeExclusiveClaim([done, archived], claimFromMarketingPlan(plan({ id: 'plan-b' }))).allowed).toBe(true)
  })

  it('广告日处方只读现有类型：有处方也不占预算，没有处方则没有段', () => {
    const prescription: NonNullable<CampaignNarrative['prescription']> = {
      kind: 'refresh_creatives',
      title: '从爆款池补新素材',
      why: '测试',
      executable: true,
    }
    const issued = claimFromAdsDaily({
      card: { campaign_id: 'camp-1', prescription },
      date: '2026-11-10',
      goal_id: GOAL,
    })
    expect(issued).toMatchObject({
      source: 'ads_daily',
      id: 'camp-1@2026-11-10',
      approved: false,
      sale_ids: [],
    })
    expect(issued.segments[0].budget).toMatchObject({ kind: 'none' })
    expect(issued.segments[0].budget.evidence).toContain('没有预算字段')

    const quiet = claimFromAdsDaily({
      card: { campaign_id: 'camp-1', prescription: null },
      date: '2026-11-10',
      goal_id: GOAL,
    })
    expect(quiet.segments).toEqual([])

    const planClaim = claimFromMarketingPlan(plan({ id: 'plan-b' }))
    expect(judgeExclusiveClaim([issued, quiet], planClaim).allowed).toBe(true)
  })

  it('三套来源里，占了预算的广告日认领会挡住重叠的推广计划', () => {
    const daily: ExclusiveClaim = {
      source: 'ads_daily',
      id: 'camp-1@2026-11-10',
      goal_id: GOAL,
      approved: true,
      sale_ids: [],
      segments: [{
        segment_key: 'day',
        window: { start_date: '2026-11-10', end_date: '2026-11-10' },
        budget: { kind: 'amount', amount_cents: 2500, currency: null, evidence: '调用方另行给出的预算，不是日处方类型上的字段' },
      }],
    }
    const diagnosticClaim = claimFromDiagnosticPrescription(diagnostic({ id: 'dx-1' }), PERIOD)
    const planClaim = claimFromMarketingPlan(plan({ id: 'plan-b' }))
    const againstDaily = judgeExclusiveClaim([daily], planClaim)
    expect(againstDaily.allowed).toBe(false)
    expect(againstDaily.conflicts[0]).toMatchObject({
      kind: 'budget_overlap',
      holder: { source: 'ads_daily', id: 'camp-1@2026-11-10' },
      candidate: { source: 'marketing_plan', id: 'plan-b' },
      overlap: { start_date: '2026-11-10', end_date: '2026-11-10' },
    })
    const againstDiagnostic = judgeExclusiveClaim([diagnosticClaim], planClaim)
    expect(againstDiagnostic.allowed).toBe(false)
    expect(againstDiagnostic.conflicts[0].holder).toMatchObject({ source: 'diagnostic_prescription' })
    expect(againstDiagnostic.conflicts[0].reason).toContain('诊断处方')
    expect(againstDiagnostic.conflicts[0].reason).toContain('推广计划')
  })
})
