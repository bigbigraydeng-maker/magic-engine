import { describe, it, expect } from 'vitest'
import {
  pickPrescribeCandidates,
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
    budget_amount: 1500,
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

describe('buildIntake —— 一项都不许编', () => {
  const prior: PrescriptionIntake = {
    business_goal: 'PM 当初亲手填的业务目标',
    timeline_urgency: 'immediate',
    monthly_budget_aud: 9999,
    priority_dimensions: ['ads'],
    notes: '人工备注',
  }

  it('🔴 有上一份就照抄 —— 那是人真填的业务意图，系统没资格替他改写', () => {
    expect(buildIntake(goal(), { seo: 10 }, prior, NOW)).toEqual(prior)
  })

  it('没有上一份才现推，且每项都指得出来源', () => {
    const intake = buildIntake(goal(), { seo: 64, ai_visibility: 31, ads: 72 }, null, NOW)
    expect(intake.business_goal).toBe('把自然流量做到每月 800 次') // ← 目标标题
    expect(intake.monthly_budget_aud).toBe(1500) // ← 目标预算
    // 默认目标 2026-09-05 到期，离 NOW 32 天 → immediate。
    // 这正是 CTS / Oztop 现在进行中目标的真实到期日。
    expect(intake.timeline_urgency).toBe('immediate') // ← 目标结束日算出来的
    expect(intake.priority_dimensions).toEqual(['ai_visibility', 'seo', 'ads']) // ← 体检分数
    expect(intake.notes).toContain('自动推得')
  })

  it('🔴 目标没填预算 → 记 0，不替客户编一个数', () => {
    const intake = buildIntake(goal({ budget_amount: null as never }), { seo: 1 }, null, NOW)
    expect(intake.monthly_budget_aud).toBe(0)
  })

  it('体检一个维度都没采到 → 重点维度留空并写明，不硬塞', () => {
    const intake = buildIntake(goal(), { seo: null }, null, NOW)
    expect(intake.priority_dimensions).toEqual([])
    expect(intake.notes).toContain('未采到')
  })
})
