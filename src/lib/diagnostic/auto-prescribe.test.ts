import { describe, it, expect } from 'vitest'
import {
  pickPrescribeCandidates,
  pickGoalForPrescription,
  lowestDimensions,
  urgencyFromGoal,
  buildIntake,
  DIAGNOSIS_FRESH_DAYS,
  REPRESCRIBE_COOLDOWN_DAYS,
  type CompletedRun,
} from './auto-prescribe'
import type { GoalRow } from '@/types/strategy'
import type { PrescriptionIntake } from '@/types/diagnostic'

const NOW = new Date('2026-08-04T00:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

const run = (
  id: string,
  clientId: string,
  ago: number,
  scores: CompletedRun['dimensionScores'] = { seo: 60 },
): CompletedRun => ({ id, clientId, createdAt: daysAgo(ago), dimensionScores: scores })

const goal = (over: Partial<GoalRow> = {}): GoalRow =>
  ({
    id: 'g1',
    title: '把自然流量做到每月 800 次',
    // 生产库实测：CTS / Oztop **全部**进行中目标的 budget_amount 都是 null。
    // 默认值取 null 才是真实形状，别拿一个"看起来合理"的数当默认。
    budget_amount: null,
    period_end: '2026-09-05',
    ...over,
  }) as GoalRow

describe('pickPrescribeCandidates —— 给错客户开方比给错客户体检更贵', () => {
  it('这周体检过、没出过方 → 该开方', () => {
    const { candidates } = pickPrescribeCandidates([run('r1', 'cts', 1)], new Map(), NOW)
    expect(candidates.map((c) => c.clientId)).toEqual(['cts'])
    expect(candidates[0].runId).toBe('r1')
  })

  it('🔴 体检太旧不开方 —— 照两个月前的结果开方等于开错药', () => {
    const { candidates, skipped } = pickPrescribeCandidates(
      [run('r1', 'cts', DIAGNOSIS_FRESH_DAYS + 2)],
      new Map(),
      NOW,
    )
    expect(candidates).toEqual([])
    expect(skipped[0].reason).toBe('no_fresh_diagnosis')
  })

  it('冷却期内刚出过方 → 不重复出', () => {
    const { candidates, skipped } = pickPrescribeCandidates(
      [run('r1', 'cts', 1)],
      new Map([['cts', daysAgo(2)]]),
      NOW,
    )
    expect(candidates).toEqual([])
    expect(skipped[0].reason).toBe('prescribed_recently')
  })

  it('过了冷却期就再开', () => {
    const { candidates } = pickPrescribeCandidates(
      [run('r1', 'cts', 1)],
      new Map([['cts', daysAgo(REPRESCRIBE_COOLDOWN_DAYS + 1)]]),
      NOW,
    )
    expect(candidates).toHaveLength(1)
  })

  it('🔴 一个客户这周跑了两次体检 → 只按最新那次开方，不出两份', () => {
    const { candidates } = pickPrescribeCandidates(
      [run('old', 'cts', 5), run('new', 'cts', 1)],
      new Map(),
      NOW,
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].runId).toBe('new')
  })

  it('每个跳过的都要有原因 —— 「这周没开方」必须能查出为什么', () => {
    const { skipped } = pickPrescribeCandidates(
      [run('r1', 'a', 30), run('r2', 'b', 1)],
      new Map([['b', daysAgo(1)]]),
      NOW,
    )
    expect(skipped).toHaveLength(2)
    expect(skipped.every((s) => s.detail.length > 0)).toBe(true)
  })

  it('空输入不炸', () => {
    expect(pickPrescribeCandidates([], new Map(), NOW)).toEqual({ candidates: [], skipped: [] })
  })
})

describe('lowestDimensions —— 没采到 ≠ 零分', () => {
  it('挑得分最低的三个', () => {
    expect(
      lowestDimensions({ ads: 72, seo: 64, social: 45, competitor: 52, reputation: 78, ai_visibility: 31 }),
    ).toEqual(['ai_visibility', 'social', 'competitor'])
  })

  it('🔴 null 的维度不算最低 —— 那是「这次没采着」，不是零分。把没数据的当最差报给 AI，AI 就会照着一块空地开方', () => {
    // 生产库真实数据（Oztop 2026-07-08 那次体检）
    const real = { ads: 31, seo: null, social: null, competitor: null, reputation: 71, ai_visibility: 16 }
    expect(lowestDimensions(real)).toEqual(['ai_visibility', 'ads', 'reputation'])
  })

  it('一个分数都没采到 → 返回空，不硬凑', () => {
    expect(lowestDimensions({ seo: null, ads: null })).toEqual([])
    expect(lowestDimensions(null)).toEqual([])
  })
})

describe('urgencyFromGoal —— 按日期算，不猜', () => {
  it('一个多月内到期 = 马上要', () => {
    expect(urgencyFromGoal(goal({ period_end: '2026-08-20' }), NOW)).toBe('immediate')
  })
  it('三个月内 = 近期', () => {
    expect(urgencyFromGoal(goal({ period_end: '2026-10-20' }), NOW)).toBe('short_term')
  })
  it('半年后 = 长线', () => {
    expect(urgencyFromGoal(goal({ period_end: '2027-06-02' }), NOW)).toBe('long_term')
  })
  it('没填结束日期不炸', () => {
    expect(urgencyFromGoal(goal({ period_end: null as never }), NOW)).toBe('short_term')
  })
})

describe('pickGoalForPrescription —— 一个客户好几个目标时挂哪个', () => {
  it('🔴 挂最先到期的那个，不是"最近建的"', () => {
    // 生产库真实形状：CTS 3 个、Oztop 4 个进行中目标，创建时间戳一模一样
    //（2026-06-04 16:25:32 批量建的），按"最近建的"挑等于随便挑一个还看不出来
    const picked = pickGoalForPrescription([
      goal({ id: 'a', title: '慢的', period_end: '2026-12-01' }),
      goal({ id: 'b', title: '最急的', period_end: '2026-08-20' }),
      goal({ id: 'c', title: '中间的', period_end: '2026-10-01' }),
    ])
    expect(picked!.title).toBe('最急的')
  })

  it('一个目标都没有 → 返回 null，不硬挑', () => {
    expect(pickGoalForPrescription([])).toBeNull()
  })

  it('目标都没填到期日 → 不炸，退回第一个', () => {
    const picked = pickGoalForPrescription([goal({ id: 'a', period_end: null as never })])
    expect(picked!.id).toBe('a')
  })
})

describe('buildIntake —— 一项都不许编，跟目标走的每次重算', () => {
  const prior: PrescriptionIntake = {
    business_goal: '3个月内产生15位flooring客户',
    timeline_urgency: 'long_term',
    monthly_budget_aud: 3000,
    priority_dimensions: ['ads'],
    notes: '人工备注',
  }

  it('🔴 业务目标永远等于本次挂的那个目标 —— 不许照抄上一份的旧口径', () => {
    // 真实事故形状：库里 Oztop 最近一份口径是 5/14 填的「3个月内产生15位flooring客户」，
    // 而目标是 6/4 建的《Oztop Walnut 地板清仓》。照抄等于让 AI 两头都够不着。
    const intake = buildIntake(goal({ title: 'Oztop Walnut 地板清仓' }), { seo: 10 }, prior, NOW)
    expect(intake.business_goal).toBe('Oztop Walnut 地板清仓')
    // 人填过的那句话不丢，降级成背景写进备注
    expect(intake.notes).toContain('3个月内产生15位flooring客户')
    expect(intake.notes).toContain('不是本次的目标')
  })

  it('🔴 重点维度每次用本周体检重算 —— 冻在旧口径等于每周白采数据', () => {
    const intake = buildIntake(goal(), { seo: 64, ai_visibility: 31, ads: 72 }, prior, NOW)
    expect(intake.priority_dimensions).toEqual(['ai_visibility', 'seo', 'ads'])
    expect(intake.priority_dimensions).not.toEqual(prior.priority_dimensions)
  })

  it('🔴 紧迫度按本次目标的到期日算，不照抄', () => {
    const intake = buildIntake(goal({ period_end: '2026-08-20' }), { seo: 1 }, prior, NOW)
    expect(intake.timeline_urgency).toBe('immediate')
    expect(prior.timeline_urgency).toBe('long_term') // 上一份说的是别的
  })

  it('目标自带预算 → 用目标的', () => {
    const intake = buildIntake(goal({ budget_amount: 1500 }), { seo: 1 }, prior, NOW)
    expect(intake.monthly_budget_aud).toBe(1500)
    expect(intake.notes).toContain('目标自带预算')
  })

  it('🔴 目标没填预算但人工填过 → 沿用人工的，并写明这是沿用来的', () => {
    // 生产库实测：CTS/Oztop 全部进行中目标的预算字段都是空的
    const intake = buildIntake(goal({ budget_amount: null as never }), { seo: 1 }, prior, NOW)
    expect(intake.monthly_budget_aud).toBe(3000)
    expect(intake.notes).toContain('沿用')
  })

  it('🔴 两边都没预算 → 记 0，不替客户编一个数', () => {
    const intake = buildIntake(goal({ budget_amount: null as never }), { seo: 1 }, null, NOW)
    expect(intake.monthly_budget_aud).toBe(0)
  })

  it('没有上一份时，业务目标仍然是目标标题，且写明没人填过', () => {
    const intake = buildIntake(goal(), { seo: 64, ai_visibility: 31, ads: 72 }, null, NOW)
    expect(intake.business_goal).toBe('把自然流量做到每月 800 次')
    expect(intake.notes).toContain('没有人工填过')
  })

  it('体检一个维度都没采到 → 重点维度留空并写明，不硬塞', () => {
    const intake = buildIntake(goal(), { seo: null }, null, NOW)
    expect(intake.priority_dimensions).toEqual([])
    expect(intake.notes).toContain('未采到')
  })
})
