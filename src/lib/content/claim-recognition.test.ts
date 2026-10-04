import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PRICE_CLAIM_RECALL_RE, PRICE_CLAIM_STRICT_RE, containsPriceClaim } from './price-claim'
import { containsDateClaim, findDateClaims } from './date-claim'
import {
  LEGACY_PRICE_RECALL_RE,
  LEGACY_PRICE_STRICT_RE,
  LEGACY_DATE_RE,
  compareClaimRules,
  formatShadowReport,
} from './claim-shadow-stats'

const recallHit = (t: string) => t.match(PRICE_CLAIM_RECALL_RE) !== null
const legacyRecallHit = (t: string) => t.match(LEGACY_PRICE_RECALL_RE) !== null
const legacyStrictHit = (t: string) => t.match(LEGACY_PRICE_STRICT_RE) !== null

const NORMAL_COPY: string[] = [
  'Planning made simple',
  'We map the logistics',
  "Let's plan yours together",
  'Book your 2026 China tour with us today',
  '12 day itinerary through Yunnan',
  'Auckland showroom open 7 days',
  'We have been doing this for 25 years',
  '100% Kiwi owned and operated',
  '100% authentic Sichuan cuisine',
  'Top 10 for 2026 — where to go next',
  'Open 7 days for walk-in customers',
  'Premium walnut floors',
  'Level 3 showroom',
  'Walk the Great Wall at sunrise with a local guide',
  'Hobbiton, Rotorua and Queenstown in one small-group journey',
  'Small groups, local guides, no rush',
  'Ask us about a tailor-made South Island road trip',
  '4 star hotels and private transfers included',
  'Message us on WhatsApp and we will reply within 24 hours',
  '5 minutes from Auckland CBD',
  '3 bedrooms, 2 bathrooms, double garage',
  '450m² section in a quiet street',
  'Open home this Saturday 11am — all welcome',
  'Why choose SPC flooring for a busy family home?',
  'Our team has helped 300 families find the right floor',
  '15 days of memories, one seamless itinerary',
  'Join our 3 day Milford Sound adventure',
  'Sunrise at Mount Cook, 8 hours of hiking',
  '24/7 customer support in Chinese and English',
  'Version 2.0 of our booking portal is live',
  'Flights depart from Auckland, Christchurch and Queenstown',
  'Rated 4.9 stars by 1200 happy travellers',
  'Follow us for travel tips every Friday',
  'Visit us at Level 1, 22 Market Street, Auckland',
  'Shop 5 Mayfair Plaza, now open',
  '12 Marsden Road showroom',
  'Book our CNY tours before they fill up',
  '欢迎来新西兰,体验最地道的南岛环线',
  '每月都有出发,全程中文导游',
  '咨询后3个工作日内回复您',
  '三天两夜奥克兰深度游',
  '澳洲和新西兰客户都可以预约上门量尺',
  '元旦快乐,新的一年一起出发',
]

// price positives: BOTH the strict (publish-blocking) and the wide (recall) regex must hit
const PRICE_POSITIVES: string[] = [
  'From NZD 4,999', 'NZD4999', '4,999 NZD', '¥3999', '￥3999', '3999元', 'USD 1,200', '纽币 3999', '3999纽币',
  '新西兰元3999', 'From NZ$4,999', 'AUD88', 'aud 88', 'RMB 12000', '12,000 RMB', 'NZD 4,999.00', 'From NZD 1.3k',
  '1.3k NZD', '$1.3k', 'US$ 99', '99 USD', '澳元 2999', '2999 美元', '人民币8999', '8999人民币', '澳币 3999', '美金 99',
  'A$1,299', 'Only 99 dollars', 'Save 30% this month',
  '新西兰币3999', '纽元 3999', '1.2万元', '2万纽币', '8千元', '999澳刀', '999美刀', '4999 NZDpp', 'NZD 99 per night',
  'NZD 99 free cancellation', '¥3999 人均', 'From NZD 4,999.50',
]

// price NEGATIVES: the STRICT regex must NOT hit any of these (strict = the one that blocks publishing)
const PRICE_NEGATIVES: string[] = [
  'CNY 2027 tours now open', 'Spring 2027 CNY special', '#CNY2027 Lunar New Year', 'CNY 8 day tour',
  'All prices in NZD\n7 day Queenstown tour', 'Currency: USD\n\n5 days itinerary',
  '5元件', '2元宇宙', '20 元老', '元旦快乐', '2 NZD-friendly cafes', '5 audience members', 'Auditorium 4',
  '10k followers', '4K video', '8K drone', '10k steps', 'From 1.3k', '24/7 support', 'Version 2.0',
  '15 days', '2027 tour', '4 star hotel',
  'All prices in NZD 7 day itinerary', 'Prices quoted in NZD 2 adults 1 child', 'Fares in USD 3 nights minimum',
  'Price in RMB 3 days', '请使用澳币 3 天后到账', '美金 10 人', '2027元旦快乐', '5元月', '3元宝', '3元数据中心',
  'Fraud 5 cases', 'Claudia 2 rooms',
]

// date positives: [text, expected single fragment]
const DATE_POSITIVES: Array<[string, string]> = [
  ['15 March', '15 March'], ['March 15', 'March 15'], ['15th of March', '15th of March'], ['3月15日', '3月15日'],
  ['2027年3月', '2027年3月'], ['March 5', 'March 5'], ['5 Mar', '5 Mar'], ['Mar. 15', 'Mar. 15'], ['Sept 3', 'Sept 3'],
  ['1st of September', '1st of September'], ['15 March 2027', '15 March 2027'], ['March 15, 2027', 'March 15, 2027'],
  ['March 2027', 'March 2027'], ['15/03/2027', '15/03/2027'], ['2027-03-15', '2027-03-15'], ['2027/03/15', '2027/03/15'],
  ['2027年3月15日', '2027年3月15日'], ['12月出发', '12月'], ['Valid until 31 December', '31 December'],
  ['Closes 5 May', '5 May'], ['Closes 5 MAY', '5 MAY'],
  ['Closes 5 May.', '5 May'], ['Fares may 1 July increase', '1 July'], ['Offer may 31 May end early', '31 May'],
  ['Dec 25', 'Dec 25'],
]

// date negatives: containsDateClaim must be false
const DATE_NEGATIVES: string[] = [
  '2027 tour', '3 days', 'Level 3', 'Room 12', '4 star hotel', '12 day itinerary', 'Market 50 Street', 'Shop 5 Mayfair',
  '22 Market Street', 'You may 5 times', 'these 3 may surprise you', 'Kids aged 5 may enter free',
  '88 May Road, Mt Roskill', '12 August Street', '15 June St', '6月龄宝宝', '13月', '每月', '3个月', 'Terms may apply',
  '24/7 support', 'Version 2.0', 'v2.1.3', 'Flight NZ89 14:35', 'Book your 2026 China tour with us today',
  'March 7 day tour', 'September 10 day tour in Japan', 'May 5 star lodge', 'June 3 bedroom home', 'Jan 5 km run',
  'Dec 12 rooms available', 'Nov 9 am', '15 May Court', '12 May Close', '31 August Parade', '7 June Grove',
  '5 March Square', '9 Dec Walk', '1 June Park', '10 Oct Rise', '2 July Ct', '88 May Hill', '1999.99.99', '2025-26-27',
  '第3月', '满12月', '0.5月', '1月5号线', '第3月2号线',
]

// texts that the OLD regexes already hit; the new ones must still hit them (superset property)
const LEGACY_POSITIVES: string[] = [
  '$29/m² 起', 'From A$1,299 per person', 'NZ$450 twin share', 'Save 40% off this week', 'Save 30% this month',
  'Only 99 dollars', 'Buy 2 for 1 this weekend', 'AUD 88 per m²', 'SPC flooring 29/sqm installed', 'From $199 per person',
  '100% Kiwi owned and operated', 'Top 10 for 2026 — where to go next', '20 bucks', '40% off',
]

describe('正常文案照常放行(回归集)', () => {
  it.each(NORMAL_COPY)('「%s」不触发价格/日期声明,也不新增命中', (t) => {
    expect(containsPriceClaim(t)).toBe(false)
    expect(containsDateClaim(t)).toBe(false)
    expect(recallHit(t) && !legacyRecallHit(t)).toBe(false)
  })

  it('回归集至少 30 条', () => {
    expect(NORMAL_COPY.length >= 30).toBe(true)
  })
})

describe('价格正例', () => {
  it.each(PRICE_POSITIVES)('「%s」严口径与宽口径都命中', (t) => {
    expect(containsPriceClaim(t)).toBe(true)
    expect(recallHit(t)).toBe(true)
  })

  it('正例至少 25 条', () => {
    expect(PRICE_POSITIVES.length >= 25).toBe(true)
  })
})

describe('价格反例(严口径不能误拦)', () => {
  it.each(PRICE_NEGATIVES)('「%s」严口径不命中', (t) => {
    expect(containsPriceClaim(t)).toBe(false)
  })

  it('反例至少 15 条', () => {
    expect(PRICE_NEGATIVES.length >= 15).toBe(true)
  })
})

describe('已知宽口径取舍', () => {
  it.each(['10k followers', 'From 1.3k', '10k steps'])('「%s」宽口径命中但严口径不命中', (t) => {
    expect(recallHit(t)).toBe(true)
    expect(containsPriceClaim(t)).toBe(false)
  })

  it.each(['4K video', '8K drone'])('「%s」宽口径也不命中(视频分辨率排除)', (t) => {
    expect(recallHit(t)).toBe(false)
  })
})

describe('日期正例', () => {
  it.each(DATE_POSITIVES)('「%s」识别为 [%s]', (text, expected) => {
    expect(findDateClaims(text)).toEqual([expected])
    expect(containsDateClaim(text)).toBe(true)
  })
})

describe('日期反例', () => {
  it.each(DATE_NEGATIVES)('「%s」不识别为日期', (t) => {
    expect(containsDateClaim(t)).toBe(false)
    expect(findDateClaims(t)).toEqual([])
  })

  it('反例至少 15 条', () => {
    expect(DATE_NEGATIVES.length >= 15).toBe(true)
  })

  it('空值不炸', () => {
    expect(containsDateClaim(null)).toBe(false)
    expect(containsDateClaim(undefined)).toBe(false)
    expect(containsDateClaim('')).toBe(false)
    expect(findDateClaims(null)).toEqual([])
  })
})

describe('超集:旧规则命中的,新规则必须仍然命中', () => {
  const ALL = [...NORMAL_COPY, ...PRICE_POSITIVES, ...PRICE_NEGATIVES, ...LEGACY_POSITIVES]

  it.each(LEGACY_POSITIVES)('「%s」旧规则命中则新规则也命中', (t) => {
    const oldStrict = legacyStrictHit(t)
    const oldRecall = legacyRecallHit(t)
    expect(oldStrict || oldRecall).toBe(true)
    if (oldStrict) expect(containsPriceClaim(t)).toBe(true)
    if (oldRecall) expect(recallHit(t)).toBe(true)
  })

  it('两两拼接也成立', () => {
    const violations: string[] = []
    for (const a of ALL) {
      for (const b of ALL) {
        const joined = a + ' ' + b
        if (legacyRecallHit(joined) && !recallHit(joined)) violations.push(joined)
        if (legacyStrictHit(joined) && !containsPriceClaim(joined)) violations.push(joined)
      }
    }
    expect(violations).toEqual([])
  })

  it('新正则的开头原样包含旧正则', () => {
    expect(PRICE_CLAIM_RECALL_RE.source.startsWith(LEGACY_PRICE_RECALL_RE.source)).toBe(true)
    expect(PRICE_CLAIM_STRICT_RE.source.startsWith(LEGACY_PRICE_STRICT_RE.source)).toBe(true)
  })
})

describe('命中片段要完整(白名单靠片段里的数字比对)', () => {
  it('「From NZD 4,999.50」严口径片段是完整的 NZD 4,999.50', () => {
    // 片段被截成 "NZD 4" 的话,白名单会拿数字 4 去比对,真价 4999.50 反而漏掉。
    expect('From NZD 4,999.50'.match(PRICE_CLAIM_STRICT_RE)).toEqual(['NZD 4,999.50'])
  })

  it('「From NZD 4,999 per person」宽口径片段是完整的 NZD 4,999', () => {
    expect('From NZD 4,999 per person'.match(PRICE_CLAIM_RECALL_RE)).toEqual(['NZD 4,999'])
  })

  it('「4,999 NZD」严口径片段是完整的 4,999 NZD', () => {
    expect('4,999 NZD'.match(PRICE_CLAIM_STRICT_RE)).toEqual(['4,999 NZD'])
  })

  it('「3999元起」严口径片段是完整的 3999元', () => {
    expect('3999元起'.match(PRICE_CLAIM_STRICT_RE)).toEqual(['3999元'])
  })
})

describe('正则标志', () => {
  it('宽口径带 g 与 i 标志', () => {
    // 没有 g 时 String.prototype.match 只返回第一个片段,hasInventedNumber 只会检查一个价格。
    expect(PRICE_CLAIM_RECALL_RE.flags).toContain('g')
    expect(PRICE_CLAIM_RECALL_RE.flags).toContain('i')
  })

  it('严口径带 g 与 i 标志', () => {
    expect(PRICE_CLAIM_STRICT_RE.flags).toContain('g')
    expect(PRICE_CLAIM_STRICT_RE.flags).toContain('i')
  })

  it('一段文字里两个价格都要抓到', () => {
    const matches = 'Was NZD 5000 now NZD 4999'.match(PRICE_CLAIM_RECALL_RE)
    expect(matches).not.toBeNull()
    expect(matches?.length).toBe(2)
  })
})

describe('冻结的旧规则没有被改动', () => {
  it('LEGACY_PRICE_RECALL_RE 源字符串与冻结副本一致', () => {
    expect(LEGACY_PRICE_RECALL_RE.source).toBe(
      `(?:\\$|a\\$|nz\\$|\\baud\\b|￥)\\s*\\d[\\d,]*(?:\\.\\d+)?|\\d[\\d,]*(?:\\.\\d+)?\\s*(?:%|\\boff\\b|\\bdollars?\\b|\\bbucks\\b|\\/\\s*m²|\\/\\s*m2|\\/\\s*sqm|\\bper\\s*m²?)|\\d[\\d,]*\\s*\\bfor\\b\\s*\\d`,
    )
  })

  it('LEGACY_PRICE_STRICT_RE 源字符串与冻结副本一致', () => {
    expect(LEGACY_PRICE_STRICT_RE.source).toBe(
      `(?:\\$|a\\$|nz\\$|\\baud\\b|￥)\\s*\\d[\\d,]*(?:\\.\\d+)?|\\d[\\d,]*(?:\\.\\d+)?\\s*(?:\\bdollars?\\b|\\bbucks\\b)|\\d[\\d,]*(?:\\.\\d+)?\\s*%?\\s*\\boff\\b|\\b(?:save|saving|savings|discount|discounted|sale|rrp)\\b[^\\n]{0,12}?\\d[\\d,]*(?:\\.\\d+)?\\s*%|\\d[\\d,]*(?:\\.\\d+)?\\s*(?:\\/\\s*m²|\\/\\s*m2|\\/\\s*sqm|\\bper\\s*m²?\\b)|\\bbuy\\s*\\d[\\d,]*\\s*(?:\\bfor\\b|\\bget\\b)\\s*\\d`,
    )
  })

  it('LEGACY_DATE_RE 源字符串与冻结副本一致', () => {
    expect(LEGACY_DATE_RE.source).toBe(
      `\\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+\\d{2,4}\\b|\\b(?:19|20)\\d{2}\\b`,
    )
  })

  it('copy-generator 的私有 DATE_RE 没有漂移', () => {
    // 第 4 步替换掉 copy-generator 的 DATE_RE 时这条会变红 —— 那时请连同 claim-shadow-stats.ts 一起删掉冻结副本。
    // vitest 的工作目录就是仓库根(jsdom 环境下 import.meta.url 不是 file 协议,不能用它)
    const content = readFileSync(resolve(process.cwd(), 'src/lib/factory/copy-generator.ts'), 'utf8')
    expect(content).toContain('/' + LEGACY_DATE_RE.source + '/gi')
  })
})

describe('影子统计 date_strict 层与摘录', () => {
  it('date_strict 层只把精确日期算作新命中', () => {
    const rows = [
      { id: 'd1', source: 't', text: 'Departs 15 March' },
      { id: 'd2', source: 't', text: 'Book your 2027 tour' },
      { id: 'd3', source: 't', text: 'Planning made simple' },
    ]
    const report = compareClaimRules(rows)

    // 只有 d1 是精确日期;d2 的裸年份不算。
    expect(report.layers.date_strict.newHits).toBe(1)
    // 旧正则只命中 d2 的裸年份 2027,不命中 '15 March'。
    expect(report.layers.date_strict.legacyHits).toBe(1)
    expect(report.layers.date_strict.newlyHit).toBe(1)
    expect(report.layers.date_strict.lostHits).toBe(0)

    const dateNewlyHit = report.newlyHit.filter((hit) => hit.layer === 'date_strict')
    expect(dateNewlyHit.length).toBe(1)
    expect(dateNewlyHit[0].layer).toBe('date_strict')
    expect(dateNewlyHit[0].id).toBe('d1')
    expect(dateNewlyHit[0].fragments).toEqual(['15 March'])
  })

  it('摘录围绕命中位置展开,而不是永远截文案开头', () => {
    const text =
      'Planning your 2027 journey? '.repeat(8) +
      'Fares in NZD 4,999 per person. ' +
      'Planning your journey? '.repeat(8)
    const report = compareClaimRules([{ id: 'x', source: 't', text }])

    const strictNewlyHit = report.newlyHit.filter((hit) => hit.layer === 'price_strict')
    expect(strictNewlyHit.length).toBe(1)
    const excerpt = strictNewlyHit[0].excerpt
    expect(excerpt).toContain('NZD 4,999')
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
  })

  it('formatShadowReport 输出包含各层与明细标题', () => {
    const report = compareClaimRules([{ id: 'x', source: 't', text: 'From NZD 4,999' }])
    const formatted = formatShadowReport(report)
    expect(formatted).toContain('| price_strict |')
    expect(formatted).toContain('新增命中明细')
    expect(formatted).toContain('丢失命中(应为 0)')
  })
})

describe('影子统计函数 compareClaimRules', () => {
  const rows = [
    ...NORMAL_COPY.map((text, i) => ({ id: `n${i}`, source: 'test', text })),
    ...PRICE_POSITIVES.map((text, i) => ({ id: `p${i}`, source: 'test', text })),
    { id: 'null', source: 'test', text: null },
    { id: 'empty', source: 'test', text: '' },
  ]
  const report = compareClaimRules(rows)

  it('统计总行数与有文案行数', () => {
    expect(report.total).toBe(rows.length)
    expect(report.withText).toBe(rows.length - 2)
  })

  it('没有丢失命中', () => {
    expect(report.layers.price_recall.lostHits).toBe(0)
    expect(report.layers.price_strict.lostHits).toBe(0)
    expect(report.lostHits.length).toBe(0)
  })

  it('严口径新增命中数等于旧严口径漏掉的正例数', () => {
    const expected = PRICE_POSITIVES.filter((t) => !legacyStrictHit(t)).length
    expect(report.layers.price_strict.newlyHit).toBe(expected)
  })

  it('严口径新增命中全部来自价格正例', () => {
    const strictNewlyHit = report.newlyHit.filter((hit) => hit.layer === 'price_strict')
    for (const hit of strictNewlyHit) {
      expect(hit.id.startsWith('p')).toBe(true)
    }
  })
})

describe('连续调用结果一致', () => {
  it('共享 /g 正则不泄漏 lastIndex', () => {
    expect(containsPriceClaim('From NZD 4,999')).toBe(true)
    expect(containsPriceClaim('From NZD 4,999')).toBe(true)
    expect(containsPriceClaim('From NZD 4,999')).toBe(true)
    expect(containsDateClaim('15 March')).toBe(true)
    expect(containsDateClaim('15 March')).toBe(true)
    expect(containsDateClaim('15 March')).toBe(true)
    expect(findDateClaims('15 March')).toEqual(['15 March'])
    expect(findDateClaims('15 March')).toEqual(['15 March'])
  })
})
