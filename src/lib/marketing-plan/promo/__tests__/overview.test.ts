import { describe, expect, it } from 'vitest'
import { buildPromoSample, describePromoSpec } from '../overview'
import { parsePromoSpec } from '../spec'

describe('buildPromoSample', () => {
  it('示例通过推广计划自己的校验，阶段按顺序不重叠', () => {
    const res = parsePromoSpec(buildPromoSample('2026-10-20'))
    expect(res.ok).toBe(true)
  })
  it('跨月份日期推算正确', () => {
    const spec = buildPromoSample('2026-12-20')
    expect(spec.phases[0].end_date).toBe('2027-01-02')
    expect(spec.phases[1].start_date).toBe('2027-01-03')
  })
  it('示例里不出现真实客户名或真实账户', () => {
    const text = JSON.stringify(buildPromoSample('2026-10-20'))
    expect(text).not.toMatch(/act_\d|CTS|Roman|Oztop/i)
  })
})

describe('describePromoSpec', () => {
  const views = describePromoSpec(buildPromoSample('2026-10-20'))

  it('按阶段给出天数和日期范围', () => {
    expect(views.map(v => v.name)).toEqual(['预热', '主推', '收尾'])
    expect(views.map(v => v.days)).toEqual([14, 28, 14])
    expect(views[0].range).toBe('2026-10-20 至 2026-11-02')
  })
  it('广告预算由「分」换成元，PM 看不到分', () => {
    const ads = views[1].steps.find(s => s.group === 'ads')!
    expect(ads.lines[0]).toContain('50.00')
    expect(ads.lines.join('')).not.toContain('5000')
  })
  it('社媒只写有数量的项，全是 0 时明说不安排', () => {
    expect(views[0].steps[0].lines[0]).toBe('每周 3 条帖子，每周 2 条快拍，每月 2 条短视频')
    const quiet = describePromoSpec({
      ...buildPromoSample('2026-10-20'),
      phases: [{ id: 'q', name: 'q', start_date: '2026-10-20', end_date: '2026-10-21',
        steps: [{ id: 's', kind: 'social_cadence', settings: { posts_per_week: 0, stories_per_week: 0, reels_per_month: 0 } }] }],
    })
    expect(quiet[0].steps[0].lines[0]).toBe('这个阶段不安排社媒')
  })
  it('四类步骤都有对应分组', () => {
    expect(new Set(views[1].steps.map(s => s.group))).toEqual(new Set(['ads', 'social', 'blog', 'newsletter']))
  })
  it('阶段乱序输入也按开始日期排', () => {
    const spec = buildPromoSample('2026-10-20')
    const out = describePromoSpec({ ...spec, phases: [...spec.phases].reverse() })
    expect(out.map(v => v.name)).toEqual(['预热', '主推', '收尾'])
  })
})
