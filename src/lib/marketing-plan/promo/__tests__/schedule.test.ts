import { describe, expect, it } from 'vitest'
import { expandPromoSchedule, isoWeekday, isRealDate, weekStartOf } from '../schedule'
import { DEFAULT_PROMO_PLAYBOOK as PB } from '../playbooks'
import type { PromoSpec, PromoStep } from '../spec'

const social = (p: number, s: number, r: number, id = 'soc'): PromoStep => ({ id, kind: 'social_cadence', settings: { posts_per_week: p, stories_per_week: s, reels_per_month: r } })
const spec = (phases: { id: string; name: string; start: string; end: string; steps: PromoStep[] }[]): PromoSpec => ({
  schema: 'promo_v1', goal_id: 'g', checks: [],
  phases: phases.map(p => ({ id: p.id, name: p.name, start_date: p.start, end_date: p.end, steps: p.steps })),
})
const one = (start: string, end: string, steps: PromoStep[]) => spec([{ id: 'p1', name: '阶段一', start, end, steps }])
const of = (sch: ReturnType<typeof expandPromoSchedule>, kind: string) => sch.days.flatMap(d => d.items.filter(i => i.kind === kind).map(() => d.date))

describe('日期工具', () => {
  it('星期与周起点按 UTC 日历算', () => {
    expect(isoWeekday('2026-11-02')).toBe(1) // 周一
    expect(isoWeekday('2026-11-08')).toBe(7) // 周日
    expect(weekStartOf('2026-11-08')).toBe('2026-11-02')
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02')
  })
  it('真实日期校验', () => {
    expect(isRealDate('2026-02-28')).toBe(true)
    expect(isRealDate('2028-02-29')).toBe(true)
    expect(isRealDate('2026-02-30')).toBe(false)
    expect(isRealDate('2026-13-01')).toBe(false)
    expect(isRealDate('26-1-1')).toBe(false)
    expect(isRealDate('9999-12-31')).toBe(false) // 超出 2000–2100：会让日期加减出怪字符串
    expect(isRealDate('1999-12-31')).toBe(false)
  })
})

describe('每周帖子 / 快拍', () => {
  it('每周 3 条：周一、周三、周五；快拍错开到周二、周四、周六', () => {
    const sch = expandPromoSchedule(one('2026-11-02', '2026-11-08', [social(3, 3, 0)]), PB)
    expect(of(sch, 'post')).toEqual(['2026-11-02', '2026-11-04', '2026-11-06'])
    expect(of(sch, 'story')).toEqual(['2026-11-03', '2026-11-05', '2026-11-07'])
  })
  it('每周 7 条：每天；快拍周日回绕到周一', () => {
    const sch = expandPromoSchedule(one('2026-11-02', '2026-11-08', [social(7, 7, 0)]), PB)
    expect(sch.totals.post).toBe(7)
    expect(sch.totals.story).toBe(7)
  })
  it('超过 7 条按 7 条排，并写明', () => {
    const sch = expandPromoSchedule(one('2026-11-02', '2026-11-08', [social(10, 0, 0)]), PB)
    expect(sch.totals.post).toBe(7)
    expect(sch.notes.join('')).toContain('每周最多排 7 条')
  })
  it('N=0 不排，不报错', () => {
    const sch = expandPromoSchedule(one('2026-11-02', '2026-11-08', [social(0, 0, 0)]), PB)
    expect(sch.days).toEqual([])
    expect(sch.error).toBeNull()
  })
  it('一周被阶段边界切成两段：合计不超过 N', () => {
    const sch = expandPromoSchedule(spec([
      { id: 'a', name: 'A', start: '2026-11-02', end: '2026-11-04', steps: [social(3, 0, 0, 's1')] },
      { id: 'b', name: 'B', start: '2026-11-05', end: '2026-11-08', steps: [social(3, 0, 0, 's2')] },
    ]), PB)
    expect(sch.totals.post).toBe(3)
  })
  it('阶段只有 1 天且不在排期日：0 条并说明', () => {
    const sch = expandPromoSchedule(one('2026-11-04', '2026-11-04', [social(2, 0, 0)]), PB) // 周三，N=2 排周二/周四
    expect(sch.totals.post).toBe(0)
    expect(sch.notes.join('')).toContain('没排上')
  })
  it('跨年、闰年不乱', () => {
    const sch = expandPromoSchedule(one('2027-12-27', '2028-01-09', [social(1, 0, 0)]), PB) // 每周三
    expect(of(sch, 'post')).toEqual(['2027-12-29', '2028-01-05'])
    const leap = expandPromoSchedule(one('2028-02-28', '2028-03-01', [social(7, 0, 0)]), PB)
    expect(of(leap, 'post')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  })
})

describe('短视频每月 N 条', () => {
  it('按阶段天数折算、均匀落在工作日', () => {
    const sch = expandPromoSchedule(one('2026-11-02', '2026-12-01', [social(0, 0, 2)]), PB) // 30 天，2 条
    const dates = of(sch, 'reel')
    expect(dates).toHaveLength(2)
    dates.forEach(d => expect(isoWeekday(d)).toBeLessThanOrEqual(5))
    expect(dates[0] < dates[1]).toBe(true)
  })
  it('M>0 的短阶段至少 1 条', () => {
    expect(expandPromoSchedule(one('2026-11-02', '2026-11-06', [social(0, 0, 1)]), PB).totals.reel).toBe(1)
  })
  it('阶段内只有周末：0 条并说明', () => {
    const sch = expandPromoSchedule(one('2026-11-07', '2026-11-08', [social(0, 0, 3)]), PB)
    expect(sch.totals.reel).toBe(0)
    expect(sch.notes.join('')).toContain('没有适合排短视频的日子')
  })
  it('条数不超过工作日数', () => {
    expect(expandPromoSchedule(one('2026-11-02', '2026-11-03', [social(0, 0, 999)]), PB).totals.reel).toBe(2)
  })
})

describe('博客 / 邮件 / 广告', () => {
  const steps: PromoStep[] = [
    { id: 'b', kind: 'blog_article', settings: { topic: '主题甲', primary_keyword: null, due_date: '2026-11-10' } },
    { id: 'n', kind: 'newsletter_email', settings: { topic: '主题乙', due_date: '2026-11-10', requires_link: true } },
    { id: 'a', kind: 'ads_campaign', settings: { ad_account_id: 'acc', daily_budget_cents: 5000, audience_ref: '受众A', creative_refs: [], placements: [], paused_ranges: [] } },
  ]
  it('广告阶段内有暂停区间：写明区间，不只看第一天', () => {
    const paused: PromoStep = { id: 'a', kind: 'ads_campaign', settings: { ad_account_id: 'acc', daily_budget_cents: 100, audience_ref: 'x', creative_refs: [], placements: [], paused_ranges: [{ from: '2026-11-10', to: '2026-11-12' }, { from: '2027-01-01', to: '2027-01-02' }] } }
    const text = expandPromoSchedule(one('2026-11-02', '2026-11-30', [paused]), PB).days[0].items[0].text
    expect(text).toContain('2026-11-10 至 2026-11-12')
    expect(text).not.toContain('2027-01-01') // 阶段之外的区间不提
  })
  it('小数条数（脏数据）当 0 处理，不报「阶段太短」', () => {
    const sch = expandPromoSchedule(one('2026-11-02', '2026-11-08', [social(0.5, 0, 0)]), PB)
    expect(sch.totals.post).toBe(0)
    expect(sch.notes).toEqual([])
  })
  it('落在各自日期，同一天按固定顺序；广告只在阶段开始日出现', () => {
    const sch = expandPromoSchedule(one('2026-11-02', '2026-11-30', steps), PB)
    expect(sch.days.map(d => d.date)).toEqual(['2026-11-02', '2026-11-10'])
    expect(sch.days[1].items.map(i => i.kind)).toEqual(['blog', 'newsletter'])
    expect(sch.days[0].items[0].text).toContain('50.00')
    expect(sch.days[0].items[0].text).toContain('目前广告没有投')
    expect(sch.days[0].items[0].text).toContain('另行批准')
  })
})

describe('防护', () => {
  it('不存在的日期：给人话错误，不展开', () => {
    const sch = expandPromoSchedule(one('2026-02-28', '2026-02-30', [social(3, 0, 0)]), PB)
    expect(sch.error).toContain('不是真实日期')
    expect(sch.days).toEqual([])
  })
  it('结束日早于开始日', () => {
    expect(expandPromoSchedule(one('2026-11-10', '2026-11-02', []), PB).error).toContain('早于')
  })
  it('时间跨度巨大：直接拒绝，不卡', () => {
    const t = Date.now()
    const sch = expandPromoSchedule(one('2026-01-01', '2100-12-31', [social(3, 3, 3)]), PB)
    expect(sch.error).toContain('跨度太长')
    expect(Date.now() - t).toBeLessThan(500)
  })
  it('9999-12-31 附近的两天阶段：不死循环，直接拒绝', () => {
    const t = Date.now()
    const sch = expandPromoSchedule(one('9999-12-30', '9999-12-31', [social(3, 3, 3)]), PB)
    expect(sch.error).toContain('不是真实日期')
    expect(Date.now() - t).toBeLessThan(500)
  })
  it('阶段重叠：拒绝，不重复计算', () => {
    const sch = expandPromoSchedule(spec([
      { id: 'a', name: 'A', start: '2026-11-02', end: '2026-11-10', steps: [social(3, 0, 0, 'x')] },
      { id: 'b', name: 'B', start: '2026-11-10', end: '2026-11-20', steps: [social(3, 0, 0, 'y')] },
    ]), PB)
    expect(sch.error).toContain('重叠')
  })
  it('博客到期日不在阶段内：不排，写明', () => {
    const steps: PromoStep[] = [{ id: 'b', kind: 'blog_article', settings: { topic: '甲', primary_keyword: null, due_date: '2026-12-31' } }]
    const sch = expandPromoSchedule(one('2026-11-02', '2026-11-30', steps), PB)
    expect(sch.totals.blog).toBe(0)
    expect(sch.notes.join('')).toContain('不在这个阶段内')
  })
  it('博客到期日不是真实日期：给人话错误', () => {
    const steps: PromoStep[] = [{ id: 'b', kind: 'blog_article', settings: { topic: '甲', primary_keyword: null, due_date: '2026-02-30' } }]
    expect(expandPromoSchedule(one('2026-02-01', '2026-03-30', steps), PB).error).toContain('到期日不是真实日期')
  })
  it('说明太多时按原因聚合并封顶', () => {
    const many = Array.from({ length: 150 }, (_, i) => social(2, 0, 0, `s${i}`))
    const sch = expandPromoSchedule(one('2026-11-04', '2026-11-04', many), PB) // 周三，N=2 排周二/周四，全部落空
    expect(sch.notes.length).toBeLessThanOrEqual(21)
    expect(sch.notes[0]).toContain('共 150 处')
  })
  it('M 巨大不出错', () => {
    expect(expandPromoSchedule(one('2026-11-02', '2026-11-20', [social(0, 0, 1e21)]), PB).totals.reel).toBeGreaterThan(0)
  })
  it('长主题被截断', () => {
    const steps: PromoStep[] = [{ id: 'b', kind: 'blog_article', settings: { topic: '长'.repeat(500), primary_keyword: null, due_date: '2026-11-10' } }]
    const sch = expandPromoSchedule(one('2026-11-02', '2026-11-30', steps), PB)
    expect(sch.days[0].items[0].text.length).toBeLessThan(120)
  })
  it('步骤太多：拒绝', () => {
    const many = Array.from({ length: 201 }, (_, i) => social(1, 0, 0, `s${i}`))
    expect(expandPromoSchedule(one('2026-11-02', '2026-11-08', many), PB).error).toContain('步骤太多')
  })
  it('排得太密：只给汇总不展开', () => {
    const many = Array.from({ length: 150 }, (_, i) => social(7, 0, 0, `s${i}`))
    const sch = expandPromoSchedule(one('2026-11-02', '2027-01-30', many), PB)
    expect(sch.too_dense).toBe(true)
    expect(sch.days).toEqual([])
    expect(sch.totals.post).toBeGreaterThan(PB.scheduleMaxItems)
  })
  it('同输入同输出', () => {
    const s = one('2026-11-02', '2026-12-20', [social(3, 2, 2)])
    expect(expandPromoSchedule(s, PB)).toEqual(expandPromoSchedule(s, PB))
  })
  it('阶段乱序输入也按日期排', () => {
    const sch = expandPromoSchedule(spec([
      { id: 'b', name: 'B', start: '2026-11-16', end: '2026-11-22', steps: [social(1, 0, 0, 'x')] },
      { id: 'a', name: 'A', start: '2026-11-02', end: '2026-11-08', steps: [social(1, 0, 0, 'y')] },
    ]), PB)
    expect(sch.days.map(d => d.date)).toEqual(['2026-11-04', '2026-11-18'])
  })
})
