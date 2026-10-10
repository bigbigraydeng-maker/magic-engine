import { describe, expect, it } from 'vitest'
import { PRICE_CLAIM_RECALL_RE, PRICE_CLAIM_STRICT_RE, containsPriceClaim } from './price-claim'
import { containsDateClaim, findDateClaims } from './date-claim'

// 2026-10-05 补强前的旧规则,逐字冻结在这里,只用来证明「旧规则命中的,新规则仍然命中」。
// 影子期结束(价格闸稳定)后可以整段删除。只许用 String.prototype.match 调用(带 g 标志)。
const LEGACY_RECALL_SRC = `(?:\\$|a\\$|nz\\$|\\baud\\b|￥)\\s*\\d[\\d,]*(?:\\.\\d+)?|\\d[\\d,]*(?:\\.\\d+)?\\s*(?:%|\\boff\\b|\\bdollars?\\b|\\bbucks\\b|\\/\\s*m²|\\/\\s*m2|\\/\\s*sqm|\\bper\\s*m²?)|\\d[\\d,]*\\s*\\bfor\\b\\s*\\d`
const LEGACY_STRICT_SRC = `(?:\\$|a\\$|nz\\$|\\baud\\b|￥)\\s*\\d[\\d,]*(?:\\.\\d+)?|\\d[\\d,]*(?:\\.\\d+)?\\s*(?:\\bdollars?\\b|\\bbucks\\b)|\\d[\\d,]*(?:\\.\\d+)?\\s*%?\\s*\\boff\\b|\\b(?:save|saving|savings|discount|discounted|sale|rrp)\\b[^\\n]{0,12}?\\d[\\d,]*(?:\\.\\d+)?\\s*%|\\d[\\d,]*(?:\\.\\d+)?\\s*(?:\\/\\s*m²|\\/\\s*m2|\\/\\s*sqm|\\bper\\s*m²?\\b)|\\bbuy\\s*\\d[\\d,]*\\s*(?:\\bfor\\b|\\bget\\b)\\s*\\d`
const LEGACY_RECALL_RE = new RegExp(LEGACY_RECALL_SRC, 'gi')
const LEGACY_STRICT_RE = new RegExp(LEGACY_STRICT_SRC, 'gi')

const recallHit = (t: string) => t.match(PRICE_CLAIM_RECALL_RE) !== null
const legacyRecallHit = (t: string) => t.match(LEGACY_RECALL_RE) !== null
const legacyStrictHit = (t: string) => t.match(LEGACY_STRICT_RE) !== null

// 正常文案(无价格/日期声明):严口径、严日期都不能命中,宽口径不能比旧规则多命中
const NORMAL_COPY: string[] = [
  'Planning made simple', 'We map the logistics', "Let's plan yours together",
  'Book your 2026 China tour with us today', '12 day itinerary through Yunnan', 'Auckland showroom open 7 days',
  'We have been doing this for 25 years', '100% Kiwi owned and operated', '100% authentic Sichuan cuisine',
  'Top 10 for 2026 — where to go next', 'Open 7 days for walk-in customers', 'Premium walnut floors',
  'Level 3 showroom', 'Walk the Great Wall at sunrise with a local guide', 'Hobbiton, Rotorua and Queenstown in one small-group journey',
  'Small groups, local guides, no rush', 'Ask us about a tailor-made South Island road trip', '4 star hotels and private transfers included',
  'Message us on WhatsApp and we will reply within 24 hours', '5 minutes from Auckland CBD', '3 bedrooms, 2 bathrooms, double garage',
  '450m² section in a quiet street', 'Open home this Saturday 11am — all welcome', 'Why choose SPC flooring for a busy family home?',
  'Our team has helped 300 families find the right floor', '15 days of memories, one seamless itinerary', 'Join our 3 day Milford Sound adventure',
  'Sunrise at Mount Cook, 8 hours of hiking', '24/7 customer support in Chinese and English', 'Version 2.0 of our booking portal is live',
  'Flights depart from Auckland, Christchurch and Queenstown', 'Rated 4.9 stars by 1200 happy travellers', 'Follow us for travel tips every Friday',
  'Visit us at Level 1, 22 Market Street, Auckland', 'Shop 5 Mayfair Plaza, now open', '12 Marsden Road showroom',
  'Book our CNY tours before they fill up', '欢迎来新西兰,体验最地道的南岛环线', '每月都有出发,全程中文导游',
  '咨询后3个工作日内回复您', '三天两夜奥克兰深度游', '澳洲和新西兰客户都可以预约上门量尺',
  '元旦快乐,新的一年一起出发',
]

// 价格正例:严口径(会挡发布)与宽口径都必须命中
const PRICE_POSITIVES: string[] = [
  'From NZD 4,999', 'NZD4999', '4,999 NZD', '¥3999', '￥3999', '3999元', 'USD 1,200', '纽币 3999', '3999纽币',
  '新西兰元3999', 'From NZ$4,999', 'AUD88', 'aud 88', 'RMB 12000', '12,000 RMB', 'NZD 4,999.00', 'From NZD 1.3k',
  '1.3k NZD', '$1.3k', 'US$ 99', '99 USD', '澳元 2999', '2999 美元', '人民币8999', '8999人民币', '澳币 3999', '美金 99',
  'A$1,299', 'Only 99 dollars', 'Save 30% this month',
  '新西兰币3999', '纽元 3999', '1.2万元', '2万纽币', '8千元', '999澳刀', '999美刀', '4999 NZDpp', 'NZD 99 per night',
  'NZD 99 free cancellation', '¥3999 人均', 'From NZD 4,999.50',
]

// 价格反例:严口径(会挡发布)不能命中
const PRICE_NEGATIVES: string[] = [
  'CNY 2027 tours now open', 'Spring 2027 CNY special', '#CNY2027 Lunar New Year', 'CNY 8 day tour',
  'All prices in NZD\n7 day Queenstown tour', 'Currency: USD\n\n5 days itinerary',
  '5元件', '2元宇宙', '20 元老', '元旦快乐', '2 NZD-friendly cafes', '5 audience members', 'Auditorium 4',
  '10k followers', '4K video', '8K drone', '10k steps', 'From 1.3k', '24/7 support', 'Version 2.0',
  '15 days', '2027 tour', '4 star hotel',
  'All prices in NZD 7 day itinerary', 'Prices quoted in NZD 2 adults 1 child', 'Fares in USD 3 nights minimum',
  'Price in RMB 3 days', '请使用澳币 3 天后到账', '美金 10 人', '2027元旦快乐', '5元月', '3元宝', '3元数据中心',
  'Fraud 5 cases', 'Claudia 2 rooms', 'Currency: USD\n\n12 Queen Street, Auckland', // 币种与数字隔着换行,不配对
]

// 日期正例:[文本, 期望的唯一片段]
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

// 日期反例:containsDateClaim 必须是 false
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

// 旧规则已经命中的文本:新规则必须仍然命中(超集)
const LEGACY_POSITIVES: string[] = [
  '$29/m² 起', 'From A$1,299 per person', 'NZ$450 twin share', 'Save 40% off this week', 'Save 30% this month',
  'Only 99 dollars', 'Buy 2 for 1 this weekend', 'AUD 88 per m²', 'SPC flooring 29/sqm installed', 'From $199 per person',
  '100% Kiwi owned and operated', 'Top 10 for 2026 — where to go next', '20 bucks', '40% off',
]

describe('正常文案照常放行(回归集)', () => {
  it('回归集至少 30 条', () => {
    expect(NORMAL_COPY.length).toBeGreaterThanOrEqual(30)
  })
  it.each(NORMAL_COPY)('「%s」不触发价格/日期声明,也不新增命中', (t) => {
    expect(containsPriceClaim(t)).toBe(false)
    expect(containsDateClaim(t)).toBe(false)
    expect(recallHit(t) && !legacyRecallHit(t)).toBe(false)
  })
})

describe('价格识别', () => {
  it('正例至少 25 条,反例至少 15 条', () => {
    expect(PRICE_POSITIVES.length).toBeGreaterThanOrEqual(25)
    expect(PRICE_NEGATIVES.length).toBeGreaterThanOrEqual(15)
  })
  it.each(PRICE_POSITIVES)('正例「%s」严口径与宽口径都命中', (t) => {
    expect(containsPriceClaim(t)).toBe(true)
    expect(recallHit(t)).toBe(true)
  })
  it.each(PRICE_NEGATIVES)('反例「%s」严口径不命中', (t) => {
    expect(containsPriceClaim(t)).toBe(false)
  })
  it.each(['10k followers', 'From 1.3k', '10k steps'])('「%s」宽口径命中、严口径不命中(有意取舍:宽口径只触发落模板)', (t) => {
    expect(recallHit(t)).toBe(true)
    expect(containsPriceClaim(t)).toBe(false)
  })
  it.each(['4K video', '8K drone'])('「%s」视频分辨率,宽口径也不命中', (t) => {
    expect(recallHit(t)).toBe(false)
  })
})

describe('命中片段要完整(白名单靠片段里的数字比对)', () => {
  it('小数、币种在前/在后、元 都取到整段', () => {
    expect('From NZD 4,999.50'.match(PRICE_CLAIM_STRICT_RE)).toEqual(['NZD 4,999.50']) // 截成 "NZD 4" 会被当成数字 4
    expect('From NZD 4,999 per person'.match(PRICE_CLAIM_RECALL_RE)).toEqual(['NZD 4,999'])
    expect('4,999 NZD'.match(PRICE_CLAIM_STRICT_RE)).toEqual(['4,999 NZD'])
    expect('3999元起'.match(PRICE_CLAIM_STRICT_RE)).toEqual(['3999元'])
  })
  it('带 g 标志:一句话里两个价格都被逐个检查(否则 hasInventedNumber 只查第一个)', () => {
    for (const re of [PRICE_CLAIM_RECALL_RE, PRICE_CLAIM_STRICT_RE]) expect(re.flags).toContain('g')
    expect('Was NZD 5000 now NZD 4999'.match(PRICE_CLAIM_RECALL_RE)).toHaveLength(2)
  })
  it('连续调用结果一致(共享 /g 正则不泄漏 lastIndex)', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(containsPriceClaim('From NZD 4,999')).toBe(true)
      expect(containsDateClaim('15 March')).toBe(true)
      expect(findDateClaims('15 March')).toEqual(['15 March'])
    }
  })
})

describe('日期识别', () => {
  it('反例至少 15 条', () => {
    expect(DATE_NEGATIVES.length).toBeGreaterThanOrEqual(15)
  })
  it.each(DATE_POSITIVES)('正例「%s」识别为 [%s]', (text, expected) => {
    expect(findDateClaims(text)).toEqual([expected])
    expect(containsDateClaim(text)).toBe(true)
  })
  it.each(DATE_NEGATIVES)('反例「%s」不识别为日期', (t) => {
    expect(findDateClaims(t)).toEqual([])
    expect(containsDateClaim(t)).toBe(false)
  })
  it('空值不炸', () => {
    expect(containsDateClaim(null)).toBe(false)
    expect(containsDateClaim(undefined)).toBe(false)
    expect(containsDateClaim('')).toBe(false)
    expect(findDateClaims(null)).toEqual([])
  })
})

describe('超集:旧规则命中的,新规则必须仍然命中', () => {
  it.each(LEGACY_POSITIVES)('「%s」', (t) => {
    expect(legacyStrictHit(t) || legacyRecallHit(t)).toBe(true) // 这条用例本身有意义
    if (legacyStrictHit(t)) expect(containsPriceClaim(t)).toBe(true)
    if (legacyRecallHit(t)) expect(recallHit(t)).toBe(true)
  })
  it('任意两条文案拼接也成立', () => {
    const all = [...NORMAL_COPY, ...PRICE_POSITIVES, ...PRICE_NEGATIVES, ...LEGACY_POSITIVES]
    const violations: string[] = []
    for (const a of all) {
      for (const b of all) {
        const joined = `${a} ${b}`
        if (legacyRecallHit(joined) && !recallHit(joined)) violations.push(joined)
        if (legacyStrictHit(joined) && !containsPriceClaim(joined)) violations.push(joined)
      }
    }
    expect(violations).toEqual([])
  })
  it('新正则的开头原样包含旧正则', () => {
    expect(PRICE_CLAIM_RECALL_RE.source.startsWith(LEGACY_RECALL_RE.source)).toBe(true)
    expect(PRICE_CLAIM_STRICT_RE.source.startsWith(LEGACY_STRICT_RE.source)).toBe(true)
  })
})
