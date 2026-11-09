import { describe, expect, it } from 'vitest'
import { resolveOfferFacts, resolvePostFields } from './post-fields'

describe('resolvePostFields — 纯函数字段映射，零 LLM', () => {
  it('按 postFieldSources 把每个必填元素名映射到 offerFacts 对应的真实值', () => {
    const result = resolvePostFields({
      requiredPostFields: ['EndTour', 'EndMeta'],
      postFieldSources: { EndTour: 'tour', EndMeta: 'price_line' },
      offerFacts: { tour: 'Best of China', price_line: 'From NZD $4,080 pp', route: 'Beijing · Xi\'an' },
    })
    expect(result).toEqual({ EndTour: 'Best of China', EndMeta: 'From NZD $4,080 pp' })
  })

  it('requiredPostFields 为空 → 返回空对象，不校验任何东西', () => {
    expect(resolvePostFields({ requiredPostFields: [], postFieldSources: undefined, offerFacts: {} })).toEqual({})
  })

  it('postFieldSources 没给这个字段的映射 → 抛错，报出具体字段名', () => {
    expect(() =>
      resolvePostFields({
        requiredPostFields: ['EndTour'],
        postFieldSources: {},
        offerFacts: { tour: 'Best of China' },
      }),
    ).toThrow(/EndTour/)
  })

  it('映射到的 offerFacts key 不存在或是空字符串 → 抛错，不静默填空', () => {
    expect(() =>
      resolvePostFields({
        requiredPostFields: ['EndTour', 'EndDate'],
        postFieldSources: { EndTour: 'tour', EndDate: 'departure' },
        offerFacts: { tour: 'Best of China', departure: '  ' },
      }),
    ).toThrow(/EndDate/)
  })

  it('确定性：同样的输入调两次结果完全一样（Inngest 重试安全，不像 LLM 会漂移）', () => {
    const input = {
      requiredPostFields: ['EndTour'],
      postFieldSources: { EndTour: 'tour' },
      offerFacts: { tour: 'Best of China' },
    }
    expect(resolvePostFields(input)).toEqual(resolvePostFields(input))
  })
})

describe('resolveOfferFacts — 挑哪个团/档位的事实，fail-closed', () => {
  const offers = {
    best_of_china: { tour: 'Best of China', price_line: 'From NZD $4,080 pp' },
    family_edition: { tour: 'Best of China — Family Edition', price_line: 'From NZD $4,080 pp' },
  }

  it('指定了 offerKey 且存在 → 返回那一份', () => {
    expect(resolveOfferFacts({ offers, offerKey: 'family_edition' })).toEqual(offers.family_edition)
  })

  it('指定了 offerKey 但配置里没有这个档位 → 抛错，报出可选档位清单，不猜一份顶上', () => {
    expect(() => resolveOfferFacts({ offers, offerKey: 'christmas_tour' })).toThrow(/christmas_tour/)
  })

  it('没指定 offerKey 且只配了一个档位 → 直接用那一个（单团客户不用每条视频都标 offer_key）', () => {
    const single = { default: { tour: 'Best of China' } }
    expect(resolveOfferFacts({ offers: single, offerKey: null })).toEqual(single.default)
  })

  it('没指定 offerKey 且配了 ≥2 个档位 → 抛错，不允许自动猜一个（这是魏征复审①要堵的洞）', () => {
    expect(() => resolveOfferFacts({ offers, offerKey: null })).toThrow(/2 个档位/)
  })

  it('没指定 offerKey 且一个档位都没配 → 抛错，说清楚是配置缺失', () => {
    expect(() => resolveOfferFacts({ offers: undefined, offerKey: null })).toThrow(/一个.*都没配/)
  })
})
