import { describe, it, expect } from 'vitest'
import {
  validateDraft,
  metaTripletFor,
  describeDraft,
  MAX_AUTO_DAILY_BUDGET,
  type AdDraft,
} from '../ad-draft'

function leadDraft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'lead_form',
    clientId: 'c1',
    campaignName: 'Kiteroa 留资',
    adSetName: 'North Shore 买家',
    dailyBudget: 30,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'page1',
    leadFormId: 'form1',
    creatives: [
      { name: 'EN', primaryText: 'Brand new four bedroom home', headline: 'Book a viewing', imageHash: 'h1' },
    ],
    ...over,
  }
}

describe('validateDraft — 拦住 ME 自己就能判的错', () => {
  it('齐全的留资草案没问题', () => {
    expect(validateDraft(leadDraft())).toEqual([])
  })

  it('留资广告没挂表单 → 拦（不然它收不到任何联系方式）', () => {
    const p = validateDraft(leadDraft({ leadFormId: undefined }))
    expect(p.map((x) => x.field)).toContain('leadFormId')
  })

  it('没说投给哪里 → 拦（投给全世界不是一个决定）', () => {
    const p = validateDraft(leadDraft({ geoCountries: [] }))
    expect(p.map((x) => x.field)).toContain('geoCountries')
  })

  it('没说跑几天 → 拦（不设终点的广告没人记得关）', () => {
    const p = validateDraft(leadDraft({ durationDays: 0 }))
    expect(p.map((x) => x.field)).toContain('durationDays')
  })

  it(`每天超过 $${MAX_AUTO_DAILY_BUDGET} → 拦`, () => {
    const p = validateDraft(leadDraft({ dailyBudget: MAX_AUTO_DAILY_BUDGET + 1 }))
    expect(p.map((x) => x.field)).toContain('dailyBudget')
  })

  it(`刚好 $${MAX_AUTO_DAILY_BUDGET} 放行 —— 边界不能反着来`, () => {
    expect(validateDraft(leadDraft({ dailyBudget: MAX_AUTO_DAILY_BUDGET }))).toEqual([])
  })

  it('视频广告没给视频 → 拦', () => {
    const p = validateDraft(
      leadDraft({
        kind: 'video_thruplay',
        leadFormId: undefined,
        creatives: [{ name: 'V', primaryText: 'x', headline: 'y' }],
      }),
    )
    expect(p.map((x) => x.field)).toContain('creatives[0].videoId')
  })

  it('视频广告不需要表单', () => {
    const p = validateDraft(
      leadDraft({
        kind: 'video_thruplay',
        leadFormId: undefined,
        creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' }],
      }),
    )
    expect(p).toEqual([])
  })

  it('正文空白（只有空格）也算空', () => {
    const p = validateDraft(
      leadDraft({ creatives: [{ name: 'E', primaryText: '   ', headline: 'h', imageHash: 'h1' }] }),
    )
    expect(p.map((x) => x.field)).toContain('creatives[0].primaryText')
  })

  it('年龄下限 18 岁以下 → 拦', () => {
    expect(validateDraft(leadDraft({ ageMin: 16 })).map((x) => x.field)).toContain('ageMin')
  })
})

describe('metaTripletFor — 三件套写死，配错就是「名字叫留资、实际买曝光」', () => {
  it('留资 → OUTCOME_LEADS / LEAD_GENERATION，落点在广告里不是私信', () => {
    const t = metaTripletFor('lead_form')
    expect(t.objective).toBe('OUTCOME_LEADS')
    expect(t.optimizationGoal).toBe('LEAD_GENERATION')
    expect(t.destinationType).toBe('ON_AD')
  })

  it('养受众 → THRUPLAY，落点 ON_VIDEO（少了它 Meta 不给按完播优化）', () => {
    const t = metaTripletFor('video_thruplay')
    expect(t.optimizationGoal).toBe('THRUPLAY')
    expect(t.destinationType).toBe('ON_VIDEO')
  })

  it('两种草案的落点都不是私信 —— 私信那条线已经不走了', () => {
    for (const k of ['lead_form', 'video_thruplay'] as const) {
      expect(['MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT']).not.toContain(
        metaTripletFor(k).destinationType,
      )
    }
  })
})

describe('describeDraft — 审批页第一行必须说清花多少', () => {
  it('算的是总花费上限，不是每天', () => {
    expect(describeDraft(leadDraft({ dailyBudget: 30, durationDays: 7 }))).toContain('$210')
  })

  it('留资和养受众说的是两件事', () => {
    expect(describeDraft(leadDraft())).toContain('联系方式')
    expect(
      describeDraft(
        leadDraft({
          kind: 'video_thruplay',
          creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v' }],
        }),
      ),
    ).toContain('受众')
  })
})
