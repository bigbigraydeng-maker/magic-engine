/**
 * Acceptance tests for the outbound claim scanner (design:
 * docs/specs/2026-10-14-outbound-gate-consolidation-design.md §4.5).
 *
 * Written by the reviewer, not the implementer, on purpose: the implementer's own
 * fixtures tend to agree with its own regexes. Every "must block" row here is a real
 * way a price / date / promise reaches a customer in Chinese or in English.
 */

import { describe, it, expect } from 'vitest'
import { scanOutboundClaims, type ClaimKind } from '../outbound-claims'

function kinds(text: string): ClaimKind[] {
  return scanOutboundClaims(text).map((h) => h.kind)
}
function valueOf(text: string, kind: ClaimKind): string | undefined {
  return scanOutboundClaims(text).find((h) => h.kind === kind)?.value
}

describe('price — must block, with normalised amount', () => {
  const cases: Array<[string, string]> = [
    ['每人3880纽币', '3880'],
    ['每人３８８０纽币', '3880'], // full-width
    ['三千八百八十纽币一位', '3880'],
    ['叁仟捌佰捌拾元整', '3880'],
    ['3880刀', '3880'],
    ['3880块', '3880'],
    ['3880蚊', '3880'],
    ['新币3880', '3880'],
    ['新西兰元3880', '3880'],
    ['NZD 3880', '3880'],
    ['NZ$3,880', '3880'],
    ['三千八就能走', '3800'],
    ['3千8', '3800'],
    ['3.88k', '3880'],
    ['3.8k', '3800'],
    ['单房差另加五百', '500'],
    ['价格 3 8 8 0', '3880'], // spaces between digits
    ['价格3️⃣8️⃣8️⃣0️⃣', '3880'], // keycap emoji digits
    ['价格3​880纽币', '3880'], // zero-width char inside the number
  ]
  it.each(cases)('%s', (text, amount) => {
    expect(kinds(text)).toContain('price')
    expect(valueOf(text, 'price')).toBe(amount)
  })
})

describe('date — must block, with normalised value', () => {
  const cases: Array<[string, string]> = [
    ['3月18号出发', '03-18'],
    ['三月十八日出发', '03-18'],
    ['3月18日', '03-18'],
    ['有效期至2026年12月31日', '2026-12-31'],
    ['有效期到2026/12/31', '2026-12-31'],
    ['12月31日截止', '12-31'],
  ]
  it.each(cases)('%s', (text, value) => {
    expect(kinds(text)).toContain('date')
    expect(valueOf(text, 'date')).toBe(value)
  })

  it.each(['下周三出发', '这个周末', '圣诞前报名', '国庆期间', '下个月出发', '春节前'])(
    'relative date: %s',
    (text) => {
      expect(kinds(text)).toContain('date')
    },
  )
})

describe('duration / response-time promise — must block', () => {
  it.each(['15天14晚', '十五日游', '两周行程', '我们三个工作日内回复您', '24小时内回复', '三天后给您答复'])(
    '%s',
    (text) => {
      expect(kinds(text)).toContain('duration')
    },
  )
})

describe('promise / visa / availability / discount — must block with no fact lookup', () => {
  it.each(['保证出签', '包过签', '一定能过', '百分百出签', '确保成功', '全额退款没问题'])('promise: %s', (text) => {
    expect(kinds(text)).toContain('promise')
  })
  it.each(['新西兰护照免签入境', '您不需要办签证', '签证一般都能通过', '拒签的话怎么办'])('visa: %s', (text) => {
    expect(kinds(text)).toContain('visa')
  })
  it.each(['仅剩2个名额', '名额有限，抓紧', '还有位置', '已经满团了', '余位不多'])('availability: %s', (text) => {
    expect(kinds(text)).toContain('availability')
  })
  it.each(['全网最低价', '免费升级', '现在报名有优惠', '立减200', '免费赠送行李箱'])('discount: %s', (text) => {
    expect(kinds(text)).toContain('discount')
  })
})

describe('embedding does not hide a claim', () => {
  const claim = '保证出签，每人3880纽币，3月18号出发'
  it('in the middle of ordinary courtesy', () => {
    const t = `您好，感谢您的咨询。${claim}。期待您的回复。`
    expect(kinds(t)).toEqual(expect.arrayContaining(['promise', 'price', 'date']))
  })
  it('repeated three times', () => {
    expect(kinds(claim.repeat(3))).toEqual(expect.arrayContaining(['promise', 'price', 'date']))
  })
  it('at the end of a 1700-character message', () => {
    const t = '感谢您的留言，我们的顾问会尽快联系您。'.repeat(90) + claim
    expect(t.length).toBeGreaterThan(1700)
    expect(kinds(t)).toEqual(expect.arrayContaining(['promise', 'price', 'date']))
  })
})

describe('English — same scanner, same strictness', () => {
  it.each([
    ['only nine hundred NZD for the trip', 'price'],
    ['NZ $ 3 880 per person', 'price'],
    ['AUD 900 per person', 'price'],
    ['departs 16 November 2026', 'date'],
    ['valid until Dec 31', 'date'],
    ['we guarantee your visa', 'promise'],
    ['only 2 seats left', 'availability'],
    ['a 15 day tour', 'duration'],
  ] as Array<[string, ClaimKind]>)('%s', (text, kind) => {
    expect(kinds(text)).toContain(kind)
  })
})

describe('fail closed', () => {
  it('a non-string input is reported as a hit, never as clean', () => {
    const scanAnything = (v: unknown) => scanOutboundClaims(v as never)
    expect(scanAnything(undefined).map((h) => h.kind)).toContain('scan_error')
    expect(scanAnything(null).map((h) => h.kind)).toContain('scan_error')
    expect(scanAnything(12345).map((h) => h.kind)).toContain('scan_error')
  })
})

describe('must pass — no false alarm on ordinary replies', () => {
  it.each([
    '感谢您的留言，我们的顾问稍后回复您。',
    '您好，请问大概几位出行？',
    '我帮你问一下同事，稍后回你',
    '您说的是新西兰南岛吗？',
    '欢迎随时联系我们，期待为您服务。',
    '团页在这里：https://ctstours.co.nz/tours/south-island?utm_campaign=me_daily_plan&utm_content=20261014',
    'Thanks for your message — one of our team will get back to you with the details shortly.',
    'Hi there, thanks for your interest. One of our consultants will be in touch.',
  ])('%s', (text) => {
    expect(scanOutboundClaims(text)).toEqual([])
  })
})

// ─── Review round 1 (子牙 / 魏征 / 狄仁杰) — every row below slipped through or misfired ───

describe('review: URL strip must not swallow the Chinese text after it', () => {
  it.each(['详情www.cts.co.nz价格3880纽币', 'https://a.com/x保证包过 价格$9999'])('%s', (text) => {
    expect(scanOutboundClaims(text).length).toBeGreaterThan(0)
  })
  it('the claim after a URL is found, the URL itself is ignored', () => {
    expect(kinds('https://a.com/x保证包过')).toContain('promise')
    expect(scanOutboundClaims('https://ctstours.co.nz/tours?utm_content=20261014')).toEqual([])
  })
})

describe('review: a second price after a price word is not swallowed', () => {
  it('团费3880，订金5000 reports both amounts', () => {
    const v = scanOutboundClaims('团费3880，订金5000').filter((h) => h.kind === 'price').map((h) => h.value)
    expect(v).toEqual(expect.arrayContaining(['3880', '5000']))
  })
  it('价格3880，另加2000 reports both', () => {
    const v = scanOutboundClaims('价格3880，另加2000').filter((h) => h.kind === 'price').map((h) => h.value)
    expect(v).toEqual(expect.arrayContaining(['3880', '2000']))
  })
})

describe('review: separators must not glue unrelated numbers together', () => {
  it('团费$3,880，12月31日出发 keeps 3880 and the date apart', () => {
    const hits = scanOutboundClaims('团费$3,880，12月31日出发')
    expect(hits.filter((h) => h.kind === 'price').map((h) => h.value)).toContain('3880')
    expect(hits.filter((h) => h.kind === 'price').map((h) => h.value)).not.toContain('388012')
    expect(hits.find((h) => h.kind === 'date')?.value).toBe('12-31')
  })
  it('价格3880，500元 is 3880 and 500, never 3880500', () => {
    const v = scanOutboundClaims('价格3880，500元').filter((h) => h.kind === 'price').map((h) => h.value)
    expect(v).toEqual(expect.arrayContaining(['3880', '500']))
    expect(v).not.toContain('3880500')
  })
})

describe('review: prices with no currency word', () => {
  it.each([
    ['这条路线每位3880，含住宿', '3880'],
    ['整个行程总共3880', '3880'],
    ['只要3880', '3880'],
    ['3880起', '3880'],
    ['3880/人', '3880'],
    ['每位三八八零就行', '3880'],
    ['我们的团费是三千八百八十', '3880'],
    ['三千八百八十', '3880'],
    ['三万八千', '38000'],
    ['贰仟捌佰', '2800'],
    ['3880 New Zealand dollars', '3880'],
    ['3 880 dollars', '3880'],
    ['三千八百八十圆', '3880'],
    ['3880塊', '3880'],
    ['紐幣3880', '3880'],
    ['貳佰紐幣', '200'],
  ])('%s', (text, amount) => {
    expect(scanOutboundClaims(text).filter((h) => h.kind === 'price').map((h) => h.value)).toContain(amount)
  })
})

describe('review: traditional Chinese is covered', () => {
  it.each([
    ['簽證我們可以幫您辦理，不會拒簽', 'visa'],
    ['這個團保證成行', 'promise'],
    ['保證出簽', 'promise'],
    ['免簽證入境', 'visa'],
    ['名額有限', 'availability'],
    ['全網最低價', 'discount'],
  ] as Array<[string, ClaimKind]>)('%s', (text, kind) => {
    expect(kinds(text)).toContain(kind)
  })
})

describe('review: more promise / discount / availability / visa wording', () => {
  it.each([
    ['包您满意', 'promise'],
    ['百分之百没问题', 'promise'],
    ['绝对没问题', 'promise'],
    ['肯定能过', 'promise'],
    ['担保出票', 'promise'],
    ['不满意全额退钱', 'promise'],
    ['we promise you a seat', 'promise'],
    ['full refund if you are not happy', 'promise'],
    ['半价', 'discount'],
    ['买一送一', 'discount'],
    ['free breakfast included', 'discount'],
    ['早鸟价', 'discount'],
    ['内部价', 'discount'],
    ['20 percent off', 'discount'],
    ['最后两个位置', 'availability'],
    ['只剩最后几位', 'availability'],
    ['almost full', 'availability'],
    ['no visa needed', 'visa'],
    ['you do not need a visa', 'visa'],
    ['签证没问题', 'visa'],
  ] as Array<[string, ClaimKind]>)('%s', (text, kind) => {
    expect(kinds(text)).toContain(kind)
  })
})

describe('review: more date and duration wording', () => {
  it.each([
    '十月二十号出发',
    '10月20号出发',
    '10月廿号出发',
    '12.31出发',
    '31/12出发',
    '12/31出发',
    '月底出发',
    '年底前报名',
    '明年三月',
    '11月初',
    '后天出发',
    'Dec. 31',
    '1st December',
    '31st of December',
    'december 31st',
    'tomorrow',
    'next friday',
    'this saturday',
    'end of the month',
  ])('date: %s', (text) => {
    expect(kinds(text)).toContain('date')
  })
  it.each(['10天', '7天行程', '7D6N', '七日六夜', '一星期', '两个星期', '一个半月', '3天2晚', '我们会在一个工作日内联系您。'])(
    'duration: %s',
    (text) => {
      expect(kinds(text)).toContain('duration')
    },
  )
})

describe('review: false alarms removed', () => {
  it.each([
    '我们一起去看看吧，三位同行',
    '一定要带护照',
    '第一次来新西兰吗',
    '第三天去罗托鲁瓦',
    '评分4.8，非常满意',
    '万一有变化我们会通知您',
    '我们的电话是021 123 4567',
    'Please feel free to contact us any time.',
    'Feel free to ask if you have any questions.',
  ])('%s', (text) => {
    expect(scanOutboundClaims(text)).toEqual([])
  })
})

describe('review: hard limits, fail closed', () => {
  it('input over the length cap is reported as scan_error input_too_long', () => {
    const hits = scanOutboundClaims('您好'.repeat(1600))
    expect(hits).toEqual([{ kind: 'scan_error', match: 'input_too_long' }])
  })
  it('very long input is reported, not scanned for seconds', () => {
    const t0 = Date.now()
    const hits = scanOutboundClaims('1'.repeat(50000))
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(hits.map((h) => h.kind)).toContain('scan_error')
  })
  it('a number too large to be a number is not silently dropped', () => {
    expect(scanOutboundClaims('价格$' + '9'.repeat(400)).length).toBeGreaterThan(0)
  })
  it('long chinese-numeral run stays fast', () => {
    const t0 = Date.now()
    scanOutboundClaims('一二三四五六七八九十'.repeat(250))
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})

// ─── Review round 2 ───
describe('review 2: price word followed by filler before the number', () => {
  it.each([
    '团费：4880', '团费是4880', '团费为4880', '价格: 4880', '总价是 4880', '团费约4880', '团费大概4880左右',
    '费用：３，８８０', '价格：4,880', '团费(含税)4880', 'Price: 4880',
  ])('%s', (text) => {
    const v = scanOutboundClaims(text).filter((h) => h.kind === 'price').map((h) => h.value)
    expect(v.some((x) => x === '4880' || x === '3880' || x === '880' || x === '3' || Number(x) > 0)).toBe(true)
    expect(v.length).toBeGreaterThan(0)
  })
  it('the amount is the right one', () => {
    expect(scanOutboundClaims('团费：4880').find((h) => h.kind === 'price')?.value).toBe('4880')
    expect(scanOutboundClaims('价格：4,880').find((h) => h.kind === 'price')?.value).toBe('4880')
    expect(scanOutboundClaims('费用：３，８８０').find((h) => h.kind === 'price')?.value).toBe('3880')
  })
})

describe('review 2: day-first and labelled numeric dates', () => {
  it.each(['25/12/2026', '25/12/26', '出发日期：12.25', '出发：12/25', '日期：25/12', '报名截止：12/20'])('%s', (text) => {
    expect(kinds(text)).toContain('date')
  })
  it('25/12/2026 normalises to 2026-12-25', () => {
    expect(scanOutboundClaims('25/12/2026').map((h) => h.value)).toContain('2026-12-25')
  })
})

describe('review 2: more wording', () => {
  it.each([
    ['保你满意', 'promise'], ['一定帮你搞定', 'promise'], ['肯定行', 'promise'], ['稳了', 'promise'], ['不成功不收费', 'promise'],
    ['不会有问题', 'promise'], ['絕對沒問題', 'promise'],
    ['入境不用办理手续', 'visa'], ['visa is not needed', 'visa'], ['no visa required', 'visa'],
    ['还剩两个位置', 'availability'], ['座位不多了', 'availability'], ['剩下最后2席', 'availability'], ['仅余3个', 'availability'],
    ['only 2 left', 'availability'], ['last two seats', 'availability'],
    ['买一赠一', 'discount'], ['白送', 'discount'], ['满减', 'discount'], ['直降500', 'discount'], ['half the price', 'discount'],
  ] as Array<[string, ClaimKind]>)('%s', (text, kind) => {
    expect(kinds(text)).toContain(kind)
  })
})

// ─── Review round 2b (魏征 二审) ───
describe('review 2b: no catastrophic regex time on 3000-char inputs', () => {
  it.each([
    ['三'.repeat(1000) + ' '.repeat(1999)],
    ['十'.repeat(1000) + ' '.repeat(1999)],
    ['三'.repeat(2999)],
    ['三'.repeat(1400) + '天' + '三'.repeat(1400)],
    ['1 '.repeat(1499)],
  ])('adversarial input %#', (text) => {
    const t0 = Date.now()
    scanOutboundClaims(text)
    expect(Date.now() - t0).toBeLessThan(300)
  })
})

describe('review 2b: wrong normalised amounts', () => {
  it.each([
    ['三千二百零五元', '3205'],
    ['十万元', '100000'],
    ['3万8', '38000'],
    ['两千零五块', '2005'],
  ])('%s', (text, amount) => {
    expect(scanOutboundClaims(text).filter((h) => h.kind === 'price').map((h) => h.value)).toContain(amount)
  })
})

describe('review 2b: English price words and more Chinese price shapes', () => {
  it.each(['price is 3880', 'costs 3880', 'total 4000', 'only 4000', '3880 per couple', 'from 3880', '4000 kiwi', '一共4000', '总计4000', '共4000', '4000左右', '低至3880'])(
    '%s',
    (text) => {
      expect(kinds(text)).toContain('price')
    },
  )
})

describe('review 2b: dates without a month, month-only, and visa/availability/discount wording', () => {
  it.each(['20号出发', '二十号出发', '15日截止', '11月出发', '十二月出发', '2026年11月', 'on the 20th', '星期三出发', 'on friday'])('date: %s', (text) => {
    expect(kinds(text)).toContain('date')
  })
  it.each([
    ['需要签证', 'visa'], ['you need a visa', 'visa'],
    ['还有座位', 'availability'], ['有空位', 'availability'], ['seats available', 'availability'], ['订满', 'availability'], ['sold-out', 'availability'],
    ['免费取消', 'discount'], ['免费改期', 'discount'], ['no extra charge', 'discount'], ['save 200', 'discount'], ['省200', 'discount'],
    ['will be refunded', 'promise'], ['we will refund you in full', 'promise'],
  ] as Array<[string, ClaimKind]>)('%s', (text, kind) => {
    expect(kinds(text)).toContain(kind)
  })
  it('a bare 20号 in ordinary text (e.g. 1号线 / 20号楼) is not flagged without a date marker', () => {
    expect(scanOutboundClaims('酒店在20号楼')).toEqual([])
    expect(scanOutboundClaims('请坐1号线地铁')).toEqual([])
  })
})
