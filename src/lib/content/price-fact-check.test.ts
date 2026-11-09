import { describe, it, expect } from 'vitest'
import {
  buildOfferPriceFacts,
  extractPriceClaims,
  priceFactMessage,
  verifyPostPrices,
  type OfferPriceFacts,
} from './price-fact-check'

const OFFERS = {
  'alps-akl': {
    tour: 'Alpine Journeys — Swiss Alps Explorer (Auckland departure)',
    price_line: '8 Nights · From NZD $5,400 pp',
    single_supplement: 'NZD $650',
    tips: 'suggested NZD $12 per day',
    url: 'https://example.co.nz/tours/swiss-alps?ref=a',
  },
  'alps-chc': {
    tour: 'Alpine Journeys — Swiss Alps Explorer (Christchurch departure)',
    price_line: '7 Nights · From NZD $4,900 pp',
    single_supplement: 'NZD $650',
    tips: 'suggested NZD $12 per day',
    url: 'https://example.co.nz/tours/swiss-alps',
  },
  lakes: {
    tour: 'Alpine Journeys — Italian Lakes',
    price_line: '6 Nights · From NZD $3,200 pp',
    single_supplement: 'NZD $300',
    promo: '15% off',
  },
}

const facts: OfferPriceFacts[] = buildOfferPriceFacts(OFFERS)

describe('verifyPostPrices —— 判得对不对', () => {
  it('文案里没有价格 → no_claims', () => {
    const v = verifyPostPrices({
      text: 'Come see our Auckland showroom, open 7 days',
      offers: facts,
    })
    expect(v.status).toBe('no_claims')
  })

  it('价格对得上 → verified，且只认 Auckland 那个团', () => {
    const v = verifyPostPrices({
      text: 'Swiss Alps Explorer departing Auckland. NZD $5,400 per person twin share (single supplement NZD $650).',
      offers: facts,
    })
    expect(v.status).toBe('verified')
    if (v.status !== 'verified') throw new Error('expected verified')
    expect(v.offerKeys).toEqual(['alps-akl'])
  })

  it('🔴 负面对照：$5,400 改成 $4,400 → mismatch，并列出真实价格', () => {
    const v = verifyPostPrices({
      text: 'Swiss Alps Explorer departing Auckland. NZD $4,400 per person twin share (single supplement NZD $650).',
      offers: facts,
    })
    expect(v.status).toBe('blocked')
    if (v.status !== 'blocked') throw new Error('expected blocked')
    expect(v.reason).toBe('mismatch')
    const expected = v.problems.flatMap((p) => p.expected)
    expect(expected.some((s) => s.includes('5,400'))).toBe(true)
  })

  it('单房差写错（$650 → $560）→ mismatch', () => {
    const v = verifyPostPrices({
      text: 'Swiss Alps Explorer departing Auckland. NZD $5,400 per person twin share (single supplement NZD $560).',
      offers: facts,
    })
    expect(v.status).toBe('blocked')
    if (v.status !== 'blocked') throw new Error('expected blocked')
    expect(v.reason).toBe('mismatch')
  })

  it('客户资料里一个团都没有 → no_facts', () => {
    const v = verifyPostPrices({
      text: 'Spring sale NZD $999 per person',
      offers: [],
    })
    expect(v.status).toBe('blocked')
    if (v.status !== 'blocked') throw new Error('expected blocked')
    expect(v.reason).toBe('no_facts')
  })

  it('有价格但认不出是哪个团 → offer_unresolved', () => {
    const v = verifyPostPrices({
      text: 'Great deal, NZD $999 per person',
      offers: facts,
    })
    expect(v.status).toBe('blocked')
    if (v.status !== 'blocked') throw new Error('expected blocked')
    expect(v.reason).toBe('offer_unresolved')
  })

  it('链接对不上 → unresolved；链接对得上（带 query / 尾斜杠）→ verified 且只认 Christchurch', () => {
    const unresolved = verifyPostPrices({
      text: 'What does NZD $3,200 include?',
      ctaUrl: 'https://example.co.nz/tours/italian-lakes',
      offers: facts,
    })
    expect(unresolved.status).toBe('blocked')
    if (unresolved.status !== 'blocked') throw new Error('expected blocked')
    expect(unresolved.reason).toBe('offer_unresolved')

    const resolved = verifyPostPrices({
      text: 'Swiss Alps Explorer from Christchurch. NZD $4,900 per person.',
      ctaUrl: 'https://example.co.nz/tours/swiss-alps/?utm_source=fb',
      offers: facts,
    })
    expect(resolved.status).toBe('verified')
    if (resolved.status !== 'verified') throw new Error('expected verified')
    expect(resolved.offerKeys).toEqual(['alps-chc'])
  })

  it('🔴 绝不跨出发地核对：链接指向 Swiss Alps、文案写 Christchurch、价格却是 Auckland 的 $5,400 → mismatch', () => {
    const v = verifyPostPrices({
      text: 'Swiss Alps Explorer from Christchurch. NZD $5,400 per person.',
      ctaUrl: 'https://example.co.nz/tours/swiss-alps',
      offers: facts,
    })
    expect(v.status).toBe('blocked')
    if (v.status !== 'blocked') throw new Error('expected blocked')
    expect(v.reason).toBe('mismatch')
  })

  it('链接指向 Swiss Alps、文案没写城市、价格 $5,400 → ambiguous_variant；价格 $650（两团相同）→ verified', () => {
    const ambiguous = verifyPostPrices({
      text: 'Swiss Alps Explorer. NZD $5,400 per person.',
      ctaUrl: 'https://example.co.nz/tours/swiss-alps',
      offers: facts,
    })
    expect(ambiguous.status).toBe('blocked')
    if (ambiguous.status !== 'blocked') throw new Error('expected blocked')
    expect(ambiguous.reason).toBe('ambiguous_variant')

    const shared = verifyPostPrices({
      text: 'Swiss Alps Explorer. Single supplement NZD $650.',
      ctaUrl: 'https://example.co.nz/tours/swiss-alps',
      offers: facts,
    })
    expect(shared.status).toBe('verified')
  })

  it('百分比：15% off 对得上 → verified；20% off → mismatch', () => {
    const ok = verifyPostPrices({
      text: 'Italian Lakes now 15% off, NZD $3,200 per person',
      offers: facts,
    })
    expect(ok.status).toBe('verified')

    const bad = verifyPostPrices({
      text: 'Italian Lakes now 20% off, NZD $3,200 per person',
      offers: facts,
    })
    expect(bad.status).toBe('blocked')
    if (bad.status !== 'blocked') throw new Error('expected blocked')
    expect(bad.reason).toBe('mismatch')
  })

  it('币种对不上 → mismatch；不写币种（裸 $3,200）→ verified', () => {
    const aud = verifyPostPrices({
      text: 'Italian Lakes AUD $3,200 per person',
      offers: facts,
    })
    expect(aud.status).toBe('blocked')
    if (aud.status !== 'blocked') throw new Error('expected blocked')
    expect(aud.reason).toBe('mismatch')

    const bare = verifyPostPrices({
      text: 'Italian Lakes $3,200 per person',
      offers: facts,
    })
    expect(bare.status).toBe('verified')
  })

  it('读不懂的价格写法 → unparseable', () => {
    const v = verifyPostPrices({
      text: 'Italian Lakes: buy 2 for 1',
      offers: facts,
    })
    expect(v.status).toBe('blocked')
    if (v.status !== 'blocked') throw new Error('expected blocked')
    expect(v.reason).toBe('unparseable')
  })

  it('文案里的 URL 不算价格（utm 里的数字要忽略）', () => {
    const v = verifyPostPrices({
      text: 'Italian Lakes NZD $3,200 https://example.co.nz/x?utm_campaign=sale_2026_NZD500',
      offers: facts,
    })
    expect(v.status).toBe('verified')
  })

  it('🔴 回归：日期里的年份不会被当成价格（22 Dec 2026, NZD $5,400）', () => {
    const text =
      'Swiss Alps Explorer departing Auckland on 22 Dec 2026, NZD $5,400 per person twin share.'
    const v = verifyPostPrices({ text, offers: facts })
    expect(v.status).toBe('verified')
    if (v.status !== 'verified') throw new Error('expected verified')
    expect(v.offerKeys).toEqual(['alps-akl'])

    const claims = extractPriceClaims(text)
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ unit: 'money', value: 5400 })
    expect(claims.some((c) => c.value === 2026)).toBe(false)
  })

  it('🔴 回归：日期年份 + 不带 $ 的币种（2026, NZD 5,400）', () => {
    const claims = extractPriceClaims('on 22 Dec 2026, NZD 5,400 per person')
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ unit: 'money', value: 5400, currency: 'NZD' })
  })
})

describe('extractPriceClaims —— 抽出来的数字对不对', () => {
  it('NZD $2,699 twin share → 一条 money，值 2699，币种 NZD', () => {
    const claims = extractPriceClaims('NZD $2,699 twin share')
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ unit: 'money', value: 2699, currency: 'NZD' })
  })

  it('NZD 3k → 值 3000', () => {
    const claims = extractPriceClaims('NZD 3k')
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ unit: 'money', value: 3000 })
  })
})

describe('priceFactMessage —— 拦下来必须说清', () => {
  it('verified / no_claims 返回空串', () => {
    expect(priceFactMessage({ status: 'no_claims' })).toBe('')
    expect(
      priceFactMessage({ status: 'verified', offerKeys: ['alps-akl'], claims: [] }),
    ).toBe('')
  })

  it('五种拦截原因都带「已拦下」；mismatch 还带具体价格', () => {
    const reasons = ['no_facts', 'offer_unresolved', 'unparseable', 'ambiguous_variant', 'mismatch'] as const
    for (const reason of reasons) {
      const msg = priceFactMessage({
        status: 'blocked',
        reason,
        offerKeys: [],
        problems: [{ claim: 'NZD $9,999', expected: ['NZD $5,400'] }],
      })
      expect(msg).toContain('已拦下')
    }
    const mismatch = priceFactMessage({
      status: 'blocked',
      reason: 'mismatch',
      offerKeys: [],
      problems: [{ claim: 'NZD $9,999', expected: ['NZD $5,400'] }],
    })
    expect(mismatch).toContain('NZD $9,999')
  })

  it('mismatch 文案：claim 用「」包起来，并列出该团真实价格', () => {
    const msg = priceFactMessage({
      status: 'blocked',
      reason: 'mismatch',
      offerKeys: [],
      problems: [{ claim: 'NZD $9,999', expected: ['NZD $5,400'] }],
    })
    expect(msg).toContain('「')
    expect(msg).toContain('没有这个数字')
    expect(msg).toContain('已拦下')
  })
})

describe('buildOfferPriceFacts —— 空输入', () => {
  it('null / undefined → []', () => {
    expect(buildOfferPriceFacts(null)).toEqual([])
    expect(buildOfferPriceFacts(undefined)).toEqual([])
  })
})

describe('Fix 1 —— 长团名不能被短团名（其子串）判成 ambiguous', () => {
  const offers = buildOfferPriceFacts({
    classic: {
      tour: 'Alpine Journeys — Classic',
      price_line: 'From NZD $2,000 pp',
    },
    'classic-plus': {
      tour: 'Alpine Journeys — Classic Plus (Christchurch departure)',
      price_line: 'From NZD $3,999 pp',
    },
  })

  it('"Classic Plus NZD $3,999" → verified，只认 Plus', () => {
    const v = verifyPostPrices({ text: 'Classic Plus NZD $3,999', offers })
    expect(v.status).toBe('verified')
    if (v.status !== 'verified') throw new Error('expected verified')
    expect(v.offerKeys).toEqual(['classic-plus'])
  })

  it('"Classic NZD $2,000" → verified，只认 Classic', () => {
    const v = verifyPostPrices({ text: 'Classic NZD $2,000', offers })
    expect(v.status).toBe('verified')
    if (v.status !== 'verified') throw new Error('expected verified')
    expect(v.offerKeys).toEqual(['classic'])
  })
})

describe('Fix 2 —— qualifier 词表', () => {
  it('"from" 不再当 qualifier', () => {
    const offers = buildOfferPriceFacts({
      x: { tour: 'X (from Auckland)', price_line: 'From NZD $1,000 pp' },
    })
    expect(offers[0].qualifiers).toEqual(['auckland'])
  })
})

describe('Fix 3 —— 额外价格写法', () => {
  const cases = [
    'was 2,699, now 1,999',
    'Price ex Auckland 1,999',
    'tour - 1,999',
    '1999 NZ dollars',
    '20% discount',
    '＄1,999',
    '$1,999',
    'NZD 1,999',
  ]
  for (const text of cases) {
    it(`能抽出价格：${text}`, () => {
      expect(extractPriceClaims(text).length).toBeGreaterThan(0)
    })
  }

  it('零宽字符夹在 $ 和数字之间也能抽出', () => {
    expect(extractPriceClaims('$\u200b1,999').length).toBeGreaterThan(0)
  }) 
})

describe('Fix 3 —— 不误报', () => {
  const cases = ['Over 10,000 followers', '5,000 km of coastline', 'Since 2026, our team…', '22 Dec 2026']
  for (const text of cases) {
    it(`零 claim：${text}`, () => {
      expect(extractPriceClaims(text)).toHaveLength(0)
    })
  }
})

describe('Fix 3 —— promo 写法写错价格要拦下', () => {
  it('"Italian Lakes was 3,200, now 1,999" → mismatch', () => {
    const offers = buildOfferPriceFacts({
      lakes: {
        tour: 'Alpine Journeys — Italian Lakes',
        price_line: 'From NZD $3,200 pp',
      },
    })
    const v = verifyPostPrices({ text: 'Italian Lakes was 3,200, now 1,999', offers })
    expect(v.status).toBe('blocked')
    if (v.status !== 'blocked') throw new Error('expected blocked')
    expect(v.reason).toBe('mismatch')
  })
})
