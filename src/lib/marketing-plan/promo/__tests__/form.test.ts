import { describe, expect, it } from 'vitest'
import { addPhase, addStep, centsToYuan, newStep, removePhase, removeStep, setGoal, splitList, updatePhase, updateStep, yuanToCents } from '../form'
import { buildPromoTemplate } from '../template'
import { parsePromoSpec } from '../spec'

const base = () => buildPromoTemplate({ start_date: '2026-11-01', end_date: '2026-11-30' })

describe('元和分互转', () => {
  it('元转分四舍五入到分，空和非法给 0', () => {
    expect(yuanToCents('50')).toBe(5000)
    expect(yuanToCents('12.345')).toBe(1235)
    expect(yuanToCents('')).toBe(0)
    expect(yuanToCents('abc')).toBe(0)
    expect(yuanToCents('-5')).toBe(0)
  })
  it('分转元，0 显示为空', () => {
    expect(centsToYuan(5000)).toBe('50')
    expect(centsToYuan(0)).toBe('')
  })
})

describe('阶段与步骤增删改', () => {
  it('加步骤时编号不重复，即使删过', () => {
    let s = addStep(base(), 'phase-1', 'social_cadence')
    s = addStep(s, 'phase-1', 'social_cadence')
    s = removeStep(s, 'phase-1', s.phases[0].steps[0].id)
    s = addStep(s, 'phase-1', 'blog_article')
    const ids = s.phases[0].steps.map(x => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('加阶段给新编号，删阶段至少保留一个', () => {
    let s = addPhase(base())
    expect(s.phases.map(p => p.id)).toEqual(['phase-1', 'phase-2'])
    s = removePhase(s, 'phase-2')
    s = removePhase(s, 'phase-1')
    expect(s.phases).toHaveLength(1)
  })
  it('改阶段只动目标阶段，改目标不动阶段', () => {
    const s = updatePhase(addPhase(base()), 'phase-2', { name: '主推' })
    expect(s.phases[0].name).toBe('阶段 1')
    expect(s.phases[1].name).toBe('主推')
    expect(setGoal(s, 'g1').phases).toBe(s.phases)
  })
  it('改步骤按编号替换', () => {
    const s = addStep(base(), 'phase-1', 'social_cadence')
    const step = { ...s.phases[0].steps[0], settings: { posts_per_week: 5, stories_per_week: 0, reels_per_month: 0 } }
    expect(updateStep(s, 'phase-1', step as never).phases[0].steps[0]).toEqual(step)
  })
  it('四类新步骤填完必填项后能通过推广计划校验', () => {
    let s = updatePhase(base(), 'phase-1', { start_date: '2026-11-01', end_date: '2026-11-30' })
    s = { ...s, goal_id: 'g1' }
    for (const k of ['ads_campaign', 'social_cadence', 'blog_article', 'newsletter_email'] as const) s = addStep(s, 'phase-1', k)
    const filled = s.phases[0].steps.map(st => {
      if (st.kind === 'ads_campaign') return { ...st, settings: { ...st.settings, ad_account_id: 'a', daily_budget_cents: 100, audience_ref: 'x' } }
      if (st.kind === 'blog_article') return { ...st, settings: { ...st.settings, topic: 't', due_date: '2026-11-10' } }
      if (st.kind === 'newsletter_email') return { ...st, settings: { ...st.settings, topic: 't', due_date: '2026-11-10' } }
      return st
    })
    s = { ...s, phases: [{ ...s.phases[0], steps: filled }] }
    expect(parsePromoSpec(s).ok).toBe(true)
  })
  it('新步骤的空必填项保存会被校验拒绝（不会悄悄存进空预算）', () => {
    const s = { ...addStep(base(), 'phase-1', 'ads_campaign'), goal_id: 'g' }
    expect(parsePromoSpec(s).ok).toBe(false)
    expect(newStep('ads_campaign', 'x').kind).toBe('ads_campaign')
  })
})

describe('splitList', () => {
  it('支持逗号、中文逗号、换行，去空去重', () => {
    expect(splitList('a, b，b\n\n c ')).toEqual(['a', 'b', 'c'])
  })
})
