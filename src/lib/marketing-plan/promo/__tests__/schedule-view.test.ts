import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { expandPromoSchedule } from '../schedule'
import { buildScheduleView, todayInNz } from '../schedule-view'
import { DEFAULT_PROMO_PLAYBOOK as PB } from '../playbooks'
import type { PromoSpec, PromoStep } from '../spec'
import { ScheduleTable } from '@/app/dashboard/clients/[id]/promo-plan/_components/ScheduleTable'

const social = (posts: number, reels = 4, id = 'soc'): PromoStep =>
  ({ id, kind: 'social_cadence', settings: { posts_per_week: posts, stories_per_week: 3, reels_per_month: reels } })
const ads = (id: string, cents: number, aud = '52551185747273'): PromoStep =>
  ({ id, kind: 'ads_campaign', settings: { ad_account_id: 'act_1', daily_budget_cents: cents, audience_ref: aud, creative_refs: [], placements: [], paused_ranges: [] } }) as unknown as PromoStep
const mail: PromoStep = { id: 'nl', kind: 'newsletter_email', settings: { topic: '十一月邮件', due_date: '2026-11-10' } } as unknown as PromoStep
const spec: PromoSpec = {
  schema: 'promo_v1', goal_id: 'g', checks: [],
  phases: [
    { id: 'p1', name: '拉新', start_date: '2026-10-19', end_date: '2026-11-01', steps: [social(3), ads('a1', 1500), ads('a2', 4500)] },
    { id: 'p2', name: '收割', start_date: '2026-11-02', end_date: '2026-11-22', steps: [social(1), mail, ads('a3', 2000)] },
  ],
}
const phases = spec.phases.map(p => ({ id: p.id, name: p.name, start_date: p.start_date }))
const sched = expandPromoSchedule(spec, PB)
const today = '2026-10-21' // 周三
const view = buildScheduleView(sched, today, phases)
const lines = view.weeks.flatMap(w => w.days)

describe('buildScheduleView', () => {
  it('帖子和快拍不逐日列出，汇总写出每周几条', () => {
    expect(view.routine).toMatch(/帖子每周约 \d+ 条、快拍每周约 \d+ 条/)
    const allText = lines.map(d => d.text).join('|')
    expect(allText).not.toContain('发一条帖子')
    expect(allText).not.toContain('发一条快拍')
  })
  it('只有第一阶段第一天写「开投」，同一天多条广告合成一句、不带数字受众', () => {
    const first = lines.find(d => d.date === '2026-10-19')
    expect(first?.text).toBe('开投：每天预算合计 60（15 + 45）')
    expect(first?.text).not.toContain('52551185747273')
    expect(lines.filter(d => d.text.includes('开投：'))).toHaveLength(1)
  })
  it('后面阶段首日写进入阶段（用阶段开始日，不是该阶段第一件事的日子）', () => {
    const d = lines.find(l => l.phaseSwitch === '收割')
    expect(d?.date).toBe('2026-11-02')
    expect(d?.text).toBe('进入阶段：收割，每天预算合计 20')
    expect(d?.text).not.toContain('开投')
  })
  it('阶段只有每周 1 帖时，阶段切换日也不会被挪到第一个帖子的日子', () => {
    const only: PromoSpec = { ...spec, phases: [spec.phases[0], { ...spec.phases[1], steps: [social(1)] }] }
    const s = buildScheduleView(expandPromoSchedule(only, PB), today, phases)
    expect(s.weeks.flatMap(w => w.days).find(l => l.phaseSwitch === '收割')?.date).toBe('2026-11-02')
  })
  it('广告“需要另行批准”只在 adsNote 里，逐日行里没有', () => {
    expect(view.adsNote).toContain('另行批准')
    expect(lines.map(d => d.text).join('|')).not.toContain('另行批准')
  })
  it('只展开本周和下周，其余折叠成小结，过去的周标已过', () => {
    expect(view.weeks.filter(w => w.expanded).map(w => w.weekStart)).toEqual(['2026-10-19', '2026-10-26'])
    const folded = view.weeks.find(w => w.weekStart === '2026-11-09')
    expect(folded?.expanded).toBe(false)
    expect(folded?.summary).toContain('邮件 1')
    const late = buildScheduleView(sched, '2026-11-16', phases)
    expect(late.weeks.find(w => w.weekStart === '2026-10-19')?.summary).toContain('已过')
  })
  it('同一天多条短视频合并成「短视频 ×N」，总数不丢', () => {
    const reels: PromoSpec = { ...spec, phases: [{ ...spec.phases[0], steps: [social(3, 1000)] }] }
    const v = buildScheduleView(expandPromoSchedule(reels, PB), today, phases)
    const total = v.weeks.reduce((n, w) => n + (w.counts.reel ?? 0), 0)
    expect(total).toBe(expandPromoSchedule(reels, PB).totals.reel)
  })
  it('每天最多一行', () => {
    const dates = lines.map(d => d.date)
    expect(new Set(dates).size).toBe(dates.length)
  })
  it('今天格式坏了不抛错，退回排期第一天', () => {
    expect(() => buildScheduleView(sched, 'garbage', phases)).not.toThrow()
    expect(buildScheduleView(sched, 'garbage', phases).today).toBe(sched.days[0].date)
  })
  it('本周和下周即使没事也在列表里', () => {
    const empty = buildScheduleView({ days: [], totals: { post: 0, story: 0, reel: 0, blog: 0, newsletter: 0, ads_start: 0 }, notes: [], error: null, too_dense: false }, today)
    expect(empty.weeks.map(w => w.weekStart)).toEqual(['2026-10-19', '2026-10-26'])
    expect(empty.routine).toBe('这份计划没有排帖子和快拍')
  })
})

describe('todayInNz', () => {
  it('用新西兰日期：世界标准时间 12:30（NZ 已是次日凌晨）不会晚一天', () => {
    expect(todayInNz(new Date('2026-10-20T12:30:00Z'))).toBe('2026-10-21')
    expect(todayInNz(new Date('2026-10-20T10:30:00Z'))).toBe('2026-10-20')
  })
})

describe('ScheduleTable 渲染', () => {
  const render = (adsRunning?: 'none' | 'running' | 'unknown') =>
    renderToStaticMarkup(createElement(ScheduleTable, { schedule: sched, mode: 'preview', today, phases, ...(adsRunning ? { adsRunning } : {}) }))
  it('今天有明显标记；说明默认收起', () => {
    const html = render()
    expect(html).toContain('今天')
    expect(html).toContain('<details')
  })
  it('「目前广告没有投」只在确认没有在跑广告时才出现', () => {
    expect(render('none')).toContain('目前广告没有投')
    expect(render('running')).not.toContain('目前广告没有投')
    expect(render()).not.toContain('目前广告没有投')
  })
})
