import { describe, expect, it } from 'vitest'
import { expandPromoSchedule } from '../schedule'
import { buildScheduleView } from '../schedule-view'
import { DEFAULT_PROMO_PLAYBOOK as PB } from '../playbooks'
import type { PromoSpec, PromoStep } from '../spec'

const social: PromoStep = { id: 'soc', kind: 'social_cadence', settings: { posts_per_week: 3, stories_per_week: 3, reels_per_month: 4 } }
const ads: PromoStep = {
  id: 'ads', kind: 'ads_campaign',
  settings: { daily_budget_cents: 2000, audience_ref: 'aud-1', paused_ranges: [] },
} as unknown as PromoStep
const mail: PromoStep = { id: 'nl', kind: 'newsletter_email', settings: { topic: '十一月邮件', due_date: '2026-11-10' } } as unknown as PromoStep
const spec: PromoSpec = {
  schema: 'promo_v1', goal_id: 'g', checks: [],
  phases: [
    { id: 'p1', name: '拉新', start_date: '2026-10-19', end_date: '2026-11-01', steps: [social, ads] },
    { id: 'p2', name: '收割', start_date: '2026-11-02', end_date: '2026-11-22', steps: [social, mail] },
  ],
}
const today = '2026-10-21' // 周三
const view = buildScheduleView(expandPromoSchedule(spec, PB), today, { p1: '拉新', p2: '收割' })

describe('buildScheduleView', () => {
  it('帖子和快拍不逐日列出，只在汇总里出现', () => {
    expect(view.routine).toMatch(/帖子 \d+ 条/)
    const allText = view.weeks.flatMap(w => w.days.map(d => d.text)).join('|')
    expect(allText).not.toContain('发一条帖子')
    expect(allText).not.toContain('发一条快拍')
  })
  it('广告“需要另行批准”只在表头出现一次，逐日行里没有', () => {
    expect(view.adsNote).toContain('另行批准')
    expect(view.weeks.flatMap(w => w.days.map(d => d.text)).join('|')).not.toContain('另行批准')
    expect(view.weeks.flatMap(w => w.days).find(d => d.kinds.includes('ads_start'))?.text).toMatch(/^开投/)
  })
  it('只展开本周和下周，其余按周折叠成小结', () => {
    const expanded = view.weeks.filter(w => w.expanded).map(w => w.weekStart)
    expect(expanded).toEqual(['2026-10-19', '2026-10-26'])
    const folded = view.weeks.find(w => w.weekStart === '2026-11-09')
    expect(folded?.expanded).toBe(false)
    expect(folded?.summary).toContain('11/09 周')
    expect(folded?.summary).toContain('邮件 1')
  })
  it('阶段切换日单独标出，每天最多一行', () => {
    const switchDay = view.weeks.flatMap(w => w.days).find(d => d.phaseSwitch)
    expect(switchDay?.date).toBe('2026-11-02')
    expect(switchDay?.text).toContain('进入阶段：收割')
    const dates = view.weeks.flatMap(w => w.days.map(d => d.date))
    expect(new Set(dates).size).toBe(dates.length)
  })
  it('本周和下周即使没事也在列表里', () => {
    const empty = buildScheduleView({ days: [], totals: { post: 0, story: 0, reel: 0, blog: 0, newsletter: 0, ads_start: 0 }, notes: [], error: null, too_dense: false }, today)
    expect(empty.weeks.map(w => w.weekStart)).toEqual(['2026-10-19', '2026-10-26'])
    expect(empty.routine).toBe('这份计划没有排帖子和快拍')
  })
})
